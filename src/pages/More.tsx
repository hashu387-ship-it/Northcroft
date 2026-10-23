import "@/styles/comms.css";
import { Link } from "react-router-dom";
import { BarChart3, CalendarDays, LogOut, MapPin, Megaphone, MessagesSquare, Settings, type LucideIcon } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { Avatar, useConfirm } from "@/components/ui";
import { useAuth, useMe } from "@/lib/auth";
import { needsMyAck, useAnnouncementsWithAcks } from "./home/data";

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
    { to: "/announcements", label: "Announcements", hint: unacked ? `${unacked} to acknowledge` : "Team news", icon: Megaphone, color: "#FF9F0A", count: unacked },
    { to: "/calendar", label: "Calendar", hint: "Deadlines and visits", icon: CalendarDays, color: "#FF375F" },
    { to: "/chat", label: "Team chat", hint: "Talk to everyone", icon: MessagesSquare, color: "#30D158" },
    ...(!me.attendance_exempt
      ? [{ to: "/attendance", label: "Check in", hint: "Arrive and leave", icon: MapPin, color: "#0A84FF" }]
      : canAssign
        ? [{ to: "/attendance", label: "Attendance", hint: "The team's day", icon: MapPin, color: "#0A84FF" }]
        : []),
    ...(canAssign ? [{ to: "/workload", label: "Workload", hint: "Who has what", icon: BarChart3, color: "#BF5AF2" }] : []),
    { to: "/settings", label: "Settings", hint: "Notifications, password", icon: Settings, color: "#8E8E93" },
  ];

  async function out() {
    if (await confirm({ title: "Sign out?", message: "You'll stop getting notifications on this device until you sign in again.", confirmLabel: "Sign out" })) {
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
            {me.role === "manager" ? " · Manager" : me.can_assign ? " · Can assign tasks" : ""}
          </span>
          <span className="faint tiny ellipsis" style={{ display: "block" }}>
            {me.email}
          </span>
        </span>
      </Link>
      <div className="more-grid">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="glass">
            <span className="ic" style={{ background: `linear-gradient(145deg, ${t.color}, color-mix(in srgb, ${t.color} 70%, #000))` }}>
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
