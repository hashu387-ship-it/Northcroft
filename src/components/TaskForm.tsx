import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileSpreadsheet, FileText, Image as ImageIcon, Paperclip, Plus, Repeat, Trash2, X } from "lucide-react";
import { useInvalidate, usePeople, useProjects, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { STORAGE_MAX_BYTES, uploadFile } from "@/lib/files";
import { fileSize } from "@/lib/format";
import { errorMessage, supabase } from "@/lib/supabase";
import { DOW_LONG, addDays, fmtDue, todayISO } from "@/lib/time";
import type { Priority, Task } from "@/lib/types";
import { Field, PeopleSelect, PersonSelect, PriorityPicker, ProjectSelect, Segmented, Sheet, useToast } from "./ui";

type Repeat = "none" | "daily" | "weekly" | "monthly";

export interface TaskDefaults {
  projectId?: string | null;
  assigneeId?: string | null;
  /** Several people at once (takes precedence over assigneeId). */
  assigneeIds?: string[];
  dueDate?: string | null;
  /** Optional starting values for a new task. */
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
  const { canAssign } = useAuth();
  const people = usePeople();
  const { data: projects = [] } = useProjects();
  const toast = useToast();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const editing = !!task;
  // People on a task can edit its details; only managers and seniors change who's on it.
  const lockPeople = editing && !canAssign;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assignees, setAssignees] = useState<string[]>([]);
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
  // Files picked in the form; they go up once the task (or repeating task) exists.
  const [files, setFiles] = useState<File[]>([]);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const driveOn = !!useSettings().data?.drive_connected_at;

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? defaults?.title ?? "");
    setDescription(task?.description ?? defaults?.description ?? "");
    setProjectId(task ? task.project_id : defaults?.projectId ?? null);
    setAssignees(
      task
        ? task.assignees?.length
          ? task.assignees
          : task.assignee_id
            ? [task.assignee_id]
            : []
        : defaults?.assigneeIds ?? (defaults?.assigneeId ? [defaults.assigneeId] : []),
    );
    setReviewerId(task ? task.reviewer_id : me.id);
    setDueDate(task?.due_date ?? defaults?.dueDate ?? addDays(todayISO(), 2));
    setPriority(task?.priority ?? defaults?.priority ?? "normal");
    setEstimate(task?.estimate_hours ? String(task.estimate_hours) : "");
    setSteps(task ? [] : defaults?.steps ?? []);
    setRepeat("none");
    setWeekday(0);
    setMonthDay(Math.min(28, Number(todayISO().slice(8, 10))));
    setOffset(2);
    setFiles([]);
    setUploadNote(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, defaults?.projectId, defaults?.assigneeId, defaults?.assigneeIds?.join(","), defaults?.dueDate, defaults?.title, defaults?.description, defaults?.priority, defaults?.steps?.join("\n"), me.id]);

  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);

  function pickFiles(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list);
    // Without Google Drive, the app's own storage takes files up to 50 MB.
    const tooBig = driveOn ? [] : picked.filter((f) => f.size > STORAGE_MAX_BYTES);
    if (tooBig.length) {
      toast(`${tooBig.map((f) => f.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 50 MB. Bigger files need Google Drive, which a manager connects in Settings > Google Drive.`, "error");
    }
    const ok = picked.filter((f) => !tooBig.includes(f));
    setFiles((xs) => [...xs, ...ok.filter((f) => !xs.some((x) => x.name === f.name && x.size === f.size))]);
    if (fileInput.current) fileInput.current.value = "";
  }

  /** Upload the picked files one by one. Returns the names that didn't make it, and why. */
  async function uploadPicked(target: { taskId?: string; recurringId?: string; projectId: string | null }) {
    const failed: string[] = [];
    let reason = "";
    for (const [i, f] of files.entries()) {
      const of = files.length > 1 ? ` (${i + 1} of ${files.length})` : "";
      setUploadNote(`Uploading ${f.name}${of}`);
      try {
        await uploadFile(f, {
          taskId: target.taskId ?? null,
          recurringId: target.recurringId ?? null,
          projectId: target.projectId,
          userId: me.id,
          onProgress: (x) => setUploadNote(`Uploading ${f.name}, ${Math.round(x * 100)}%${of}`),
        });
      } catch (e) {
        failed.push(f.name);
        reason ||= errorMessage(e);
      }
    }
    setUploadNote(null);
    return { failed, reason };
  }

  function reportFailed({ failed, reason }: { failed: string[]; reason: string }, where: string) {
    if (!failed.length) return;
    toast(`${failed.join(", ")} didn't upload (${reason}). Add ${failed.length === 1 ? "it" : "them"} again from ${where}.`, "error");
  }

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
        // Only managers and seniors send who's on it and who reviews it.
        ...(lockPeople ? {} : { assignees, reviewer_id: reviewerId }),
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
        // Files set up here come with every copy of the task.
        const result = files.length ? await uploadPicked({ recurringId: data.id, projectId }) : { failed: [], reason: "" };
        await supabase.rpc("run_recurring");
        const { data: fresh } = await supabase.from("recurring_tasks").select("next_run, last_run").eq("id", data.id).single();
        toast(
          fresh?.last_run
            ? `Repeating task set up. The first one is ready now, the next on ${fmtDue(fresh.next_run)}.`
            : `Repeating task set up. The first one appears on ${fmtDue(fresh?.next_run ?? data.next_run)}.`,
        );
        await invalidate("recurring_tasks", "attachments");
        reportFailed(result, "a copy of the task's Files");
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
        // The task is out; now its files go up, with progress, before the task opens.
        const result = files.length ? await uploadPicked({ taskId: data.id, projectId }) : { failed: [], reason: "" };
        const others = assignees.filter((id) => id !== me.id).map((id) => people.get(id)?.short_name).filter(Boolean);
        toast(others.length ? `Task sent to ${others.length > 3 ? `${others.length} people` : others.join(", ")}` : "Task created");
        reportFailed(result, "the task's Files");
        onClose();
        await invalidate("tasks", "task_checklist", "attachments");
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
          <button className="btn" onClick={onClose} type="button" disabled={!!uploadNote}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving} type="button">
            {uploadNote ? "Uploading files..." : saving ? "Saving..." : editing ? "Save changes" : repeat !== "none" ? "Set up repeating task" : "Assign task"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Task" className="full">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field
          label="Assign to"
          className="full"
          group
          hint={lockPeople ? "Only a manager or a senior can change who's on a task" : assignees.length > 1 ? "They all see it, get its notifications, and any of them can submit it" : "Add one person or several"}
        >
          <PeopleSelect
            value={assignees}
            onChange={setAssignees}
            people={people.assignableBy(me.id).concat(people.active.filter((p) => assignees.includes(p.id) && p.assignable === false && p.id !== me.id))}
            empty="Nobody yet"
            disabled={lockPeople}
          />
        </Field>
        <Field label="Project">
          <ProjectSelect value={projectId} onChange={setProjectId} projects={projects} />
        </Field>
        <Field label="Reviewer" hint="Checks the work before it's marked done">
          <PersonSelect value={reviewerId} onChange={setReviewerId} people={people.assigners} placeholder="Whoever created it" disabled={lockPeople} />
        </Field>
        {repeat === "none" && (
          <Field label="Due date">
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        )}
        <Field label="Estimate (hours)" hint="Used in the workload view">
          <input className="input" type="number" min="0" step="0.5" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Priority" className="full" group>
          <PriorityPicker value={priority} onChange={setPriority} />
        </Field>
        <Field label="Details" className="full">
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs doing, drawings to use, anything to watch for" />
        </Field>
        {!editing && (
          <Field
            label="Files"
            className="full"
            group
            hint={
              uploadNote ??
              (repeat !== "none"
                ? "These come with every copy of the task."
                : driveOn
                  ? "Drawings, BOQs, PDFs, photos. Saved to the team's Google Drive."
                  : "Drawings, BOQs, PDFs, photos. Up to 50 MB each.")
            }
          >
            <div className="tf-files">
              {files.map((f) => (
                <span className="tf-file" key={f.name + f.size}>
                  <span className="tf-file-icon">
                    {f.type.startsWith("image/") ? <ImageIcon /> : /\.(xlsx?|xlsm|csv)$/i.test(f.name) ? <FileSpreadsheet /> : <FileText />}
                  </span>
                  <span className="tf-file-name ellipsis">{f.name}</span>
                  <span className="faint tiny">{fileSize(f.size)}</span>
                  <button
                    type="button"
                    className="icon-btn small plain"
                    onClick={() => setFiles((xs) => xs.filter((x) => x !== f))}
                    aria-label={`Take ${f.name} off`}
                    disabled={saving}
                  >
                    <X />
                  </button>
                </span>
              ))}
              <button className="btn small" type="button" onClick={() => fileInput.current?.click()} disabled={saving}>
                <Paperclip /> {files.length ? "Add more files" : "Add files"}
              </button>
              <input ref={fileInput} type="file" multiple hidden aria-label="Choose files" onChange={(e) => pickFiles(e.target.files)} />
            </div>
          </Field>
        )}

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
