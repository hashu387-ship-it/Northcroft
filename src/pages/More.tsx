// Account: opened from your photo at the top right (and the bottom of the side menu). Laid out like
// iOS Settings: your profile on top, then everything that isn't in the tab bar, in groups, each
// with its coloured tile, and Sign out at the end.
import "@/styles/comms.css";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileClock,
  FileSpreadsheet,
  FolderKanban,
  IdCard,
  MapPin,
  Megaphone,
  Phone,
  ScanLine,
  Settings,
  Sparkles,
  Timer,
  Users,
  type LucideIcon,
} from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { Avatar, useConfirm, useToast } from "@/components/ui";
import { useAuth, useMe } from "@/lib/auth";
import { signOutWarning } from "@/lib/outbox";
import { sendsDailyUpdate } from "@/lib/dailyUpdates";
import { needsMyAck, useAnnouncementsWithAcks } from "./home/data";
import { showsManagerLabel } from "@/lib/people";
import { MENU_COLOR, tileStyle } from "@/lib/menu";
import { useSubmissionsDue } from "@/lib/submissions";
import { isNativeApp } from "@/native/platform";
import { scanToShare } from "@/native/scan";
import { addStaffPass } from "@/native/wallet";

interface Row {
  to: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  color: string;
  count?: number;
  onClick?: () => void;
}

function Group({ title, rows }: { title?: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <>
      {title && <div className="group-title">{title}</div>}
      <div className="group">
        {rows.map((r) => (
          <Link
            key={r.label}
            to={r.to}
            className="group-row"
            onClick={
              r.onClick
                ? (e) => {
                    e.preventDefault();
                    r.onClick!();
                  }
                : undefined
            }
          >
            <span className="tile" style={tileStyle(r.color)}>
              <r.icon />
            </span>
            <span className="label">
              {r.label}
              {r.hint && <small>{r.hint}</small>}
            </span>
            {!!r.count && <span className="badge">{r.count}</span>}
            <ChevronRight className="chev" />
          </Link>
        ))}
      </div>
    </>
  );
}

export default function More() {
  const me = useMe();
  const { canAssign, signOut } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const toast = useToast();
  const anns = useAnnouncementsWithAcks();
  const unacked = anns.data.filter((a) => needsMyAck(a, me.id)).length;
  const subsLate = useSubmissionsDue();

  const work: Row[] = [
    { to: "/projects", label: "Projects", icon: FolderKanban, color: MENU_COLOR.projects },
    { to: "/submissions", label: "Submissions", hint: subsLate ? `${subsLate} late or due today` : undefined, icon: FileClock, color: MENU_COLOR.submissions, count: subsLate },
    { to: "/vo-log", label: "VO log", icon: FileSpreadsheet, color: MENU_COLOR.volog },
    ...(sendsDailyUpdate(me) || canAssign ? [{ to: "/updates", label: "Daily updates", icon: ClipboardList, color: MENU_COLOR.updates }] : []),
    { to: "/time", label: "Time report", icon: Timer, color: MENU_COLOR.time },
    ...(canAssign ? [{ to: "/workload", label: "Workload", icon: BarChart3, color: MENU_COLOR.workload }] : []),
  ];
  const team: Row[] = [
    { to: "/team", label: "Team", hint: "Everyone's work, projects and attendance", icon: Users, color: MENU_COLOR.team },
    ...(!me.attendance_exempt
      ? [{ to: "/attendance", label: "Check in", icon: MapPin, color: MENU_COLOR.attendance }]
      : canAssign
        ? [{ to: "/attendance", label: "Attendance", icon: MapPin, color: MENU_COLOR.attendance }]
        : []),
    { to: "/calendar", label: "Calendar", icon: CalendarDays, color: MENU_COLOR.calendar },
    { to: "/announcements", label: "Announcements", hint: unacked ? `${unacked} to acknowledge` : undefined, icon: Megaphone, color: MENU_COLOR.announcements, count: unacked },
    { to: "/calls", label: "Calls", icon: Phone, color: MENU_COLOR.calls },
  ];
  const app: Row[] = [
    ...(isNativeApp()
      ? [
          { to: "/share", label: "Scan a document", icon: ScanLine, color: MENU_COLOR.scan, onClick: () => void scanToShare(navigate, toast) },
          {
            to: "/more",
            label: "Staff pass in Wallet",
            hint: "Your Northcroft staff card, always on your iPhone",
            icon: IdCard,
            color: "#1C1C1E",
            onClick: () =>
              void addStaffPass().then((r) => {
                if (!r.ok) toast(r.message, "info");
                else if (r.message) toast(r.message);
              }),
          },
        ]
      : []),
    { to: "/more?whatsnew=1", label: "What's new", icon: Sparkles, color: MENU_COLOR.whatsnew },
    { to: "/settings", label: "Settings", icon: Settings, color: MENU_COLOR.settings },
  ];

  async function out() {
    const waiting = await signOutWarning(me.id);
    if (await confirm({ title: "Sign out?", message: `${waiting}You'll stop getting notifications on this device until you sign in again.`, confirmLabel: "Sign out", danger: !!waiting })) {
      await signOut();
    }
  }

  const role = me.role === "manager" ? (showsManagerLabel(me) ? "Manager" : "") : me.can_assign ? "Can assign tasks" : "";

  return (
    <div className="page account-page">
      <PageHead title="Account" />
      <div className="group">
        <Link to="/settings/profile" className="group-row profile">
          <Avatar person={me} size={60} />
          <span className="label">
            <b>{me.full_name}</b>
            <small>{[me.title, role].filter(Boolean).join(" · ")}</small>
            <small className="ellipsis">{me.email}</small>
          </span>
          <ChevronRight className="chev" />
        </Link>
      </div>
      <Group title="Work" rows={work} />
      <Group title="Team" rows={team} />
      <Group title="App" rows={app} />
      <div className="group" style={{ marginTop: 22 }}>
        <button type="button" className="group-row no-tile danger" onClick={out}>
          Sign Out
        </button>
      </div>
      <p className="faint tiny" style={{ textAlign: "center", margin: "18px 0 4px" }}>
        Northcroft QS Team
      </p>
    </div>
  );
}
