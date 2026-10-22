import "@/styles/comms.css";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BellRing, ChevronDown, ChevronUp, CircleCheck, Clock, Megaphone, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { Avatar, Empty, Field, Loading, Pill, Progress, ProjectSelect, Sheet, Switch, useConfirm, useToast } from "@/components/ui";
import { useInvalidate, usePeople, useProjectMap, useProjects } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import { dateOf, diffDays, fmtDateTime, fmtDue, fmtTime12, timeAgo, todayISO } from "@/lib/time";

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
        sub={waiting ? `${waiting} waiting for you to acknowledge` : "Team news and instructions from Hassan and the seniors"}
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
            <AnnouncementItem key={a.id} a={a} highlight={highlight === a.id} onEdit={() => setEditing(a)} />
          ))}
        </div>
      )}

      <AnnouncementForm open={composing || !!editing} announcement={editing} onClose={() => (setComposing(false), setEditing(null))} />
    </div>
  );
}

function AnnouncementItem({ a, highlight, onEdit }: { a: AnnouncementWithAcks; highlight: boolean; onEdit: () => void }) {
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
      <div className="ann-body">{a.body}</div>

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

function AnnouncementForm({ open, onClose, announcement }: { open: boolean; onClose: () => void; announcement: Announcement | null }) {
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

  useEffect(() => {
    if (!open) return;
    setTitle(announcement?.title ?? "");
    setBody(announcement?.body ?? "");
    setImportant(announcement?.important ?? false);
    setRequiresAck(announcement?.requires_ack ?? true);
    setPinned(announcement?.pinned ?? false);
    setProjectId(announcement?.project_id ?? null);
  }, [open, announcement]);

  async function save() {
    if (!title.trim() || !body.trim()) {
      toast("Add a title and a message", "error");
      return;
    }
    setSaving(true);
    try {
      const fields = { title: title.trim(), body: body.trim(), important, requires_ack: requiresAck, pinned, project_id: projectId };
      if (announcement) {
        const { error } = await supabase.from("announcements").update(fields).eq("id", announcement.id);
        if (error) throw error;
        toast("Announcement updated");
      } else {
        const { error } = await supabase.from("announcements").insert({ ...fields, author_id: me.id });
        if (error) throw error;
        toast("Posted. The team has been notified.");
      }
      await invalidate("announcements");
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
      title={announcement ? "Edit announcement" : "New announcement"}
      footer={
        <>
          <button className="btn" onClick={onClose}>
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
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Cost reports due Wednesday" autoFocus />
        </Field>
        <Field label="Message">
          <textarea className="textarea" style={{ minHeight: 160 }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What does the team need to know?" />
        </Field>
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
