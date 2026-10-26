import "@/styles/comms.css";
import { Link } from "react-router-dom";
import { BarChart3, CalendarDays, ClipboardList, FileSpreadsheet, LogOut, MapPin, Megaphone, MessagesSquare, Settings, type LucideIcon } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { Avatar, useConfirm } from "@/components/ui";
import { useAuth, useMe } from "@/lib/auth";
import { signOutWarning } from "@/lib/outbox";
import { sendsDailyUpdate } from "@/lib/dailyUpdates";
import { needsMyAck, useAnnouncementsWithAcks } from "./home/data";
import { showsManagerLabel } from "@/lib/people";
import { MENU_COLOR, tileBackground } from "@/lib/menu";

interface Tile {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  color: string;
  count?: number;
}

export default function More() {
  const me = useMe();
  const { canAssign, signOut } = useAuth();
  const confirm = useConfirm();
  const anns = useAnnouncementsWithAcks();
  const unacked = anns.data.filter((a) => needsMyAck(a, me.id)).length;

  const tiles: Tile[] = [
    { to: "/announcements", label: "Announcements", hint: unacked ? `${unacked} to acknowledge` : "Team news", icon: Megaphone, color: MENU_COLOR.announcements, count: unacked },
    { to: "/calendar", label: "Calendar", hint: "Deadlines and visits", icon: CalendarDays, color: MENU_COLOR.calendar },
    { to: "/chats", label: "Chats", hint: "Team, projects, groups", icon: MessagesSquare, color: MENU_COLOR.chats },
    { to: "/vo-log", label: "VO log", hint: "Every project's VOs", icon: FileSpreadsheet, color: MENU_COLOR.volog },
    ...(!me.attendance_exempt
      ? [{ to: "/attendance", label: "Check in", hint: "Arrive and leave", icon: MapPin, color: MENU_COLOR.attendance }]
      : canAssign
        ? [{ to: "/attendance", label: "Attendance", hint: "The team's day", icon: MapPin, color: MENU_COLOR.attendance }]
        : []),
    ...(sendsDailyUpdate(me) || canAssign
      ? [{ to: "/updates", label: "Daily updates", hint: sendsDailyUpdate(me) ? "What you did today" : "What the team did", icon: ClipboardList, color: MENU_COLOR.updates }]
      : []),
    ...(canAssign ? [{ to: "/workload", label: "Workload", hint: "Who has what", icon: BarChart3, color: MENU_COLOR.workload }] : []),
    { to: "/settings", label: "Settings", hint: "Notifications, password", icon: Settings, color: MENU_COLOR.settings },
  ];

  async function out() {
    const waiting = await signOutWarning(me.id);
    if (await confirm({ title: "Sign out?", message: `${waiting}You'll stop getting notifications on this device until you sign in again.`, confirmLabel: "Sign out", danger: !!waiting })) {
      await signOut();
    }
  }

  return (
    <div className="page">
      <PageHead title="More" />
      <Link to="/settings" className="glass me-card">
        <Avatar person={me} size={52} />
        <span className="grow">
          <b>{me.full_name}</b>
          <span className="muted small" style={{ display: "block" }}>
            {me.title}
            {me.role === "manager" ? (showsManagerLabel(me) ? " · Manager" : "") : me.can_assign ? " · Can assign tasks" : ""}
          </span>
          <span className="faint tiny ellipsis" style={{ display: "block" }}>
            {me.email}
          </span>
        </span>
      </Link>
      <div className="more-grid">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="glass">
            <span className="ic" style={{ background: tileBackground(t.color) }}>
              <t.icon />
            </span>
            <span>{t.label}</span>
            <small>{t.hint}</small>
            {!!t.count && <span className="count">{t.count}</span>}
          </Link>
        ))}
      </div>
      <button className="btn glassy block large" style={{ marginTop: 18, color: "var(--red)" }} onClick={out}>
        <LogOut /> Sign out
      </button>
      <p className="faint tiny" style={{ textAlign: "center", marginTop: 14 }}>
        Northcroft QS workspace
      </p>
    </div>
  );
}
