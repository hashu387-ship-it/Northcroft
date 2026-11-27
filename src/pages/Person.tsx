// Someone's profile (/people/:id, opened by tapping their photo or name anywhere): who they are and
// how to reach them, today's status, their counts, then tabs for their tasks, projects,
// attendance, leave and daily updates. What shows depends on what you may see (person/access.ts).
import "@/styles/people.css";
import "@/styles/person.css";
import { useEffect, useRef } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { ClipboardList, FolderKanban, ListChecks, MapPin, SearchX, Timer, TreePalm, TriangleAlert, SquareCheckBig, ClipboardCheck } from "lucide-react";
import { usePeople, useSettings } from "@/lib/api";
import { leaveKindLabel, useTeamLeave } from "@/lib/leave";
import { showsManagerLabel } from "@/lib/people";
import { fmtTime12, isWorkday, todayISO } from "@/lib/time";
import type { Profile } from "@/lib/types";
import { OnlineLine, PersonContact } from "@/components/People";
import { Avatar, CountUp, Empty, Loading, Pill } from "@/components/ui";
import { fmtSpent } from "@/lib/tracked";
import { usePersonAccess, type PersonAccess } from "./person/access";
import { PersonTasks, usePersonHours, usePersonTasks } from "./person/PersonTasks";
import { PersonProjects } from "./person/PersonProjects";
import { PersonAttendance, usePersonAttendance } from "./person/PersonAttendance";
import { PersonLeave } from "./person/PersonLeave";
import { PersonUpdates } from "./person/PersonUpdates";
import { usePresenceRange } from "./attendance/shared";

export default function Person() {
  const { id } = useParams();
  const people = usePeople();
  const person = people.get(id);
  if (people.loading) return <div className="page"><Loading /></div>;
  if (!person) {
    return (
      <div className="page">
        <div className="glass" style={{ marginTop: 24 }}>
          <Empty icon={<SearchX />} title="Person not found" action={<Link className="btn primary" to="/team">Everyone on the team</Link>}>
            The link may be wrong, or they're no longer on Northcroft.
          </Empty>
        </div>
      </div>
    );
  }
  return <PersonProfile person={person} />;
}

