// Missed check-in requests: someone who forgot to check in or out asks for the day to be recorded,
// and Hassan (Fawaz for Hassan's own) approves or declines it. Three approved a month, by the month
// of the day being fixed. The database enforces the rules (request_checkin_fix, decide_checkin_fix);
// these helpers read the requests and work out what each screen shows.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "./api";
import { useAuth, useMe } from "./auth";
import type { Signoff } from "./signoff";
import { supabase } from "./supabase";
import { addDays, fmtDate, fmtTime12, todayISO } from "./time";
import type { CheckinRequest, Profile } from "./types";

export const FIX_LIMIT = 3;
/** How far back a request can go, in days (today included). */
export const FIX_DAYS_BACK = 7;

/** My requests, newest first. */
export function useMyCheckinRequests(userId: string) {
  return useQuery({
    queryKey: ["checkin_requests", "mine", userId],
    queryFn: () =>
      unwrap<CheckinRequest[]>(
        supabase.from("checkin_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
      ),
  });
}

/** Requests waiting for an answer that I can see (managers and seniors see all of them). */
export function usePendingCheckinRequests(enabled: boolean) {
  return useQuery({
    queryKey: ["checkin_requests", "pending"],
    enabled,
    queryFn: () =>
      unwrap<CheckinRequest[]>(supabase.from("checkin_requests").select("*").eq("status", "pending").order("created_at").limit(100)),
  });
}

/** Approved requests since the start of last month (for "1 of 3 used" next to a request). */
export function useTeamFixesThisMonth() {
  const { canAssign, isManager } = useAuth();
  const from = addDays(todayISO().slice(0, 8) + "01", -1).slice(0, 8) + "01";
  return useQuery({
    queryKey: ["checkin_requests", "approved", from],
    enabled: canAssign || isManager,
    queryFn: () =>
      unwrap<CheckinRequest[]>(supabase.from("checkin_requests").select("*").eq("status", "approved").gte("work_date", from).limit(500)),
  });
}

/** Who answers this person's requests: Hassan, Fawaz for Hassan's own, or any manager (empty). */
export function fixApprover(userId: string, s: Signoff): Profile | undefined {
  if (s.first && s.first.id !== userId) return s.first;
  if (s.final && s.final.id !== userId) return s.final;
  return undefined;
}

/** Requests waiting on me: routed to me, or to no one and I'm a manager. */
export function useCheckinRequestsToAnswer() {
  const me = useMe();
  const { isManager, canAssign } = useAuth();
  const q = usePendingCheckinRequests(canAssign || isManager);
  const list = useMemo(
    () => (q.data ?? []).filter((r) => r.user_id !== me.id && (r.approver_id === me.id || (!r.approver_id && isManager))),
    [q.data, me.id, isManager],
  );
  return { list, isLoading: q.isLoading };
}

/** Same month as this date (YYYY-MM-DD). */
const sameMonth = (a: string, b: string) => a.slice(0, 7) === b.slice(0, 7);

/** Approved and waiting requests in the month of `day`, and how many are left. */
export function fixUsage(mine: CheckinRequest[] | undefined, day = todayISO()) {
  const inMonth = (mine ?? []).filter((r) => sameMonth(r.work_date, day));
  const approved = inMonth.filter((r) => r.status === "approved").length;
  const waiting = inMonth.filter((r) => r.status === "pending").length;
  return { approved, waiting, left: Math.max(0, FIX_LIMIT - approved), canAsk: approved + waiting < FIX_LIMIT };
}

export function monthName(day: string) {
  return fmtDate(day, { month: "long" });
}

/** "Sun 22 Nov" */
export function fixDay(day: string) {
  return fmtDate(day, { weekday: "short", day: "numeric", month: "short" });
}

/** "In 8:20 am, out 5:35 pm" */
export function fixTimes(r: Pick<CheckinRequest, "in_at" | "out_at">) {
  const parts = [r.in_at ? `in ${fmtTime12(r.in_at)}` : null, r.out_at ? `out ${fmtTime12(r.out_at)}` : null].filter(Boolean) as string[];
  const s = parts.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "check-in 8:20 am and check-out 5:35 pm", for sentences. */
export function fixTimesInWords(r: Pick<CheckinRequest, "in_at" | "out_at">) {
  const parts = [r.in_at ? `check-in ${fmtTime12(r.in_at)}` : null, r.out_at ? `check-out ${fmtTime12(r.out_at)}` : null].filter(Boolean);
  return parts.join(" and ");
}

/** What the request asks for, in a few words. */
export function fixWhat(r: Pick<CheckinRequest, "in_at" | "out_at">) {
  if (r.in_at && r.out_at) return "Check-in and check-out";
  return r.in_at ? "Check-in" : "Check-out";
}

export const FIX_STATUS: Record<CheckinRequest["status"], { label: string; tone: string }> = {
  pending: { label: "Waiting", tone: "orange" },
  approved: { label: "Approved", tone: "green" },
  declined: { label: "Declined", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

export async function requestCheckinFix(day: string, inTime: string | null, outTime: string | null, reason: string) {
  const { data, error } = await supabase.rpc("request_checkin_fix", {
    p_date: day,
    p_in: inTime || null,
    p_out: outTime || null,
    p_reason: reason,
  });
  if (error) throw error;
  return data as CheckinRequest;
}

export async function decideCheckinFix(id: string, approve: boolean, note?: string) {
  const { data, error } = await supabase.rpc("decide_checkin_fix", { p_id: id, p_approve: approve, p_note: note?.trim() || null });
  if (error) throw error;
  return data as CheckinRequest;
}

export async function cancelCheckinFix(id: string) {
  const { error } = await supabase.rpc("cancel_checkin_fix", { p_id: id });
  if (error) throw error;
}

export async function markFixAnswersSeen(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.rpc("checkin_fix_seen", { p_ids: ids });
  if (error) throw error;
}
