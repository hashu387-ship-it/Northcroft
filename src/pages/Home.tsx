import "@/styles/comms.css";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClock,
  CalendarDays,
  CircleCheck,
  ClipboardList,
  FileText,
  Inbox,
  Layers,
  LogIn,
  LogOut,
  MapPin,
  Megaphone,
  Plus,
  SquareCheckBig,
  TriangleAlert,
  Users,
} from "lucide-react";
import { InstallBanner } from "@/components/InstallBanner";
import { TaskForm } from "@/components/TaskForm";
import { TaskRow } from "@/components/TaskRow";
import { OngoingTasksCard } from "@/components/TeamTasks";
import { OnlineCard } from "@/components/OnlineCard";
import { TeamTodayPresence } from "./attendance/Presence";
import { LeaveToApproveCard } from "./attendance/Leave";
import { MyUpdateHomeCard, TeamUpdatesHomeCard } from "./updates/HomeCards";
import { leaveByDay, useTeamLeave } from "@/lib/leave";
import { VoiceNote } from "@/components/Voice";
import { Avatar, CountUp, Empty, Loading, Pill, PriorityFlag, useToast } from "@/components/ui";
import { useChecklistCounts, useInvalidate, usePeople, useProjectMap, useSettings, useTasks, useUnreadCount } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useSignoff, waitingOn } from "@/lib/signoff";
import { BOQ_STATUS, EVENT_KIND, VO_STATUS } from "@/lib/constants";
import { errorMessage } from "@/lib/supabase";
import {
  addDays,
  diffDays,
  DOW_SHORT,
  dow,
  fmtClock,
  fmtDue,
  fmtDuration,
  fmtLongDate,
  fmtMinutes,
  fmtTime12,
  greeting,
  isWorkday,
  timeAgo,
  todayISO,
} from "@/lib/time";
import type { Attendance, Profile, Task } from "@/lib/types";
import { nameList, ownersOf } from "@/lib/people";
import {
  acknowledge,
  needsMyAck,
  useAnnouncementsWithAcks,
  useAttendanceOn,
  useBoqAlerts,
  useEventsBetween,
  useVoAlerts,
} from "./home/data";

