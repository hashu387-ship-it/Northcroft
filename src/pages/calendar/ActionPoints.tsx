// Action points on a calendar entry (usually a meeting): what was agreed, who does it, by when.
// Whoever made the entry, anyone invited to it, and managers and seniors can add and change them;
// managers and seniors turn them into tasks in one tap (make_tasks_from_actions). Everyone in the
// team can read them. They save as they're added, separately from the entry's own Save button.
import "@/styles/meeting.css";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, ListChecks, Plus, SendHorizontal, X } from "lucide-react";
import { Avatar, Pill, useToast } from "@/components/ui";
import { unwrap, useInvalidate, usePeople } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { TASK_STATUS } from "@/lib/constants";
import { errorMessage, supabase } from "@/lib/supabase";
import { fmtDue } from "@/lib/time";
import type { CalendarEvent, EventAction, Task } from "@/lib/types";

type TaskLite = Pick<Task, "id" | "title" | "status" | "due_date">;

export function useEventActions(eventId: string | undefined) {
  return useQuery({
    queryKey: ["event_actions", eventId],
    enabled: !!eventId,
    queryFn: () =>
      unwrap<EventAction[]>(
        supabase.from("event_actions").select("*").eq("event_id", eventId!).is("removed_at", null).order("position").order("created_at"),
      ),
  });
}

/** The meeting a task came from, if it came from one. */
export function useTaskMeeting(taskId: string | undefined) {
  return useQuery({
    queryKey: ["event_actions", "task", taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const { data: a } = await supabase.from("event_actions").select("event_id").eq("task_id", taskId!).limit(1).maybeSingle();
      if (!a) return null;
      const { data: e } = await supabase.from("events").select("id, title, event_date").eq("id", a.event_id).maybeSingle();
      return (e as Pick<CalendarEvent, "id" | "title" | "event_date"> | null) ?? null;
    },
    staleTime: 60_000,
  });
}

