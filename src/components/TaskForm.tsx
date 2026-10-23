import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Repeat, Trash2 } from "lucide-react";
import { useInvalidate, usePeople, useProjects } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import { DOW_LONG, addDays, fmtDue, todayISO } from "@/lib/time";
import type { Priority, Task } from "@/lib/types";
import { Field, PersonSelect, ProjectSelect, Segmented, Sheet, useToast } from "./ui";

type Repeat = "none" | "daily" | "weekly" | "monthly";

export interface TaskDefaults {
  projectId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
  /** Filled in when Claude drafts the task from a chat message or voice note. */
  title?: string;
  description?: string;
  priority?: Priority;
  steps?: string[];
}

export function TaskForm({
  open,
  onClose,
  task,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaults?: TaskDefaults;
}) {
  const me = useMe();
  const people = usePeople();
  const { data: projects = [] } = useProjects();
  const toast = useToast();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const editing = !!task;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [reviewerId, setReviewerId] = useState<string | null>(me.id);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [estimate, setEstimate] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [weekday, setWeekday] = useState(0);
  const [monthDay, setMonthDay] = useState(1);
  const [offset, setOffset] = useState(2);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? defaults?.title ?? "");
    setDescription(task?.description ?? defaults?.description ?? "");
    setProjectId(task ? task.project_id : defaults?.projectId ?? null);
    setAssigneeId(task ? task.assignee_id : defaults?.assigneeId ?? null);
    setReviewerId(task ? task.reviewer_id : me.id);
    setDueDate(task?.due_date ?? defaults?.dueDate ?? addDays(todayISO(), 2));
    setPriority(task?.priority ?? defaults?.priority ?? "normal");
    setEstimate(task?.estimate_hours ? String(task.estimate_hours) : "");
    setSteps(task ? [] : defaults?.steps ?? []);
    setRepeat("none");
    setWeekday(0);
    setMonthDay(Math.min(28, Number(todayISO().slice(8, 10))));
    setOffset(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, defaults?.projectId, defaults?.assigneeId, defaults?.dueDate, defaults?.title, defaults?.description, defaults?.priority, defaults?.steps?.join("\n"), me.id]);

  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);

  async function save() {
    if (!title.trim()) {
      toast("Give the task a title", "error");
      return;
    }
    setSaving(true);
    try {
      const fields = {
        title: title.trim(),
        description: description.trim() || null,
        project_id: projectId,
        assignee_id: assigneeId,
        reviewer_id: reviewerId,
        priority,
        estimate_hours: estimate ? Number(estimate) : null,
      };
      if (editing && task) {
        const { error } = await supabase.from("tasks").update({ ...fields, due_date: dueDate || null }).eq("id", task.id);
        if (error) throw error;
        toast("Task updated");
      } else if (repeat !== "none") {
        const { data, error } = await supabase
          .from("recurring_tasks")
          .insert({
            ...fields,
            frequency: repeat,
            weekday: repeat === "weekly" ? weekday : null,
            month_day: repeat === "monthly" ? monthDay : null,
            due_offset_days: offset,
            checklist: cleanSteps,
            next_run: todayISO(),
            created_by: me.id,
          })
          .select()
          .single();
        if (error) throw error;
        await supabase.rpc("run_recurring");
        const { data: fresh } = await supabase.from("recurring_tasks").select("next_run, last_run").eq("id", data.id).single();
        toast(
          fresh?.last_run
            ? `Repeating task set up. The first one is ready now, the next on ${fmtDue(fresh.next_run)}.`
            : `Repeating task set up. The first one appears on ${fmtDue(fresh?.next_run ?? data.next_run)}.`,
        );
        await invalidate("recurring_tasks");
      } else {
        const { data, error } = await supabase
          .from("tasks")
          .insert({ ...fields, due_date: dueDate || null, created_by: me.id })
          .select()
          .single();
        if (error) throw error;
        if (cleanSteps.length) {
          const { error: e2 } = await supabase
            .from("task_checklist")
            .insert(cleanSteps.map((text, i) => ({ task_id: data.id, text, position: i + 1 })));
          if (e2) throw e2;
        }
        const who = people.get(assigneeId);
        toast(who && who.id !== me.id ? `Task sent to ${who.short_name}` : "Task created");
        onClose();
        await invalidate("tasks", "task_checklist");
        navigate(`/tasks/${data.id}`);
        return;
      }
      await invalidate("tasks", "task_checklist");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit task" : "New task"}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving} type="button">
            {saving ? "Saving..." : editing ? "Save changes" : repeat !== "none" ? "Set up repeating task" : "Assign task"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Task" className="full">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Price HVAC BOQ for L14" autoFocus />
        </Field>
        <Field label="Project">
          <ProjectSelect value={projectId} onChange={setProjectId} projects={projects} />
        </Field>
        <Field label="Assign to">
          <PersonSelect value={assigneeId} onChange={setAssigneeId} people={people.assignableBy(me.id, task?.assignee_id)} />
        </Field>
        <Field label="Reviewer" hint="Checks the work before it's marked done">
          <PersonSelect value={reviewerId} onChange={setReviewerId} people={people.assigners} placeholder="Whoever created it" />
        </Field>
        {repeat === "none" && (
          <Field label="Due date">
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        )}
        <Field label="Priority">
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </Field>
        <Field label="Estimate (hours)" hint="Used in the workload view">
          <input className="input" type="number" min="0" step="0.5" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Details" className="full">
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs doing, drawings to use, anything to watch for" />
        </Field>

        {!editing && (
          <div className="full stack" style={{ gap: 8 }}>
            <span className="field-label">Checklist</span>
            {steps.map((s, i) => (
              <div className="row" key={i}>
                <input
                  className="input"
                  value={s}
                  placeholder={`Step ${i + 1}`}
                  onChange={(e) => setSteps((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <button className="icon-btn small plain" type="button" aria-label="Remove step" onClick={() => setSteps((xs) => xs.filter((_, j) => j !== i))}>
                  <Trash2 />
                </button>
              </div>
            ))}
            <button className="btn small ghost" type="button" style={{ alignSelf: "flex-start" }} onClick={() => setSteps((xs) => [...xs, ""])}>
              <Plus /> Add step
            </button>
          </div>
        )}

        {!editing && (
          <div className="full stack solid" style={{ padding: 14, gap: 12, borderRadius: 10 }}>
            <div className="row">
              <Repeat size={18} className="muted" />
              <b>Repeat</b>
              <span className="spacer" />
              <Segmented<Repeat>
                value={repeat}
                onChange={setRepeat}
                options={[
                  { value: "none", label: "Once" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" },
                ]}
              />
            </div>
            {repeat !== "none" && (
              <div className="form-grid">
                {repeat === "weekly" && (
                  <Field label="Every">
                    <select className="select" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                      {DOW_LONG.map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {repeat === "monthly" && (
                  <Field label="On day of month">
                    <select className="select" value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {repeat === "daily" && <p className="muted small full">A new task appears every working day, Sunday to Thursday.</p>}
                <Field label="Due" hint="Counted from the day it appears">
                  <select className="select" value={offset} onChange={(e) => setOffset(Number(e.target.value))}>
                    <option value={0}>Same day</option>
                    <option value={1}>Next day</option>
                    <option value={2}>2 days later</option>
                    <option value={3}>3 days later</option>
                    <option value={5}>5 days later</option>
                    <option value={7}>A week later</option>
                    <option value={14}>2 weeks later</option>
                  </select>
                </Field>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
