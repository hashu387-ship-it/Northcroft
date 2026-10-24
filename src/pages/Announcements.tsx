import "@/styles/comms.css";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BellRing, ChevronDown, ChevronUp, CircleCheck, Clock, ListChecks, Megaphone, Mic, Pencil, Pin, PinOff, Plus, RotateCcw, Trash2 } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { Avatar, Empty, Field, Loading, Pill, Progress, ProjectSelect, Sheet, Switch, useConfirm, useToast } from "@/components/ui";
import { useInvalidate, usePeople, useProjectMap, useProjects } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import { dateOf, diffDays, fmtDateTime, fmtDue, fmtTime12, timeAgo, todayISO } from "@/lib/time";
import { canRecord, uploadVoice, useRecorder, type Recording } from "@/lib/voice";
import { RecorderBar, VoiceNote, VoicePlayer } from "@/components/Voice";
import { PollCard, PollFields, emptyPoll, type PollDraft } from "@/components/Polls";
import { addAnnouncementPoll, pollProblem, usePolls, type PollWithVotes } from "@/lib/polls";

/** "today at 9:14 AM", "yesterday at 5:02 PM" or "on Sun 18 Oct at 8:40 AM". */
function whenPhrase(ts: string) {
  const d = diffDays(todayISO(), dateOf(ts));
  const t = fmtTime12(ts);
  if (d === 0) return `today at ${t}`;
  if (d === 1) return `yesterday at ${t}`;
  return `on ${fmtDue(dateOf(ts))} at ${t}`;
}
import type { Announcement } from "@/lib/types";
import { acknowledge, needsMyAck, useAnnouncementsWithAcks, type AnnouncementWithAcks } from "./home/data";

