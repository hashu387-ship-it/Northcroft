import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileSpreadsheet, FileText, Folder, Image as ImageIcon, Link2, Mic, Paperclip, Plus, Repeat, Trash2, X } from "lucide-react";
import { useInvalidate, usePeople, useProjects, useSettings } from "@/lib/api";
import { useProjectTeams } from "@/lib/projectTeam";
import { useApprover } from "@/lib/taskApproval";
import { useAuth, useMe } from "@/lib/auth";
import { STORAGE_MAX_BYTES, isImage, uploadFile } from "@/lib/files";
import { addDriveLinks, checkDriveLink, looksLikeDriveLink, type LinkInfo } from "@/lib/drivelinks";
import { DropZone } from "./DropZone";
import { checkOtherLink, linkMeta, normalizeUrl } from "@/lib/links";
import { useSignoff } from "@/lib/signoff";
import { canRecord, uploadVoice, useRecorder, voiceLabel, type Recording } from "@/lib/voice";
import { fileSize } from "@/lib/format";
import { errorMessage, supabase } from "@/lib/supabase";
import { DOW_LONG, addDays, fmtDue, todayISO } from "@/lib/time";
import type { Priority, Task } from "@/lib/types";
import { Field, PeopleSelect, PersonSelect, PriorityPicker, ProjectSelect, Segmented, Sheet, useToast } from "./ui";
import { RecorderBar, VoicePlayer } from "./Voice";
import { CheckWording } from "@/components/CheckWording";

