// The people board: one card per person on the team with what they're working on (each task's %),
// what's waiting for review, and what they finished this week (or last week, or this month), plus
// whether today's update is in. For managers and seniors.
import "@/styles/updates.css";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, CircleCheck, Hourglass } from "lucide-react";
import { usePeople, useProjectMap, useTasks } from "@/lib/api";
import { isBlocked, progressTone, sendsDailyUpdate, useTeamDailyUpdates, type UpdateWithItems } from "@/lib/dailyUpdates";
import { peopleOn } from "@/lib/people";
import { addDays, dateOf, fmtDate, fmtTime12, monthStart, todayISO, weekStart } from "@/lib/time";
import type { Profile, Task } from "@/lib/types";
import { Avatar, DueLabel, Empty, Loading, Pill, ProjectTag, Segmented } from "@/components/ui";
import { openPersonCard } from "@/components/People";
import { BlockerBlock } from "./BlockerThread";

type Period = "week" | "last" | "month";

function periodRange(p: Period): { from: string; to: string; label: string } {
  const today = todayISO();
  const ws = weekStart(today);
  if (p === "last") return { from: addDays(ws, -7), to: addDays(ws, -1), label: "last week" };
  if (p === "month") return { from: monthStart(today), to: today, label: "this month" };
  return { from: ws, to: today, label: "this week" };
}

interface PersonView {
  person: Profile;
  ongoing: Task[];
  notStarted: Task[];
  review: Task[];
  finished: Task[];
  update?: UpdateWithItems;
}

export function PeopleBoard() {
  const people = usePeople();
  const tasksQ = useTasks({});
  const today = todayISO();
  const updates = useTeamDailyUpdates(today, true);
  const [period, setPeriod] = useState<Period>("week");
  const range = periodRange(period);

  const board = useMemo<PersonView[]>(() => {
    const tasks = tasksQ.data ?? [];
    const byUser = new Map((updates.data ?? []).map((u) => [u.user_id, u]));
    const byDue = (a: Task, b: Task) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
    return people.active
      .filter((p) => sendsDailyUpdate(p))
      .map((person) => {
        const mine = tasks.filter((t) => peopleOn(t).includes(person.id));
        const started = (t: Task) => t.status === "in_progress" || (t.progress ?? 0) > 0;
        return {
          person,
          ongoing: mine.filter((t) => (t.status === "todo" || t.status === "in_progress") && started(t)).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0) || byDue(a, b)),
          notStarted: mine.filter((t) => t.status === "todo" && !started(t)).sort(byDue),
          review: mine.filter((t) => t.status === "in_review").sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? "")),
          finished: mine
            .filter((t) => t.status === "done" && t.completed_at && dateOf(t.completed_at) >= range.from && dateOf(t.completed_at) <= range.to)
            .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "")),
          update: byUser.get(person.id),
        };
      });
  }, [people.active, tasksQ.data, updates.data, range.from, range.to]);

  if (tasksQ.isLoading || people.loading) return <Loading rows={4} />;
  if (!board.length) {
    return (
      <Empty title="Nobody sends daily updates yet">
        Switch them on per person in Settings, Team.
      </Empty>
    );
  }

  const totals = board.reduce((t, b) => ({ ongoing: t.ongoing + b.ongoing.length, review: t.review + b.review.length, finished: t.finished + b.finished.length }), { ongoing: 0, review: 0, finished: 0 });

  return (
    <div className="du-page stack" style={{ gap: 14 }}>
      <div className="du-board-bar">
        <Segmented<Period>
          value={period}
          onChange={setPeriod}
          options={[
            { value: "week", label: "This week" },
            { value: "last", label: "Last week" },
            { value: "month", label: "This month" },
          ]}
        />
        <span className="faint small">
          {fmtDate(range.from)} to {fmtDate(range.to)}
        </span>
      </div>
      <div className="du-stats">
        <div className="glass du-stat">
          <b>{totals.ongoing}</b>
          <span>ongoing</span>
        </div>
        <div className="glass du-stat">
          <b>{totals.review}</b>
          <span>in review</span>
        </div>
        <div className="glass du-stat">
          <b>{totals.finished}</b>
          <span>finished {range.label}</span>
        </div>
      </div>
      <div className="du-board">
        {board.map((b) => (
          <PersonCard key={b.person.id} view={b} periodLabel={range.label} />
        ))}
      </div>
    </div>
  );
}

