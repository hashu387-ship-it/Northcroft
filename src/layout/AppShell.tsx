import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { isMorphing, morphBack } from "@/lib/morph";
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  BarChart3,
  Timer,
  CalendarDays,
  ChevronLeft,
  CircleCheckBig,
  ClipboardList,
  FileClock,
  FileSpreadsheet,
  FolderKanban,
  House,
  Inbox,
  MapPin,
  Megaphone,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePeople, useUnreadCount } from "@/lib/api";
import { useChats } from "@/lib/chats";
import { useAuth, useMe } from "@/lib/auth";
import { useRealtime } from "@/lib/realtime";
import { useSubmissionsDue } from "@/lib/submissions";
import { useOnlineTracking } from "@/lib/online";
import { registerServiceWorker, setBadge, syncPushSubscription } from "@/lib/push";
import { useAppUpdates } from "@/lib/updates";
import { sendsDailyUpdate } from "@/lib/dailyUpdates";
import { supabase } from "@/lib/supabase";
import { Avatar, Loading } from "@/components/ui";
import ChangePassword from "@/pages/ChangePassword";
import ProfileSetup from "@/pages/ProfileSetup";
import { ContextMenuHost } from "@/components/ContextMenu";
import { PersonCardHost } from "@/components/People";
import { CallHost } from "@/calls/CallScreen";
import { CelebrationHost } from "@/components/Celebration";
import { AppPopups } from "@/components/AppPopups";
import { isAndroidApp, isNativeApp } from "@/native/platform";
import { FaceIdLock } from "@/native/FaceIdLock";

// The iPhone app's own parts (notification buttons, check-in at the office, share sheet); never loaded in a browser.
const NativeBridge = lazy(() => import("@/native/NativeBridge"));
const AndroidBridge = lazy(() => import("@/native/AndroidBridge"));
import { SEARCH_SHORTCUT, SearchHost } from "@/components/Search";
import { openSearch } from "@/lib/search";
import { OfflineBar, OutboxRunner } from "@/components/Offline";
import { blockStrayDrops } from "@/components/DropZone";
import { useEdgeSwipeBack, usePullToRefresh } from "@/lib/gestures";

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

// The tab bar's four sections. Everything else opens on top of them, with a back button.
const TAB_ROOTS = ["/", "/my-tasks", "/chats", "/inbox"];

