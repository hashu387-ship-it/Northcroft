// Shared data hooks. Query keys always start with the table name so live updates can refresh them.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "./supabase";
import type { AppSettings, ChecklistItem, Profile, Project, Task } from "./types";

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export function useProfiles() {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: () => unwrap<Profile[]>(supabase.from("profiles").select("*").order("full_name")),
    staleTime: 60_000,
  });
}

/** People helpers: active list sorted (manager first) and lookup by id. */
export function usePeople() {
  const q = useProfiles();
  return useMemo(() => {
    const all = q.data ?? [];
    const byId = new Map(all.map((p) => [p.id, p]));
    const active = all
      .filter((p) => p.active)
      .sort((a, b) => (a.role === b.role ? a.short_name.localeCompare(b.short_name) : a.role === "manager" ? -1 : 1));
    const assigners = active.filter((p) => p.role === "manager" || p.can_assign);
    // People who check in (the attendance board, map, late list and monthly export).
    const attenders = active.filter((p) => !p.attendance_exempt);
    /** Who `meId` can give a task to: everyone who takes tasks, plus themselves, plus whoever has it now. */
    const assignableBy = (meId: string, current?: string | null) =>
      active.filter((p) => p.assignable !== false || p.id === meId || p.id === current);
    return {
      all,
      active,
      assigners,
      attenders,
      assignableBy,
      byId,
      get: (id: string | null | undefined) => (id ? byId.get(id) : undefined),
      loading: q.isLoading,
    };
  }, [q.data, q.isLoading]);
}

export function useSettings() {
  return useQuery({
    queryKey: ["app_settings"],
    queryFn: () => unwrap<AppSettings>(supabase.from("app_settings").select("*").eq("id", 1).single()),
    staleTime: 5 * 60_000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: () => unwrap<Project[]>(supabase.from("projects").select("*").order("status").order("name")),
    staleTime: 60_000,
  });
}

export function useProjectMap() {
  const q = useProjects();
  return useMemo(() => {
    const list = q.data ?? [];
    const byId = new Map(list.map((p) => [p.id, p]));
    return { list, byId, get: (id: string | null | undefined) => (id ? byId.get(id) : undefined), loading: q.isLoading };
  }, [q.data, q.isLoading]);
}

export interface TaskFilter {
  projectId?: string;
  assigneeId?: string;
  reviewerId?: string;
  createdBy?: string;
  openOnly?: boolean;
}

export function useTasks(filter: TaskFilter = {}) {
  return useQuery({
    queryKey: ["tasks", filter],
    queryFn: async () => {
      // Tasks a team member made that are still waiting for approval (or were turned down) aren't
      // work yet; they show in their own lists (useTaskRequests).
      let q = supabase.from("tasks").select("*").is("approval", null);
      if (filter.projectId) q = q.eq("project_id", filter.projectId);
      // Tasks this person is on (alone or with others).
      if (filter.assigneeId) q = q.contains("assignees", [filter.assigneeId]);
      if (filter.reviewerId) q = q.eq("reviewer_id", filter.reviewerId);
      if (filter.createdBy) q = q.eq("created_by", filter.createdBy);
      if (filter.openOnly) q = q.neq("status", "done");
      q = q.order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(1000);
      return unwrap<Task[]>(q);
    },
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ["tasks", "one", id],
    enabled: !!id,
    queryFn: () => unwrap<Task | null>(supabase.from("tasks").select("*").eq("id", id!).maybeSingle()),
  });
}

export function useChecklist(taskId: string | undefined) {
  return useQuery({
    queryKey: ["task_checklist", taskId],
    enabled: !!taskId,
    queryFn: () =>
      unwrap<ChecklistItem[]>(
        supabase.from("task_checklist").select("*").eq("task_id", taskId!).is("removed_at", null).order("position").order("created_at"),
      ),
  });
}

/** Checklist progress for many tasks at once: { taskId: [done, total] }. */
export function useChecklistCounts(taskIds: string[]) {
  const key = taskIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["task_checklist", "counts", key],
    enabled: taskIds.length > 0,
    queryFn: async () => {
      const rows = await unwrap<{ task_id: string; done: boolean }[]>(
        supabase.from("task_checklist").select("task_id, done").in("task_id", taskIds).is("removed_at", null),
      );
      const out: Record<string, [number, number]> = {};
      for (const r of rows) {
        const c = (out[r.task_id] ||= [0, 0]);
        c[1]++;
        if (r.done) c[0]++;
      }
      return out;
    },
  });
}

export function useUnreadCount(userId: string | undefined) {
  return useQuery({
    queryKey: ["notifications", "unread", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId!)
        .is("read_at", null)
        .is("archived_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Refresh every query that reads from these tables. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...tables: string[]) => Promise.all(tables.map((t) => qc.invalidateQueries({ queryKey: [t] })));
}

export { unwrap };
