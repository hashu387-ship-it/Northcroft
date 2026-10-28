// Daily updates: each day the team says how far their tasks got (%) and what they did on them,
// any other work, and anything blocking them. Setting a task to 100% hands it in for review. The
// database does the work (submit_daily_update in migration 0028); these are the hooks and helpers.
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "./api";
import { supabase } from "./supabase";
import type { DailyUpdate, DailyUpdateItem, DailyUpdateReply, Profile } from "./types";

export type UpdateWithItems = DailyUpdate & { items: DailyUpdateItem[]; replies?: DailyUpdateReply[] };

const KEY = "daily_updates";
// The replies under a blocker come with each update (the database only shows them to whoever
// can see the update).
const SELECT = "*, items:daily_update_items(*), replies:daily_update_replies(*)";

/** Whether this person sends a daily update (the team; not managers, not people who don't check in). */
export function sendsDailyUpdate(p: Pick<Profile, "daily_update" | "attendance_exempt" | "active"> | null | undefined): boolean {
  return !!p && p.active !== false && p.daily_update === true && !p.attendance_exempt;
}

function sortItems(u: UpdateWithItems): UpdateWithItems {
  return {
    ...u,
    items: [...(u.items ?? [])].sort((a, b) => Number(b.handed_in) - Number(a.handed_in) || a.created_at.localeCompare(b.created_at)),
    replies: [...(u.replies ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
  };
}

/** My update for one day, or null if I haven't sent it. */
export function useMyDailyUpdate(userId: string, date: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "mine", userId, date],
    enabled,
    queryFn: async () => {
      const row = await unwrap<UpdateWithItems | null>(
        supabase.from("daily_updates").select(SELECT).eq("user_id", userId).eq("work_date", date).maybeSingle(),
      );
      return row ? sortItems(row) : null;
    },
  });
}

/** My recent updates, newest first. */
export function useMyDailyUpdates(userId: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "history", userId],
    enabled,
    queryFn: async () => {
      const rows = await unwrap<UpdateWithItems[]>(
        supabase.from("daily_updates").select(SELECT).eq("user_id", userId).order("work_date", { ascending: false }).limit(30),
      );
      return rows.map(sortItems);
    },
  });
}

/** Everyone's updates for one day (managers and seniors). */
export function useTeamDailyUpdates(date: string, enabled: boolean) {
  return useQuery({
    queryKey: [KEY, "team", date],
    enabled,
    queryFn: async () => {
      const rows = await unwrap<UpdateWithItems[]>(supabase.from("daily_updates").select(SELECT).eq("work_date", date));
      return rows.map(sortItems);
    },
  });
}

/** Updates that mention one task, newest first: the task's progress history. */
export function useTaskProgressHistory(taskId: string | undefined) {
  return useQuery({
    queryKey: [KEY, "task", taskId],
    enabled: !!taskId,
    queryFn: () =>
      unwrap<(DailyUpdateItem & { update: Pick<DailyUpdate, "user_id" | "work_date"> | null })[]>(
        supabase
          .from("daily_update_items")
          .select("*, update:daily_updates(user_id, work_date)")
          .eq("task_id", taskId!)
          .order("created_at", { ascending: false })
          .limit(30),
      ),
  });
}

export interface UpdateLine {
  task_id: string;
  progress: number;
  note: string;
}

/** Send (or send again) today's update. Returns how many tasks went in for review. */
export async function submitDailyUpdate(lines: UpdateLine[], other: string, blockers: string) {
  const { data, error } = await supabase.rpc("submit_daily_update", {
    p_items: lines.map((l) => ({ task_id: l.task_id, progress: Math.round(l.progress), note: l.note.trim() || null })),
    p_other: other.trim() || null,
    p_blockers: blockers.trim() || null,
  });
  if (error) throw error;
  return data as { update_id: string; tasks: number; handed_in: number };
}

/**
 * A manager or senior changes one task in someone's update: the %, done (100%) and the note. The
 * task's own % follows, and 100% hands an open task in for review. The person is told.
 */
export async function editUpdateItem(itemId: string, progress: number, note: string) {
  const { data, error } = await supabase.rpc("edit_daily_update_item", {
    p_item: itemId,
    p_progress: Math.round(progress),
    p_note: note.trim() || null,
  });
  if (error) throw error;
  return data as DailyUpdateItem;
}

/** A reply under what's blocking someone. The person (or whoever replied before) is told. */
export async function replyToBlocker(updateId: string, authorId: string, body: string) {
  const { error } = await supabase.from("daily_update_replies").insert({ update_id: updateId, author_id: authorId, body: body.trim() });
  if (error) throw error;
}

/** The colour for a percentage: grey at 0, blue under way, green at 100. */
export function progressTone(pct: number): string {
  return pct >= 100 ? "var(--green)" : pct > 0 ? "var(--accent)" : "var(--text-3)";
}