export default function AppShell() {
  const me = useMe();
  const { canAssign } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadCount(me.id).data ?? 0;
  const unacked = useUnackedCount(me.id).data ?? 0;
  const people = usePeople();
  const chatUnread = useChats(me.id, people).unread;
  const subsDue = useSubmissionsDue();

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
  const layerRef = useRef<HTMLDivElement>(null);
  const ptrRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    mainRef.current?.scrollTo({ top: 0 });
    window.dispatchEvent(new Event("nc-route"));
  }, [location.pathname]);

  // Pages slide in the way you're going: forward from the right, back from the left. Switching
  // between the tab bar's sections just cross-fades (they sit side by side, not on top). After a
  // swipe back from the edge the old page has already slid away, so the new one just settles in.
  // Set before the new page is painted, so it starts with the right movement.
  const navType = useNavigationType();
  const prevPath = useRef(location.pathname);
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const from = prevPath.current;
    prevPath.current = location.pathname;
    if (from === location.pathname) return;
    if (layer.dataset.swiped) {
      delete layer.dataset.swiped;
      layer.dataset.nav = "settle";
      return;
    }
    const tabs = TAB_ROOTS.includes(from) && TAB_ROOTS.includes(location.pathname);
    layer.dataset.nav = isMorphing() ? "morph" : tabs ? "fade" : navType === "POP" ? "back" : "forward";
  }, [location.key, location.pathname, navType]);

  // Phone gestures: swipe from the left edge to go back, pull down to refresh.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;
  const canGoBack = useCallback(() => !TAB_ROOTS.includes(pathRef.current) && ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0, []);
  const goBack = useCallback(() => navigate(-1), [navigate]);
  useEdgeSwipeBack(mainRef, layerRef, canGoBack, goBack, shellShown, location.key);
  const qc = useQueryClient();
  const refresh = useCallback(() => qc.refetchQueries({ type: "active" }), [qc]);
  usePullToRefresh(mainRef, layerRef, ptrRef, refresh, shellShown);

  if (me.must_change_password) return <ChangePassword forced />;
  // Everyone needs a photo and a mobile number before using the app.
  if (!me.avatar_url || !me.phone) return <ProfileSetup />;

  const isRoot = TAB_ROOTS.includes(location.pathname);
  // The side menu on computers and iPads, in sections, with the accent-coloured icons of a Mac sidebar.
  type Item = { to: string; label: string; icon: typeof House; end?: boolean; count?: number };
  const home: Item = { to: "/", label: "Home", icon: House, end: true };
  const sections: { label: string; items: Item[] }[] = [
    {
      label: "Work",
      items: [
        // Someone who only gives out tasks sees every assigned task there instead of their own.
        { to: "/my-tasks", label: me.assignable === false ? "Assigned tasks" : "My tasks", icon: CircleCheckBig },
        { to: "/projects", label: "Projects", icon: FolderKanban },
        // Every project's VOs in one table, laid out like the VO log spreadsheet.
        { to: "/vo-log", label: "VO log", icon: FileSpreadsheet },
        // Deadlines for what the team has to send, with the days left on each.
        { to: "/submissions", label: "Submissions", icon: FileClock, count: subsDue },
        // The team sends a daily update; managers and seniors read everyone's.
        ...(sendsDailyUpdate(me) || canAssign ? [{ to: "/updates", label: "Daily updates", icon: ClipboardList }] : []),
      ],
    },
    {
      label: "Team",
      items: [
        { to: "/team", label: "Team", icon: Users },
        { to: "/chats", label: "Chats", icon: MessageCircle, count: chatUnread },
        { to: "/calls", label: "Calls", icon: Phone },
        { to: "/announcements", label: "Announcements", icon: Megaphone, count: unacked },
        { to: "/calendar", label: "Calendar", icon: CalendarDays },
        { to: "/inbox", label: "Inbox", icon: Inbox, count: unread },
      ],
    },
    {
      label: "Attendance",
      // People who don't check in see "Attendance" (the team's board) if they manage, otherwise nothing.
      items: !me.attendance_exempt
        ? [{ to: "/attendance", label: "Check in", icon: MapPin }]
        : canAssign
          ? [{ to: "/attendance", label: "Attendance", icon: MapPin }]
          : [],
    },
    {
      label: "Manage",
      items: [
        ...(canAssign ? [{ to: "/workload", label: "Workload", icon: BarChart3 }] : []),
        { to: "/time", label: "Time report", icon: Timer },
        { to: "/settings", label: "Settings", icon: Settings },
      ],
    },
  ];
  const navLink = (n: Item) => (
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
  );

  return (
    <div className="app">
      <Wallpaper />

      <aside className="sidebar glass">
        <Link to="/" className="brand" aria-label="Northcroft home">
          <span>
            <span className="brand-word">Northcroft</span>
            <small>QS Team</small>
          </span>
        </Link>
        <button type="button" className="nav-search" onClick={openSearch} aria-label="Search">
          <Search />
          <span>Search</span>
          <kbd>{SEARCH_SHORTCUT}</kbd>
        </button>
        <nav className="nav">
          {navLink(home)}
          {sections
            .filter((sec) => sec.items.length > 0)
            .map((sec) => (
              <div className="nav-section" key={sec.label} role="group" aria-label={sec.label}>
                <div className="nav-label">{sec.label}</div>
                {sec.items.map(navLink)}
              </div>
            ))}
        </nav>
        <Link to="/more" className="sidebar-user">
          <Avatar person={me} size={36} />
          <span className="meta">
            <b>{me.short_name}</b>
            <span>{me.title}</span>
          </span>
        </Link>
      </aside>

      <header className="topbar">
        <div className="side">
          {!isRoot && (
            <button
              type="button"
              className="bar-btn lg"
              onClick={() => (window.history.length > 1 ? morphBack(navigate) || navigate(-1) : navigate("/"))}
              aria-label="Back"
            >
              <ChevronLeft />
            </button>
          )}
        </div>
        <div className="title" aria-hidden="true" />
        <div className="side right">
          {location.pathname !== "/more" && (
            <Link to="/more" className="bar-btn avatar-btn" aria-label="Account and more">
              <Avatar person={me} size={36} />
              {!!unacked && <span className="bar-dot" />}
            </Link>
          )}
        </div>
      </header>

      <OfflineBar />
      <OutboxRunner userId={me.id} />

      <main className="main" ref={mainRef}>
        <div className="ptr" ref={ptrRef} aria-hidden>
          <RefreshCw />
        </div>
        <div className="main-inner" ref={layerRef}>
          <Suspense fallback={<div className="center-screen"><Loading /></div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>

      <div className="tabbar-wrap">
        <nav className="tabbar" aria-label="Main">
          <NavLink to="/" end>
            <House />
            Home
          </NavLink>
          <NavLink to="/my-tasks">
            <CircleCheckBig />
            Tasks
          </NavLink>
          <NavLink to="/chats" className={() => (/^\/chats?(\/|$)/.test(location.pathname) ? "active" : "")}>
            <MessageCircle />
            Chats
            {!!chatUnread && <span className="dot">{chatUnread > 99 ? "99+" : chatUnread}</span>}
          </NavLink>
          <NavLink to="/inbox">
            <Inbox />
            Inbox
            {!!unread && <span className="dot">{unread > 99 ? "99+" : unread}</span>}
          </NavLink>
        </nav>
        <button type="button" className="tab-search" onClick={openSearch} aria-label="Search">
          <Search />
        </button>
      </div>
      <PersonCardHost />
      <CallHost />
      <CelebrationHost />
      <AppPopups />
      <ContextMenuHost />
      <SearchHost />
      {isNativeApp() && (
        <Suspense fallback={null}>
          <NativeBridge />
        </Suspense>
      )}
      {isAndroidApp() && (
        <Suspense fallback={null}>
          <AndroidBridge />
        </Suspense>
      )}
      <FaceIdLock />
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
