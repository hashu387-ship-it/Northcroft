// The task board: To do, In progress, In review and Done side by side. Drag a card to another
// column to move the task (hold it for a moment first on a phone). The usual rules apply: the
// people on a task start it and hand it in, the reviewer approves it, and sending work back still
// needs a note on the task itself. With a keyboard, Alt + arrow left or right moves a focused card.
import "@/styles/board.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import { Pause } from "lucide-react";
import { useInvalidate, usePeople, useProjectMap } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { TASK_STATUS } from "@/lib/constants";
import { burst, haptic } from "@/lib/motion";
import { peopleOn } from "@/lib/people";
import { passesOn, useSignoff, waitingOn, type Signoff } from "@/lib/signoff";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Task, TaskStatus } from "@/lib/types";
import { MorphLink } from "./Morph";
import { WorkingDots } from "./Tracked";
import { AvatarStack, DueLabel, Pill, PriorityFlag, ProjectTag, useConfirm, useToast } from "./ui";

const COLS: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];
const COL_COLOR: Record<TaskStatus, string> = {
  todo: "var(--text-3)",
  in_progress: "var(--accent)",
  in_review: "var(--purple)",
  done: "var(--green)",
};

/** Whether I can move this task to that column from the board, and if not, why. */
function canMove(t: Task, to: TaskStatus, meId: string, canAssign: boolean, s: Signoff): true | string {
  if (t.status === to) return "It's already there.";
  if (t.approval) return "This task is waiting for approval first.";
  if (t.hold === "on") return "This task is on hold.";
  const mine = peopleOn(t).includes(meId);
  const from = t.status;
  if (from === "done") return "Finished tasks stay finished. Open it to reopen it.";
  if (from === "in_review") {
    if (to === "done") {
      const turn = waitingOn(t, s);
      const reviewer = canAssign && (!s.on || !t.review_stage || turn === meId);
      return reviewer ? true : "It's waiting for the reviewer's OK.";
    }
    return "To send it back, open the task and add a note saying what to change.";
  }
  if (to === "done") return canAssign && !mine ? true : "Hand it in for review instead: drag it to In review.";
  if (!mine && !canAssign) return "Only the people on this task can move it.";
  if (to === "in_review" && !mine) return "Only the people on this task hand it in.";
  return true;
}

interface Drag {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  w: number;
  over: TaskStatus | null;
}

