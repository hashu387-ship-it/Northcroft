// The daily update form: each open task with how far it has got (%) and what was done on it today,
// then other work and anything blocking. Used on the Daily updates page and at check-out.
import "@/styles/updates.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, CircleCheck, Send } from "lucide-react";
import { useInvalidate, useProjectMap, useTasks } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { submitDailyUpdate, progressTone, type UpdateLine, type UpdateWithItems } from "@/lib/dailyUpdates";
import { errorMessage } from "@/lib/supabase";
import { fmtDate } from "@/lib/time";
import type { Task } from "@/lib/types";
import { DueLabel, Field, Loading, ProjectTag, useToast } from "@/components/ui";
import { CheckWording } from "@/components/CheckWording";

interface Line {
  progress: number;
  note: string;
}

const QUICK = [0, 25, 50, 75, 100];

const rowsFor = (text: string) => Math.min(8, Math.max(2, Math.ceil(text.length / 70) + text.split("\n").length - 1));

export interface UpdateFormProps {
  /** Today's update when it has already been sent (the form then starts from it). */
  existing: UpdateWithItems | null | undefined;
  /** After it's sent. */
  onSent?: (r: { tasks: number; handed_in: number }) => void;
  /** Custom buttons under the form (send() resolves true once it's sent). Default: one Send button. */
  footer?: (send: () => Promise<boolean>, busy: boolean) => ReactNode;
}