/** A voice note recorded in the form: its English text goes into Details, the recording onto the task. */
interface FormVoice {
  url: string;
  path: string | null;
  seconds: number;
  peaks: number[];
  state: "uploading" | "writing" | "done" | "failed" | "off";
}

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
  const signoff = useSignoff();
  const { data: projects = [] } = useProjects();
  const toast = useToast();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const editing = !!task;
  const approver = useApprover();
  // A team member's own task waits for the approver's OK (Hassan); until then they can change
  // anything on it, people included.
  const asking = !canAssign && (!editing || (!!task?.approval && task.created_by === me.id));
  // People on a task can edit its details; only managers and seniors change who's on it.
  const lockPeople = editing && !canAssign && !asking;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  // The chosen project's team is listed first in Assign to.
  const teams = useProjectTeams();
  const projectTeam = teams.team(projectId);
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
  // Links checked in the form (Google Drive, OneDrive or any web link); saved on the task once it exists.
  const [links, setLinks] = useState<(LinkInfo & { url: string })[]>([]);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [voice, setVoice] = useState<FormVoice | null>(null);
  const voiceRef = useRef<FormVoice | null>(null);
  voiceRef.current = voice;
  const recorder = useRecorder({ onDone: (r) => void gotVoice(r) });
  const recording = recorder.state !== "idle";
  const voiceBusy = voice?.state === "uploading" || voice?.state === "writing";

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
        : defaults?.assigneeIds ?? (defaults?.assigneeId ? [defaults.assigneeId] : canAssign ? [] : [me.id]),
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
    setLinks([]);
    setLinkUrl(null);
    setLinkError(null);
    setVoice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task, defaults?.projectId, defaults?.assigneeId, defaults?.assigneeIds?.join(","), defaults?.dueDate, defaults?.title, defaults?.description, defaults?.priority, defaults?.steps?.join("\n"), me.id]);

  const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);

  /** A recording is done: store it, then put its English text into Details. */
  async function gotVoice(rec: Recording) {
    const url = URL.createObjectURL(rec.blob);
    const same = (v: FormVoice | null) => v?.url === url;
    setVoice({ url, path: null, seconds: rec.seconds, peaks: rec.peaks, state: "uploading" });
    let path: string;
    try {
      path = await uploadVoice(rec, me.id);
    } catch (e) {
      setVoice((v) => (same(v) ? null : v));
      URL.revokeObjectURL(url);
      toast(`The voice note couldn't be saved (${errorMessage(e)}). Record it again.`, "error");
      return;
    }
    // Taken off or the form closed while it was saving: tidy up.
    if (!same(voiceRef.current)) {
      void supabase.storage.from("files").remove([path]);
      return;
    }
    setVoice((v) => (same(v) ? { ...v!, path, state: "writing" } : v));
    try {
      const { data, error } = await supabase.functions.invoke("transcribe", { body: { kind: "draft", path, seconds: rec.seconds } });
      if (error) throw error;
      if (data?.status === "off") {
        setVoice((v) => (same(v) ? { ...v!, state: "off" } : v));
        return;
      }
      const text = String(data?.text ?? "").trim();
      if (same(voiceRef.current) && text) setDescription((d) => (d.trim() ? `${d.trimEnd()}\n${text}` : text));
      setVoice((v) => (same(v) ? { ...v!, state: "done" } : v));
    } catch {
      setVoice((v) => (same(v) ? { ...v!, state: "failed" } : v));
    }
  }

  async function startVoice() {
    try {
      await recorder.start();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  /** Take the voice note off (the text already in Details stays, to keep or edit). */
  function dropVoice() {
    const v = voiceRef.current;
    if (!v) return;
    if (v.path) void supabase.storage.from("files").remove([v.path]);
    URL.revokeObjectURL(v.url);
    setVoice(null);
  }

  /** The recording goes on the task as a voice note, so the team can play it. */
  async function attachVoice(taskId: string, project: string | null) {
    const v = voiceRef.current;
    if (!v?.path) return;
    const { error } = await supabase.from("comments").insert({
      body: voiceLabel(v.seconds),
      mentions: [],
      author_id: me.id,
      task_id: taskId,
      project_id: project,
      voice_path: v.path,
      voice_seconds: Math.round(v.seconds * 10) / 10,
      voice_peaks: v.peaks,
    });
    if (error) {
      toast(`The voice note wasn't added to the task (${errorMessage(error)}). Its text is in the details.`, "error");
      return;
    }
    URL.revokeObjectURL(v.url);
    voiceRef.current = null;
    setVoice(null);
  }

  /** Closing without saving: stop any recording and remove a stored one. */
  function close() {
    if (recording) recorder.cancel();
    dropVoice();
    onClose();
  }

  function pickFiles(list: FileList | File[] | null) {
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

  async function addLink() {
    setLinkError(null);
    if (!(linkUrl ?? "").trim()) return;
    const v = normalizeUrl(linkUrl ?? "");
    if (!v) {
      setLinkError("That doesn't look like a link. Copy the whole address, starting with https://, then paste it here.");
      return;
    }
    if (links.some((l) => l.url === v)) {
      setLinkUrl(null);
      return;
    }
    setLinkBusy(true);
    try {
      // Google Drive links are checked with Google; anything else becomes a card that opens it.
      const info = looksLikeDriveLink(v) ? await checkDriveLink(v) : await checkOtherLink(v);
      setLinks((xs) => [...xs, { ...info, url: v }]);
      setLinkUrl(null);
    } catch (e) {
      setLinkError(errorMessage(e));
    } finally {
      setLinkBusy(false);
    }
  }

  /** Save the checked Drive links; says so if they couldn't be saved (the task still goes out). */
  async function saveLinks(where: { taskId?: string; recurringId?: string; projectId: string | null }) {
    if (!links.length) return;
    try {
      await addDriveLinks(links, where);
    } catch (e) {
      toast(`The ${links.length === 1 ? "link wasn't" : "links weren't"} saved (${errorMessage(e)}). Add ${links.length === 1 ? "it" : "them"} again from the task.`, "error");
    }
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
        // Only managers and seniors send who's on it and who reviews it (a team member's own
        // request sends who's on it; the database sets the approver as reviewer).
        ...(lockPeople ? {} : asking ? { assignees } : { assignees, reviewer_id: reviewerId }),
        priority,
        estimate_hours: estimate ? Number(estimate) : null,
      };
      if (editing && task) {
        const { error } = await supabase.from("tasks").update({ ...fields, due_date: dueDate || null }).eq("id", task.id);
        if (error) throw error;
        await attachVoice(task.id, projectId);
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
        await saveLinks({ recurringId: data.id, projectId });
        await supabase.rpc("run_recurring");
        const { data: fresh } = await supabase.from("recurring_tasks").select("next_run, last_run").eq("id", data.id).single();
        toast(
          fresh?.last_run
            ? `Repeating task set up. The first one is ready now, the next on ${fmtDue(fresh.next_run)}.`
            : `Repeating task set up. The first one appears on ${fmtDue(fresh?.next_run ?? data.next_run)}.`,
        );
        await invalidate("recurring_tasks", "attachments");
        reportFailed(result, "a copy of the task's Files");
        // A repeating task keeps the voice note's text in its details; the recording isn't kept.
        dropVoice();
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
        await saveLinks({ taskId: data.id, projectId });
        await attachVoice(data.id, projectId);
        const others = assignees.filter((id) => id !== me.id).map((id) => people.get(id)?.short_name).filter(Boolean);
        toast(
          asking
            ? `Sent to ${approver.name} for the OK. It starts once it's approved.`
            : others.length
              ? `Task sent to ${others.length > 3 ? `${others.length} people` : others.join(", ")}`
              : "Task created",
        );
        reportFailed(result, "the task's Files");
        onClose();
        await invalidate("tasks", "task_checklist", "attachments", "comments");
        navigate(`/tasks/${data.id}`);
        return;
      }
      await invalidate("tasks", "task_checklist", "comments");
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
      onClose={close}
      title={editing ? "Edit task" : "New task"}
      wide
      footer={
        <>
          <button className="btn" onClick={close} type="button" disabled={!!uploadNote}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving || recording || voiceBusy} type="button">
            {uploadNote
              ? "Uploading files..."
              : recording
                ? "Recording..."
                : voiceBusy
                  ? "Writing out the voice note..."
                  : saving
                    ? "Saving..."
                    : editing
                      ? "Save changes"
                      : repeat !== "none"
                        ? "Set up repeating task"
                        : asking
                          ? `Send to ${approver.name}`
                          : "Assign task"}
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
          hint={
            lockPeople
              ? "Only a manager or a senior can change who's on a task"
              : asking
                ? `Yourself, others, or both. They see it once ${approver.name} approves it.`
                : assignees.length > 1
                  ? "They all see it, get its notifications, and any of them can submit it"
                  : "Add one person or several"
          }
        >
          <PeopleSelect
            value={assignees}
            onChange={setAssignees}
            people={people.assignableBy(me.id).concat(people.active.filter((p) => assignees.includes(p.id) && p.assignable === false && p.id !== me.id))}
            empty="Nobody yet"
            disabled={lockPeople}
            first={projectTeam.length ? { label: `${projects.find((x) => x.id === projectId)?.name ?? "Project"} team`, ids: projectTeam } : undefined}
          />
        </Field>
        <Field label="Project">
          <ProjectSelect value={projectId} onChange={setProjectId} projects={projects} />
        </Field>
        {asking ? (
          <Field label="Approval">
            <div className="tf-signoff">
              {approver.name} checks it first and can change it. Once approved it starts, and it's signed off like any other task.
            </div>
          </Field>
        ) : signoff.on ? (
          <Field label="Sign-off" hint="Set in Settings > Team">
            <div className="tf-signoff">
              {signoff.first && signoff.first.id !== signoff.final?.id
                ? `${signoff.first.short_name} checks it, then ${signoff.final?.short_name} gives the final OK`
                : `${signoff.final?.short_name} approves it`}
            </div>
          </Field>
        ) : (
          <Field label="Reviewer" hint="Checks the work before it's marked done">
            <PersonSelect value={reviewerId} onChange={setReviewerId} people={people.assigners} placeholder="Whoever created it" disabled={lockPeople} />
          </Field>
        )}
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
        <Field
          label="Details"
          className="full"
          group
          hint={
            !canRecord()
              ? undefined
              : voice?.state === "uploading"
                ? "Saving the voice note..."
                : voice?.state === "writing"
                  ? "Writing it out in English..."
                  : voice?.state === "failed"
                    ? "Couldn't write it out. The voice note still goes with the task; type the details if you need them."
                    : voice?.state === "off"
                      ? "The voice note goes with the task. Writing it out isn't switched on."
                      : voice
                        ? repeat !== "none"
                          ? "Its text is in the details above. For a repeating task the recording isn't kept."
                          : "Its text is in the details above to check. The recording goes on the task too."
                        : "Speak instead of typing: the English text goes into the details, and the recording goes on the task."
          }
        >
          <textarea
            className="textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What needs doing, drawings to use, anything to watch for"
            aria-label="Details"
          />
          <CheckWording value={description} onUse={setDescription} kind="task" />
          {canRecord() && (
            <div className="tf-voice">
              {recording ? (
                <RecorderBar
                  elapsed={recorder.elapsed}
                  maxSeconds={recorder.maxSeconds}
                  bars={recorder.bars}
                  onCancel={recorder.cancel}
                  onFinish={recorder.stop}
                  finishLabel="Done"
                  finishIcon="stop"
                />
              ) : voice ? (
                <div className="tf-voice-note">
                  <VoicePlayer src={voice.url} seconds={voice.seconds} peaks={voice.peaks} seed={voice.url} />
                  {voiceBusy && <span className="vspin" style={{ color: "var(--accent)" }} aria-hidden />}
                  <button type="button" className="icon-btn small plain" onClick={dropVoice} aria-label="Take the voice note off" title="Take it off">
                    <X />
                  </button>
                </div>
              ) : (
                <button type="button" className="btn small" onClick={startVoice}>
                  <Mic /> Record a voice note
                </button>
              )}
            </div>
          )}
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
            <DropZone className="tf-files" onFiles={pickFiles} disabled={saving}>
              {files.map((f) => (
                <span className="tf-file" key={f.name + f.size}>
                  <span className="tf-file-icon">
                    {isImage({ mime: f.type, name: f.name }) ? <ImageIcon /> : /\.(xlsx?|xlsm|csv)$/i.test(f.name) ? <FileSpreadsheet /> : <FileText />}
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
              {links.map((l) => (
                <span className="tf-file" key={l.url}>
                  <span className="tf-file-icon drive">{l.kind === "folder" ? <Folder /> : <Link2 />}</span>
                  <span className="tf-file-name ellipsis">{l.title}</span>
                  <span className="faint tiny">{l.provider && l.provider !== "google" ? linkMeta(l) : l.kind === "folder" ? "Drive folder" : "Drive file"}</span>
                  <button
                    type="button"
                    className="icon-btn small plain"
                    onClick={() => setLinks((xs) => xs.filter((x) => x !== l))}
                    aria-label={`Take ${l.title} off`}
                    disabled={saving}
                  >
                    <X />
                  </button>
                </span>
              ))}
              {linkUrl !== null && (
                <div className="tf-link-row">
                  <input
                    className="input"
                    value={linkUrl}
                    onChange={(e) => {
                      setLinkUrl(e.target.value);
                      setLinkError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addLink();
                      }
                    }}
                    placeholder="Paste a Google Drive, OneDrive or any link"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Link"
                    autoFocus
                  />
                  <button className="btn" type="button" onClick={addLink} disabled={linkBusy || !linkUrl.trim()}>
                    {linkBusy ? "Checking..." : "Add"}
                  </button>
                </div>
              )}
              {linkError && <small className="danger-text tiny">{linkError}</small>}
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn small" type="button" onClick={() => fileInput.current?.click()} disabled={saving}>
                  <Paperclip /> {files.length ? "Add more files" : "Add files"}
                </button>
                {linkUrl === null && (
                  <button className="btn small" type="button" onClick={() => setLinkUrl("")} disabled={saving}>
                    <Link2 /> Add link
                  </button>
                )}
              </div>
              <input ref={fileInput} type="file" multiple hidden aria-label="Choose files" onChange={(e) => pickFiles(e.target.files)} />
            </DropZone>
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

        {!editing && !asking && (
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