export function ActionPoints({ event }: { event: CalendarEvent }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const canEdit = canAssign || event.created_by === me.id || event.attendees.includes(me.id);
  const { data: points = [], isLoading } = useEventActions(event.id);

  const taskIds = points.map((p) => p.task_id).filter(Boolean) as string[];
  const tasks = useQuery({
    queryKey: ["tasks", "for-actions", taskIds.join(",")],
    enabled: taskIds.length > 0,
    queryFn: () => unwrap<TaskLite[]>(supabase.from("tasks").select("id, title, status, due_date").in("id", taskIds)),
  });
  const taskById = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t])), [tasks.data]);

  const [body, setBody] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Who a point can be for: anyone who takes tasks (plus whoever it's already for).
  const options = (current: string | null) => people.assignableBy(me.id, current);
  const ready = points.filter((p) => !p.task_id && !p.done_at && p.assignee_id);
  const finished = points.filter((p) => p.done_at || (p.task_id && taskById.get(p.task_id)?.status === "done")).length;

  async function add() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("event_actions").insert({
        event_id: event.id,
        body: text,
        assignee_id: who,
        due_date: due || null,
        position: (points[points.length - 1]?.position ?? 0) + 1,
        created_by: me.id,
      });
      if (error) throw error;
      setBody("");
      setWho(null);
      setDue("");
      await invalidate("event_actions");
      inputRef.current?.focus();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function change(p: EventAction, patch: Partial<EventAction>) {
    const { error } = await supabase.from("event_actions").update(patch).eq("id", p.id);
    if (error) toast(errorMessage(error), "error");
    await invalidate("event_actions");
  }

  async function makeTasks(list: EventAction[]) {
    if (!list.length || busy) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("make_tasks_from_actions", { p_actions: list.map((p) => p.id) });
      if (error) throw error;
      const made = Number(data) || 0;
      const names = Array.from(new Set(list.map((p) => people.get(p.assignee_id)?.short_name).filter(Boolean)));
      toast(made ? `${made === 1 ? "Task" : `${made} tasks`} sent to ${names.length > 3 ? `${names.length} people` : names.join(", ")}` : "Those already have tasks");
      await invalidate("event_actions", "tasks");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ap" aria-label="Action points">
      <div className="ap-head">
        <h3>
          <ListChecks /> Action points
        </h3>
        {points.length > 0 && (
          <span className="faint small">
            {finished} of {points.length} done
          </span>
        )}
      </div>

      {isLoading ? null : points.length === 0 ? (
        <p className="faint small ap-empty">
          {canEdit ? "Note what was agreed: what needs doing, who does it and by when." : "No action points yet."}
        </p>
      ) : (
        <ol className="ap-list">
          {points.map((p) => {
            const task = p.task_id ? taskById.get(p.task_id) : undefined;
            const editable = canEdit && !p.task_id;
            return (
              <li key={p.id} className={clsx("ap-row", (p.done_at || task?.status === "done") && "done")}>
                {p.task_id ? (
                  <span className="ap-tick linked" aria-hidden>
                    <Check />
                  </span>
                ) : (
                  <button
                    type="button"
                    className={clsx("ap-tick", p.done_at && "on")}
                    onClick={() => change(p, { done_at: p.done_at ? null : new Date().toISOString() })}
                    disabled={!canEdit}
                    aria-pressed={!!p.done_at}
                    aria-label={p.done_at ? "Mark as not done" : "Mark as done"}
                  >
                    <Check />
                  </button>
                )}
                <div className="ap-main">
                  {editable && !p.done_at ? (
                    <input
                      className="ap-body-input"
                      defaultValue={p.body}
                      aria-label="Action point"
                      maxLength={500}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== p.body) change(p, { body: v });
                        else e.target.value = p.body;
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    <span className="ap-body">{p.body}</span>
                  )}
                  <div className="ap-meta">
                    {editable && !p.done_at ? (
                      <>
                        <select
                          className="ap-select"
                          value={p.assignee_id ?? ""}
                          onChange={(e) => change(p, { assignee_id: e.target.value || null })}
                          aria-label="Who does it"
                        >
                          <option value="">Who does it?</option>
                          {options(p.assignee_id).map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.short_name}
                            </option>
                          ))}
                        </select>
                        <input
                          className="ap-date"
                          type="date"
                          value={p.due_date ?? ""}
                          onChange={(e) => change(p, { due_date: e.target.value || null })}
                          aria-label="By when"
                        />
                      </>
                    ) : (
                      <>
                        {p.assignee_id && (
                          <span className="row" style={{ gap: 5 }}>
                            <Avatar person={people.get(p.assignee_id)} size={18} />
                            {people.get(p.assignee_id)?.short_name ?? "Former team member"}
                          </span>
                        )}
                        {p.due_date && <span>{fmtDue(p.due_date)}</span>}
                        {p.done_at && <span>Done{p.done_by ? ` by ${people.get(p.done_by)?.short_name ?? "someone"}` : ""}</span>}
                      </>
                    )}
                    {p.task_id && (
                      <Link to={`/tasks/${p.task_id}`} className="ap-task">
                        {task ? <Pill tone={TASK_STATUS[task.status].tone}>{TASK_STATUS[task.status].label}</Pill> : <Pill>Task</Pill>}
                        <span>Open task</span>
                      </Link>
                    )}
                    {canAssign && !p.task_id && !p.done_at && (
                      <button
                        type="button"
                        className="btn small ap-make"
                        onClick={() => makeTasks([p])}
                        disabled={busy || !p.assignee_id}
                        title={p.assignee_id ? undefined : "Pick who does it first"}
                      >
                        <SendHorizontal /> Make task
                      </button>
                    )}
                  </div>
                </div>
                {editable && (
                  <button type="button" className="icon-btn small plain ap-remove" onClick={() => change(p, { removed_at: new Date().toISOString() })} aria-label="Take this point off">
                    <X />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {canEdit && (
        <div className="ap-add">
          <input
            ref={inputRef}
            className="input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            placeholder="Add an action point"
            maxLength={500}
            aria-label="New action point"
          />
          <div className="ap-add-row">
            <select className="select" value={who ?? ""} onChange={(e) => setWho(e.target.value || null)} aria-label="Who does it">
              <option value="">Who does it?</option>
              {options(null).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.short_name}
                </option>
              ))}
            </select>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="By when" />
            <button type="button" className="btn" onClick={add} disabled={!body.trim() || busy}>
              <Plus /> Add
            </button>
          </div>
        </div>
      )}

      {canAssign && ready.length > 1 && (
        <button type="button" className="btn primary ap-make-all" onClick={() => makeTasks(ready)} disabled={busy}>
          <SendHorizontal /> Make {ready.length} tasks
        </button>
      )}
      {canAssign && points.some((p) => !p.task_id && !p.done_at && !p.assignee_id) && (
        <p className="faint tiny">Pick who does each point to make it a task. Each task notes the meeting it came from.</p>
      )}
      {canEdit && <p className="faint tiny">Action points save as you add them.</p>}
    </section>
  );
}