function PersonProfile({ person }: { person: Profile }) {
  const { tab = "" } = useParams();
  const access = usePersonAccess(person);
  const tasks = usePersonTasks(person);
  const hours = usePersonHours(person.id);
  const tabsRef = useRef<HTMLElement>(null);

  const tabs = [
    { key: "", label: "Tasks", icon: ListChecks },
    { key: "projects", label: "Projects", icon: FolderKanban },
    ...(access.attendanceTimes || access.attendancePresence ? [{ key: "attendance", label: "Attendance", icon: MapPin }] : []),
    ...(access.leave ? [{ key: "leave", label: "Leave", icon: TreePalm }] : []),
    ...(access.updates ? [{ key: "updates", label: "Daily updates", icon: ClipboardList }] : []),
  ];
  const current = tabs.some((t) => t.key === tab) ? tab : "";

  // Keep the active tab in view when the tab strip scrolls sideways on phones.
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>("a.active")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [current]);

  const base = `/people/${person.id}`;
  return (
    <div className="page person-page">
      <div className="glass pp-hero">
        <Avatar person={person} size={96} />
        <div className="pp-who">
          <h1>{person.full_name}</h1>
          <div className="pc-title">
            {person.title}
            {showsManagerLabel(person) ? <Pill tone="blue">Manager</Pill> : person.role !== "manager" && person.can_assign ? <Pill tone="purple">Can assign</Pill> : null}
          </div>
          <div className="pp-status">
            {!access.self && person.active && <OnlineLine id={person.id} />}
            <TodayStatus person={person} access={access} />
          </div>
        </div>
        {person.active && <PersonContact person={person} />}
      </div>

      <div className="grid-4 stat-row">
        <Link to={base} className="glass stat stat-link tone-blue">
          <span className="label">
            <SquareCheckBig /> Open tasks
          </span>
          <span className="value">{tasks.loading ? "–" : <CountUp value={tasks.open} />}</span>
          <span className="hint">{tasks.doing.length} in progress</span>
        </Link>
        <Link to={base} className={`glass stat stat-link ${tasks.overdue.length ? "tone-red" : "tone-green"}`}>
          <span className="label" style={{ color: tasks.overdue.length ? "var(--red)" : undefined }}>
            <TriangleAlert /> Overdue
          </span>
          <span className="value" style={{ color: tasks.overdue.length ? "var(--red)" : undefined }}>
            {tasks.loading ? "–" : <CountUp value={tasks.overdue.length} />}
          </span>
          <span className="hint">{tasks.overdue.length ? "Past their due date" : "Nothing late"}</span>
        </Link>
        <Link to={base} className="glass stat stat-link tone-purple">
          <span className="label">
            <ClipboardCheck /> With reviewer
          </span>
          <span className="value">{tasks.loading ? "–" : <CountUp value={tasks.review.length} />}</span>
          <span className="hint">{tasks.done.length} finished this month</span>
        </Link>
        <Link to={base} className="glass stat stat-link tone-teal">
          <span className="label">
            <Timer /> This week
          </span>
          <span className="value">{hours.loading ? "–" : hours.total >= 3600 ? `${(hours.total / 3600).toFixed(1)}h` : fmtSpent(hours.total)}</span>
          <span className="hint">{hours.running ? "Timing a task now" : "Logged on tasks"}</span>
        </Link>
      </div>

      <nav className="tabs glass" aria-label={`${person.short_name}'s sections`} ref={tabsRef}>
        {tabs.map((t) => (
          <NavLink key={t.key} to={t.key ? `${base}/${t.key}` : base} end className={() => (current === t.key ? "active" : "")}>
            <t.icon /> {t.label}
          </NavLink>
        ))}
      </nav>

      {current === "" && <PersonTasks person={person} groups={tasks} self={access.self} />}
      {current === "projects" && <PersonProjects person={person} self={access.self} />}
      {current === "attendance" && <PersonAttendance person={person} access={access} />}
      {current === "leave" && <PersonLeave person={person} self={access.self} />}
      {current === "updates" && <PersonUpdates person={person} self={access.self} />}
    </div>
  );
}

/** "Checked in 8:02 am · Head office", "On annual leave today", "Not in yet", "Day off"... */
function TodayStatus({ person, access }: { person: Profile; access: PersonAccess }) {
  const today = todayISO();
  const { data: settings } = useSettings();
  const row = usePersonAttendance(person.id, today, today, access.attendanceTimes);
  const presence = usePresenceRange(today, today, access.attendancePresence);
  const away = useTeamLeave(today, today);
  if (!person.active) return <Pill tone="gray">No longer on the team</Pill>;
  if (person.attendance_exempt) return null;

  const leave = (away.data ?? []).find((r) => r.user_id === person.id && r.start_date <= today && r.end_date >= today);
  if (leave) {
    return <Pill tone="purple">{leave.kind ? `On ${leaveKindLabel(leave.kind).toLowerCase()} today` : "On leave today"}</Pill>;
  }
  const working = isWorkday(today, settings?.work_days);
  if (access.attendanceTimes) {
    const r = row.data?.[0];
    if (r) {
      const place = r.check_out_at ? r.out_place_name : r.in_place_name;
      return (
        <Pill tone={r.check_out_at ? "gray" : r.late_minutes > 0 ? "orange" : "green"}>
          {r.check_out_at ? `Checked out ${fmtTime12(r.check_out_at)}` : `Checked in ${fmtTime12(r.check_in_at)}`}
          {place ? ` · ${place}` : ""}
          {!r.check_out_at && r.late_minutes > 0 ? ` · ${r.late_minutes} min late` : ""}
        </Pill>
      );
    }
    if (row.isLoading) return null;
    return working ? <Pill tone="gray">Not checked in yet</Pill> : <Pill tone="gray">Day off</Pill>;
  }
  if (access.attendancePresence) {
    const p = (presence.data ?? []).find((x) => x.user_id === person.id);
    if (presence.isLoading) return null;
    if (p?.present) return <Pill tone="green">In today</Pill>;
    return working ? <Pill tone="gray">Not in yet</Pill> : <Pill tone="gray">Day off</Pill>;
  }
  return null;
}