export default function Home() {
  const me = useMe();
  const { canAssign, isManager } = useAuth();
  const signoff = useSignoff();
  const today = todayISO();
  const [newTask, setNewTask] = useState(false);
  const firstName = me.short_name.split(" ")[0];
  // Someone who only gives out tasks (the Commercial Head) sees the team's numbers, not their own.
  const givesOnly = me.assignable === false;

  const mine = useTasks({ assigneeId: me.id, openOnly: true });
  const allOpen = useTasks({ openOnly: true });
  const unread = useUnreadCount(me.id).data ?? 0;

  const teamOpen = allOpen.data ?? [];
  const myOpen = givesOnly ? teamOpen : mine.data ?? [];
  const tasksLoading = givesOnly ? allOpen.isLoading : mine.isLoading;
  const overdue = myOpen.filter((t) => t.due_date && t.due_date < today && t.status !== "in_review");
  // Waiting on me: my check, my final OK, or (with one reviewer) my review.
  const toReview = teamOpen.filter((t) => waitingOn(t, signoff) === me.id);
  const myInReview = myOpen.filter((t) => t.status === "in_review");
  const finalOk = toReview.filter((t) => t.review_stage === "final").length;

  const dueToday = myOpen.filter((t) => t.due_date === today).length;
  // One plain-English line under the greeting.
  const summary = tasksLoading
    ? "Loading your day..."
    : givesOnly
      ? `${teamOpen.length} ${teamOpen.length === 1 ? "task is" : "tasks are"} open across the team${overdue.length ? `, ${overdue.length} overdue` : ""}.${
          toReview.length ? ` ${toReview.length} ${toReview.length === 1 ? "is" : "are"} waiting for your ${finalOk ? "final OK" : "review"}.` : ""
        }`
    : overdue.length
      ? `${overdue.length} overdue ${overdue.length === 1 ? "task needs" : "tasks need"} your attention${dueToday ? `, and ${dueToday} ${dueToday === 1 ? "is" : "are"} due today` : ""}.`
      : dueToday
        ? `${dueToday} ${dueToday === 1 ? "task is" : "tasks are"} due today, out of ${myOpen.length} open.`
        : myOpen.length
          ? `You have ${myOpen.length} open ${myOpen.length === 1 ? "task" : "tasks"} and nothing late.`
          : canAssign && toReview.length
            ? `${toReview.length} ${toReview.length === 1 ? "task is" : "tasks are"} waiting for your review.`
            : "You're all caught up. Nothing open right now.";

  return (
    <div className="page">
      <section className="home-banner" aria-label="Today">
        <div className="hb-photo" aria-hidden />
        <div className="hb-shade" aria-hidden />
        <div className="hb-body">
          <span className="hb-eyebrow">
            <i className="hb-bar" /> {fmtLongDate(today)}
          </span>
          <h1>
            {greeting()}, {firstName}
          </h1>
          <p>{summary}</p>
          <div className="hb-actions">
            {canAssign && (
              <button className="btn brand" onClick={() => setNewTask(true)}>
                <Plus /> New task
              </button>
            )}
            <Link to="/my-tasks" className="btn on-dark">
              <SquareCheckBig /> {givesOnly ? "Assigned tasks" : "My tasks"}
            </Link>
          </div>
        </div>
      </section>
      <InstallBanner />

      <div className="grid-4 stat-row">
        <Link to="/my-tasks" className="glass stat stat-link tone-blue">
          <span className="label">
            <SquareCheckBig /> {givesOnly ? "Open tasks" : "My open tasks"}
          </span>
          <span className="value">{tasksLoading ? "–" : <CountUp value={myOpen.length} />}</span>
          <span className="hint">{givesOnly ? `Across the team, ${dueToday} due today` : `${dueToday} due today`}</span>
        </Link>
        <Link to="/my-tasks" className={`glass stat stat-link ${overdue.length ? "tone-red" : "tone-green"}`}>
          <span className="label" style={{ color: overdue.length ? "var(--red)" : undefined }}>
            <TriangleAlert /> Overdue
          </span>
          <span className="value" style={{ color: overdue.length ? "var(--red)" : undefined }}>
            {tasksLoading ? "–" : <CountUp value={overdue.length} />}
          </span>
          <span className="hint">{overdue.length ? (givesOnly ? "Across the team" : "Needs your attention") : "Nothing late"}</span>
        </Link>
        {canAssign ? (
          <Link to="/my-tasks?view=review" className="glass stat stat-link tone-purple">
            <span className="label" style={{ color: toReview.length ? "var(--purple)" : undefined }}>
              <ClipboardList /> {signoff.on && signoff.final?.id === me.id ? "Final OK" : "To review"}
            </span>
            <span className="value">{allOpen.isLoading ? "–" : <CountUp value={toReview.length} />}</span>
            <span className="hint">{signoff.on && signoff.final?.id === me.id ? "Checked, waiting for you" : "Submitted by the team"}</span>
          </Link>
        ) : (
          <Link to="/my-tasks" className="glass stat stat-link tone-purple">
            <span className="label">
              <ClipboardList /> With reviewer
            </span>
            <span className="value">{mine.isLoading ? "–" : <CountUp value={myInReview.length} />}</span>
            <span className="hint">Waiting for sign-off</span>
          </Link>
        )}
        <Link to="/inbox" className="glass stat stat-link tone-teal">
          <span className="label" style={{ color: unread ? "var(--accent)" : undefined }}>
            <Inbox /> Unread
          </span>
          <span className="value">
            <CountUp value={unread} />
          </span>
          <span className="hint">In your inbox</span>
        </Link>
      </div>

      <div className="home-grid">
        <div className="stack">
          {!me.attendance_exempt && <CheckInCard />}
          <MyUpdateHomeCard />
          {!givesOnly && <FocusCard tasks={myOpen} loading={mine.isLoading} />}
          {canAssign && <ReviewCard tasks={toReview} loading={allOpen.isLoading} finalOk={signoff.on && signoff.final?.id === me.id} />}
          {canAssign && <LeaveToApproveCard />}
          <TeamUpdatesHomeCard />
          {isManager && <OngoingTasksCard tasks={teamOpen} loading={allOpen.isLoading} linkTo={givesOnly ? "/my-tasks" : "/my-tasks?view=team"} />}
          {canAssign && (me.attendance_times === false ? <TeamTodayPresence /> : <TeamSnapshot />)}
        </div>
        <div className="stack">
          <OnlineCard />
          <AnnouncementCard />
          <QsAlertsCard />
          <EventsCard />
        </div>
      </div>

      {canAssign && (
        <button className="fab" onClick={() => setNewTask(true)} aria-label="New task">
          <Plus />
        </button>
      )}
      <TaskForm open={newTask} onClose={() => setNewTask(false)} />
    </div>
  );
}

