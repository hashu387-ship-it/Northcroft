import { useState, type FormEvent } from "react";
import { Check, ListChecks, Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useChecklist, useInvalidate, usePeople } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import type { ChecklistItem, Task } from "@/lib/types";
import { Progress, useToast } from "@/components/ui";

export function Checklist({ task }: { task: Task }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { data: items = [], isLoading } = useChecklist(task.id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const canManage = canAssign || task.assignee_id === me.id;
  const doneCount = items.filter((i) => i.done).length;

  async function run(p: PromiseLike<{ error: unknown }>) {
    const { error } = await p;
    if (error) toast(errorMessage(error), "error");
    invalidate("task_checklist");
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    const position = items.reduce((m, i) => Math.max(m, i.position), 0) + 1;
    await run(supabase.from("task_checklist").insert({ task_id: task.id, text: t, position }));
    setText("");
    setBusy(false);
  }

  const toggle = (i: ChecklistItem) => run(supabase.from("task_checklist").update({ done: !i.done }).eq("id", i.id));
  const assign = (i: ChecklistItem, id: string | null) => run(supabase.from("task_checklist").update({ assignee_id: id }).eq("id", i.id));
  const remove = (i: ChecklistItem) => run(supabase.from("task_checklist").delete().eq("id", i.id));

  if (isLoading) return null;
  if (!items.length && !canManage) return null;

  return (
    <div className="glass card">
      <div className="card-head">
        <h3>
          <ListChecks /> Checklist
        </h3>
        {items.length > 0 && (
          <span className="muted small">
            {doneCount} of {items.length} done
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <Progress value={(doneCount / items.length) * 100} color={doneCount === items.length ? "var(--green)" : undefined} />
        </div>
      )}
      {items.map((i) => {
        const canToggle = canManage || i.assignee_id === me.id;
        const owner = people.get(i.assignee_id);
        return (
          <div key={i.id} className={clsx("cl-item", i.done && "done")}>
            <button
              type="button"
              className={clsx("cl-check", i.done && "on")}
              onClick={() => toggle(i)}
              disabled={!canToggle}
              aria-label={i.done ? `Mark "${i.text}" as not done` : `Mark "${i.text}" as done`}
            >
              {i.done && <Check strokeWidth={3} />}
            </button>
            <span className="cl-text">
              <span className="cl-label">{i.text}</span>
              <span className="cl-meta">
                {canManage ? (
                  <select
                    className="cl-assign"
                    value={i.assignee_id ?? ""}
                    onChange={(e) => assign(i, e.target.value || null)}
                    aria-label={`Who does "${i.text}"`}
                  >
                    <option value="">Anyone</option>
                    {people.assignableBy(me.id, i.assignee_id).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.short_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  owner && <span>{owner.short_name}</span>
                )}
                {i.done && i.done_by && <span>Done by {people.get(i.done_by)?.short_name ?? "someone"}</span>}
              </span>
            </span>
            {canManage && (
              <button type="button" className="icon-btn small plain" onClick={() => remove(i)} aria-label={`Delete "${i.text}"`}>
                <Trash2 />
              </button>
            )}
          </div>
        );
      })}
      {canManage && (
        <form className="cl-add" onSubmit={add}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a step" aria-label="New checklist step" />
          <button className="btn" type="submit" disabled={busy || !text.trim()}>
            <Plus /> Add
          </button>
        </form>
      )}
    </div>
  );
}
