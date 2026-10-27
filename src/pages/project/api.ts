// Data hooks and helpers for the tasks and projects screens.
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { BOQ_STATUS, PRIORITY, TASK_STATUS, VO_STATUS } from "@/lib/constants";
import { DOW_LONG, addDays, dow, fmtDue, todayISO, weekStart } from "@/lib/time";
import type { Activity, BoqPackage, Profile, RecurringTask, Task, TaskStatus, Variation, VoStatus, BoqStatus } from "@/lib/types";
import { nameList } from "@/lib/people";

export function useVariations(projectId?: string) {
  return useQuery({
    queryKey: ["variations", projectId ?? "all"],
    queryFn: () => {
      let q = supabase.from("variations").select("*");
      if (projectId) q = q.eq("project_id", projectId);
      return unwrap<Variation[]>(q.order("vo_number"));
    },
  });
}

export function useBoq(projectId?: string) {
  return useQuery({
    queryKey: ["boq_packages", projectId ?? "all"],
    queryFn: () => {
      let q = supabase.from("boq_packages").select("*");
      if (projectId) q = q.eq("project_id", projectId);
      return unwrap<BoqPackage[]>(q.order("position").order("created_at"));
    },
  });
}

export function useRecurring(projectId?: string) {
  return useQuery({
    queryKey: ["recurring_tasks", projectId ?? "all"],
    queryFn: () => {
      let q = supabase.from("recurring_tasks").select("*");
      if (projectId) q = q.eq("project_id", projectId);
      return unwrap<RecurringTask[]>(q.order("next_run"));
    },
  });
}

export function useActivity(opts: { projectId?: string; taskId?: string; limit?: number }) {
  return useQuery({
    queryKey: ["activity", opts.projectId ?? "", opts.taskId ?? "", opts.limit ?? 100],
    enabled: !!(opts.projectId || opts.taskId),
    queryFn: () => {
      let q = supabase.from("activity").select("*");
      if (opts.taskId) q = q.eq("task_id", opts.taskId);
      else if (opts.projectId) q = q.eq("project_id", opts.projectId);
      return unwrap<Activity[]>(q.order("created_at", { ascending: false }).limit(opts.limit ?? 100));
    },
  });
}

export function useWatchers(taskId: string | undefined) {
  return useQuery({
    queryKey: ["task_watchers", taskId],
    enabled: !!taskId,
    queryFn: () => unwrap<{ task_id: string; user_id: string }[]>(supabase.from("task_watchers").select("*").eq("task_id", taskId!)),
  });
}

/* ------------------------------------------------------------------ dates */

/** Last working day (Thursday) of the current week; on Friday or Saturday, the coming Thursday. */
export function endOfWorkWeek(today = todayISO()): string {
  const ws = weekStart(today);
  return dow(today) <= 4 ? addDays(ws, 4) : addDays(ws, 11);
}

/** fmtDue for use mid-sentence: "due tomorrow", "due Sun 25 Oct". */
export function dueInline(iso: string | null | undefined): string {
  const s = fmtDue(iso);
  return ["Today", "Tomorrow", "Yesterday", "No date"].includes(s) ? s.toLowerCase() : s;
}

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";
export const DUE_GROUP_LABEL: Record<DueGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No due date",
};

export function dueGroup(t: Pick<Task, "due_date">, today = todayISO()): DueGroup {
  if (!t.due_date) return "none";
  if (t.due_date < today) return "overdue";
  if (t.due_date === today) return "today";
  if (t.due_date <= endOfWorkWeek(today)) return "week";
  return "later";
}

export function frequencyLabel(r: Pick<RecurringTask, "frequency" | "weekday" | "month_day">): string {
  if (r.frequency === "daily") return "Every working day";
  if (r.frequency === "weekly") return `Every ${DOW_LONG[r.weekday ?? 0]}`;
  const d = r.month_day ?? 1;
  const suffix = d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th";
  return `Monthly on the ${d}${suffix}`;
}

/* ------------------------------------------------------------------ variations */

export const VO_PENDING: VoStatus[] = ["identified", "requested", "quoted", "evaluation", "recommended", "disputed"];
export const VO_APPROVED: VoStatus[] = ["approved", "agreed", "closed"];

export function voTotals(vos: Variation[]) {
  let pending = 0;
  let approved = 0;
  let pendingCount = 0;
  let approvedCount = 0;
  for (const v of vos) {
    if (VO_APPROVED.includes(v.status)) {
      approved += v.approved_value ?? v.assessed_value ?? v.submitted_value ?? 0;
      approvedCount++;
    } else if (VO_PENDING.includes(v.status)) {
      pending += v.assessed_value ?? v.submitted_value ?? 0;
      pendingCount++;
    }
  }
  return { pending, approved, pendingCount, approvedCount };
}