function PersonCard({ view, periodLabel }: { view: PersonView; periodLabel: string }) {
  const projects = useProjectMap();
  const [showTodo, setShowTodo] = useState(false);
  const [showAllDone, setShowAllDone] = useState(false);
  const { person, ongoing, notStarted, review, finished, update } = view;
  const todayNote = new Map((update?.items ?? []).map((i) => [i.task_id, i]));
  const avg = ongoing.length ? Math.round(ongoing.reduce((n, t) => n + (t.progress ?? 0), 0) / ongoing.length) : null;
  const doneShown = showAllDone ? finished : finished.slice(0, 4);

  const taskLine = (t: Task) => {
    const pct = t.progress ?? 0;
    const note = todayNote.get(t.id);
    return (
      <div className="du-bt" key={t.id}>
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <Link to={`/tasks/${t.id}`} className="du-task-title">
              {t.title}
            </Link>
            <div className="du-task-meta">
              <ProjectTag project={projects.get(t.project_id)} />
              <DueLabel date={t.due_date} />
            </div>
          </div>
          <b className="du-bt-pct" style={{ color: progressTone(pct) }}>
            {pct}%
          </b>
        </div>
        <div className="du-bar" aria-hidden>
          <i className="gain" style={{ width: `${pct}%`, background: progressTone(pct) }} />
        </div>
        {note?.note && (
          <p className="du-bt-note">
            <span className="faint">Today: </span>
            {note.note}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="glass card du-person-card">
      <div className="du-card-head">
        <button type="button" className="row du-who" onClick={() => openPersonCard(person.id)}>
          <Avatar person={person} size={38} />
          <span style={{ minWidth: 0 }}>
            <b>{person.short_name}</b>
            <span className="faint tiny ellipsis" style={{ display: "block" }}>
              {person.title}
            </span>
          </span>
        </button>
        <span className="spacer" />
        <span className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
          {isBlocked(update) && <Pill tone="orange">Blocked</Pill>}
          {update ? (
            <Pill tone="green">Update sent {fmtTime12(update.submitted_at)}</Pill>
          ) : (
            <Pill tone="gray">No update yet today</Pill>
          )}
        </span>
      </div>

      <div className="du-counts">
        <span>
          <b>{ongoing.length}</b> ongoing{avg != null ? `, ${avg}% on average` : ""}
        </span>
        <span>
          <b>{review.length}</b> in review
        </span>
        <span>
          <b>{finished.length}</b> finished {periodLabel}
        </span>
      </div>
      {update && <BlockerBlock update={update} />}

      <div className="du-sect">
        <span className="field-label">Working on</span>
        {ongoing.length ? <div className="du-bts">{ongoing.map(taskLine)}</div> : <p className="faint small du-none">Nothing under way.</p>}
        {notStarted.length > 0 && (
          <>
            <button type="button" className="btn small ghost du-toggle" onClick={() => setShowTodo((v) => !v)} aria-expanded={showTodo}>
              <ChevronDown style={{ transform: showTodo ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
              {notStarted.length} not started yet
            </button>
            {showTodo && <div className="du-bts">{notStarted.map(taskLine)}</div>}
          </>
        )}
      </div>

      {review.length > 0 && (
        <div className="du-sect">
          <span className="field-label">Waiting for review</span>
          <ul className="du-list">
            {review.map((t) => (
              <li key={t.id}>
                <Hourglass size={14} className="du-ic review" />
                <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                {t.submitted_at && <span className="faint tiny">handed in {fmtDate(dateOf(t.submitted_at))}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="du-sect">
        <span className="field-label">Finished {periodLabel}</span>
        {finished.length ? (
          <ul className="du-list">
            {doneShown.map((t) => (
              <li key={t.id}>
                <CircleCheck size={14} className="du-ic done" />
                <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                {t.completed_at && <span className="faint tiny">{fmtDate(dateOf(t.completed_at))}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint small du-none">Nothing finished {periodLabel} yet.</p>
        )}
        {finished.length > 4 && (
          <button type="button" className="btn small ghost du-toggle" onClick={() => setShowAllDone((v) => !v)}>
            {showAllDone ? "Show fewer" : `Show all ${finished.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
