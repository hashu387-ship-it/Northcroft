// The VO log details of a variation: the log's reference and status, scope, key dates, each
// submission to the main contractor with their response, and the QS remarks. Edited in the VO form
// and shown in the register, so the team keeps the log here instead of in a spreadsheet.
import { Plus, X } from "lucide-react";
import { Field } from "@/components/ui";
import { addDays, fmtDate } from "@/lib/time";
import type { Variation, VoSubmission } from "@/lib/types";

export interface VoLogForm {
  log_ref: string;
  log_status: string;
  scope: string;
  instruction_date: string;
  contract_due: string;
  expected_completion: string;
  qs_remarks: string;
  submissions: { sent: string; sent_note: string; response: string; response_on: string }[];
}

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
      sent: x.sent ?? "",
      sent_note: x.sent_note ?? "",
      response: x.response ?? "",
      response_on: x.response_on ?? "",
    })),
  };
}

/** What gets saved: blanks become empty, empty rounds are dropped. */
export function voLogRow(f: VoLogForm) {
  const t = (s: string) => s.trim() || null;
  const submissions: VoSubmission[] = f.submissions
    .map((x) => ({ sent: x.sent || null, sent_note: t(x.sent_note), response: t(x.response), response_on: x.response_on || null }))
    .filter((x) => x.sent || x.sent_note || x.response || x.response_on);
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

export function VoLogFields({ value, onChange }: { value: VoLogForm; onChange: (v: VoLogForm) => void }) {
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
          <span className="field-label">Submissions and ECJV responses</span>
          <button
            type="button"
            className="btn small"
            onClick={() => set("submissions", [...value.submissions, { sent: "", sent_note: "", response: "", response_on: "" }])}
            disabled={value.submissions.length >= 20}
          >
            <Plus /> Add submission
          </button>
        </div>
        {value.submissions.length === 0 && <p className="faint small vo-rounds-empty">Nothing sent yet. Add a submission when it goes to ECJV.</p>}
        {value.submissions.map((x, i) => (
          <div className="vo-round" key={i}>
            <div className="vo-round-top">
              <span className="vo-round-n">{ordinal(i + 1)} submission</span>
              <button type="button" className="icon-btn small plain" onClick={() => set("submissions", value.submissions.filter((_, j) => j !== i))} aria-label={`Take the ${ordinal(i + 1)} submission off`}>
                <X />
              </button>
            </div>
            <div className="form-grid">
              <Field label="Sent on">
                <input className="input" type="date" value={x.sent} onChange={(e) => setRound(i, { sent: e.target.value })} />
              </Field>
              <Field label="Or a note instead of a date">
                <input className="input" value={x.sent_note} onChange={(e) => setRound(i, { sent_note: e.target.value })} placeholder="What the log says when there's no date" />
              </Field>
              <Field label="ECJV response" className="full">
                <textarea className="textarea" rows={rowsFor(x.response)} value={x.response} onChange={(e) => setRound(i, { response: e.target.value })} placeholder="What ECJV replied" />
              </Field>
              <Field label="Response date">
                <input className="input" type="date" value={x.response_on} onChange={(e) => setRound(i, { response_on: e.target.value })} />
              </Field>
            </div>
          </div>
        ))}
      </div>

      <Field label="QS remarks" className="full">
        <textarea className="textarea" rows={rowsFor(value.qs_remarks)} value={value.qs_remarks} onChange={(e) => set("qs_remarks", e.target.value)} placeholder="Where it stands and what's next" />
      </Field>
    </div>
  );
}

export function ordinal(n: number) {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

/** One line for the register: the log's status, the latest submission and the expected completion. */
export function voLogLine(v: Variation): string {
  const subs = v.submissions ?? [];
  const last = subs[subs.length - 1];
  const sent = last ? (last.sent ? `${ordinal(subs.length)} sent ${fmtDate(last.sent)}` : last.sent_note) : null;
  return [v.log_status, sent, v.expected_completion ? `Expected ${fmtDate(v.expected_completion)}` : null].filter(Boolean).join(" · ");
}
