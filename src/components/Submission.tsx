// A submission: what the team has to send, by when. Shown as a row with a days-left timer, and
// opened in a panel with its details, files and conversation. Marking a VO submission sent adds it
// to the VO's revisions in the VO log (the database does that).
import "@/styles/submissions.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { Ban, CircleCheck, FileClock, Paperclip, Send, Trash2, Undo2 } from "lucide-react";
import { useInvalidate, usePeople, useProjectMap } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useProjectTeams } from "@/lib/projectTeam";
import { useMarkSeen } from "@/lib/seen";
import {
  SUBMISSION_KIND,
  SUBMISSION_KINDS,
  canEditSubmissions,
  dueDateText,
  isMySubmission,
  setSubmissionStatus,
  sortSubmissions,
  submissionDue,
  submissionLabel,
  useSubmissions,
} from "@/lib/submissions";
import { errorMessage, supabase } from "@/lib/supabase";
import { dateOf, fmtDate, todayISO } from "@/lib/time";
import type { Project, Submission, SubmissionKind, Variation } from "@/lib/types";
import { useVariations } from "@/pages/project/api";
import { Attachments } from "./Attachments";
import { CommentThread } from "./CommentThread";
import { Empty, Field, Loading, Pill, Sheet, useConfirm, useToast } from "./ui";

/* ---------------------------------------------------------------- the timer */

/** The big days-left number: orange at 3 days or less, red when due or late, green once sent. */
export function DueTile({ s, small }: { s: Pick<Submission, "due_on" | "status" | "sent_on">; small?: boolean }) {
  const d = submissionDue(s);
  return (
    <span className={clsx("due-tile", d.tone, small && "small")} aria-label={d.text}>
      <b>{d.big}</b>
      <span>{small ? d.short : d.unit}</span>
    </span>
  );
}

export function DueChip({ s }: { s: Pick<Submission, "due_on" | "status" | "sent_on"> }) {
  const d = submissionDue(s);
  return <Pill tone={d.tone}>{d.text}</Pill>;
}

/* ---------------------------------------------------------------- the Home card */

