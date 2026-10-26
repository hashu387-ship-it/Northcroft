import { Suspense, useEffect, useRef, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ClipboardList,
  FileSpreadsheet,
  FolderKanban,
  House,
  Inbox,
  MapPin,
  Megaphone,
  MessagesSquare,
  Ellipsis,
  Search,
  Settings,
  SquareCheckBig,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { usePeople, useUnreadCount } from "@/lib/api";
import { useChats } from "@/lib/chats";
import { useAuth, useMe } from "@/lib/auth";
import { useRealtime } from "@/lib/realtime";
import { useOnlineTracking } from "@/lib/online";
import { registerServiceWorker, setBadge, syncPushSubscription } from "@/lib/push";
import { useAppUpdates } from "@/lib/updates";
import { sendsDailyUpdate } from "@/lib/dailyUpdates";
import { supabase } from "@/lib/supabase";
import { Avatar, Loading } from "@/components/ui";
import ChangePassword from "@/pages/ChangePassword";
import ProfileSetup from "@/pages/ProfileSetup";
import { LogoMark, Wordmark } from "@/components/Brand";
import { PersonCardHost } from "@/components/People";
import { CelebrationHost } from "@/components/Celebration";
import { SEARCH_SHORTCUT, SearchHost } from "@/components/Search";
import { openSearch } from "@/lib/search";
import { OfflineBar, OutboxRunner } from "@/components/Offline";
import { blockStrayDrops } from "@/components/DropZone";

function useUnackedCount(userId: string) {
  return useQuery({
    queryKey: ["announcements", "unacked", userId],
    queryFn: async () => {
      const [{ data: anns }, { data: acks }] = await Promise.all([
        supabase.from("announcements").select("id, author_id, requires_ack").eq("requires_ack", true).gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
        supabase.from("announcement_acks").select("announcement_id").eq("user_id", userId),
      ]);
      const done = new Set((acks ?? []).map((a) => a.announcement_id));
      return (anns ?? []).filter((a) => a.author_id !== userId && !done.has(a.id)).length;
    },
  });
}

function Wallpaper() {
  return (
    <div className="wallpaper" aria-hidden>
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div className="blob b4" />
      <div className="blob b5" />
    </div>
  );
}

export function Background({ children }: { children: ReactNode }) {
  return (
    <>
      <Wallpaper />
      {children}
    </>
  );
}

/** Sign-in backdrop: the Northcroft tower, softly blurred behind the glass card. */
export function PhotoBackground({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="auth-photo" aria-hidden>
        <div className="img" />
        <div className="shade" />
      </div>
      {children}
    </>
  );
}

const TAB_ROOTS = ["/", "/my-tasks", "/projects", "/chats", "/inbox", "/more"];

export default function AppShell() {
  const me = useMe();
  const { canAssign } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadCount(me.id).data ?? 0;
  const unacked = useUnackedCount(me.id).data ?? 0;
  const people = usePeople();
  const chatUnread = useChats(me.id, people).unread;

  useRealtime(me.id);
  useOnlineTracking(me.id);
  // A file dropped outside an attach area doesn't open in the browser.
  useEffect(() => blockStrayDrops(), []);
  const appUpdate = useAppUpdates();

  useEffect(() => {
    registerServiceWorker().then(() => syncPushSubscription());
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "navigate" && typeof e.data.url === "string") {
        const u = new URL(e.data.url, window.location.origin);
        navigate(u.pathname + u.search);
      }
      if (e.data?.type === "resubscribe") syncPushSubscription();
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [navigate]);

  useEffect(() => {
    setBadge(unread);
    document.title = unread ? `(${unread}) Northcroft` : "Northcroft";
  }, [unread]);

  // On phones the content scrolls inside the app frame rather than the whole page. iPhones on
  // iOS 26 can let the tab bar, the + button and the background slide up with a scrolling page;
  // with the page itself still, they stay put. (Desktop keeps normal page scrolling.)
  // Only while the app's own screens show (not the first-time password and profile set-up pages).
  const shellShown = !me.must_change_password && !!me.avatar_url && !!me.phone;
  useEffect(() => {
    if (!shellShown) return;
    const root = document.documentElement;
    root.classList.add("shell-scroll");
    return () => root.classList.remove("shell-scroll");
  }, [shellShown]);

  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (me.must_change_password) return <ChangePassword forced />;
  // Everyone needs a photo and a mobile number before using the app.
  if (!me.avatar_url || !me.phone) return <ProfileSetup />;

  const isRoot = TAB_ROOTS.includes(location.pathname);
  const nav = [
    { to: "/", label: "Home", icon: House, end: true },
    // Someone who only gives out tasks sees every assigned task there instead of their own.
    { to: "/my-tasks", label: me.assignable === false ? "Assigned tasks" : "My tasks", icon: SquareCheckBig },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    // Every project's VOs in one table, laid out like the VO log spreadsheet.
    { to: "/vo-log", label: "VO log", icon: FileSpreadsheet },
    { to: "/inbox", label: "Inbox", icon: Inbox, count: unread },
    { to: "/announcements", label: "Announcements", icon: Megaphone, count: unacked },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    { to: "/chats", label: "Chats", icon: MessagesSquare, count: chatUnread },
    // The team sends a daily update; managers and seniors read everyone's.
    ...(sendsDailyUpdate(me) || canAssign ? [{ to: "/updates", label: "Daily updates", icon: ClipboardList }] : []),
    // People who don't check in see "Attendance" (the team's board) if they manage, otherwise nothing.
    ...(!me.attendance_exempt
      ? [{ to: "/attendance", label: "Check in", icon: MapPin }]
      : canAssign
        ? [{ to: "/attendance", label: "Attendance", icon: MapPin }]
        : []),
  ];
  const manage = [
    ...(canAssign ? [{ to: "/workload", label: "Workload", icon: BarChart3 }] : []),
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="app">
      <Wallpaper />

      <aside className="sidebar glass">
        <Link to="/" className="brand" style={{ color: "inherit" }} aria-label="Northcroft home">
          <LogoMark variant="tile" size={38} className="brand-tile" />
          <span>
            <span className="brand-word">
              <Wordmark height={16} />
            </span>
            <small>QS workspace</small>
          </span>
        </Link>
        <button type="button" className="nav-search" onClick={openSearch} aria-label="Search">
          <Search />
          <span>Search</span>
          <kbd>{SEARCH_SHORTCUT}</kbd>
        </button>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => (isActive || (n.to === "/chats" && /^\/chats?(\/|$)/.test(location.pathname)) ? "active" : "")}
            >
              <n.icon />
              {n.label}
              {!!n.count && <span className="count">{n.count > 99 ? "99+" : n.count}</span>}
            </NavLink>
          ))}
          <div className="nav-label">Manage</div>
          {manage.map((n) => (
            <NavLink key={n.to} to={n.to}>
              <n.icon />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/settings" className="sidebar-user">
          <Avatar person={me} size={36} />
          <span className="meta">
            <b>{me.short_name}</b>
            <span>{me.title}</span>
          </span>
        </Link>
      </aside>

      <header className="topbar glass">
        <div className="side">
          {isRoot ? (
            <Link to="/" aria-label="Northcroft home" style={{ lineHeight: 0 }}>
              <LogoMark variant="tile" size={32} />
            </Link>
          ) : (
            <button className="icon-btn plain" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))} aria-label="Back">
              <ChevronLeft />
            </button>
          )}
        </div>
        <div className="title brand-word">
          <Wordmark height={15} />
        </div>
        <div className="side right">
          <button type="button" className="icon-btn plain" onClick={openSearch} aria-label="Search">
            <Search />
          </button>
          {!me.attendance_exempt && (
            <Link to="/attendance" className="icon-btn plain" aria-label="Check in">
              <MapPin />
            </Link>
          )}
          <Link to="/settings" aria-label="Settings">
            <Avatar person={me} size={32} />
          </Link>
        </div>
      </header>

      <OfflineBar />
      <OutboxRunner userId={me.id} />

      <main className="main" ref={mainRef}>
        <Suspense fallback={<div className="center-screen"><Loading /></div>}>
          <Outlet />
        </Suspense>
      </main>

      <nav className="tabbar glass-strong" aria-label="Main">
        <NavLink to="/" end>
          <House />
          Home
        </NavLink>
        <NavLink to="/my-tasks">
          <SquareCheckBig />
          Tasks
        </NavLink>
        <NavLink to="/projects">
          <FolderKanban />
          Projects
        </NavLink>
        <NavLink to="/chats" className={() => (/^\/chats?(\/|$)/.test(location.pathname) ? "active" : "")}>
          <MessagesSquare />
          Chats
          {!!chatUnread && <span className="dot">{chatUnread > 99 ? "99+" : chatUnread}</span>}
        </NavLink>
        <NavLink to="/inbox">
          <Inbox />
          Inbox
          {!!unread && <span className="dot">{unread > 99 ? "99+" : unread}</span>}
        </NavLink>
        <NavLink to="/more" className={({ isActive }) => (isActive || ["/announcements", "/calendar", "/attendance", "/updates", "/vo-log", "/workload", "/settings"].some((p) => location.pathname.startsWith(p)) ? "active" : "")}>
          <Ellipsis />
          More
          {!!unacked && <span className="dot">{unacked}</span>}
        </NavLink>
      </nav>
      <PersonCardHost />
      <CelebrationHost />
      <SearchHost />
      {appUpdate.ready && (
        <div className="update-bar" role="status">
          <span>A new version of the app is ready.</span>
          <button className="btn small primary" type="button" onClick={appUpdate.update}>
            Update
          </button>
        </div>
      )}
    </div>
  );
}
