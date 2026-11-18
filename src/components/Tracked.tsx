// Tracked tasks on screen (EI-116 first): the countdown to the deadline, each person's own steps,
// and the stopwatch. On the task page it replaces the plain checklist; on Home it's one card for
// everyone on these tasks and the managers.
import "@/styles/tracked.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Check, Pause, Pencil, Play, Timer } from "lucide-react";
import clsx from "clsx";
import { useChecklist, useInvalidate, usePeople, useProjectMap, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/supabase";
import {
  canTime,
  fmtClockSecs,
  fmtDeadline,
  fmtSpent,
  isUnnamedStep,
  renameStep,
  setStepDone,
  startOfToday,
  startStopwatch,
  stepsByOwner,
  stopStopwatch,
  timeLeft,
  timeTotals,
  useDeadline,
  useNow,
  useRunningLogs,
  useTimeLogs,
  useTrackedSteps,
  useTrackedTasks,
  type OwnerSteps,
} from "@/lib/tracked";
import type { ChecklistItem, Task, TimeLog } from "@/lib/types";
import { MorphLink } from "./Morph";
import { Flip, Ring } from "./Motion";
import { burst, haptic } from "@/lib/motion";
import { Avatar, CountUp, Loading, Pill, ProjectTag, useToast } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
const isOpen = (t: Pick<Task, "status">) => t.status === "todo" || t.status === "in_progress";

/* ---------------------------------------------------------------- the countdown */

/** Days, hours, minutes and seconds to the deadline (the due date at the end of the working day). */
export function Countdown({ task, compact }: { task: Pick<Task, "due_date" | "status">; compact?: boolean }) {
  const deadline = useDeadline(task);
  const tz = useSettings().data?.timezone;
  const now = useNow(1000);
  if (!deadline) return null;
  const l = timeLeft(deadline, now);
  const when = fmtDeadline(deadline, tz);
  const parts: [string, number][] = [
    ["days", l.days],
    ["hrs", l.hours],
    ["min", l.mins],
    ["sec", l.secs],
  ];
  return (
    <div className={clsx("trk-count", l.tone, compact && "compact")}>
      <div className="trk-digits" role="timer" aria-label={l.late ? `Deadline passed, ${when}` : `${l.days} days ${l.hours} hours ${l.mins} minutes left, until ${when}`}>
        {parts.map(([unit, v]) => (
          <span key={unit} className="trk-digit">
            <Flip value={pad(v)} />
            <i>{unit}</i>
          </span>
        ))}
      </div>
      <div className="trk-count-label">
        {l.late ? <b>Past the deadline</b> : <b>Left until the deadline</b>}
        <span>{when}</span>
        {task.status === "in_review" && <Pill tone="purple">Handed in for review</Pill>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the stopwatch */

/** My stopwatch on a task: Start, or the running time and Stop. */
export function StopwatchButton({ task, logs, small }: { task: Pick<Task, "id" | "status" | "approval" | "hold">; logs: TimeLog[]; small?: boolean }) {
  const me = useMe();
  const toast = useToast();
  const invalidate = useInvalidate();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const t = timeTotals(logs, task.id, me.id, now, startOfToday());
  if (!canTime(task)) return null;

  async function toggle() {
    setBusy(true);
    try {
      if (t.running) {
        const secs = await stopStopwatch();
        toast(`Stopped. ${fmtSpent(secs)} on it just now, ${fmtSpent(t.todaySecs)} today.`);
      } else {
        await startStopwatch(task.id);
        toast("Stopwatch started. It stops by itself when you check out.");
      }
      await invalidate("task_time_logs", "tasks");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={clsx("trk-watch", t.running && "running", small && "small")}
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={!!t.running}
    >
      {t.running ? <Pause /> : <Play />}
      <span className="trk-watch-text">
        <b>{t.running ? fmtClockSecs(t.runningSecs) : "Start stopwatch"}</b>
        <i>{t.running ? "Tap to stop" : `Today ${fmtSpent(t.todaySecs)}`}</i>
      </span>
    </button>
  );
}

/** "Working on it now 12:04" or "Today 1h 20m · In all 3h 05m". */
function TimeLine({ task, logs, userId }: { task: Pick<Task, "id">; logs: TimeLog[]; userId: string }) {
  const now = useNow(1000);
  const t = timeTotals(logs, task.id, userId, now, startOfToday());
  if (t.running) {
    return (
      <span className="trk-time live">
        <i className="trk-live" aria-hidden /> Working on it now · {fmtClockSecs(t.runningSecs)}
      </span>
    );
  }
  return (
    <span className="trk-time">
      Today {fmtSpent(t.todaySecs)} · In all {fmtSpent(t.totalSecs)}
    </span>
  );
}

/* ---------------------------------------------------------------- steps */

function StepRow({ item, canTick, canName, finishing }: { item: ChecklistItem; canTick: boolean; canName: boolean; finishing?: boolean }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const unnamed = isUnnamedStep(item.text);

  useEffect(() => {
    if (!editing) setText(item.text);
  }, [item.text, editing]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  async function tick(from: HTMLElement) {
    setBusy(true);
    try {
      await setStepDone(item, !item.done);
      if (!item.done) {
        haptic(finishing ? "success" : "tick");
        if (finishing) {
          burst(from);
          toast("Every step done. Send your daily update to hand it in.");
        }
      }
      await invalidate("task_checklist", "tasks");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setEditing(false);
    if (text.trim() === item.text || !text.trim()) {
      setText(item.text);
      return;
    }
    try {
      await renameStep(item, text);
      await invalidate("task_checklist");
    } catch (e) {
      toast(errorMessage(e), "error");
      setText(item.text);
    }
  }

  return (
    <li className={clsx("trk-step", item.done && "done")}>
      <button
        type="button"
        className={clsx("trk-check", item.done && "on")}
        onClick={(e) => void tick(e.currentTarget)}
        disabled={!canTick || busy}
        aria-label={item.done ? `Mark "${item.text}" as not done` : `Mark "${item.text}" as done`}
      >
        {item.done && <Check strokeWidth={3} />}
      </button>
      {editing ? (
        <input
          ref={input}
          className="input trk-step-input"
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setText(item.text);
              setEditing(false);
            }
          }}
          aria-label="Name this step"
          placeholder="What this step is"
        />
      ) : canName ? (
        <button type="button" className={clsx("trk-step-label", unnamed && "unnamed")} onClick={() => setEditing(true)} title="Tap to name this step">
          <span>{item.text}</span>
          {unnamed ? <em>Tap to name it</em> : <Pencil aria-hidden />}
        </button>
      ) : (
        <span className={clsx("trk-step-label static", unnamed && "unnamed")}>
          <span>{item.text}</span>
        </span>
      )}
    </li>
  );
}

/** One person's part: their steps, their count and their time. */
function PersonPart({ task, part, logs }: { task: Task; part: OwnerSteps; logs: TimeLog[] }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const p = people.get(part.userId);
  const mine = part.userId === me.id;
  const open = isOpen(task);
  const pct = part.total ? (part.done / part.total) * 100 : 0;
  const unnamed = part.steps.filter((s) => isUnnamedStep(s.text)).length;
  return (
    <section className={clsx("trk-person", mine && "mine")} style={p?.color ? ({ ["--person" as string]: p.color } as CSSProperties) : undefined}>
      <div className="trk-person-head">
        <Avatar person={p} size={32} />
        <div className="grow">
          <b className="trk-name">
            {p?.short_name ?? "Someone"}
            {mine && <span className="faint"> (you)</span>}
          </b>
          <TimeLine task={task} logs={logs} userId={part.userId} />
        </div>
        <Ring value={pct} size={50} color={part.total > 0 && part.done === part.total ? "var(--green)" : "var(--person, var(--accent))"} label={`${part.done} of ${part.total} steps done`}>
          <span className="trk-tally-in">
            <CountUp value={part.done} />/{part.total}
          </span>
        </Ring>
      </div>
      {part.steps.length > 0 ? (
        <ol className="trk-steps">
          {part.steps.map((s) => (
            <StepRow key={s.id} item={s} canTick={(mine && open) || canAssign} canName={mine || canAssign} finishing={!s.done && part.done === part.total - 1} />
          ))}
        </ol>
      ) : (
        <p className="faint small" style={{ margin: 0 }}>
          No steps for {p?.short_name ?? "them"} yet.
        </p>
      )}
      {mine && unnamed > 0 && open && (
        <p className="trk-hint small">
          Name your {unnamed === part.total ? `${part.total} steps` : unnamed === 1 ? "last step" : `other ${unnamed} steps`} so everyone can see what each one is. Tap a step to name it.
        </p>
      )}
      {mine && open && <StopwatchButton task={task} logs={logs} />}
    </section>
  );
}

/** On the task page of a tracked task: the countdown, then each person's steps and time. */
export function TrackedPanel({ task }: { task: Task }) {
  const itemsQ = useChecklist(task.id);
  const items = itemsQ.data ?? [];
  const logs = useTimeLogs([task.id]).data ?? [];
  const parts = stepsByOwner(task, items);
  const done = parts.reduce((n, p) => n + p.done, 0);
  const total = parts.reduce((n, p) => n + p.total, 0);
  return (
    <div className="glass card trk-card">
      <div className="card-head">
        <h3 className="tone-orange">
          <Timer /> Countdown and steps
        </h3>
        {total > 0 && (
          <span className="muted small">
            {done} of {total} steps done
          </span>
        )}
      </div>
      <Countdown task={task} />
      {itemsQ.isLoading ? (
        <Loading rows={2} />
      ) : (
        <div className="trk-people">
          {parts.map((p) => (
            <PersonPart key={p.userId} task={task} part={p} logs={logs} />
          ))}
        </div>
      )}
      <p className="faint small trk-foot">
        Each person ticks their own steps here or in their daily update. The count goes in with the daily update, and the managers get it as
        a push. The stopwatch stops by itself at check-out, when the task is handed in, and at 11:55 pm.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- time on any task */

/** On any task's page: my stopwatch, and each person's time on it. Hidden until there's something
 *  to show (I can time it, or someone has). */
export function TaskTimeCard({ task }: { task: Task }) {
  const me = useMe();
  const people = usePeople();
  const logs = useTimeLogs([task.id]).data ?? [];
  const mine = (task.assignees ?? []).includes(me.id);
  const ids = [...new Set([...(task.assignees ?? []), ...logs.map((l) => l.user_id)])];
  if (!logs.length && !(mine && canTime(task))) return null;
  return (
    <div className="glass card trk-timecard">
      <div className="card-head">
        <h3 className="tone-teal">
          <Timer /> Time on this task
        </h3>
      </div>
      <div className="trk-timelist">
        {ids.map((id) => {
          const p = people.get(id);
          return (
            <div key={id} className="trk-timerow">
              <Avatar person={p} size={30} />
              <b className="trk-name grow">
                {p?.short_name ?? "Someone"}
                {id === me.id && <span className="faint"> (you)</span>}
              </b>
              <TimeLine task={task} logs={logs} userId={id} />
            </div>
          );
        })}
      </div>
      {mine && <StopwatchButton task={task} logs={logs} />}
    </div>
  );
}

/** Home: who has a stopwatch running right now, with the task and a live timer. Nothing when
 *  nobody's timing. */
export function WorkingNowStrip() {
  const me = useMe();
  const people = usePeople();
  const invalidate = useInvalidate();
  const toast = useToast();
  const list = useRunningLogs().data ?? [];
  const now = useNow(1000);
  if (!list.length) return null;

  async function stopMine() {
    try {
      const secs = await stopStopwatch();
      toast(`Stopped. ${fmtSpent(secs)} on it just now.`);
      await invalidate("task_time_logs");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="glass card wn" aria-label="Working now">
      <div className="wn-head">
        <i className="trk-live" aria-hidden />
        <b>Working now</b>
        <span className="muted small">
          {list.length} {list.length === 1 ? "person" : "people"} timing a task
        </span>
      </div>
      <div className="wn-row">
        {list.map((l) => {
          const p = people.get(l.user_id);
          const secs = Math.max(0, Math.floor((now - new Date(l.started_at).getTime()) / 1000));
          return (
            <div key={l.id} className="wn-item" style={p?.color ? ({ ["--person" as string]: p.color } as CSSProperties) : undefined}>
              <Link to={`/tasks/${l.task_id}`} className="wn-link">
                <Avatar person={p} size={38} />
                <span className="wn-text">
                  <b>
                    {p?.short_name ?? "Someone"}
                    {l.user_id === me.id && <span className="faint"> (you)</span>}
                  </b>
                  <span className="wn-task">{l.task?.title ?? "A task"}</span>
                </span>
                <span className="wn-time">{fmtClockSecs(secs)}</span>
              </Link>
              {l.user_id === me.id && (
                <button type="button" className="icon-btn small" onClick={() => void stopMine()} aria-label="Stop my stopwatch" title="Stop">
                  <Pause />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** In a task row: the photos of whoever is timing this task right now. */
export function WorkingDots({ taskId }: { taskId: string }) {
  const people = usePeople();
  const on = (useRunningLogs().data ?? []).filter((l) => l.task_id === taskId);
  if (!on.length) return null;
  return (
    <span className="wn-dots" title={`${on.map((l) => people.get(l.user_id)?.short_name ?? "Someone").join(", ")} working on it now`}>
      <i className="trk-live" aria-hidden />
      {on.slice(0, 3).map((l) => (
        <Avatar key={l.id} person={people.get(l.user_id)} size={18} />
      ))}
    </span>
  );
}

/* ---------------------------------------------------------------- Home */

/** "EI-116" from "EI-116 Ceiling", "EI-116 External wall" and "EI-116 Wall finishes". */
function sharedName(titles: string[]): string | null {
  if (titles.length < 2) return null;
  let p = titles[0];
  for (const t of titles.slice(1)) {
    let i = 0;
    while (i < p.length && i < t.length && p[i].toLowerCase() === t[i].toLowerCase()) i++;
    p = p.slice(0, i);
  }
  const cut = p.replace(/[\s:,.\-–]+$/, "").trim();
  return cut.length >= 3 ? cut : null;
}

/** Home: the countdown for the tracked tasks I'm on (managers see them all), each task's people
 *  and counts, and my stopwatch. Not shown when there's nothing tracked. */
export function TrackedHomeCard() {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const projects = useProjectMap();
  const tasksQ = useTrackedTasks();
  const list = useMemo(
    () => (tasksQ.data ?? []).filter((t) => canAssign || (t.assignees ?? []).includes(me.id)),
    [tasksQ.data, canAssign, me.id],
  );
  const ids = list.map((t) => t.id);
  const stepsQ = useTrackedSteps(ids);
  const steps = stepsQ.data ?? [];
  const logs = useTimeLogs(ids).data ?? [];
  if (!list.length) return null;

  const first = [...list].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))[0];
  const name = sharedName(list.map((t) => t.title));
  const project = projects.get(first.project_id);
  const sameProject = list.every((t) => t.project_id === first.project_id);

  return (
    <div className="glass card trk-home">
      <div className="card-head">
        <h2 className="tone-orange">
          <Timer /> {name ? `${name} countdown` : "Countdown"}
        </h2>
        {sameProject && project && <ProjectTag project={project} />}
      </div>
      <Countdown task={first} compact />
      <div className="trk-home-list">
        {list.map((t) => {
          const parts = stepsByOwner(t, steps.filter((s) => s.task_id === t.id));
          const mine = (t.assignees ?? []).includes(me.id);
          const short = name && t.title.toLowerCase().startsWith(name.toLowerCase()) ? t.title.slice(name.length).replace(/^[\s:,.\-–]+/, "") || t.title : t.title;
          return (
            <div key={t.id} className={clsx("trk-home-row", mine && "mine")}>
              <MorphLink to={`/tasks/${t.id}`} morphKey={`task-${t.id}`} className="trk-home-link">
                <span className="trk-home-title">
                  <b>{short}</b>
                  {t.status === "in_review" && <Pill tone="purple">In review</Pill>}
                </span>
                <span className="trk-chips">
                  {stepsQ.data && parts.map((p) => {
                    const who = people.get(p.userId);
                    return (
                      <span
                        key={p.userId}
                        className={clsx("trk-chip", p.total > 0 && p.done === p.total && "all")}
                        style={who?.color ? ({ ["--person" as string]: who.color } as CSSProperties) : undefined}
                      >
                        <Avatar person={who} size={20} /> {who?.short_name ?? "Someone"} <b>{p.done}/{p.total}</b>
                      </span>
                    );
                  })}
                </span>
                <Ring value={t.progress ?? 0} size={46} color={(t.progress ?? 0) >= 100 ? "var(--green)" : undefined}>
                  <CountUp value={t.progress ?? 0} />
                </Ring>
              </MorphLink>
              {mine && isOpen(t) && <StopwatchButton task={t} logs={logs} small />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
