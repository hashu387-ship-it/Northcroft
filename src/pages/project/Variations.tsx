import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileDiff, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useInvalidate, usePeople } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { VO_STATUS, VO_STATUS_ORDER } from "@/lib/constants";
import { num, parseMoney, pct, plural, sar } from "@/lib/format";
import { errorMessage, supabase } from "@/lib/supabase";
import { dateOf, dueState, fmtDate, fmtDue, todayISO } from "@/lib/time";
import type { Project, Variation, VoStatus } from "@/lib/types";
import { Avatar, Empty, Field, Loading, PersonSelect, Pill, Segmented, Sheet, useConfirm, useToast } from "@/components/ui";
import { VO_APPROVED, VO_PENDING, dueInline, nextVoNumber, useVariations, voTotals } from "./api";

type Filter = "all" | "pending" | "approved" | "closed_out";
const INITIATORS = ["Client", "Engineer", "Contractor", "Consultant", "Other"];

/** Cumulative VOs as a share of the contract, against the 10% and 20% marks. */
export function VoMeter({ approved, pending, contract }: { approved: number; pending: number; contract: number | null }) {
  if (!contract) return <p className="muted small">Add a contract value to the project to see VOs as a percentage of the contract.</p>;
  const scale = Math.max(25, Math.ceil(((approved + pending) / contract) * 100 / 5) * 5 + 5);
  const aPct = (approved / contract) * 100;
  const pPct = (Math.max(0, pending) / contract) * 100;
  const total = aPct + pPct;
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / scale) * 100))}%`;
  const over = total > 20 ? "var(--red)" : total > 10 ? "var(--orange)" : "var(--green)";
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="small muted">VOs as % of contract value</span>
        <b className="num" style={{ color: over }}>{pct(total)}</b>
      </div>
      <div className="vo-meter">
        <div className="mark" style={{ left: w(10) }}>
          <span>10%</span>
        </div>
        <div className="mark" style={{ left: w(20) }}>
          <span>20%</span>
        </div>
        <div className="track">
          <i style={{ width: w(aPct), background: "var(--green)" }} />
          <i style={{ width: w(pPct), background: "var(--orange)", opacity: 0.75 }} />
        </div>
      </div>
      <div className="vo-legend">
        <span><i style={{ background: "var(--green)" }} />Approved {pct(aPct)}</span>
        <span><i style={{ background: "var(--orange)", opacity: 0.75 }} />Pending {pct(pPct)}</span>
        <span>The new procurement law lifts the cap on increases from 10% to 20% of the contract value.</span>
      </div>
    </div>
  );
}

export function Variations({ project }: { project: Project }) {
  const { canAssign } = useAuth();
  const people = usePeople();
  const { data: vos = [], isLoading } = useVariations(project.id);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Variation | null>(null);
  const [creating, setCreating] = useState(false);

  // Deep link: /projects/:id/variations?vo=<id>
  const voParam = params.get("vo");
  useEffect(() => {
    if (!voParam || !vos.length) return;
    const v = vos.find((x) => x.id === voParam);
    if (v) setEditing(v);
  }, [voParam, vos]);

  const close = () => {
    setEditing(null);
    setCreating(false);
    if (voParam) {
      params.delete("vo");
      setParams(params, { replace: true });
    }
  };

  const shown = useMemo(() => {
    const list = filter === "all" ? vos : vos.filter((v) => VO_STATUS[v.status].group === filter);
    return [...list].sort((a, b) => a.vo_number.localeCompare(b.vo_number, undefined, { numeric: true }));
  }, [vos, filter]);
  const totals = voTotals(vos);
  const submittedPending = vos.filter((v) => VO_PENDING.includes(v.status)).reduce((s, v) => s + (v.submitted_value ?? 0), 0);
  const assessedPending = vos.filter((v) => VO_PENDING.includes(v.status)).reduce((s, v) => s + (v.assessed_value ?? 0), 0);
  const approvedTotal = vos.filter((v) => VO_APPROVED.includes(v.status)).reduce((s, v) => s + (v.approved_value ?? 0), 0);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="vo-stats">
        <div className="glass stat">
          <span className="label">Approved</span>
          <span className="value">{sar(totals.approved, { compact: true, blank: "SAR 0" })}</span>
          <span className="hint">{plural(totals.approvedCount, "VO")}</span>
        </div>
        <div className="glass stat">
          <span className="label">Pending</span>
          <span className="value">{sar(totals.pending, { compact: true, blank: "SAR 0" })}</span>
          <span className="hint">{plural(totals.pendingCount, "VO")}, at assessed value where known</span>
        </div>
        <div className="glass card">
          <VoMeter approved={totals.approved} pending={totals.pending} contract={project.contract_value} />
        </div>
      </div>

      <div className="view-head">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: vos.length },
            { value: "pending", label: "Pending", count: vos.filter((v) => VO_STATUS[v.status].group === "pending").length },
            { value: "approved", label: "Approved", count: vos.filter((v) => VO_STATUS[v.status].group === "approved").length },
            { value: "closed_out", label: "Rejected", count: vos.filter((v) => VO_STATUS[v.status].group === "closed_out").length },
          ]}
        />
        <span className="spacer" />
        <span className="faint small hide-mobile">Values in SAR</span>
        <button className="btn primary small" onClick={() => setCreating(true)}>
          <Plus /> Add VO
        </button>
      </div>

      {isLoading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="glass">
          <Empty icon={<FileDiff />} title={vos.length ? "No VOs in this view" : "No variations yet"} action={!vos.length ? <button className="btn primary" onClick={() => setCreating(true)}><Plus /> Add the first VO</button> : undefined} />
        </div>
      ) : (
        <>
          <div className="solid vo-table" style={{ padding: 0, overflow: "hidden" }}>
            <div className="table-wrap" style={{ borderRadius: 0 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>VO</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th className="r">Submitted</th>
                    <th className="r">Assessed</th>
                    <th className="r">Approved</th>
                    <th>Next action</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((v) => {
                    const late = VO_PENDING.includes(v.status) && dueState(v.response_due) === "overdue";
                    return (
                      <tr key={v.id} className="clickable" onClick={() => setEditing(v)}>
                        <td className="bold nowrap">{v.vo_number}</td>
                        <td style={{ maxWidth: 230 }}>
                          <div className="ellipsis" title={v.title}>{v.title}</div>
                          {v.initiated_by && <div className="faint tiny">Raised by {v.initiated_by}</div>}
                        </td>
                        <td>
                          <Pill tone={VO_STATUS[v.status].tone}>{VO_STATUS[v.status].label}</Pill>
                        </td>
                        <td className="r money">{num(v.submitted_value)}</td>
                        <td className="r money">{num(v.assessed_value)}</td>
                        <td className="r money bold">{num(v.approved_value)}</td>
                        <td className={clsx("nowrap", late && "danger-text bold")}>
                          {v.response_due && VO_PENDING.includes(v.status) ? fmtDue(v.response_due) : "–"}
                        </td>
                        <td>
                          <Avatar person={people.get(v.owner_id)} size={26} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>
                      Totals
                      <div className="faint tiny" style={{ fontWeight: 500 }}>Submitted and assessed count pending VOs only</div>
                    </td>
                    <td className="r money" title="Submitted value of pending VOs">{num(submittedPending)}</td>
                    <td className="r money" title="Assessed value of pending VOs">{num(assessedPending)}</td>
                    <td className="r money">{num(approvedTotal)}</td>
                    <td colSpan={2} className="muted small">
                      {project.contract_value ? `${pct((approvedTotal / project.contract_value) * 100)} of contract approved` : ""}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="vo-cards">
            {shown.map((v) => {
              const late = VO_PENDING.includes(v.status) && dueState(v.response_due) === "overdue";
              return (
                <button key={v.id} className="vo-card" onClick={() => setEditing(v)}>
                  <div className="row">
                    <b>{v.vo_number}</b>
                    <Pill tone={VO_STATUS[v.status].tone}>{VO_STATUS[v.status].label}</Pill>
                    <span className="spacer" />
                    <Avatar person={people.get(v.owner_id)} size={24} />
                  </div>
                  <div style={{ fontWeight: 550 }}>{v.title}</div>
                  <div className="vals">
                    <span>Submitted<b>{sar(v.submitted_value, { compact: true })}</b></span>
                    <span>Assessed<b>{sar(v.assessed_value, { compact: true })}</b></span>
                    <span>Approved<b>{sar(v.approved_value, { compact: true })}</b></span>
                  </div>
                  {v.response_due && VO_PENDING.includes(v.status) && (
                    <span className={clsx("small", late ? "danger-text bold" : "muted")}>Next action {late ? "was due" : "due"} {dueInline(v.response_due)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      <VoSheet
        open={creating || !!editing}
        onClose={close}
        project={project}
        vo={editing}
        suggestedNumber={nextVoNumber(vos)}
        canDelete={canAssign}
      />
    </div>
  );
}

function VoSheet({
  open,
  onClose,
  project,
  vo,
  suggestedNumber,
  canDelete,
}: {
  open: boolean;
  onClose: () => void;
  project: Project;
  vo: Variation | null;
  suggestedNumber: string;
  canDelete: boolean;
}) {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [f, setF] = useState({
    vo_number: "",
    title: "",
    description: "",
    status: "identified" as VoStatus,
    initiated_by: "Client",
    submitted_value: "",
    assessed_value: "",
    approved_value: "",
    submitted_date: "",
    approved_date: "",
    response_due: "",
    owner_id: null as string | null,
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setF({
      vo_number: vo?.vo_number ?? suggestedNumber,
      title: vo?.title ?? "",
      description: vo?.description ?? "",
      status: vo?.status ?? "identified",
      initiated_by: vo?.initiated_by ?? "Client",
      submitted_value: vo?.submitted_value != null ? String(vo.submitted_value) : "",
      assessed_value: vo?.assessed_value != null ? String(vo.assessed_value) : "",
      approved_value: vo?.approved_value != null ? String(vo.approved_value) : "",
      submitted_date: vo?.submitted_date ?? "",
      approved_date: vo?.approved_date ?? "",
      response_due: vo?.response_due ?? "",
      owner_id: vo?.owner_id ?? me.id,
      notes: vo?.notes ?? "",
    });
  }, [open, vo?.id]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!f.vo_number.trim() || !f.title.trim()) {
      toast("Add a VO number and a short description", "error");
      return;
    }
    setSaving(true);
    const row = {
      vo_number: f.vo_number.trim(),
      title: f.title.trim(),
      description: f.description.trim() || null,
      status: f.status,
      initiated_by: f.initiated_by || null,
      submitted_value: parseMoney(f.submitted_value),
      assessed_value: parseMoney(f.assessed_value),
      approved_value: parseMoney(f.approved_value),
      submitted_date: f.submitted_date || null,
      approved_date: f.approved_date || (VO_APPROVED.includes(f.status) ? todayISO() : null),
      response_due: f.response_due || null,
      owner_id: f.owner_id,
      notes: f.notes.trim() || null,
    };
    try {
      const { error } = vo
        ? await supabase.from("variations").update(row).eq("id", vo.id)
        : await supabase.from("variations").insert({ ...row, project_id: project.id, created_by: me.id });
      if (error) throw error;
      toast(vo ? `${row.vo_number} updated` : `${row.vo_number} added`);
      invalidate("variations", "activity");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!vo) return;
    const ok = await confirm({ title: `Delete ${vo.vo_number}?`, message: "It is removed from the register. This can't be undone.", confirmLabel: "Delete VO", danger: true });
    if (!ok) return;
    const { error } = await supabase.from("variations").delete().eq("id", vo.id);
    if (error) {
      toast(errorMessage(error), "error");
      return;
    }
    toast(`${vo.vo_number} deleted`);
    invalidate("variations");
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={vo ? `${vo.vo_number} · ${vo.title}` : "New variation"}
      wide
      footer={
        <>
          {vo && canDelete && (
            <button className="btn danger" onClick={remove} style={{ marginRight: "auto" }}>
              <Trash2 /> Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : vo ? "Save changes" : "Add VO"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="VO number">
          <input className="input" value={f.vo_number} onChange={(e) => set("vo_number", e.target.value)} />
        </Field>
        <Field label="Status">
          <select className="select" value={f.status} onChange={(e) => set("status", e.target.value as VoStatus)}>
            {VO_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {VO_STATUS[s].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Short description" className="full">
          <input className="input" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Additional glass partitions on L18" />
        </Field>
        <Field label="Raised by">
          <select className="select" value={f.initiated_by} onChange={(e) => set("initiated_by", e.target.value)}>
            {INITIATORS.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </Field>
        <Field label="Owner on our team">
          <PersonSelect value={f.owner_id} onChange={(v) => set("owner_id", v)} people={people.active} placeholder="Nobody yet" />
        </Field>
        <Field label="Submitted value (SAR)" hint="Contractor's quotation">
          <input className="input" inputMode="decimal" value={f.submitted_value} onChange={(e) => set("submitted_value", e.target.value)} placeholder="0" />
        </Field>
        <Field label="Assessed value (SAR)" hint="Our evaluation">
          <input className="input" inputMode="decimal" value={f.assessed_value} onChange={(e) => set("assessed_value", e.target.value)} placeholder="0" />
        </Field>
        <Field label="Approved value (SAR)" hint="Use a minus for omissions">
          <input className="input" inputMode="decimal" value={f.approved_value} onChange={(e) => set("approved_value", e.target.value)} placeholder="0" />
        </Field>
        <Field label="Next action due" hint="Quotation, evaluation or determination deadline. Reminders go to the owner.">
          <input className="input" type="date" value={f.response_due} onChange={(e) => set("response_due", e.target.value)} />
        </Field>
        <Field label="Date submitted">
          <input className="input" type="date" value={f.submitted_date} onChange={(e) => set("submitted_date", e.target.value)} />
        </Field>
        <Field label="Date approved">
          <input className="input" type="date" value={f.approved_date} onChange={(e) => set("approved_date", e.target.value)} />
        </Field>
        <Field label="Details" className="full">
          <textarea className="textarea" value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Scope of the change, instruction reference, drawings" />
        </Field>
        <Field label="Notes" className="full">
          <textarea className="textarea" value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Negotiation notes, contract clause, anything to remember" style={{ minHeight: 70 }} />
        </Field>
        {vo && (
          <p className="faint tiny full">
            Added {fmtDate(dateOf(vo.created_at), { day: "numeric", month: "short", year: "numeric" })}
            {vo.created_by ? ` by ${people.get(vo.created_by)?.short_name ?? "someone"}` : ""}.
          </p>
        )}
      </div>
    </Sheet>
  );
}