/** Home: my submissions that are late or due in the next 7 days, soonest first. */
export function SubmissionsHomeCard() {
  const me = useMe();
  const { canAssign } = useAuth();
  const teams = useProjectTeams();
  const projects = useProjectMap();
  const subs = useSubmissions();
  const allVos = useVariations().data;
  const vos = useMemo(() => new Map((allVos ?? []).map((v) => [v.id, v])), [allVos]);
  const today = todayISO();
  const mine = teams.projectsOf(me.id);
  const list = sortSubmissions(subs.data ?? []).filter(
    (s) => s.status === "open" && (submissionDue(s, today).days ?? 0) <= 7 && isMySubmission(s, me.id, canAssign, mine),
  );
  const late = list.filter((s) => submissionDue(s, today).tone === "red").length;

  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-orange">
          <FileClock /> Submissions
        </h2>
        <div className="row" style={{ gap: 6 }}>
          {late > 0 && <Pill tone="red">{late} late or today</Pill>}
          <Link to="/submissions">All</Link>
        </div>
      </div>
      {subs.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={<CircleCheck />} title="Nothing due in the next 7 days" />
      ) : (
        <div className="list">
          {list.slice(0, 6).map((s) => {
            const d = submissionDue(s, today);
            return (
              <Link key={s.id} to={`/submissions?id=${s.id}`} className="alert-row">
                <DueTile s={s} small />
                <span className="grow">
                  <span className="title" style={{ display: "block" }}>
                    {submissionLabel(s, vos)}
                  </span>
                  <span className="meta" style={{ display: "block" }}>
                    {[projects.get(s.project_id)?.name, s.rev, dueDateText(s.due_on)].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Pill tone={d.tone}>{d.text}</Pill>
              </Link>
            );
          })}
          {list.length > 6 && (
            <Link to="/submissions" className="faint small" style={{ padding: "8px 4px" }}>
              {list.length - 6} more on the Submissions page
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- a row */

export function SubmissionRow({
  s,
  vos,
  project,
  showProject = true,
  onOpen,
  extra,
  compact,
}: {
  s: Submission;
  vos: Map<string, Variation>;
  project?: Project;
  showProject?: boolean;
  onOpen: () => void;
  extra?: ReactNode;
  /** The smaller timer, for lists inside a panel. */
  compact?: boolean;
}) {
  const d = submissionDue(s);
  const meta = [
    showProject ? project?.name : null,
    SUBMISSION_KIND[s.kind].short === "Other" ? null : SUBMISSION_KIND[s.kind].label,
    s.rev,
    s.status === "open" ? dueDateText(s.due_on) : s.status === "sent" ? null : `Was due ${fmtDate(s.due_on)}`,
  ].filter(Boolean);
  return (
    <button type="button" className={clsx("sub-row", s.status !== "open" && "closed")} onClick={onOpen}>
      <DueTile s={s} small={compact} />
      <span className="grow">
        <span className="t">{submissionLabel(s, vos)}</span>
        <span className="m">
          {meta.join(" · ")}
          {extra}
        </span>
      </span>
      <span className="hide-mobile">
        <Pill tone={d.tone}>{d.text}</Pill>
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------- the panel */

interface Form {
  project_id: string;
  kind: SubmissionKind;
  variation_id: string;
  title: string;
  rev: string;
  due_on: string;
  details: string;
}

const emptyForm = (d?: { projectId?: string | null; variationId?: string | null }, vo?: Variation): Form => ({
  project_id: vo?.project_id ?? d?.projectId ?? "",
  kind: d?.variationId ? "vo" : "other",
  variation_id: d?.variationId ?? "",
  title: "",
  rev: "",
  due_on: "",
  details: "",
});

const formOf = (s: Submission): Form => ({
  project_id: s.project_id,
  kind: s.kind,
  variation_id: s.variation_id ?? "",
  title: s.title,
  rev: s.rev ?? "",
  due_on: s.due_on,
  details: s.details ?? "",
});

export function SubmissionSheet({
  open,
  onClose,
  submission,
  defaults,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** The submission to show, or null to add a new one. */
  submission: Submission | null;
  /** For a new one: the project and VO it's for. */
  defaults?: { projectId?: string | null; variationId?: string | null };
  /** A new one was saved: it stays open (to add its files), as this one. */
  onCreated?: (s: Submission) => void;
}) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const projects = useProjectMap();
  const teams = useProjectTeams();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const allVos = useVariations().data;
  const vos = useMemo(() => new Map((allVos ?? []).map((v) => [v.id, v])), [allVos]);
  const s = submission;
  const [f, setF] = useState<Form>(() => (s ? formOf(s) : emptyForm(defaults)));
  const [saving, setSaving] = useState(false);
  const [sentOn, setSentOn] = useState(todayISO());
  const [marking, setMarking] = useState(false);

  // Reading it clears its notifications.
  useMarkSeen(open && s ? { link: `/submissions?id=${s.id}` } : null);

  useEffect(() => {
    if (!open) return;
    setF(s ? formOf(s) : emptyForm(defaults, defaults?.variationId ? vos.get(defaults.variationId) : undefined));
    setSentOn(s?.sent_on ?? todayISO());
    setMarking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, s?.id]);
  // The VO list arrives after the panel opens: a new one for a VO takes the VO's project.
  useEffect(() => {
    if (!open || s || !defaults?.variationId) return;
    const vo = vos.get(defaults.variationId);
    if (vo && !f.project_id) setF((x) => ({ ...x, project_id: vo.project_id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vos.size]);

  const canEdit = (projectId: string | null | undefined) => canEditSubmissions(projectId, me.id, canAssign, teams.team);
  const editable = s ? canEdit(s.project_id) : true;
  const canDelete = !!s && (s.created_by === me.id || canAssign);
  // A new one can go on the projects this person works on (any project for managers and seniors).
  const projectChoices = useMemo(
    () => projects.list.filter((p) => (p.status !== "completed" || p.id === f.project_id) && canEdit(p.id)).sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects.list, teams, f.project_id, canAssign, me.id],
  );
  const voChoices = useMemo(
    () => (allVos ?? []).filter((v) => v.project_id === f.project_id).sort((a, b) => a.vo_number.localeCompare(b.vo_number, undefined, { numeric: true })),
    [allVos, f.project_id],
  );
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const changed = !s || JSON.stringify(formOf(s)) !== JSON.stringify(f);

  async function save() {
    if (!f.project_id) return toast("Pick the project", "error");
    if (f.kind === "vo" && !f.variation_id) return toast("Pick the VO it's for", "error");
    if (!f.title.trim()) return toast("Say what's being sent, for example Revised quotation", "error");
    if (!f.due_on) return toast("Add the deadline", "error");
    setSaving(true);
    const row = {
      project_id: f.project_id,
      kind: f.kind,
      variation_id: f.kind === "vo" ? f.variation_id : null,
      title: f.title.trim(),
      rev: f.rev.trim() || null,
      due_on: f.due_on,
      details: f.details.trim() || null,
    };
    try {
      if (s) {
        const { error } = await supabase.from("submissions").update(row).eq("id", s.id);
        if (error) throw error;
        toast("Submission saved");
      } else {
        const { data, error } = await supabase.from("submissions").insert({ ...row, created_by: me.id }).select().single();
        if (error) throw error;
        toast("Submission added. The project's team has been told.");
        onCreated?.(data as Submission);
      }
      await invalidate("submissions", "notifications");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(status: Submission["status"]) {
    if (!s) return;
    if (status === "cancelled") {
      const ok = await confirm({
        title: "No longer needed?",
        message: "It comes off the list and its reminders stop. You can open it again later.",
        confirmLabel: "No longer needed",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await setSubmissionStatus(s.id, status, status === "sent" ? sentOn : null);
      toast(status === "sent" ? (s.variation_id ? "Marked sent, and added to the VO's revisions" : "Marked sent") : status === "open" ? "Open again" : "Taken off the list");
      setMarking(false);
      await invalidate("submissions", "variations", "notifications");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function changeSentDate() {
    if (!s || !sentOn || sentOn === s.sent_on) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("submissions").update({ sent_on: sentOn }).eq("id", s.id);
      if (error) throw error;
      toast("Sent date changed");
      await invalidate("submissions", "variations");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!s) return;
    const ok = await confirm({
      title: "Delete this submission?",
      message: "Its files and conversation go too. A VO revision it added stays in the VO log.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("submissions").delete().eq("id", s.id);
    if (error) return toast(errorMessage(error), "error");
    toast("Submission deleted");
    invalidate("submissions", "attachments", "comments");
    onClose();
  }

  const vo = f.variation_id ? vos.get(f.variation_id) : undefined;
  const due = s ? submissionDue(s) : null;
  const who = (id: string | null) => (id ? (id === me.id ? "you" : people.get(id)?.short_name ?? "someone") : "someone");
  const title = s ? submissionLabel(s, vos) : "New submission";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      wide
      footer={
        <>
          {canDelete && (
            <button className="btn danger" type="button" onClick={remove} style={{ marginRight: "auto" }} disabled={saving}>
              <Trash2 /> Delete
            </button>
          )}
          <button className="btn" type="button" onClick={onClose}>
            {s && !changed ? "Close" : "Cancel"}
          </button>
          {editable && changed && (
            <button className="btn primary" type="button" onClick={save} disabled={saving}>
              {saving ? "Saving..." : s ? "Save changes" : "Add submission"}
            </button>
          )}
        </>
      }
    >
      <div className="stack sub-sheet" style={{ gap: 16 }}>
        {s && due && (
          <div className={clsx("sub-status", due.tone)}>
            <DueTile s={s} />
            <div className="grow">
              <b>{due.text}</b>
              <div className="small muted">
                {s.status === "open"
                  ? `${dueDateText(s.due_on)}. Reminders go to ${projects.get(s.project_id)?.name ?? "the project"}'s team.`
                  : s.status === "sent"
                    ? `Marked sent by ${who(s.sent_by)}.${s.revision_key ? " It's in the VO log as this VO's latest revision." : ""}`
                    : `Was due ${fmtDate(s.due_on, { weekday: "short", day: "numeric", month: "short" })}.`}
              </div>
            </div>
            {editable && (
              <div className="sub-actions">
                {s.status === "open" && !marking && (
                  <>
                    <button className="btn success" type="button" onClick={() => setMarking(true)} disabled={saving}>
                      <Send /> Mark as sent
                    </button>
                    <button className="btn ghost" type="button" onClick={() => setStatus("cancelled")} disabled={saving}>
                      <Ban /> No longer needed
                    </button>
                  </>
                )}
                {s.status !== "open" && (
                  <button className="btn" type="button" onClick={() => setStatus("open")} disabled={saving}>
                    <Undo2 /> Open again
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {s && editable && s.status === "open" && marking && (
          <div className="sub-mark glass-inset">
            <Field label="Sent on" hint={s.variation_id ? `It's added to ${vos.get(s.variation_id)?.vo_number ?? "the VO"}'s revisions in the VO log, with this date.` : undefined}>
              <input className="input" type="date" value={sentOn} max={todayISO()} onChange={(e) => setSentOn(e.target.value)} />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" type="button" onClick={() => setMarking(false)}>
                Not yet
              </button>
              <button className="btn success" type="button" onClick={() => setStatus("sent")} disabled={saving || !sentOn}>
                <CircleCheck /> Sent
              </button>
            </div>
          </div>
        )}

        {s && editable && s.status === "sent" && (
          <div className="row wrap sub-sent-date">
            <Field label="Sent on">
              <input className="input" type="date" value={sentOn} max={todayISO()} onChange={(e) => setSentOn(e.target.value)} />
            </Field>
            {sentOn !== s.sent_on && (
              <button className="btn small" type="button" onClick={changeSentDate} disabled={saving || !sentOn}>
                Change the date
              </button>
            )}
          </div>
        )}

        <div className="form-grid">
          {!s && projectChoices.length === 0 ? (
            <p className="muted full">You're not on a project's team yet, so you can't add submissions. Hassan or a senior can add you to a project.</p>
          ) : (
            <>
              <Field label="Project">
                <select
                  className="select"
                  value={f.project_id}
                  onChange={(e) => setF((x) => ({ ...x, project_id: e.target.value, variation_id: "" }))}
                  disabled={!editable || (!!s && !canAssign)}
                >
                  <option value="">Pick a project</option>
                  {(s ? projects.list.filter((p) => p.id === f.project_id || canEdit(p.id)) : projectChoices).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="What it is">
                <select className="select" value={f.kind} onChange={(e) => set("kind", e.target.value as SubmissionKind)} disabled={!editable}>
                  {SUBMISSION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SUBMISSION_KIND[k].label}
                    </option>
                  ))}
                </select>
              </Field>
              {f.kind === "vo" && (
                <Field label="VO" className="full" hint={vo ? vo.title : f.project_id && !voChoices.length ? "This project has no VOs yet." : undefined}>
                  <select className="select" value={f.variation_id} onChange={(e) => set("variation_id", e.target.value)} disabled={!editable || !f.project_id}>
                    <option value="">{f.project_id ? "Pick the VO" : "Pick the project first"}</option>
                    {voChoices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.vo_number} · {v.title}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="What's being sent" className="full">
                <input
                  className="input"
                  value={f.title}
                  onChange={(e) => set("title", e.target.value)}
                  maxLength={200}
                  placeholder={f.kind === "vo" ? "Revised quotation" : f.kind === "payment" ? "Payment application No. 7" : f.kind === "boq" ? "Bill 3 priced BOQ" : "Reply to ECJV letter"}
                  disabled={!editable}
                />
              </Field>
              <Field label="Deadline">
                <input className="input" type="date" value={f.due_on} onChange={(e) => set("due_on", e.target.value)} disabled={!editable} />
              </Field>
              <Field label="Revision" hint="Optional">
                <input className="input" value={f.rev} onChange={(e) => set("rev", e.target.value)} maxLength={40} placeholder="Rev 1" disabled={!editable} />
              </Field>
              <Field label="Details" className="full">
                <textarea
                  className="textarea"
                  value={f.details}
                  onChange={(e) => set("details", e.target.value)}
                  maxLength={4000}
                  placeholder="What they asked for, the letter or instruction reference, what's still missing"
                  disabled={!editable}
                  style={{ minHeight: 70 }}
                />
              </Field>
            </>
          )}
          {!s && projectChoices.length > 0 && <p className="faint tiny full">The project's team hears about it now, and gets reminders 3 days before, the working day before and on the day.</p>}
        </div>

        {s && (
          <section className="stack" style={{ gap: 8 }}>
            <h3 className="sub-h">
              <Paperclip /> Files
            </h3>
            <Attachments submissionId={s.id} projectId={s.project_id} canUpload={editable} compact emptyText="No files yet" />
          </section>
        )}

        {s && (
          <section className="stack" style={{ gap: 8 }}>
            <h3 className="sub-h">Conversation</h3>
            <CommentThread scope={{ kind: "submission", submissionId: s.id, projectId: s.project_id }} placeholder="Comment, or @mention someone" height={360} />
          </section>
        )}

        {s && (
          <p className="faint tiny">
            Added {fmtDate(dateOf(s.created_at), { day: "numeric", month: "short", year: "numeric" })} by {who(s.created_by)}
            {s.updated_by && s.updated_at !== s.created_at ? `, last changed by ${who(s.updated_by)} ${fmtDate(dateOf(s.updated_at))}` : ""}.
          </p>
        )}
      </div>
    </Sheet>
  );
}
