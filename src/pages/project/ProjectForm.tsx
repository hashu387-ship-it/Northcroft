import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import clsx from "clsx";
import { useInvalidate } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { PROJECT_COLORS } from "@/lib/constants";
import { parseMoney } from "@/lib/format";
import { errorMessage, supabase } from "@/lib/supabase";
import type { Project } from "@/lib/types";
import { Field, Sheet, useConfirm, useToast } from "@/components/ui";

export function ProjectForm({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project | null }) {
  const me = useMe();
  const { isManager } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const editing = !!project;

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [city, setCity] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Project["status"]>("active");
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCode(project?.code ?? "");
    setName(project?.name ?? "");
    setClient(project?.client ?? "");
    setCity(project?.city ?? "");
    setValue(project?.contract_value != null ? String(project.contract_value) : "");
    setStatus(project?.status ?? "active");
    setColor(project?.color ?? PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)]);
    setStart(project?.start_date ?? "");
    setEnd(project?.end_date ?? "");
    setDescription(project?.description ?? "");
  }, [open, project]);

  async function save() {
    if (!name.trim()) {
      toast("Give the project a name", "error");
      return;
    }
    setSaving(true);
    const row = {
      code: code.trim() || null,
      name: name.trim(),
      client: client.trim() || null,
      city: city.trim() || null,
      contract_value: parseMoney(value),
      status,
      color,
      start_date: start || null,
      end_date: end || null,
      description: description.trim() || null,
    };
    try {
      if (editing && project) {
        const { error } = await supabase.from("projects").update(row).eq("id", project.id);
        if (error) throw error;
        toast("Project updated");
        onClose();
      } else {
        const { data, error } = await supabase.from("projects").insert({ ...row, created_by: me.id }).select().single();
        if (error) throw error;
        toast("Project created");
        onClose();
        navigate(`/projects/${data.id}`);
      }
      invalidate("projects");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!project) return;
    const ok = await confirm({
      title: `Delete ${project.name}?`,
      message: "All of its tasks, VOs, BOQ packages, chat and files are deleted too. If the job is finished, set it to Completed instead.",
      confirmLabel: "Delete project",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("projects").delete().eq("id", project.id);
    if (error) {
      toast(errorMessage(error), "error");
      return;
    }
    toast("Project deleted");
    onClose();
    invalidate("projects", "tasks");
    navigate("/projects", { replace: true });
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit project" : "New project"}
      wide
      footer={
        <>
          {editing && isManager && (
            <button className="btn danger" onClick={remove} style={{ marginRight: "auto" }}>
              <Trash2 /> Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Create project"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Project name" className="full">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Olaya Business Tower Fit-out" autoFocus={!editing} />
        </Field>
        <Field label="Project code">
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. NC-104" />
        </Field>
        <Field label="Status">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value as Project["status"])}>
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
          </select>
        </Field>
        <Field label="Client">
          <input className="input" value={client} onChange={(e) => setClient(e.target.value)} />
        </Field>
        <Field label="City">
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Riyadh" />
        </Field>
        <Field label="Contract value (SAR)">
          <input className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 48,500,000" />
        </Field>
        <div className="field">
          <span>Colour</span>
          <div className="color-pick">
            {PROJECT_COLORS.map((c) => (
              <button key={c} type="button" className={clsx(c === color && "on")} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} aria-pressed={c === color} />
            ))}
          </div>
        </div>
        <Field label="Start date">
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Completion date">
          <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Notes" className="full">
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Scope, contract form, anything the team should know" />
        </Field>
      </div>
    </Sheet>
  );
}