export default function Announcements() {
  const me = useMe();
  const { canAssign } = useAuth();
  const { data, isLoading } = useAnnouncementsWithAcks();
  const [params] = useSearchParams();
  const focusId = params.get("id");
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [composing, setComposing] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  const waiting = data.filter((a) => needsMyAck(a, me.id)).length;
  const polls = usePolls("announcement", data.map((a) => a.id));

  useEffect(() => {
    if (!focusId || isLoading) return;
    const el = document.getElementById(`ann-${focusId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlight(focusId);
    const t = window.setTimeout(() => setHighlight(null), 2600);
    return () => window.clearTimeout(t);
  }, [focusId, isLoading]);

  return (
    <div className="page">
      <PageHead
        title="Announcements"
        sub={waiting ? `${waiting} waiting for you to acknowledge` : "Team news and instructions from the managers and seniors"}
        actions={
          canAssign && (
            <button className="btn primary" onClick={() => setComposing(true)}>
              <Plus /> New announcement
            </button>
          )
        }
      />

      {isLoading ? (
        <Loading />
      ) : data.length === 0 ? (
        <div className="glass card">
          <Empty icon={<Megaphone />} title="No announcements yet">
            {canAssign ? "Post one and the whole team gets a notification." : "When Hassan posts something it shows up here."}
          </Empty>
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {data.map((a) => (
            <AnnouncementItem key={a.id} a={a} poll={polls.get(a.id)} highlight={highlight === a.id} onEdit={() => setEditing(a)} />
          ))}
        </div>
      )}

      <AnnouncementForm
        open={composing || !!editing}
        announcement={editing}
        hasPoll={!!editing && polls.has(editing.id)}
        onClose={() => (setComposing(false), setEditing(null))}
      />
    </div>
  );
}

function AnnouncementItem({ a, poll, highlight, onEdit }: { a: AnnouncementWithAcks; poll?: PollWithVotes; highlight: boolean; onEdit: () => void }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const projects = useProjectMap();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [showWho, setShowWho] = useState(false);

  const author = people.get(a.author_id);
  const isAuthor = a.author_id === me.id;
  const myAck = a.acks.find((k) => k.user_id === me.id);
  const audience = useMemo(() => people.active.filter((p) => p.id !== a.author_id), [people.active, a.author_id]);
  const ackedIds = new Set(a.acks.map((k) => k.user_id));
  const ackedCount = audience.filter((p) => ackedIds.has(p.id)).length;
  const remaining = audience.length - ackedCount;
  const showTracking = a.requires_ack && (canAssign || isAuthor);
  const project = projects.get(a.project_id);

  async function ack() {
    setBusy(true);
    try {
      await acknowledge(a.id, me.id);
      toast("Thanks, marked as acknowledged");
      await invalidate("announcement_acks", "announcements");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function nudge() {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("nudge_announcement", { p_id: a.id });
      if (error) throw error;
      const n = Number(data ?? 0);
      toast(n ? `Reminder sent to ${n} ${n === 1 ? "person" : "people"}` : "Everyone has already acknowledged");
      await invalidate("announcements");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function togglePin() {
    const { error } = await supabase.from("announcements").update({ pinned: !a.pinned }).eq("id", a.id);
    if (error) toast(errorMessage(error), "error");
    else {
      toast(a.pinned ? "Unpinned" : "Pinned to the top");
      invalidate("announcements");
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this announcement?",
      message: "It will be removed for everyone, along with who acknowledged it.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("announcements").delete().eq("id", a.id);
    if (error) toast(errorMessage(error), "error");
    else {
      if (a.voice_path) await supabase.storage.from("files").remove([a.voice_path]);
      qc.setQueryData<Announcement[]>(["announcements", "list"], (old) => old?.filter((x) => x.id !== a.id));
      toast("Announcement deleted");
      invalidate("announcements", "announcement_acks");
    }
  }

  return (
    <article id={`ann-${a.id}`} className={clsx("glass ann-card", highlight && "highlight", a.important && "important")}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Avatar person={author} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <b>{author?.short_name ?? "Someone"}</b>
            <span className="muted small">{author?.title}</span>
          </div>
          <div className="faint tiny">
            {fmtDateTime(a.created_at)}
            {project ? ` · ${project.name}` : ""}
          </div>
        </div>
        {canAssign && (
          <div className="row" style={{ gap: 2 }}>
            <button className="icon-btn small plain" onClick={togglePin} aria-label={a.pinned ? "Unpin" : "Pin"} title={a.pinned ? "Unpin" : "Pin to top"}>
              {a.pinned ? <PinOff /> : <Pin />}
            </button>
            <button className="icon-btn small plain" onClick={onEdit} aria-label="Edit" title="Edit">
              <Pencil />
            </button>
            <button className="icon-btn small plain" onClick={remove} aria-label="Delete" title="Delete">
              <Trash2 />
            </button>
          </div>
        )}
      </div>

      <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
        {a.important && <Pill tone="red">Important</Pill>}
        {a.pinned && (
          <Pill tone="blue">
            <Pin /> Pinned
          </Pill>
        )}
      </div>
      <h2 style={{ marginTop: a.important || a.pinned ? 8 : 12 }}>{a.title}</h2>
      {a.body.trim() && <div className="ann-body">{a.body}</div>}
      {a.voice_path && (
        <VoiceNote
          kind="announcement"
          id={a.id}
          path={a.voice_path}
          seconds={a.voice_seconds}
          peaks={a.voice_peaks}
          transcript={a.transcript}
          status={a.transcript_status}
          canEdit={canAssign}
        />
      )}
      {poll && <PollCard pw={poll} />}

      <div className="ann-foot">
        {needsMyAck(a, me.id) ? (
          <button className="btn primary" onClick={ack} disabled={busy}>
            <CircleCheck /> Acknowledge
          </button>
        ) : myAck ? (
          <span className="row small" style={{ gap: 6, color: "var(--green)", fontWeight: 600 }}>
            <CircleCheck size={17} /> You acknowledged this {whenPhrase(myAck.acked_at)}
          </span>
        ) : isAuthor ? (
          <span className="muted small">You posted this</span>
        ) : (
          <span className="muted small">No acknowledgement needed</span>
        )}
        <span className="spacer" />
        {showTracking && (
          <span className="small muted">
            {ackedCount} of {audience.length} acknowledged
          </span>
        )}
      </div>

      {showTracking && (
        <div className="ack-box">
          <div className="row" style={{ gap: 10 }}>
            <div style={{ flex: 1 }}>
              <Progress value={audience.length ? (ackedCount / audience.length) * 100 : 0} color={remaining ? "var(--accent)" : "var(--green)"} />
            </div>
            <button className="btn small ghost" onClick={() => setShowWho((s) => !s)} aria-expanded={showWho}>
              {showWho ? <ChevronUp /> : <ChevronDown />} {showWho ? "Hide" : "Who"}
            </button>
            {canAssign && remaining > 0 && (
              <button className="btn small warn" onClick={nudge} disabled={busy}>
                <BellRing /> Nudge the rest
              </button>
            )}
          </div>
          {a.nudged_at && remaining > 0 && <div className="faint tiny" style={{ marginTop: 6 }}>Last reminder sent {whenPhrase(a.nudged_at)}</div>}
          {showWho && (
            <div className="ack-list">
              {audience.map((p) => {
                const k = a.acks.find((x) => x.user_id === p.id);
                return (
                  <div className="who" key={p.id}>
                    <Avatar person={p} size={24} />
                    <span>{p.short_name}</span>
                    {k ? (
                      <span className="success-text tiny" title={fmtDateTime(k.acked_at)} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <CircleCheck size={14} /> {timeAgo(k.acked_at)}
                      </span>
                    ) : (
                      <span className="warn-text tiny" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <Clock size={14} /> Not yet
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function AnnouncementForm({
  open,
  onClose,
  announcement,
  hasPoll,
}: {
  open: boolean;
  onClose: () => void;
  announcement: Announcement | null;
  /** The announcement being edited already has a poll (polls can't be changed once posted). */
  hasPoll: boolean;
}) {
  const me = useMe();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: projects = [] } = useProjects();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [requiresAck, setRequiresAck] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // An optional poll under the announcement.
  const [pollOn, setPollOn] = useState(false);
  const [poll, setPoll] = useState<PollDraft>(emptyPoll);
  // Voice note: a fresh recording, or the one already on the announcement (when editing).
  const [voice, setVoice] = useState<Recording | null>(null);
  const [keepExisting, setKeepExisting] = useState(true);
  const recorder = useRecorder({ onDone: (r) => setVoice(r) });
  const voiceUrl = useMemo(() => (voice ? URL.createObjectURL(voice.blob) : null), [voice]);
  useEffect(() => () => void (voiceUrl && URL.revokeObjectURL(voiceUrl)), [voiceUrl]);
  const existingVoice = announcement?.voice_path && keepExisting ? announcement : null;
  const hasVoice = !!voice || !!existingVoice;

  useEffect(() => {
    if (!open) return;
    setTitle(announcement?.title ?? "");
    setBody(announcement?.body ?? "");
    setImportant(announcement?.important ?? false);
    setRequiresAck(announcement?.requires_ack ?? true);
    setPinned(announcement?.pinned ?? false);
    setProjectId(announcement?.project_id ?? null);
    setVoice(null);
    setKeepExisting(true);
    setPollOn(false);
    setPoll(emptyPoll());
  }, [open, announcement]);

  async function record() {
    try {
      setVoice(null);
      await recorder.start();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function close() {
    if (recorder.state !== "idle") recorder.cancel();
    onClose();
  }

  async function save() {
    const addingPoll = pollOn && !hasPoll;
    if (!title.trim() || (!body.trim() && !hasVoice && !addingPoll && !hasPoll)) {
      toast("Add a title, and a message, a voice note or a poll", "error");
      return;
    }
    const problem = addingPoll ? pollProblem(poll.question, poll.options) : null;
    if (problem) {
      toast(`Poll: ${problem.toLowerCase()}`, "error");
      return;
    }
    if (recorder.state !== "idle") {
      toast("Stop the recording first", "error");
      return;
    }
    setSaving(true);
    let uploaded: string | null = null;
    try {
      const fields: Record<string, unknown> = { title: title.trim(), body: body.trim(), important, requires_ack: requiresAck, pinned, project_id: projectId };
      const oldPath = announcement?.voice_path ?? null;
      if (voice) {
        uploaded = await uploadVoice(voice, me.id);
        Object.assign(fields, { voice_path: uploaded, voice_seconds: Math.round(voice.seconds * 10) / 10, voice_peaks: voice.peaks });
      } else if (announcement && oldPath && !keepExisting) {
        fields.voice_path = null;
      }
      // The poll goes on once the announcement is saved; if it fails, the announcement still stands.
      const attachPoll = async (id: string) => {
        if (!addingPoll) return null;
        try {
          await addAnnouncementPoll(id, poll.question.trim(), poll.options.map((o) => o.trim()).filter(Boolean), poll.multi);
          return null;
        } catch (e) {
          return errorMessage(e);
        }
      };
      let pollError: string | null = null;
      if (announcement) {
        const { error } = await supabase.from("announcements").update(fields).eq("id", announcement.id);
        if (error) throw error;
        // The old recording is no longer used once it's replaced or removed.
        if (oldPath && (uploaded || !keepExisting)) await supabase.storage.from("files").remove([oldPath]);
        pollError = await attachPoll(announcement.id);
        if (!pollError) toast(addingPoll ? "Announcement updated, with its poll" : "Announcement updated");
      } else {
        const { data: made, error } = await supabase.from("announcements").insert({ ...fields, author_id: me.id }).select("id").single();
        if (error) throw error;
        pollError = await attachPoll((made as { id: string }).id);
        if (!pollError) toast("Posted. The team has been notified.");
      }
      if (pollError) toast(`Saved, but the poll wasn't added: ${pollError} Edit the announcement to add it again.`, "error");
      uploaded = null;
      await invalidate("announcements", "polls");
      onClose();
    } catch (e) {
      if (uploaded) await supabase.storage.from("files").remove([uploaded]);
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={announcement ? "Edit announcement" : "New announcement"}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : announcement ? "Save changes" : "Post to the team"}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label={hasVoice ? "Message (optional with a voice note)" : pollOn || hasPoll ? "Message (optional with a poll)" : "Message"}>
          <textarea className="textarea" style={{ minHeight: hasVoice ? 90 : 160 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What does the team need to know?" />
        </Field>
        {canRecord() && (
          <div className="voice-field">
            {recorder.state !== "idle" ? (
              <RecorderBar
                elapsed={recorder.elapsed}
                maxSeconds={recorder.maxSeconds}
                bars={recorder.bars}
                onCancel={recorder.cancel}
                onFinish={recorder.stop}
                finishLabel="Stop recording"
                finishIcon="stop"
              />
            ) : voice && voiceUrl ? (
              <>
                <VoicePlayer src={voiceUrl} seconds={voice.seconds} peaks={voice.peaks} seed="draft" />
                <div className="row" style={{ gap: 6 }}>
                  <span className="muted small grow">It's written out in English for everyone once you post.</span>
                  <button type="button" className="btn small" onClick={record}>
                    <RotateCcw /> Record again
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => setVoice(null)} aria-label="Remove voice note">
                    <Trash2 />
                  </button>
                </div>
              </>
            ) : existingVoice?.voice_path ? (
              <>
                <VoicePlayer path={existingVoice.voice_path} seconds={existingVoice.voice_seconds} peaks={existingVoice.voice_peaks} seed={existingVoice.id} />
                <div className="row" style={{ gap: 6 }}>
                  <span className="muted small grow">Voice note on this announcement</span>
                  <button type="button" className="btn small" onClick={record}>
                    <Mic /> Replace
                  </button>
                  <button type="button" className="btn small ghost" onClick={() => setKeepExisting(false)} aria-label="Remove voice note">
                    <Trash2 />
                  </button>
                </div>
              </>
            ) : (
              <div className="row" style={{ gap: 10 }}>
                <button type="button" className="btn" onClick={record}>
                  <Mic /> Record a voice note
                </button>
                <span className="muted small">Up to 3 minutes. Written out in English for everyone.</span>
              </div>
            )}
          </div>
        )}
        {hasPoll ? (
          <div className="muted small row" style={{ gap: 8 }}>
            <ListChecks size={17} /> This announcement has a poll. Polls stay as they are once posted.
          </div>
        ) : (
          <div className="solid stack" style={{ padding: 6, borderRadius: 10, gap: 0 }}>
            <ToggleRow label="Add a poll" hint="Ask the team a quick question. Everyone can vote and see the results." checked={pollOn} onChange={setPollOn} />
            {pollOn && (
              <div style={{ padding: "6px 10px 12px" }}>
                <PollFields value={poll} onChange={setPoll} />
              </div>
            )}
          </div>
        )}
        <Field label="Project (optional)">
          <ProjectSelect value={projectId} onChange={setProjectId} projects={projects} emptyLabel="Whole team" />
        </Field>
        <div className="solid stack" style={{ padding: 6, borderRadius: 10, gap: 0 }}>
          <ToggleRow label="Needs acknowledgement" hint="Everyone gets an Acknowledge button and you can see who hasn't." checked={requiresAck} onChange={setRequiresAck} />
          <hr className="divider" />
          <ToggleRow label="Mark as important" hint="Shown in red and the notification says Important." checked={important} onChange={setImportant} />
          <hr className="divider" />
          <ToggleRow label="Pin to the top" hint="Stays above newer announcements until you unpin it." checked={pinned} onChange={setPinned} />
        </div>
        {!announcement && <p className="muted small">Everyone on the team gets a notification as soon as you post.</p>}
      </div>
    </Sheet>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="row" style={{ padding: "10px 10px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="bold">{label}</div>
        <div className="muted small">{hint}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}