/* ---------------------------------------------------------------- check-in */
function CheckInCard() {
  const me = useMe();
  const today = todayISO();
  const settings = useSettings().data;
  const q = useAttendanceOn(today, me.id);
  const row = q.data?.[0];
  const workday = isWorkday(today, settings?.work_days);

  let tone = "#1B3570";
  let icon = <LogIn />;
  let headline = "You haven't checked in yet";
  let sub: ReactNode = settings ? `Work starts at ${fmtClock(settings.work_start)}` : "";
  let pills: ReactNode = null;
  let button = (
    <Link to="/attendance" className="btn primary">
      <MapPin /> Check in
    </Link>
  );

  if (!row && !workday) {
    tone = "#8E8E93";
    headline = "It's the weekend";
    sub = "Check in only if you're working today.";
    button = (
      <Link to="/attendance" className="btn">
        <MapPin /> Check in
      </Link>
    );
  } else if (row && !row.check_out_at) {
    tone = "#30D158";
    icon = <CircleCheck />;
    headline = `Checked in at ${fmtTime12(row.check_in_at)}`;
    sub = `${row.in_place_name ?? "Location unavailable"} · ${fmtDuration(row.check_in_at, null)} so far`;
    pills = <AttendancePills row={row} />;
    button = (
      <Link to="/attendance" className="btn">
        <LogOut /> Check out
      </Link>
    );
  } else if (row) {
    tone = "#8E8E93";
    icon = <LogOut />;
    headline = `Checked out at ${fmtTime12(row.check_out_at)}`;
    sub = `In at ${fmtTime12(row.check_in_at)} · ${fmtDuration(row.check_in_at, row.check_out_at)} on the day`;
    pills = <AttendancePills row={row} />;
    button = (
      <Link to="/attendance" className="btn">
        View
      </Link>
    );
  }

  if (q.isLoading) {
    return (
      <div className="glass checkin-card">
        <div className="skeleton" style={{ width: 46, height: 46, borderRadius: 9 }} />
        <div className="grow stack" style={{ gap: 8 }}>
          <div className="skeleton" style={{ height: 16, width: "60%" }} />
          <div className="skeleton" style={{ height: 12, width: "40%" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="glass checkin-card">
      <span className="ic" style={{ background: `linear-gradient(145deg, ${tone}, color-mix(in srgb, ${tone} 70%, #000))` }}>{icon}</span>
      <div className="grow">
        <div className="headline">{headline}</div>
        <div className="muted small">{sub}</div>
        {pills && <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>{pills}</div>}
      </div>
      {button}
    </div>
  );
}

function AttendancePills({ row }: { row: Attendance }) {
  return (
    <>
      {row.late_minutes > 0 && <Pill tone="orange">Late {fmtMinutes(row.late_minutes)}</Pill>}
      {row.early_minutes > 0 && <Pill tone="orange">Left {fmtMinutes(row.early_minutes)} early</Pill>}
      {row.in_place_kind === "elsewhere" && <Pill tone="yellow">Off-site</Pill>}
      {row.in_place_kind === "unknown" && <Pill tone="gray">No location</Pill>}
    </>
  );
}

/* ---------------------------------------------------------------- tasks */
function FocusCard({ tasks, loading }: { tasks: Task[]; loading: boolean }) {
  const today = todayISO();
  const soon = addDays(today, 3);
  const focus = useMemo(
    () =>
      tasks
        .filter(
          (t) =>
            t.status !== "in_review" &&
            ((t.due_date && t.due_date <= soon) || (!!t.changes_note && t.status !== "done") || t.priority === "urgent"),
        )
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
        .slice(0, 6),
    [tasks, soon],
  );
  const counts = useChecklistCounts(focus.map((t) => t.id)).data ?? {};
  const later = tasks.filter((t) => t.status !== "in_review").length - focus.length;

  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-red">
          <AlarmClock /> Needs your attention
        </h2>
        <Link to="/my-tasks">All my tasks</Link>
      </div>
      {loading ? (
        <Loading />
      ) : focus.length === 0 ? (
        <Empty icon={<CircleCheck />} title="You're all caught up">
          {later > 0 ? `Nothing due in the next few days. You have ${later} other open ${later === 1 ? "task" : "tasks"}.` : "No open tasks right now."}
        </Empty>
      ) : (
        <div className="list">
          {focus.map((t) => (
            <TaskRow key={t.id} task={t} showAssignee={false} checklist={counts[t.id]} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ tasks, loading, finalOk }: { tasks: Task[]; loading: boolean; finalOk?: boolean }) {
  const counts = useChecklistCounts(tasks.map((t) => t.id)).data ?? {};
  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-purple">
          <ClipboardList /> {finalOk ? "Waiting for your final OK" : "Waiting for your review"}
        </h2>
        {tasks.length > 0 && <Pill tone="purple">{tasks.length}</Pill>}
      </div>
      {loading ? (
        <Loading />
      ) : tasks.length === 0 ? (
        <Empty icon={<CircleCheck />} title="Nothing to review">
          {finalOk ? "Tasks show up here once they've been checked and need your final OK." : "When someone submits a task for review it shows up here."}
        </Empty>
      ) : (
        <div className="list">
          {tasks
            .slice()
            .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))
            .map((t) => (
              <TaskRow key={t.id} task={t} checklist={counts[t.id]} />
            ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- team */
function TeamSnapshot() {
  const today = todayISO();
  const people = usePeople();
  const settings = useSettings().data;
  const q = useAttendanceOn(today);
  const rows = new Map((q.data ?? []).map((r) => [r.user_id, r]));
  const workday = isWorkday(today, settings?.work_days);
  const inCount = (q.data ?? []).filter((r) => !r.check_out_at).length;
  // People on approved leave (or a Leave entry) today show as on leave, not "Not in yet".
  const away = useTeamLeave(today, today);
  const onLeave = useMemo(() => leaveByDay(away.data ?? [], today, today, settings?.work_days), [away.data, today, settings?.work_days]);

  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-green">
          <Users /> Team today
        </h2>
        <Link to="/attendance">Attendance</Link>
      </div>
      <p className="muted small" style={{ marginBottom: 10 }}>
        {workday ? `${inCount} of ${people.attenders.length} checked in right now` : `${DOW_SHORT[dow(today)]} is a weekend day`}
      </p>
      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="team-snap">
          {people.attenders.map((p) => (
            <TeamPerson key={p.id} person={p} row={rows.get(p.id)} onLeave={onLeave.has(`${p.id}|${today}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamPerson({ person, row, onLeave }: { person: Profile; row?: Attendance; onLeave?: boolean }) {
  let dot = "";
  let line = onLeave ? "On leave" : "Not in yet";
  if (row && !row.check_out_at) {
    dot = row.late_minutes > 0 ? "late" : "in";
    line = `In ${fmtTime12(row.check_in_at)} · ${row.in_place_kind === "elsewhere" ? "Off-site" : row.in_place_name ?? ""}`;
  } else if (row) {
    dot = "out";
    line = `Out ${fmtTime12(row.check_out_at)}`;
  }
  return (
    <div className="person" title={row?.in_address ?? undefined}>
      <Avatar person={person} size={30} />
      <div className="who">
        <b>{person.short_name}</b>
        <span>{line}</span>
      </div>
      <i className={`status-dot ${dot}`} />
    </div>
  );
}

/* ---------------------------------------------------------------- announcement */
function AnnouncementCard() {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data, isLoading } = useAnnouncementsWithAcks();
  const [busy, setBusy] = useState(false);

  const recentCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const pick =
    data.find((a) => needsMyAck(a, me.id)) ?? data.find((a) => a.pinned) ?? data.find((a) => a.created_at > recentCutoff);
  const waiting = data.filter((a) => needsMyAck(a, me.id)).length;

  async function ack() {
    if (!pick) return;
    setBusy(true);
    try {
      await acknowledge(pick.id, me.id);
      toast("Thanks, marked as acknowledged");
      await invalidate("announcement_acks", "announcements");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-orange">
          <Megaphone /> Announcements
        </h2>
        <Link to="/announcements">{waiting > 1 ? `${waiting} to acknowledge` : "See all"}</Link>
      </div>
      {isLoading ? (
        <Loading />
      ) : !pick ? (
        <Empty icon={<Megaphone />} title="No announcements this week" />
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            {pick.important && <Pill tone="red">Important</Pill>}
            {pick.pinned && <Pill tone="blue">Pinned</Pill>}
          </div>
          <Link to={`/announcements?id=${pick.id}`} style={{ color: "inherit" }}>
            <b style={{ fontSize: 16 }}>{pick.title}</b>
          </Link>
          {pick.body.trim() && (
            <p
              className="muted small"
              style={{ display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}
            >
              {pick.body}
            </p>
          )}
          {pick.voice_path && (
            <VoiceNote
              kind="announcement"
              id={pick.id}
              path={pick.voice_path}
              seconds={pick.voice_seconds}
              peaks={pick.voice_peaks}
              transcript={pick.transcript}
              status={pick.transcript_status}
              canEdit={false}
            />
          )}
          <div className="row" style={{ gap: 8 }}>
            <Avatar person={people.get(pick.author_id)} size={24} />
            <span className="small muted ellipsis">
              {people.get(pick.author_id)?.short_name ?? "Someone"} · {timeAgo(pick.created_at)}
            </span>
            <span className="spacer" />
            {needsMyAck(pick, me.id) ? (
              <button className="btn small primary" onClick={ack} disabled={busy}>
                <CircleCheck /> Acknowledge
              </button>
            ) : pick.requires_ack && pick.author_id !== me.id ? (
              <Pill tone="green">
                <CircleCheck /> Acknowledged
              </Pill>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- QS alerts */
function dueText(date: string | null) {
  if (!date) return "";
  const d = diffDays(date, todayISO());
  if (d < 0) return d === -1 ? "1 day overdue" : `${-d} days overdue`;
  if (d === 0) return "Due today";
  return d === 1 ? "Due tomorrow" : `Due ${fmtDue(date)}`;
}

function QsAlertsCard() {
  const people = usePeople();
  const projects = useProjectMap();
  const vos = useVoAlerts(2);
  const boqs = useBoqAlerts(5);
  const voList = vos.data ?? [];
  const boqList = boqs.data ?? [];
  const today = todayISO();

  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-red">
          <TriangleAlert /> QS alerts
        </h2>
        <div className="row" style={{ gap: 6 }}>
          {voList.length > 0 && <Pill tone="purple">{voList.length} VO</Pill>}
          {boqList.length > 0 && <Pill tone="teal">{boqList.length} BOQ</Pill>}
        </div>
      </div>
      {vos.isLoading || boqs.isLoading ? (
        <Loading />
      ) : voList.length + boqList.length === 0 ? (
        <Empty icon={<CircleCheck />} title="Nothing urgent on VOs or BOQs" />
      ) : (
        <div className="list">
          {voList.slice(0, 6).map((v) => {
            const late = v.response_due! < today;
            return (
              <Link key={v.id} to={`/projects/${v.project_id}/variations?vo=${v.id}`} className="alert-row">
                <span className="tag" style={{ background: late ? "var(--red-soft)" : "var(--purple-soft)", color: late ? "var(--red)" : "var(--purple)" }}>
                  <FileText />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: "block" }}>
                    {v.vo_number} {v.title}
                  </span>
                  <span className="meta" style={{ display: "block" }}>
                    {projects.get(v.project_id)?.name ?? "Project"} · {VO_STATUS[v.status].label}
                    {ownersOf(v).length ? ` · ${nameList(ownersOf(v).map((id) => people.get(id)?.short_name ?? "someone"))}` : ""}
                  </span>
                </span>
                <PriorityFlag priority={v.priority ?? "normal"} size="small" />
                <Pill tone={late ? "red" : "orange"}>{dueText(v.response_due)}</Pill>
              </Link>
            );
          })}
          {boqList.slice(0, 6).map((b) => {
            const late = b.due_date! < today;
            return (
              <Link key={b.id} to={`/projects/${b.project_id}/boq`} className="alert-row">
                <span className="tag" style={{ background: late ? "var(--red-soft)" : "var(--teal-soft)", color: late ? "var(--red)" : "var(--teal)" }}>
                  <Layers />
                </span>
                <span className="grow">
                  <span className="title" style={{ display: "block" }}>
                    {b.name} BOQ
                  </span>
                  <span className="meta" style={{ display: "block" }}>
                    {projects.get(b.project_id)?.name ?? "Project"} · {BOQ_STATUS[b.status].label}
                    {ownersOf(b).length ? ` · ${nameList(ownersOf(b).map((id) => people.get(id)?.short_name ?? "someone"))}` : ""}
                  </span>
                </span>
                <PriorityFlag priority={b.priority ?? "normal"} size="small" />
                <Pill tone={late ? "red" : "orange"}>{dueText(b.due_date)}</Pill>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- events */
function EventsCard() {
  const me = useMe();
  const { canAssign } = useAuth();
  const projects = useProjectMap();
  const today = todayISO();
  const q = useEventsBetween(today, addDays(today, 7));
  const list = (q.data ?? [])
    .filter((e) => canAssign || e.attendees.includes(me.id) || e.created_by === me.id)
    .slice(0, 5);

  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-blue">
          <CalendarDays /> Coming up
        </h2>
        <Link to="/calendar">Calendar</Link>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={<CalendarDays />} title="Nothing in the next 7 days" />
      ) : (
        <div className="list">
          {list.map((e) => {
            const kind = EVENT_KIND[e.kind];
            return (
              <Link key={e.id} to={`/calendar?date=${e.event_date}`} className="event-row">
                <span className="event-date">
                  <small>{DOW_SHORT[dow(e.event_date)]}</small>
                  <b>{Number(e.event_date.slice(8, 10))}</b>
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="bold ellipsis" style={{ display: "block" }}>
                    {e.title}
                  </span>
                  <span className="muted small ellipsis" style={{ display: "block" }}>
                    {[e.start_time ? fmtClock(e.start_time) : "All day", e.location, projects.get(e.project_id)?.name].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <i className="dot-swatch" style={{ background: kind.color }} title={kind.label} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