export function UpdateForm({ existing, onSent, footer }: UpdateFormProps) {
  const me = useMe();
  const toast = useToast();
  const invalidate = useInvalidate();
  const projects = useProjectMap();
  const tasksQ = useTasks({ assigneeId: me.id, openOnly: true });
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [other, setOther] = useState(existing?.other_work ?? "");
  const [blockers, setBlockers] = useState(existing?.blockers ?? "");
  const [showTodo, setShowTodo] = useState(false);
  const [busy, setBusy] = useState(false);

  // Tasks they can still move on: not started or under way (in review and done ones are with someone else).
  const sentToday = useMemo(() => new Map((existing?.items ?? []).map((i) => [i.task_id, i])), [existing]);
  const open = useMemo(() => {
    const list = (tasksQ.data ?? []).filter((t) => t.status === "todo" || t.status === "in_progress");
    const rank = (t: Task) => (t.status === "in_progress" || sentToday.has(t.id) ? 0 : 1);
    return list.sort((a, b) => rank(a) - rank(b) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  }, [tasksQ.data, sentToday]);
  const underWay = open.filter((t) => t.status === "in_progress" || sentToday.has(t.id) || (t.progress ?? 0) > 0);
  const notStarted = open.filter((t) => !underWay.includes(t));
  // Handed in earlier today: shown so they know it's already in the update.
  const handedToday = (existing?.items ?? []).filter((i) => i.handed_in);

  // Start each task from what was sent today, or from where the task stands.
  useEffect(() => {
    setLines((cur) => {
      const next = { ...cur };
      for (const t of open) {
        if (next[t.id]) continue;
        const s = sentToday.get(t.id);
        next[t.id] = { progress: s ? s.progress : t.progress ?? 0, note: s?.note ?? "" };
      }
      return next;
    });
  }, [open, sentToday]);

  const set = (id: string, patch: Partial<Line>) => setLines((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }));

  function changed(t: Task): boolean {
    const l = lines[t.id];
    if (!l) return false;
    return l.progress !== (t.progress ?? 0) || l.note.trim() !== "" || sentToday.has(t.id);
  }

  async function send(): Promise<boolean> {
    const out: UpdateLine[] = open.filter(changed).map((t) => ({ task_id: t.id, progress: lines[t.id].progress, note: lines[t.id].note }));
    if (!out.length && !other.trim() && !handedToday.length) {
      toast("Say what you did today on at least one task, or under Other work.", "error");
      return false;
    }
    setBusy(true);
    try {
      const r = await submitDailyUpdate(out, other, blockers);
      await invalidate("daily_updates", "tasks");
      toast(
        r.handed_in
          ? `Update sent. ${r.handed_in === 1 ? "1 task" : `${r.handed_in} tasks`} handed in for review.`
          : existing
            ? "Today's update is changed."
            : "Update sent. Thanks.",
      );
      onSent?.(r);
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (tasksQ.isLoading) return <Loading rows={3} />;

  const renderTask = (t: Task) => {
    const l = lines[t.id] ?? { progress: t.progress ?? 0, note: "" };
    const before = t.progress ?? 0;
    return (
      <div className="du-task" key={t.id}>
        <div className="du-task-top">
          <div className="grow" style={{ minWidth: 0 }}>
            <Link to={`/tasks/${t.id}`} className="du-task-title">
              {t.title}
            </Link>
            <div className="du-task-meta">
              <ProjectTag project={projects.get(t.project_id)} />
              <DueLabel date={t.due_date} />
            </div>
          </div>
          <span className="du-pct" style={{ color: progressTone(l.progress) }}>
            {l.progress}%
          </span>
        </div>
        <input
          className="range du-range"
          type="range"
          min={0}
          max={100}
          step={5}
          value={l.progress}
          onChange={(e) => set(t.id, { progress: Number(e.target.value) })}
          aria-label={`How far ${t.title} has got`}
          style={{ ["--pct" as string]: `${l.progress}%` }}
        />
        <div className="du-quick">
          {QUICK.map((q) => (
            <button key={q} type="button" className={q === l.progress ? "on" : ""} onClick={() => set(t.id, { progress: q })}>
              {q === 100 ? "Done" : `${q}%`}
            </button>
          ))}
          <span className="faint tiny du-was">
            {before !== l.progress ? `Was ${before}%` : t.progress_at ? `Since ${fmtDate(t.progress_at.slice(0, 10))}` : "Not started"}
          </span>
        </div>
        {l.progress === 100 && (
          <div className="du-hand-in small">
            <CircleCheck size={15} /> Goes in for review when you send this.
          </div>
        )}
        <textarea
          className="textarea"
          rows={rowsFor(l.note)}
          value={l.note}
          onChange={(e) => set(t.id, { note: e.target.value })}
          placeholder="What you did on it today"
          maxLength={1000}
        />
        <CheckWording value={l.note} onUse={(v) => set(t.id, { note: v.slice(0, 1000) })} kind="update" />
      </div>
    );
  };

  return (
    <div className="du-form stack" style={{ gap: 14 }}>
      {handedToday.length > 0 && (
        <div className="du-handed small">
          <CircleCheck size={16} />
          <span>
            Handed in today: <b>{handedToday.map((i) => i.task_title).join(", ")}</b>
          </span>
        </div>
      )}

      {open.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          You have no open tasks right now. Use Other work to say what you did today.
        </p>
      ) : (
        <>
          {underWay.length > 0 ? (
            <div className="du-tasks">{underWay.map(renderTask)}</div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              None of your tasks are under way yet. Open one below to say how far it got.
            </p>
          )}
          {notStarted.length > 0 && (
            <div className="du-more">
              <button type="button" className="btn small ghost" onClick={() => setShowTodo((v) => !v)} aria-expanded={showTodo}>
                <ChevronDown style={{ transform: showTodo ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
                {showTodo ? "Hide" : "Show"} tasks not started yet ({notStarted.length})
              </button>
              {showTodo && <div className="du-tasks">{notStarted.map(renderTask)}</div>}
            </div>
          )}
        </>
      )}

      <Field label="Other work today">
        <textarea
          className="textarea"
          rows={rowsFor(other)}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          placeholder="Anything you worked on that isn't one of your tasks"
          maxLength={2000}
        />
      </Field>
      <CheckWording value={other} onUse={(v) => setOther(v.slice(0, 2000))} kind="update" />
      <Field label="Anything blocking you?">
        <textarea
          className="textarea"
          rows={rowsFor(blockers)}
          value={blockers}
          onChange={(e) => setBlockers(e.target.value)}
          placeholder="Waiting on someone, missing drawings or information, or leave it empty"
          maxLength={2000}
        />
      </Field>
      <CheckWording value={blockers} onUse={(v) => setBlockers(v.slice(0, 2000))} kind="update" />

      {footer ? (
        footer(send, busy)
      ) : (
        <button className="btn primary large block" type="button" onClick={() => void send()} disabled={busy}>
          <Send /> {busy ? "Sending..." : existing ? "Send the changes" : "Send today's update"}
        </button>
      )}
    </div>
  );
}
