import { useEffect, useState } from "react";
import { ArrowRight, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useInvalidate, usePeople } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BOQ_STATUS, BOQ_STATUS_ORDER } from "@/lib/constants";
import { parseMoney, sar } from "@/lib/format";
import { errorMessage, supabase } from "@/lib/supabase";
import { dueState } from "@/lib/time";
import type { BoqPackage, BoqStatus, Project } from "@/lib/types";
import { Avatar, AvatarStack, Empty, Field, Loading, PeopleSelect, Pill, Sheet, useConfirm, useToast } from "@/components/ui";
import { dueInline, useBoq } from "./api";
import { nameList, ownersOf } from "@/lib/people";

const TRADES = ["Civil", "Structure", "Envelope", "Finishes", "MEP", "External works", "Preliminaries", "Other"];

export function Stages({ status }: { status: BoqStatus }) {
  const step = BOQ_STATUS[status].step;
  return (
    <span className={clsx("stages", status === "issued" && "done")} title={BOQ_STATUS[status].label} aria-label={`Stage: ${BOQ_STATUS[status].label}`}>
      {BOQ_STATUS_ORDER.slice(1).map((s, i) => (
        <i key={s} className={clsx(i < step && "on")} />
      ))}
    </span>
  );
}

function nextStatus(s: BoqStatus): BoqStatus | null {
  const i = BOQ_STATUS_ORDER.indexOf(s);
  return i < BOQ_STATUS_ORDER.length - 1 ? BOQ_STATUS_ORDER[i + 1] : null;
}

export function Boq({ project }: { project: Project }) {
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: rows = [], isLoading } = useBoq(project.id);
  const [editing, setEditing] = useState<BoqPackage | null>(null);
  const [creating, setCreating] = useState(false);

  const issued = rows.filter((r) => r.status === "issued").length;
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);

  async function advance(b: BoqPackage) {
    const next = nextStatus(b.status);
    if (!next) return;
    const { error } = await supabase.from("boq_packages").update({ status: next }).eq("id", b.id);
    if (error) toast(errorMessage(error), "error");
    else toast(`${b.name} moved to ${BOQ_STATUS[next].label}`);
    invalidate("boq_packages", "activity");
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="view-head">
        <span className="muted">
          {issued} of {rows.length} packages issued{total ? ` · ${sar(total, { compact: true })} priced so far` : ""}
        </span>
        <span className="spacer" />
        <button className="btn primary small" onClick={() => setCreating(true)}>
          <Plus /> Add package
        </button>
      </div>

      {isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="glass">
          <Empty icon={<Layers />} title="No BOQ packages yet" action={<button className="btn primary" onClick={() => setCreating(true)}><Plus /> Add a package</button>}>
            Split the BOQ into packages (Civil, MEP, Finishes) and track each one from measuring to issue.
          </Empty>
        </div>
      ) : (
        <div className="grid-2">
          {rows.map((b) => {
            const next = nextStatus(b.status);
            const late = b.status !== "issued" && dueState(b.due_date) === "overdue";
            const team = ownersOf(b).map((id) => people.get(id));
            const owner = team[0];
            return (
              <div key={b.id} className="boq-card">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bold">{b.name}</div>
                    <div className="row wrap small muted" style={{ gap: "2px 10px", marginTop: 2 }}>
                      {b.trade && <span>{b.trade}</span>}
                      {b.value != null && <span className="money">{sar(b.value)}</span>}
                    </div>
                  </div>
                  <Pill tone={BOQ_STATUS[b.status].tone}>{BOQ_STATUS[b.status].label}</Pill>
                </div>
                <Stages status={b.status} />
                <div className="row wrap" style={{ gap: 8 }}>
                  <span className="row" style={{ gap: 6 }}>
                    {team.length > 1 ? <AvatarStack people={team} size={22} max={3} /> : <Avatar person={owner} size={24} />}
                    <span className="small">{nameList(team.map((p) => p?.short_name ?? "someone")) || "No owner"}</span>
                  </span>
                  {b.due_date && b.status !== "issued" && (
                    <span className={clsx("small", late ? "danger-text bold" : "muted")}>
                      {late ? "Was due" : "Due"} {dueInline(b.due_date)}
                    </span>
                  )}
                  <span className="spacer" />
                  <button className="icon-btn small plain" onClick={() => setEditing(b)} aria-label={`Edit ${b.name}`}>
                    <Pencil />
                  </button>
                  {next && (
                    <button className="btn small" onClick={() => advance(b)} title={`Move to ${BOQ_STATUS[next].label}`} aria-label={`Move ${b.name} to ${BOQ_STATUS[next].label}`}>
                      {BOQ_STATUS[next].label} <ArrowRight />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BoqSheet open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); }} project={project} pkg={editing} position={rows.length + 1} />
    </div>
  );
}

function BoqSheet({ open, onClose, project, pkg, position }: { open: boolean; onClose: () => void; project: Project; pkg: BoqPackage | null; position: number }) {
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [trade, setTrade] = useState("Civil");
  const [status, setStatus] = useState<BoqStatus>("not_started");
  const [owners, setOwners] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(pkg?.name ?? "");
    setTrade(pkg?.trade ?? "Civil");
    setStatus(pkg?.status ?? "not_started");
    setOwners(pkg ? ownersOf(pkg) : []);
    setDue(pkg?.due_date ?? "");
    setValue(pkg?.value != null ? String(pkg.value) : "");
    setNotes(pkg?.notes ?? "");
  }, [open, pkg]);

  async function save() {
    if (!name.trim()) {
      toast("Name the package", "error");
      return;
    }
    setSaving(true);
    const row = { name: name.trim(), trade: trade || null, status, owners, due_date: due || null, value: parseMoney(value), notes: notes.trim() || null };
    try {
      const { error } = pkg
        ? await supabase.from("boq_packages").update(row).eq("id", pkg.id)
        : await supabase.from("boq_packages").insert({ ...row, project_id: project.id, position });
      if (error) throw error;
      toast(pkg ? "Package updated" : "Package added");
      invalidate("boq_packages", "activity");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!pkg) return;
    if (!(await confirm({ title: `Delete ${pkg.name}?`, confirmLabel: "Delete package", danger: true }))) return;
    const { error } = await supabase.from("boq_packages").delete().eq("id", pkg.id);
    if (error) {
      toast(errorMessage(error), "error");
      return;
    }
    toast("Package deleted");
    invalidate("boq_packages");
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={pkg ? pkg.name : "New BOQ package"}
      footer={
        <>
          {pkg && canAssign && (
            <button className="btn danger" onClick={remove} style={{ marginRight: "auto" }}>
              <Trash2 /> Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : pkg ? "Save changes" : "Add package"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Package" className="full">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Trade">
          <select className="select" value={trade} onChange={(e) => setTrade(e.target.value)}>
            {TRADES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Stage">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as BoqStatus)}>
            {BOQ_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {BOQ_STATUS[s].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owners" className="full" hint="Everyone here gets this package's updates and reminders">
          <PeopleSelect value={owners} onChange={setOwners} people={people.active} empty="Nobody yet" />
        </Field>
        <Field label="Due date">
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Value (SAR)" hint="Once priced">
          <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Notes" className="full">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Drawing revision, exclusions, queries" style={{ minHeight: 70 }} />
        </Field>
      </div>
    </Sheet>
  );
}
