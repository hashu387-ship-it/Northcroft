import { Repeat, Trash2 } from "lucide-react";
import { useInvalidate, usePeople, useProjectMap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import type { RecurringTask } from "@/lib/types";
import { Avatar, Empty, Loading, PriorityFlag, ProjectTag, Switch, useConfirm, useToast } from "@/components/ui";
import { dueInline, frequencyLabel, useRecurring } from "./api";

/** Repeating task rules, for one project or (without projectId) for everyone. */
export function RecurringList({ projectId, showProject = false, hideWhenEmpty = false }: { projectId?: string; showProject?: boolean; hideWhenEmpty?: boolean }) {
  const { canAssign } = useAuth();
  const people = usePeople();
  const projects = useProjectMap();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const { data: rules = [], isLoading } = useRecurring(projectId);

  async function setActive(r: RecurringTask, active: boolean) {
    const { error } = await supabase.from("recurring_tasks").update({ active }).eq("id", r.id);
    if (error) toast(errorMessage(error), "error");
    else toast(active ? `"${r.title}" will repeat again` : `"${r.title}" is paused`, "info");
    invalidate("recurring_tasks");
  }

  async function remove(r: RecurringTask) {
    const ok = await confirm({
      title: "Stop this repeating task?",
      message: `"${r.title}" won't be created again. Tasks it already made stay as they are.`,
      confirmLabel: "Delete rule",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("recurring_tasks").delete().eq("id", r.id);
    if (error) toast(errorMessage(error), "error");
    else toast("Repeating task deleted");
    invalidate("recurring_tasks");
  }

  if (isLoading) return <Loading />;
  if (!rules.length) {
    if (hideWhenEmpty) return null;
    return (
      <Empty icon={<Repeat />} title="No repeating tasks">
        {canAssign ? "When you create a task, choose Weekly or Monthly under Repeat to set one up." : "Repeating tasks set up by Hassan or a senior show here."}
      </Empty>
    );
  }

  return (
    <div className="list">
      {rules.map((r) => {
        const who = people.get(r.assignee_id);
        return (
          <div key={r.id} className="list-item rec-item" style={{ opacity: r.active ? 1 : 0.6 }}>
            <span className="icon-btn small hide-mobile" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} aria-hidden>
              <Repeat />
            </span>
            <div className="grow">
              <div className="title" style={{ whiteSpace: "normal" }}>{r.title}</div>
              <div className="meta">
                <span>{frequencyLabel(r)}</span>
                <span>{r.active ? `Next ${dueInline(r.next_run)}` : "Paused"}</span>
                {showProject && <ProjectTag project={projects.get(r.project_id)} />}
                <span className="hide-desktop">{who ? `For ${who.short_name}` : "Unassigned"}</span>
                <PriorityFlag priority={r.priority} />
              </div>
            </div>
            <span className="hide-mobile">
              <Avatar person={who} size={28} />
            </span>
            {canAssign && (
              <>
                <Switch checked={r.active} onChange={(v) => setActive(r, v)} label={r.active ? "Pause" : "Resume"} />
                <button className="icon-btn small plain" onClick={() => remove(r)} aria-label={`Delete repeating task ${r.title}`}>
                  <Trash2 />
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
