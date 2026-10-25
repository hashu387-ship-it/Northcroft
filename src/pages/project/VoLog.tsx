// The VO log details of a variation: the log's reference and status, scope, key dates, each
// revision submitted to the main contractor with our amount, ECJV's assessment and comments, and
// the files and links on both sides, then the supporting documents and the QS remarks. Edited in
// the VO form and shown in the register, so the team keeps the log here instead of in a spreadsheet.
import { useRef } from "react";
import { Paperclip, Plus, X } from "lucide-react";
import { Attachments } from "@/components/Attachments";
import { DriveLinks } from "@/components/DriveLinks";
import { DropZone } from "@/components/DropZone";
import { Field } from "@/components/ui";
import { parseMoney, sar } from "@/lib/format";
import { addDays, fmtDate } from "@/lib/time";
import type { Variation, VoSubmission } from "@/lib/types";

interface RoundForm {
  key: string;
  rev: string;
  sent: string;
  sent_note: string;
  submitted_value: string;
  assessed_value: string;
  response: string;
  response_on: string;
}

export interface VoLogForm {
  log_ref: string;
  log_status: string;
  scope: string;
  instruction_date: string;
  contract_due: string;
  expected_completion: string;
  qs_remarks: string;
  submissions: RoundForm[];
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const money = (n: number | null | undefined) => (n == null ? "" : String(n));

/** Days the contract allows from the instruction to the submission. */
export const CONTRACT_DAYS = 35;

export function voLogForm(vo: Variation | null): VoLogForm {
  return {
    log_ref: vo?.log_ref ?? "",
    log_status: vo?.log_status ?? "",
    scope: vo?.scope ?? "",
    instruction_date: vo?.instruction_date ?? "",
    contract_due: vo?.contract_due ?? "",
    expected_completion: vo?.expected_completion ?? "",
    qs_remarks: vo?.qs_remarks ?? "",
    submissions: (vo?.submissions ?? []).map((x) => ({
      key: x.key || newKey(),
      rev: x.rev ?? "",
      sent: x.sent ?? "",
      sent_note: x.sent_note ?? "",
      submitted_value: money(x.submitted_value),
      assessed_value: money(x.assessed_value),
      response: x.response ?? "",
      response_on: x.response_on ?? "",
    })),
  };
}

/** What gets saved: blanks become empty, empty rounds are dropped. */
export function voLogRow(f: VoLogForm) {
  const t = (s: string) => s.trim() || null;
  const submissions: VoSubmission[] = f.submissions
    .map((x) => ({
      key: x.key,
      rev: t(x.rev),
      sent: x.sent || null,
      sent_note: t(x.sent_note),
      submitted_value: parseMoney(x.submitted_value),
      assessed_value: parseMoney(x.assessed_value),
      response: t(x.response),
      response_on: x.response_on || null,
    }))
    // A revision added and left empty (only its suggested "Rev 2" name) isn't kept.
    .filter((x) => (x.rev && !/^Rev \d+$/i.test(x.rev)) || x.sent || x.sent_note || x.response || x.response_on || x.submitted_value != null || x.assessed_value != null);
  return {
    log_ref: t(f.log_ref),
    log_status: t(f.log_status),
    scope: t(f.scope),
    instruction_date: f.instruction_date || null,
    contract_due: f.contract_due || null,
    expected_completion: f.expected_completion || null,
    qs_remarks: t(f.qs_remarks),
    submissions,
  };
}

const rowsFor = (text: string, min = 2) => Math.min(14, Math.max(min, Math.ceil(text.length / 90) + text.split("\n").length));

/** Our amount against ECJV's: "SAR 12,500 less than we asked (8%)". */
export function roundGap(submitted: number | null | undefined, assessed: number | null | undefined): string | null {
  if (submitted == null || assessed == null) return null;
  const d = submitted - assessed;
  if (d === 0) return "Assessed at what we asked";
  const pct = submitted ? Math.round((Math.abs(d) / Math.abs(submitted)) * 100) : null;
  return `${sar(Math.abs(d))} ${d > 0 ? "less" : "more"} than we asked${pct != null ? ` (${pct}%)` : ""}`;
}

export function VoLogFields({
  value,
  onChange,
  vo,
}: {
  value: VoLogForm;
  onChange: (v: VoLogForm) => void;
  /** The saved variation, so files and links can be added (a new one has to be saved first). */
  vo?: Pick<Variation, "id" | "project_id" | "submissions"> | null;
}) {
  // Files go on revisions that are saved; a revision added just now gets them after saving.
  const savedKeys = (vo?.submissions ?? []).map((x) => x.key).filter((k): k is string => !!k);
  const set = <K extends keyof VoLogForm>(k: K, v: VoLogForm[K]) => onChange({ ...value, [k]: v });
  const setRound = (i: number, patch: Partial<VoLogForm["submissions"][number]>) =>
    set("submissions", value.submissions.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function setInstruction(d: string) {
    // The contractual submission date follows the instruction (35 days) unless someone has set their own.
    const auto = value.instruction_date ? addDays(value.instruction_date, CONTRACT_DAYS) : "";
    const follow = !value.contract_due || value.contract_due === auto;
    onChange({ ...value, instruction_date: d, contract_due: follow && d ? addDays(d, CONTRACT_DAYS) : follow ? "" : value.contract_due });
  }

  return (
    <div className="vo-log full">
      <div className="vo-log-head">
        <h3>VO log</h3>
        <span className="faint small">Kept up to date here, so the team always has the latest</span>
      </div>
      <div className="form-grid">
        <Field label="Reference in the log">
          <input className="input" value={value.log_ref} onChange={(e) => set("log_ref", e.target.value)} placeholder="As written in the log" />
        </Field>
        <Field label="Status in the log">
          <input className="input" value={value.log_status} onChange={(e) => set("log_status", e.target.value)} list="vo-log-statuses" placeholder="Open, Closed or as the log says" />
          <datalist id="vo-log-statuses">
            <option value="Open" />
            <option value="Closed" />
            <option value="Rejected & Closed" />
            <option value="Required to send a letter" />
          </datalist>
        </Field>
        <Field label="Scope" className="full">
          <input className="input" value={value.scope} onChange={(e) => set("scope", e.target.value)} placeholder="What the change covers" />
        </Field>
        <Field label="Instruction date">
          <input className="input" type="date" value={value.instruction_date} onChange={(e) => setInstruction(e.target.value)} />
        </Field>
        <Field label={`Contractual submission (${CONTRACT_DAYS} days)`} hint={value.instruction_date ? `${CONTRACT_DAYS} days after the instruction unless you change it` : undefined}>
          <input className="input" type="date" value={value.contract_due} onChange={(e) => set("contract_due", e.target.value)} />
        </Field>
        <Field label="Expected date of completion">
          <input className="input" type="date" value={value.expected_completion} onChange={(e) => set("expected_completion", e.target.value)} />
        </Field>
      </div>

      <div className="vo-rounds">
        <div className="vo-rounds-head">
          <span className="field-label">Revisions: what we sent and ECJV's assessment</span>
          <button
            type="button"
            className="btn small"
            onClick={() =>
              set("submissions", [
                ...value.submissions,
                { key: newKey(), rev: `Rev ${value.submissions.length}`, sent: "", sent_note: "", submitted_value: "", assessed_value: "", response: "", response_on: "" },
              ])
            }
            disabled={value.submissions.length >= 20}
          >
            <Plus /> Add revision
          </button>
        </div>
        {value.submissions.length === 0 && <p className="faint small vo-rounds-empty">Nothing sent yet. Add a revision when it goes to ECJV.</p>}
        {value.submissions.map((x, i) => {
          const label = x.rev.trim() || `${ordinal(i + 1)} submission`;
          const gap = roundGap(parseMoney(x.submitted_value), parseMoney(x.assessed_value));
          const saved = !!vo && savedKeys.includes(x.key);
          return (
            <div className="vo-round" key={x.key}>
              <div className="vo-round-top">
                <span className="vo-round-n">{label}</span>
                <button type="button" className="icon-btn small plain" onClick={() => set("submissions", value.submissions.filter((_, j) => j !== i))} aria-label={`Take ${label} off`}>
                  <X />
                </button>
              </div>
              <div className="form-grid">
                <Field label="Revision">
                  <input className="input" value={x.rev} onChange={(e) => setRound(i, { rev: e.target.value })} placeholder={`Rev ${i}`} maxLength={40} />
                </Field>
                <Field label="Sent on">
                  <input className="input" type="date" value={x.sent} onChange={(e) => setRound(i, { sent: e.target.value })} />
                </Field>
                <Field label="Or a note instead of a date" className="full">
                  <input className="input" value={x.sent_note} onChange={(e) => setRound(i, { sent_note: e.target.value })} placeholder="What the log says when there's no date" />
                </Field>
                <Field label="Our amount (SAR)">
                  <input className="input" inputMode="decimal" value={x.submitted_value} onChange={(e) => setRound(i, { submitted_value: e.target.value })} placeholder="What we submitted" />
                </Field>
                <Field label="ECJV assessed (SAR)">
                  <input className="input" inputMode="decimal" value={x.assessed_value} onChange={(e) => setRound(i, { assessed_value: e.target.value })} placeholder="What they assessed" />
                </Field>
                {gap && <p className="vo-gap full">{gap}</p>}
                <Field label="ECJV response and comments" className="full">
                  <textarea className="textarea" rows={rowsFor(x.response)} value={x.response} onChange={(e) => setRound(i, { response: e.target.value })} placeholder="What ECJV replied and their assessment comments" />
                </Field>
                <Field label="Response date">
                  <input className="input" type="date" value={x.response_on} onChange={(e) => setRound(i, { response_on: e.target.value })} />
                </Field>
              </div>
              {saved ? (
                <div className="vo-sides">
                  <VoFileBox title="What we sent" variationId={vo!.id} projectId={vo!.project_id} round={x.key} side="sent" />
                  <VoFileBox title="ECJV's assessment" variationId={vo!.id} projectId={vo!.project_id} round={x.key} side="assessment" />
                </div>
              ) : (
                <p className="faint tiny vo-files-later">
                  <Paperclip size={13} /> {vo ? "Save changes, then add this revision's files and links." : "Add the VO first, then add files and links to each revision."}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="vo-support">
        <div className="vo-rounds-head">
          <span className="field-label">Supporting documents</span>
        </div>
        {vo ? (
          <>
            <p className="faint tiny" style={{ margin: 0 }}>
              Quotations, drawings, site photos, calculations and anything else behind this VO.
            </p>
            <VoFileBox variationId={vo.id} projectId={vo.project_id} round={null} knownRounds={savedKeys} emptyText="No supporting files yet" />
          </>
        ) : (
          <p className="faint tiny" style={{ margin: 0 }}>
            Add the VO first, then add its supporting files and links.
          </p>
        )}
      </div>

      <Field label="QS remarks" className="full">
        <textarea className="textarea" rows={rowsFor(value.qs_remarks)} value={value.qs_remarks} onChange={(e) => set("qs_remarks", e.target.value)} placeholder="Where it stands and what's next" />
      </Field>
    </div>
  );
}

/** One revision side (or the supporting documents): files and links, and the whole box takes dropped files. */
function VoFileBox({
  title,
  variationId,
  projectId,
  round,
  side,
  knownRounds,
  emptyText = "No files yet",
}: {
  title?: string;
  variationId: string;
  projectId: string;
  round: string | null;
  side?: "sent" | "assessment";
  knownRounds?: string[];
  emptyText?: string;
}) {
  const upload = useRef<((files: File[]) => void) | null>(null);
  return (
    <DropZone className={title ? "vo-side" : "vo-support-box"} onFiles={(fs) => upload.current?.(fs)}>
      {title && <span className="field-label">{title}</span>}
      <Attachments variationId={variationId} projectId={projectId} voRound={round} voSide={side ?? null} compact emptyText={emptyText} knownRounds={knownRounds} uploadRef={upload} />
      <DriveLinks variationId={variationId} projectId={projectId} voRound={round} voSide={side ?? null} compact hint={false} knownRounds={knownRounds} />
    </DropZone>
  );
}

export function ordinal(n: number) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

/** One line for the register: the log's status, the latest revision (and ECJV's figure), and the expected completion. */
export function voLogLine(v: Variation): string {
  const subs = v.submissions ?? [];
  const last = subs[subs.length - 1];
  const name = last?.rev?.trim() || ordinal(subs.length);
  const sent = last ? (last.sent ? `${name} sent ${fmtDate(last.sent)}` : last.sent_note || (last.rev ? name : null)) : null;
  const assessed = last?.assessed_value != null ? `ECJV ${sar(last.assessed_value, { compact: true })}` : null;
  return [v.log_status, sent, assessed, v.expected_completion ? `Expected ${fmtDate(v.expected_completion)}` : null].filter(Boolean).join(" · ");
}