export function TaskBoard({ tasks, done = [] }: { tasks: Task[]; done?: Task[] }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const signoff = useSignoff();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  // Moves made here, shown at once while the database catches up.
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const boardRef = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false);

  const all = useMemo(() => {
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const t of [...tasks, ...done]) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(moved[t.id] ? { ...t, status: moved[t.id] } : t);
    }
    return out;
  }, [tasks, done, moved]);
  // Forget local moves once the real data agrees.
  useEffect(() => {
    setMoved((m) => {
      const next = { ...m };
      let changed = false;
      for (const t of [...tasks, ...done]) {
        if (next[t.id] && t.status === next[t.id]) {
          delete next[t.id];
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [tasks, done]);

  const byCol = useMemo(() => {
    const m: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], in_review: [], done: [] };
    for (const t of all) m[t.status].push(t);
    const due = (t: Task) => t.due_date ?? "9999";
    for (const c of COLS) m[c].sort((a, b) => (c === "done" ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "") : due(a).localeCompare(due(b))));
    m.done = m.done.slice(0, 20);
    return m;
  }, [all]);

  async function move(t: Task, to: TaskStatus, from?: HTMLElement | null) {
    const ok = canMove(t, to, me.id, canAssign, signoff);
    if (ok !== true) {
      toast(ok, "error");
      haptic("warning");
      return;
    }
    if (to === "in_review") {
      const sure = await confirm({ title: "Hand in for review?", message: `${t.title} goes to the reviewer, the same as tapping Submit on the task.`, confirmLabel: "Hand in" });
      if (!sure) return;
    }
    if (to === "done") {
      const passing = passesOn(t, me.id, signoff);
      const sure = await confirm({
        title: passing ? "Approve and send for the final OK?" : t.status === "in_review" ? "Approve this task?" : "Mark it done?",
        message: passing ? `${t.title} goes to ${signoff.final?.short_name ?? "the final checker"} for the final OK.` : `${t.title} is finished, and the people on it are told.`,
        confirmLabel: passing ? "Approve" : "Done",
      });
      if (!sure) return;
    }
    setMoved((m) => ({ ...m, [t.id]: to }));
    const { error } = await supabase.from("tasks").update({ status: to }).eq("id", t.id);
    if (error) {
      setMoved((m) => {
        const next = { ...m };
        delete next[t.id];
        return next;
      });
      toast(errorMessage(error), "error");
      return;
    }
    haptic(to === "done" ? "success" : "tick");
    if (to === "done" && from) burst(from);
    toast(to === "in_progress" ? "Moved to In progress" : to === "todo" ? "Moved back to To do" : to === "in_review" ? "Handed in for review" : "Done");
    await invalidate("tasks", "activity");
  }

  // ---- dragging: a mouse starts after a few pixels; a finger after holding still for a moment
  const press = useRef<{ id: string; x: number; y: number; t: number; el: HTMLElement; timer: number; pointer: number; touch: boolean } | null>(null);

  function begin(p: NonNullable<typeof press.current>, x: number, y: number) {
    const r = p.el.getBoundingClientRect();
    const d = { id: p.id, x, y, dx: p.x - r.left, dy: p.y - r.top, w: r.width, over: null };
    setDrag(d);
    dragRef.current = d;
    haptic("tick");
    try {
      p.el.setPointerCapture(p.pointer);
    } catch {
      /* fine */
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLElement>, t: Task) {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const touch = e.pointerType !== "mouse";
    const p = { id: t.id, x: e.clientX, y: e.clientY, t: Date.now(), el, timer: 0, pointer: e.pointerId, touch };
    press.current = p;
    if (touch) p.timer = window.setTimeout(() => press.current === p && begin(p, p.x, p.y), 280);
  }

  function colAt(x: number, y: number): TaskStatus | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-col]");
    return (el?.dataset.col as TaskStatus) ?? null;
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const p = press.current;
    const d = dragRef.current;
    if (!d) {
      if (!p) return;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.touch) {
        // Moving before the hold is up: it's a scroll, not a drag.
        if (far > 8) {
          window.clearTimeout(p.timer);
          press.current = null;
        }
      } else if (far > 5) begin(p, e.clientX, e.clientY);
      return;
    }
    const over = colAt(e.clientX, e.clientY);
    const next = { ...d, x: e.clientX, y: e.clientY, over };
    dragRef.current = next;
    setDrag(next);
    // Near the board's edge, scroll it (columns side by side on a phone).
    const b = boardRef.current;
    if (b) {
      const r = b.getBoundingClientRect();
      if (e.clientX < r.left + 36) b.scrollBy({ left: -14 });
      else if (e.clientX > r.right - 36) b.scrollBy({ left: 14 });
    }
  }

  function end(e: ReactPointerEvent<HTMLElement>, cancelled = false) {
    const p = press.current;
    if (p) window.clearTimeout(p.timer);
    press.current = null;
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    dragRef.current = null;
    justDragged.current = true;
    window.setTimeout(() => (justDragged.current = false), 60);
    if (cancelled) return;
    const to = colAt(e.clientX, e.clientY);
    const t = all.find((x) => x.id === d.id);
    if (t && to && to !== t.status) void move(t, to, document.querySelector<HTMLElement>(`[data-col="${to}"]`));
  }

  // While a finger is dragging, the page mustn't scroll.
  useEffect(() => {
    if (!drag) return;
    const stop = (ev: TouchEvent) => ev.preventDefault();
    window.addEventListener("touchmove", stop, { passive: false });
    return () => window.removeEventListener("touchmove", stop);
  }, [drag]);

  const dragged = drag ? all.find((t) => t.id === drag.id) : undefined;
  const dropOk = (c: TaskStatus) => (dragged ? canMove(dragged, c, me.id, canAssign, signoff) === true : false);

  return (
    <div className={clsx("tb", drag && "dragging")} ref={boardRef}>
      {COLS.map((c) => (
        <section
          key={c}
          className={clsx("tb-col", drag && drag.over === c && (dropOk(c) ? "over" : "no"), drag && dragged?.status !== c && dropOk(c) && "can")}
          data-col={c}
          style={{ ["--col" as string]: COL_COLOR[c] } as CSSProperties}
          aria-label={`${TASK_STATUS[c].label}, ${byCol[c].length} tasks`}
        >
          <header className="tb-head">
            <i aria-hidden />
            <b>{TASK_STATUS[c].label}</b>
            <span className="tb-n">{byCol[c].length}</span>
          </header>
          <div className="tb-cards">
            {byCol[c].map((t) => (
              <BoardCard
                key={t.id}
                task={t}
                lifted={drag?.id === t.id}
                onPointerDown={(e) => onPointerDown(e, t)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => end(e)}
                onPointerCancel={(e) => end(e, true)}
                onClickCapture={(e) => {
                  if (justDragged.current) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onKeyDown={(e) => {
                  if (!e.altKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
                  e.preventDefault();
                  const to = COLS[COLS.indexOf(t.status) + (e.key === "ArrowRight" ? 1 : -1)];
                  if (to) void move(t, to, e.currentTarget);
                }}
              />
            ))}
            {!byCol[c].length && <div className="tb-empty">{drag ? "Drop here" : "Nothing here"}</div>}
          </div>
        </section>
      ))}
      {drag && dragged && (
        <div className="tb-ghost" style={{ width: drag.w, transform: `translate3d(${drag.x - drag.dx}px, ${drag.y - drag.dy}px, 0) rotate(2.5deg)` }} aria-hidden>
          <CardBody task={dragged} />
        </div>
      )}
    </div>
  );
}

function CardBody({ task: t }: { task: Task }) {
  const people = usePeople();
  const projects = useProjectMap();
  return (
    <>
      <div className="tb-top">
        <PriorityFlag priority={t.priority} size="small" />
        {t.hold === "on" && (
          <Pill tone="orange">
            <Pause /> On hold
          </Pill>
        )}
        <WorkingDots taskId={t.id} />
      </div>
      <div className="tb-title">{t.title}</div>
      <div className="tb-meta">
        <ProjectTag project={projects.get(t.project_id)} />
        <DueLabel date={t.due_date} done={t.status === "done" || t.status === "in_review"} />
        <span className="spacer" />
        <AvatarStack people={peopleOn(t).map((id) => people.get(id))} size={24} max={3} />
      </div>
      {(t.progress ?? 0) > 0 && t.status !== "done" && (
        <span className="tb-prog" aria-label={`${t.progress}% done`}>
          <i style={{ width: `${t.progress}%` }} />
        </span>
      )}
    </>
  );
}

function BoardCard({
  task,
  lifted,
  ...handlers
}: {
  task: Task;
  lifted: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    <MorphLink
      to={`/tasks/${task.id}`}
      morphKey={`task-${task.id}`}
      className={clsx("tb-card", lifted && "lifted", task.status === "done" && "done")}
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
      {...handlers}
    >
      <CardBody task={task} />
    </MorphLink>
  );
}