export function nextVoNumber(vos: Variation[]): string {
  let max = 0;
  for (const v of vos) {
    const m = /(\d+)\s*$/.exec(v.vo_number);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `VO-${String(max + 1).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ activity sentences */

type PersonLookup = (id: string | null | undefined) => Profile | undefined;

function statusSentence(from: TaskStatus, to: TaskStatus, note: unknown, obj: string, stage?: unknown, finishedHere?: unknown): string {
  if (to === "in_review") return stage === "final" ? `sent ${obj} for the final OK` : `submitted ${obj} for review`;
  if (to === "done" && finishedHere) return from === "in_review" ? `approved and finished ${obj}` : `marked ${obj} done and finished it`;
  if (to === "done") return from === "in_review" ? `approved ${obj}` : `marked ${obj} done`;
  if (from === "done") return `reopened ${obj}`;
  if (from === "in_review" && note) return `asked for changes on ${obj}: "${String(note)}"`;
  if (from === "in_review") return `pulled ${obj} back from review`;
  if (from === "todo" && to === "in_progress") return `started work on ${obj}`;
  return `moved ${obj} to ${TASK_STATUS[to]?.label ?? to}`;
}

/**
 * Turn an activity row into a short sentence (without the actor's name).
 * In a task context the task is "it"; in a project context pass the task title so it is named.
 */
export function activitySentence(a: Activity, people: PersonLookup, taskTitle?: string): string {
  const d = a.details as Record<string, unknown>;
  const obj = taskTitle ? `"${taskTitle}"` : "it";
  if (a.entity === "task") {
    switch (a.action) {
      case "created": {
        const ids = Array.isArray(d.assignees) ? (d.assignees as string[]) : d.assignee_id ? [d.assignee_id as string] : [];
        const who = nameList(ids.map((id) => people(id)?.short_name ?? "someone"));
        return `${taskTitle ? `created ${obj}` : "created this task"}${who ? ` for ${who}` : ""}`;
      }
      case "reassigned": {
        // Newer rows say who was added and who was taken off; older ones only "to".
        if (Array.isArray(d.added) || Array.isArray(d.removed)) {
          const added = nameList(((d.added as string[]) ?? []).map((id) => people(id)?.short_name ?? "someone"));
          const removed = nameList(((d.removed as string[]) ?? []).map((id) => people(id)?.short_name ?? "someone"));
          const parts = [added && `added ${added} to ${obj}`, removed && `took ${removed} off ${obj}`].filter(Boolean);
          return parts.join(" and ") || `changed who's on ${obj}`;
        }
        const to = people(d.to as string)?.short_name;
        return to ? `reassigned ${obj} to ${to}` : `unassigned ${obj}`;
      }
      case "status":
        return statusSentence(d.from as TaskStatus, d.to as TaskStatus, d.note, obj, d.stage, d.finished_by_first);
      case "first_ok": {
        const fin = people(d.final as string)?.short_name;
        return `approved ${obj} and sent it to ${fin ?? "the final checker"} for the final OK`;
      }
      case "due_changed":
        return d.to ? `moved the due date${taskTitle ? ` of ${obj}` : ""} to ${fmtDue(d.to as string)}` : `removed the due date${taskTitle ? ` of ${obj}` : ""}`;
      case "priority":
        return `set ${taskTitle ? `${obj} to` : "the priority to"} ${PRIORITY[d.to as keyof typeof PRIORITY]?.label ?? d.to}${taskTitle ? " priority" : ""}`;
      case "edited":
        return `edited the details${taskTitle ? ` of ${obj}` : ""}`;
      case "request_approved": {
        const by = people(d.by as string)?.short_name;
        return `approved ${obj}${by ? `, made by ${by}` : ""}`;
      }
      case "hold": {
        const why = d.reason ? `: ${d.reason as string}` : "";
        if (d.to === "asked") return `asked to put ${obj} on hold${why}`;
        if (d.to === "on") return `put ${obj} on hold${why}`;
        if (d.from === "on") return `took ${obj} off hold`;
        return `kept ${obj} going (not on hold)`;
      }
      default:
        return `updated ${obj}`;
    }
  }
  if (a.entity === "variation") {
    const vo = `${d.vo_number ?? "a VO"}`;
    if (a.action === "created") return `added ${vo}${d.title ? ` "${d.title}"` : ""}`;
    if (a.action === "status") return `moved ${vo} to ${VO_STATUS[d.to as VoStatus]?.label ?? d.to}`;
    if (a.action === "values") return `updated the values on ${vo}`;
    return `updated ${vo}`;
  }
  if (a.entity === "boq") {
    const name = `${d.name ?? "a BOQ package"}`;
    if (a.action === "created") return `added the ${name} BOQ package`;
    if (a.action === "status") return `moved ${name} to ${BOQ_STATUS[d.to as BoqStatus]?.label ?? d.to}`;
    return `updated ${name}`;
  }
  return a.action;
}
