import { Suspense, useEffect, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  FolderKanban,
  House,
  Inbox,
  MapPin,
  Megaphone,
  MessagesSquare,
  Ellipsis,
  Settings,
  SquareCheckBig,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useUnreadCount } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useRealtime } from "@/lib/realtime";
import { registerServiceWorker, setBadge, syncPushSubscription } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { Avatar, Loading } from "@/components/ui";
import ChangePassword from "@/pages/ChangePassword";

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

const TAB_ROOTS = ["/", "/my-tasks", "/projects", "/inbox", "/more"];

export default function AppShell() {
  const me = useMe();
  const { canAssign } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const unread = useUnreadCount(me.id).data ?? 0;
  const unacked = useUnackedCount(me.id).data ?? 0;

  useRealtime(me.id);

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

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (me.must_change_password) return <ChangePassword forced />;

  const isRoot = TAB_ROOTS.includes(location.pathname);
  const nav = [
    { to: "/", label: "Home", icon: House, end: true },
    { to: "/my-tasks", label: "My tasks", icon: SquareCheckBig },
    { to: "/projects", label: "Projects", icon: FolderKanban },
    { to: "/inbox", label: "Inbox", icon: Inbox, count: unread },
    { to: "/announcements", label: "Announcements", icon: Megaphone, count: unacked },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    { to: "/chat", label: "Team chat", icon: MessagesSquare },
    { to: "/attendance", label: "Check in", icon: MapPin },
  ];
  const manage = [
    ...(canAssign ? [{ to: "/workload", label: "Workload", icon: BarChart3 }] : []),
    { to: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="app">
      <Wallpaper />

      <aside className="sidebar glass">
        <Link to="/" className="brand" style={{ color: "inherit" }}>
          <img src="/icons/icon-192.png" alt="" />
          <span>
            Northcroft
            <small>QS workspace</small>
          </span>
        </Link>
        <nav className="nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
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
            <img src="/icons/icon-192.png" alt="Northcroft" style={{ width: 32, height: 32, borderRadius: 8 }} />
          ) : (
            <button className="icon-btn plain" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))} aria-label="Back">
              <ChevronLeft />
            </button>
          )}
        </div>
        <div className="title">Northcroft</div>
        <div className="side right">
          <Link to="/attendance" className="icon-btn plain" aria-label="Check in">
            <MapPin />
          </Link>
          <Link to="/settings" aria-label="Settings">
            <Avatar person={me} size={32} />
          </Link>
        </div>
      </header>

      <main className="main">
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
        <NavLink to="/inbox">
          <Inbox />
          Inbox
          {!!unread && <span className="dot">{unread > 99 ? "99+" : unread}</span>}
        </NavLink>
        <NavLink to="/more" className={({ isActive }) => (isActive || ["/announcements", "/calendar", "/chat", "/attendance", "/workload", "/settings"].some((p) => location.pathname.startsWith(p)) ? "active" : "")}>
          <Ellipsis />
          More
          {!!unacked && <span className="dot">{unacked}</span>}
        </NavLink>
      </nav>
    </div>
  );
}
