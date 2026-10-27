import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Bell,
  BellRing,
  CalendarDays,
  ChevronLeft,
  CircleCheck,
  Clock,
  FileText,
  History,
  Hourglass,
  MessageCircle,
  Paperclip,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  SearchX,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { useInvalidate, usePeople, useProjectMap, useTask } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { nameList, peopleOn } from "@/lib/people";
import { useMarkSeen } from "@/lib/seen";
import { taskMessage } from "@/lib/phone";
import { PersonLink, WhatsAppButton } from "@/components/People";
import { errorMessage, supabase } from "@/lib/supabase";
import { diffDays, fmtDateTime, timeAgo, todayISO } from "@/lib/time";
import { celebrate, daysText, earlyDays } from "@/lib/celebrate";
import { passesOn, stageFor, useSignoff, waitingOn } from "@/lib/signoff";
import { useApprover } from "@/lib/taskApproval";
import type { Task, TaskStatus } from "@/lib/types";
import { Attachments } from "@/components/Attachments";
import { DriveLinks } from "@/components/DriveLinks";
import { CommentThread } from "@/components/CommentThread";
import { TaskForm } from "@/components/TaskForm";
import { DueLabel, EarlyBadge, Empty, Loading, PriorityFlag, ProjectTag, Sheet, StatusPill, useConfirm, useToast } from "@/components/ui";
import { ActivityFeed } from "./project/ActivityFeed";
import { Checklist } from "./project/Checklist";
import { useActivity, useWatchers } from "./project/api";
import { useTaskMeeting } from "./calendar/ActionPoints";
import { ProgressValue, TaskProgressCard } from "./updates/TaskProgress";
import "@/styles/tasks.css";
import "@/styles/meeting.css";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const projects = useProjectMap();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const { data: task, isLoading } = useTask(id);
  const activity = useActivity({ taskId: id, limit: 60 });
  const watchers = useWatchers(id);
  const signoff = useSignoff();
  const meeting = useTaskMeeting(id).data;
  // Opening the task reads its notifications, here and on the phone.
  useMarkSeen(id ? { taskId: id } : null);

  const [editOpen, setEditOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  // Turning down a team member's task, or a hold: ask, put on, or keep it going (each with a note).
  const [ask, setAsk] = useState<"decline" | "ask_hold" | "put_hold" | "keep" | null>(null);
  const approver = useApprover();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (isLoading) return <div className="page"><Loading /></div>;
  if (!task) {
    return (
      <div className="page">
        <div className="glass" style={{ marginTop: 24 }}>
          <Empty icon={<SearchX />} title="This task isn't here any more" action={<Link className="btn primary" to="/my-tasks">Back to my tasks</Link>}>
            It may have been deleted, or the link is wrong.
          </Empty>
        </div>
      </div>
    );
  }

  const t: Task = task;
  const project = projects.get(t.project_id);
  // Everyone on the task (one person or several).
  const onIt = peopleOn(t);
  const onItNames = nameList(onIt.map((x) => people.get(x)?.short_name ?? "someone"));
  const reviewer = people.get(t.reviewer_id) ?? people.get(t.created_by);
  const isAssignee = onIt.includes(me.id);
  // Who actually sent it for review (any of the people on it can).
  const submittedBy = people.get(
    (activity.data ?? []).find((a) => a.action === "status" && (a.details as { to?: string }).to === "in_review")?.actor_id ?? t.assignee_id,
  );
  const following = (watchers.data ?? []).some((w) => w.user_id === me.id);
  const changesRequested = !!t.changes_note && (t.status === "todo" || t.status === "in_progress");
  // Two-step sign-off: whose turn it is, and whether my OK finishes it or passes it on.
  const finalName = signoff.final?.short_name ?? "the final checker";
  const firstName = signoff.first?.short_name ?? "the first checker";
  const turn = waitingOn(t, signoff);
  const myReview = t.status === "in_review" && canAssign && (!signoff.on || !t.review_stage || turn === me.id);
  const handsOn = passesOn(t, me.id, signoff);
  const firstOkBy = people.get(t.first_ok_by);
  // Who it goes to when it's handed in.
  const nextStage = stageFor(onIt, signoff);
  const sendTo =
    nextStage === "first" ? signoff.first : nextStage === "final" ? signoff.final : reviewer && reviewer.id !== me.id ? reviewer : undefined;
  // A team member's own task waiting for the approver's OK (or turned down), and holds.
  const isRequest = !!t.approval;
  const myRequest = isRequest && t.created_by === me.id;
  const iApprove = approver.isApprover;
  const creator = people.get(t.created_by);
  const isOpen = t.status === "todo" || t.status === "in_progress";
  const onHold = t.hold === "on";
  const holdAsked = t.hold === "asked";
  const holdBy = people.get(t.hold_by);
  // Nothing moves while it waits for approval or is on hold.
  const blocked = isRequest || onHold;
  // The first checker (Hassan) chooses: send it on to the final checker, or finish it here.
  const canFinishHere = handsOn && !!signoff.first && signoff.first.id === me.id;

  /** Saves the change; `message` is the toast (none when a celebration says it instead). */
  async function update(fields: Partial<Task>, message: string | null): Promise<boolean> {
    setBusy(true);
    try {
      const { error } = await supabase.from("tasks").update(fields).eq("id", t.id);
      if (error) throw error;
      if (message) toast(message);
      await invalidate("tasks", "activity");
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const setStatus = (status: TaskStatus, message: string) => update({ status }, message);

  /** Approving (or marking done): the work is finished, so celebrate it with the people who did it. */
  async function finish(approving: boolean, here = false) {
    // With two steps, my OK may pass it on to the final checker instead of finishing it, unless I
    // finish it here (the first checker's choice).
    const passing = handsOn && !here;
    if (!(await update({ status: "done", ...(here ? { finished_by_first: true } : {}) }, passing ? `Approved. Sent to ${finalName} for the final OK.` : null))) return;
    if (passing) return;
    const others = onIt.filter((x) => x !== me.id).map((x) => people.get(x)?.short_name ?? "someone");
    const early = earlyDays(t);
    celebrate({
      kind: "approved",
      headline: approving ? "Approved" : "Done",
      line: others.length ? `Great work, ${nameList(others)}.` : "Great work.",
      detail: t.title,
      chip: early ? `Finished ${daysText(early)} early` : undefined,
    });
  }

  async function submitForReview() {
    setBusy(true);
    try {
      const { error } = await supabase.from("tasks").update({ status: "in_review" }).eq("id", t.id);
      if (error) throw error;
      if (note.trim()) {
        const { error: e2 } = await supabase
          .from("comments")
          .insert({ task_id: t.id, project_id: t.project_id, author_id: me.id, body: `Submitted for review: ${note.trim()}`, mentions: [] });
        if (e2) throw e2;
      }
      const sentTo =
        nextStage === "final" ? `Sent to ${finalName} for the final OK` : `Sent to ${sendTo ? sendTo.short_name : "the reviewer"} for review`;
      // Handed in before the due date: a big "Great job". On the due day: a smaller cheer.
      const ahead = t.due_date ? diffDays(t.due_date, todayISO()) : -1;
      if (ahead >= 1) {
        celebrate({ kind: "early", headline: `Great job, ${me.short_name}`, line: `Handed in ${daysText(ahead)} early. ${sentTo}.`, detail: t.title, chip: "Finished early" });
      } else if (ahead === 0) {
        celebrate({ kind: "on_time", headline: "Right on time", line: `${sentTo}.`, detail: t.title });
      } else {
        toast(sentTo);
      }
      setSubmitOpen(false);
      setNote("");
      await invalidate("tasks", "activity", "comments");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function requestChanges() {
    if (!note.trim()) {
      toast("Say what needs changing", "error");
      return;
    }
    await update({ status: "in_progress", changes_note: note.trim() }, `Sent back to ${onItNames || "the people on it"}`);
    setChangesOpen(false);
    setNote("");
  }

  async function approveRequest() {
    await update({ approval: null }, `Approved. ${onItNames || "The people on it"} ${onIt.length === 1 ? "has" : "have"} been told and can start.`);
  }

  async function sendAsk() {
    const text = note.trim();
    let ok = false;
    if (ask === "decline") {
      if (!text) return toast("Say why, so they can change it", "error");
      ok = await update({ approval: "declined", approval_note: text }, `Turned down. ${creator?.short_name ?? "They"} can change it and ask again.`);
    } else if (ask === "ask_hold") {
      if (!text) return toast("Say why it needs to go on hold", "error");
      ok = await update({ hold: "asked", hold_reason: text }, `Asked ${approver.name} to put it on hold`);
    } else if (ask === "put_hold") {
      ok = await update({ hold: "on", hold_reason: text || null }, "On hold. No reminders until it's back on.");
    } else if (ask === "keep") {
      ok = await update({ hold: null, hold_reason: text || null }, `Kept going. ${holdBy?.short_name ?? "They"} has been told.`);
    }
    if (ok) {
      setAsk(null);
      setNote("");
    }
  }

  async function takeBack() {
    const ok = await confirm({
      title: t.approval === "declined" ? "Remove this task?" : "Take back this task?",
      message: `It goes, with its checklist, comments and files. ${approver.name} won't see it any more.`,
      confirmLabel: t.approval === "declined" ? "Remove" : "Take it back",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("tasks").delete().eq("id", t.id);
    if (error) return toast(errorMessage(error), "error");
    toast(t.approval === "declined" ? "Task removed" : "Task taken back");
    await invalidate("tasks");
    navigate("/my-tasks", { replace: true });
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this task?",
      message: "Its checklist, comments and files go with it. This can't be undone.",
      confirmLabel: "Delete task",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("tasks").delete().eq("id", t.id);
    if (error) {
      toast(errorMessage(error), "error");
      return;
    }
    toast("Task deleted");
    await invalidate("tasks");
    navigate(project ? `/projects/${project.id}/tasks` : "/my-tasks", { replace: true });
  }

  async function toggleFollow() {
    const { error } = following
      ? await supabase.from("task_watchers").delete().eq("task_id", t.id).eq("user_id", me.id)
      : await supabase.from("task_watchers").insert({ task_id: t.id, user_id: me.id });
    if (error) toast(errorMessage(error), "error");
    else toast(following ? "You won't get updates on this task" : "You'll get updates on this task", "info");
    invalidate("task_watchers");
  }

  // Actions depend on who you are and where the task is.
  const actions: ReactNode[] = [];
  if (t.status === "todo" && isAssignee && !blocked) {
    actions.push(
      <button key="start" className="btn primary grow-mobile" disabled={busy} onClick={() => setStatus("in_progress", "Marked as in progress")}>
        <Play /> Start working
      </button>,
    );
  }
  if ((t.status === "todo" || t.status === "in_progress") && isAssignee && !blocked) {
    actions.push(
      <button key="submit" className={`btn ${t.status === "in_progress" ? "primary" : ""} grow-mobile`} disabled={busy} onClick={() => { setNote(""); setSubmitOpen(true); }}>
        <Send /> Submit for review
      </button>,
    );
  }
  if (myReview && canFinishHere) {
    // Hassan's choice each time: send it on to Fawaz, or finish it here.
    actions.push(
      <button key="approve" className="btn success grow-mobile" disabled={busy} onClick={() => finish(true)}>
        <CircleCheck /> Approve, send to {finalName}
      </button>,
      <button key="approve-here" className="btn success grow-mobile" disabled={busy} onClick={() => finish(true, true)} title={`Done now, without ${finalName}'s final OK`}>
        <CircleCheck /> Approve and finish
      </button>,
      <button key="changes" className="btn warn grow-mobile" disabled={busy} onClick={() => { setNote(""); setChangesOpen(true); }}>
        <RotateCcw /> Request changes
      </button>,
    );
  } else if (myReview) {
    actions.push(
      <button key="approve" className="btn success grow-mobile" disabled={busy} onClick={() => finish(true)}>
        <CircleCheck /> {handsOn ? `Approve, send to ${finalName}` : t.review_stage === "final" ? "Give final OK" : "Approve"}
      </button>,
      <button key="changes" className="btn warn grow-mobile" disabled={busy} onClick={() => { setNote(""); setChangesOpen(true); }}>
        <RotateCcw /> Request changes
      </button>,
    );
  }
  if (t.status === "in_review" && isAssignee && !canAssign) {
    actions.push(
      <button key="pull" className="btn grow-mobile" disabled={busy} onClick={() => setStatus("in_progress", "Pulled back from review")}>
        <Undo2 /> Pull back
      </button>,
    );
  }
  if ((t.status === "todo" || t.status === "in_progress") && canAssign && !blocked) {
    actions.push(
      <button
        key="done"
        className="btn grow-mobile"
        disabled={busy}
        onClick={() => finish(false)}
        title={handsOn ? `Goes to ${finalName} for the final OK` : undefined}
      >
        <CircleCheck /> {handsOn ? `Mark done, send to ${finalName}` : "Mark done"}
      </button>,
    );
    if (canFinishHere) {
      actions.push(
        <button key="done-here" className="btn grow-mobile" disabled={busy} onClick={() => finish(false, true)} title={`Done now, without ${finalName}'s final OK`}>
          <CircleCheck /> Mark done and finish
        </button>,
      );
    }
  }
  // Holds: the approver puts an open task on hold; the people on it ask.
  if (isOpen && !isRequest && !t.hold && iApprove) {
    actions.push(
      <button key="hold" className="btn grow-mobile" disabled={busy} onClick={() => { setNote(""); setAsk("put_hold"); }}>
        <Pause /> Put on hold
      </button>,
    );
  } else if (isOpen && !isRequest && !t.hold && isAssignee) {
    actions.push(
      <button key="ask-hold" className="btn grow-mobile" disabled={busy} onClick={() => { setNote(""); setAsk("ask_hold"); }}>
        <Pause /> Ask to hold
      </button>,
    );
  }
  if (t.status === "done" && canAssign) {
    actions.push(
      <button key="reopen" className="btn grow-mobile" disabled={busy} onClick={() => update({ status: "in_progress", changes_note: null }, "Task reopened")}>
        <RotateCcw /> Reopen
      </button>,
    );
  }

  return (
    <div className="page">
      <Link to={project ? `/projects/${project.id}/tasks` : "/my-tasks"} className="td-crumb hide-mobile">
        <ChevronLeft size={16} /> {project ? project.name : "My tasks"}
      </Link>

      <div className="td-layout">
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <div className="glass card stack" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <div className="row wrap" style={{ gap: 8, flex: 1, minWidth: 0 }}>
                <StatusPill status={t.status} />
                <PriorityFlag priority={t.priority} />
                <EarlyBadge task={t} />
                {project && (
                  <Link to={`/projects/${project.id}`} className="pill gray" style={{ color: "var(--text)" }}>
                    <i className="dot-swatch" style={{ background: project.color }} />
                    {project.code ?? project.name}
                  </Link>
                )}
              </div>
              <button
                className="btn small ghost"
                onClick={toggleFollow}
                aria-pressed={following}
                title={following ? "You get notified about comments and changes. Tap to stop." : "Get notified about comments and changes"}
                style={{ height: 28, padding: "0 10px" }}
              >
                {following ? <BellRing /> : <Bell />} {following ? "Following" : "Follow"}
              </button>
            </div>
            <h1 className="td-title">{t.title}</h1>

            {isRequest && (
              <div className={t.approval === "declined" ? "changes-banner" : "review-banner"}>
                <Hourglass />
                <div className="stack" style={{ gap: 8, minWidth: 0 }}>
                  <div className="small">
                    <b>
                      {t.approval === "declined"
                        ? iApprove
                          ? "You turned this down"
                          : `${approver.name} turned this down`
                        : iApprove
                          ? `${creator?.short_name ?? "Someone"} made this task and is waiting for your OK`
                          : `Waiting for ${approver.name}'s OK`}
                    </b>
                    <div className="muted">
                      {t.approval === "declined"
                        ? t.approval_note
                          ? `"${t.approval_note}"`
                          : "No reason given."
                        : iApprove
                          ? "Check it and change anything with Edit task. Once you approve it, the people on it are told and can start."
                          : "Nobody else sees it yet. You can still change it, or take it back."}
                    </div>
                  </div>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {iApprove && (
                      <button className="btn small success" disabled={busy} onClick={approveRequest}>
                        <CircleCheck /> {t.approval === "declined" ? "Approve anyway" : "Approve"}
                      </button>
                    )}
                    {iApprove && t.approval === "pending" && (
                      <button className="btn small warn" disabled={busy} onClick={() => { setNote(""); setAsk("decline"); }}>
                        <RotateCcw /> Turn down
                      </button>
                    )}
                    {(iApprove || myRequest) && (
                      <button className="btn small" disabled={busy} onClick={() => setEditOpen(true)}>
                        <Pencil /> {t.approval === "declined" && myRequest ? "Change it" : "Edit task"}
                      </button>
                    )}
                    {myRequest && !iApprove && t.approval === "declined" && (
                      <button className="btn small primary" disabled={busy} onClick={() => update({ approval: "pending" }, `Sent to ${approver.name} again`)}>
                        <Send /> Ask again
                      </button>
                    )}
                    {myRequest && !iApprove && (
                      <button className="btn small danger" disabled={busy} onClick={takeBack}>
                        <Trash2 /> {t.approval === "declined" ? "Remove" : "Take it back"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {t.hold && (
              <div className="changes-banner">
                <Pause />
                <div className="stack" style={{ gap: 8, minWidth: 0 }}>
                  <div className="small">
                    <b>
                      {onHold
                        ? "On hold"
                        : t.hold_by === me.id
                          ? `You asked ${approver.name} to put this on hold`
                          : `${holdBy?.short_name ?? "Someone"} asked to put this on hold`}
                    </b>
                    <div className="muted">
                      {t.hold_reason ? `"${t.hold_reason}"` : "No reason given."}
                      {onHold && t.hold_at ? ` · Since ${fmtDateTime(t.hold_at)}. No reminders until it's back on.` : ""}
                      {holdAsked && !iApprove ? ` ${approver.name} decides.` : ""}
                    </div>
                  </div>
                  {(iApprove || (holdAsked && t.hold_by === me.id)) && (
                    <div className="row wrap" style={{ gap: 8 }}>
                      {iApprove && holdAsked && (
                        <button className="btn small warn" disabled={busy} onClick={() => update({ hold: "on" }, "On hold. No reminders until it's back on.")}>
                          <Pause /> Put on hold
                        </button>
                      )}
                      {iApprove && holdAsked && (
                        <button className="btn small" disabled={busy} onClick={() => { setNote(""); setAsk("keep"); }}>
                          <Play /> Keep it going
                        </button>
                      )}
                      {iApprove && onHold && (
                        <button className="btn small primary" disabled={busy} onClick={() => update({ hold: null }, "Off hold. The people on it have been told.")}>
                          <Play /> Take off hold
                        </button>
                      )}
                      {!iApprove && holdAsked && t.hold_by === me.id && (
                        <button className="btn small" disabled={busy} onClick={() => update({ hold: null }, "Hold ask taken back")}>
                          <Undo2 /> Take back
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {changesRequested && (
              <div className="changes-banner">
                <RotateCcw />
                <div>
                  <b>Changes requested</b>
                  <div className="td-desc">{t.changes_note}</div>
                </div>
              </div>
            )}
            {t.status === "in_review" && (
              <div className="review-banner">
                <Clock />
                <div className="small">
                  <b>
                    {t.review_stage === "final"
                      ? turn === me.id
                        ? "Waiting for your final OK"
                        : `Waiting for ${finalName}'s final OK`
                      : t.review_stage === "first"
                        ? turn === me.id
                          ? "Waiting for your check"
                          : `Waiting for ${firstName}'s check`
                        : "Waiting for review"}
                  </b>
                  <div className="muted">
                    {t.review_stage === "final" && firstOkBy && firstOkBy.id !== submittedBy?.id
                      ? `${firstOkBy.id === me.id ? "You" : firstOkBy.short_name} approved it${t.first_ok_at ? ` · ${fmtDateTime(t.first_ok_at)}` : ""}. `
                      : `Submitted by ${submittedBy?.short_name ?? "someone"} ${timeAgo(t.submitted_at) === "now" ? "just now" : `· ${fmtDateTime(t.submitted_at)}`}. `}
                    {t.review_stage === "first"
                      ? turn === me.id
                        ? `You check it first, then it goes to ${finalName} for the final OK.`
                        : `${firstName} checks it first, then ${finalName} gives the final OK.`
                      : t.review_stage === "final"
                        ? turn === me.id
                          ? "Yours is the final OK."
                          : `${finalName} gives the final OK.`
                        : reviewer
                          ? `${reviewer.id === me.id ? "You are" : `${reviewer.short_name} is`} reviewing it.`
                          : ""}
                  </div>
                </div>
              </div>
            )}

            {t.description ? (
              <div className="td-desc">{t.description}</div>
            ) : (
              <div className="faint small">No details added.</div>
            )}

            {actions.length > 0 && <div className="action-bar">{actions}</div>}
          </div>

          <div className="hide-desktop">
            {details(t)}
          </div>

          <Checklist task={t} />

          <TaskProgressCard taskId={t.id} />

          <div className="glass card">
            <div className="card-head">
              <h3>
                <Paperclip /> Files
              </h3>
            </div>
            <Attachments taskId={t.id} projectId={t.project_id} repeatOf={t.repeat_of ?? t.recurring_id} />
            <DriveLinks taskId={t.id} projectId={t.project_id} repeatOf={t.repeat_of ?? t.recurring_id} />
          </div>

          <div className="glass card">
            <div className="card-head">
              <h3>
                <MessageCircle /> Comments
              </h3>
            </div>
            <CommentThread scope={{ kind: "task", taskId: t.id, projectId: t.project_id }} />
          </div>
        </div>

        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <div className="hide-mobile">
            {details(t)}
          </div>

          {(canAssign || isAssignee || myRequest) && !isRequest && (
            <div className="glass card row wrap" style={{ gap: 8 }}>
              <button className="btn small" onClick={() => setEditOpen(true)}>
                <Pencil /> Edit task
              </button>
              {canAssign && (
                <button className="btn small danger" onClick={remove}>
                  <Trash2 /> Delete
                </button>
              )}
            </div>
          )}

          <div className="glass card">
            <div className="card-head">
              <h3>
                <History /> History
              </h3>
            </div>
            {activity.isLoading ? <Loading /> : <ActivityFeed items={activity.data ?? []} />}
          </div>
        </div>
      </div>

      <TaskForm open={editOpen} onClose={() => setEditOpen(false)} task={t} />

      <Sheet
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        title="Submit for review"
        footer={
          <>
            <button className="btn" onClick={() => setSubmitOpen(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={submitForReview} disabled={busy}>
              <Send /> Submit
            </button>
          </>
        }
      >
        <div className="stack">
          <p className="muted">
            {nextStage === "first"
              ? `${firstName} gets a notification and checks it first. Once they approve it, ${finalName} gives the final OK. Either can send it back with notes.`
              : nextStage === "final"
                ? `${finalName} gets a notification and gives the final OK, or sends it back with notes.`
                : `${sendTo ? `${sendTo.short_name} gets a notification` : "The reviewer gets a notification"} and either approves it or sends it back with notes.`}
          </p>
          <label className="field">
            <span>Note for the reviewer (optional)</span>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </Sheet>

      <Sheet
        open={!!ask}
        onClose={() => setAsk(null)}
        title={ask === "decline" ? "Turn down this task" : ask === "ask_hold" ? "Ask to put it on hold" : ask === "put_hold" ? "Put it on hold" : "Keep it going"}
        footer={
          <>
            <button className="btn" onClick={() => setAsk(null)}>
              Cancel
            </button>
            <button
              className={`btn ${ask === "decline" ? "warn" : "primary"}`}
              onClick={() => void sendAsk()}
              disabled={busy || ((ask === "decline" || ask === "ask_hold") && !note.trim())}
            >
              {ask === "decline" ? "Turn down" : ask === "ask_hold" ? `Ask ${approver.name}` : ask === "put_hold" ? "Put on hold" : "Keep it going"}
            </button>
          </>
        }
      >
        <div className="stack">
          <p className="muted">
            {ask === "decline"
              ? `${creator?.short_name ?? "They"} sees your note and can change the task and ask again, or take it back.`
              : ask === "ask_hold"
                ? `${approver.name} decides. Until then it carries on as normal.`
                : ask === "put_hold"
                  ? "It stays where it is, can't be started or handed in, and gets no due or overdue reminders until you take it off hold. The people on it are told."
                  : `${holdBy?.short_name ?? "They"} is told it isn't going on hold and carries on.`}
          </p>
          <label className="field">
            <span>{ask === "decline" ? "Why" : ask === "keep" ? "Note (optional)" : ask === "put_hold" ? "Reason (optional)" : "Why it needs to go on hold"}</span>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </label>
        </div>
      </Sheet>

      <Sheet
        open={changesOpen}
        onClose={() => setChangesOpen(false)}
        title="Request changes"
        footer={
          <>
            <button className="btn" onClick={() => setChangesOpen(false)}>
              Cancel
            </button>
            <button className="btn warn" onClick={requestChanges} disabled={busy || !note.trim()}>
              <RotateCcw /> Send back
            </button>
          </>
        }
      >
        <div className="stack">
          <p className="muted">
            The task goes back to {onItNames || "the people on it"} with your note. It stays on their list until they submit it again.
          </p>
          <label className="field">
            <span>What needs changing</span>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </label>
        </div>
      </Sheet>
    </div>
  );

  function details(task: Task) {
    const team = peopleOn(task).map((x) => people.get(x));
    const reviewer = people.get(task.reviewer_id) ?? people.get(task.created_by);
    const creator = people.get(task.created_by);
    // WhatsApp opens with the task already written in, so the other person knows what it's about.
    const msg = (name: string) => taskMessage(name, task.title, task.id);
    return (
      <div className="glass card">
        <div className="card-head">
          <h3>
            <FileText /> Details
          </h3>
        </div>
        <div className="kv">
          <Row label="Assigned to">
            <span className="stack" style={{ gap: 6, minWidth: 0 }}>
              {team.length === 0 && <PersonLink person={null} />}
              {team.map((p, i) => (
                <span className="row" style={{ gap: 8, minWidth: 0 }} key={p?.id ?? i}>
                  <PersonLink person={p} />
                  {p && <WhatsAppButton person={p} variant="small" text={msg(p.short_name)} />}
                </span>
              ))}
            </span>
          </Row>
          {signoff.on ? (
            <Row label="Sign-off">
              <span className="stack" style={{ gap: 6, minWidth: 0 }}>
                {signoff.first && signoff.first.id !== signoff.final?.id && !peopleOn(task).includes(signoff.first.id) && (
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <PersonLink person={signoff.first} />
                    <span className="faint tiny">checks first</span>
                  </span>
                )}
                {signoff.final && !peopleOn(task).includes(signoff.final.id) ? (
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <PersonLink person={signoff.final} />
                    <span className="faint tiny">final OK</span>
                  </span>
                ) : (
                  signoff.first && (
                    <span className="row" style={{ gap: 8, minWidth: 0 }}>
                      <PersonLink person={signoff.first} />
                      <span className="faint tiny">approves it</span>
                    </span>
                  )
                )}
              </span>
            </Row>
          ) : (
            <Row label="Reviewer">
              <span className="row" style={{ gap: 8, minWidth: 0 }}>
                <PersonLink person={reviewer} />
                {reviewer && <WhatsAppButton person={reviewer} variant="small" text={msg(reviewer.short_name)} />}
              </span>
            </Row>
          )}
          <Row label="Due">
            {task.due_date ? (
              <DueLabel date={task.due_date} done={task.status === "done"} />
            ) : (
              <span className="faint">No date</span>
            )}
          </Row>
          <Row label="Priority">
            <PriorityFlag priority={task.priority} />
          </Row>
          {(task.progress_at || (task.progress ?? 0) > 0) && task.status !== "done" && (
            <Row label="Progress">
              <ProgressValue task={task} />
            </Row>
          )}
          <Row label="Project">
            <ProjectTag project={projects.get(task.project_id)} />
          </Row>
          {meeting && (
            <Row label="From meeting">
              <Link className="from-meeting" to={`/calendar?date=${meeting.event_date}&event=${meeting.id}`}>
                <CalendarDays size={15} />
                <span>{meeting.title}</span>
              </Link>
            </Row>
          )}
          {task.estimate_hours != null && <Row label="Estimate">{task.estimate_hours} h</Row>}
          <Row label="Created">
            <span className="row" style={{ gap: 8, minWidth: 0 }}>
              <span className="small">
                {creator?.short_name ?? "Someone"}, {fmtDateTime(task.created_at)}
              </span>
              {creator && creator.id !== reviewer?.id && <WhatsAppButton person={creator} variant="small" text={msg(creator.short_name)} />}
            </span>
          </Row>
          {task.submitted_at && task.status !== "todo" && (
            <Row label="Submitted">
              <span className="small">
                {fmtDateTime(task.submitted_at)}
                {earlyDays(task) > 0 && <b className="early-text"> · {daysText(earlyDays(task))} early</b>}
              </span>
            </Row>
          )}
          {task.first_ok_by && task.first_ok_at && task.status !== "todo" && task.status !== "in_progress" && (
            <Row label="Checked">
              <span className="small">
                {people.get(task.first_ok_by)?.short_name ?? "Someone"}, {fmtDateTime(task.first_ok_at)}
              </span>
            </Row>
          )}
          {task.status === "done" && task.completed_at && (
            <Row label={task.finished_by_first ? "Finished" : task.first_ok_by ? "Final OK" : "Approved"}>
              <span className="small">
                {people.get(task.approved_by)?.short_name ?? "Someone"}, {fmtDateTime(task.completed_at)}
                {task.finished_by_first && signoff.final ? ` · without ${signoff.final.short_name}'s final OK` : ""}
              </span>
            </Row>
          )}
          {task.recurring_id && (
            <Row label="Repeats">
              <span className="small">Created from a repeating task</span>
            </Row>
          )}
        </div>
      </div>
    );
  }
}
