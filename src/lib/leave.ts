// Leave requests: asking for leave, the two-step approval (the first checker, then the final OK),
// annual leave balances and who is away. The database enforces the rules (leave_guard in migration
// 0023); these helpers only work out the words, numbers and buttons each screen shows.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap, usePeople, useSettings } from "./api";
import { useAuth, useMe } from "./auth";
import { useSignoff, type Signoff } from "./signoff";
import { supabase } from "./supabase";
import { addDays, DOW_SHORT, dow, isWorkday, todayISO } from "./time";
import type { LeaveBalance, LeaveKind, LeaveRequest, LeaveStatus, Profile, TeamLeave } from "./types";

export const LEAVE_KINDS: { value: LeaveKind; label: string; short: string }[] = [
  { value: "annual", label: "Annual leave", short: "Annual" },
  { value: "sick", label: "Sick leave", short: "Sick" },
  { value: "emergency", label: "Emergency leave", short: "Emergency" },
  { value: "unpaid", label: "Unpaid leave", short: "Unpaid" },
  { value: "other", label: "Other leave", short: "Other" },
];

/** "Annual leave"; "On leave" when the viewer can't see the kind. */
export function leaveKindLabel(kind: LeaveKind | null | undefined): string {
  if (!kind) return "On leave";
  return LEAVE_KINDS.find((k) => k.value === kind)?.label ?? "Leave";
}

export const LEAVE_STATUS: Record<LeaveStatus, { label: string; tone: string }> = {
  pending: { label: "Waiting", tone: "orange" },
  approved: { label: "Approved", tone: "green" },
  declined: { label: "Declined", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

/** Working days from one date to another, inclusive (mirrors leave_working_days). */
export function workingDays(from: string, to: string, workDays?: number[]): number {
  if (!from || !to || to < from) return 0;
  let n = 0;
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) if (isWorkday(d, workDays)) n++;
  return n;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sun 1 Nov" (with the year when it isn't this year). */
export function fmtLeaveDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const year = y !== Number(todayISO().slice(0, 4)) ? ` ${y}` : "";
  return `${DOW_SHORT[dow(iso)]} ${d} ${MONTHS[m - 1]}${year}`;
}

/** "Sun 1 Nov" or "Sun 1 Nov to Thu 5 Nov". */
export function fmtLeaveDates(from: string, to: string): string {
  return from === to ? fmtLeaveDay(from) : `${fmtLeaveDay(from)} to ${fmtLeaveDay(to)}`;
}

export const daysText = (n: number) => `${n} working ${n === 1 ? "day" : "days"}`;

/** Where a new request starts (mirrors leave_first_stage). */
export function firstStageFor(userId: string, s: Signoff): "first" | "final" {
  if (s.first && s.first.id !== userId) return "first";
  if (s.final && s.final.id !== userId) return "final";
  return "first";
}

/** Who can approve at this stage (mirrors leave_approvers). */
export function leaveApprovers(stage: LeaveRequest["stage"], userId: string, s: Signoff, managers: Profile[]): string[] {
  if (!stage) return [];
  if (stage === "final" && s.final && s.final.id !== userId) return [s.final.id];
  if (stage === "first" && s.first && s.first.id !== userId) return [s.first.id];
  const others = managers.filter((p) => p.id !== userId).map((p) => p.id);
  return others.length ? others : [userId];
}

/** True when an OK at this stage passes the request on to the final OK rather than finishing it. */
export function leavePassesOn(r: Pick<LeaveRequest, "stage" | "user_id">, meId: string, s: Signoff): boolean {
  return r.stage === "first" && !!s.final && s.final.id !== meId && s.final.id !== r.user_id;
}

/** How a request moves, in a sentence, for the request form. */
export function leaveRouteText(userId: string, s: Signoff, managers: Profile[], nameOf: (id: string) => string | undefined): string {
  const stage = firstStageFor(userId, s);
  const approvers = leaveApprovers(stage, userId, s, managers);
  const first = approvers.length === 1 ? nameOf(approvers[0]) ?? "Your manager" : "A manager";
  if (approvers.length === 1 && approvers[0] === userId) return "You're the only manager, so you record your own leave.";
  const twoSteps = stage === "first" && !!s.final && s.final.id !== userId && !(approvers.length === 1 && approvers[0] === s.final.id);
  return twoSteps ? `${first} approves it first, then ${s.final!.short_name} gives the final OK.` : `${first} approves it.`;
}

/** Short label for a request: "Your check", "With Hassan", "Your final OK", "Final OK with Fawaz", "Approved"... */
export function leaveTurnLabel(r: LeaveRequest, s: Signoff, meId: string, managers: Profile[], people: { get: (id: string | null | undefined) => Profile | undefined }): string {
  if (r.status !== "pending") return LEAVE_STATUS[r.status].label;
  const who = leaveApprovers(r.stage, r.user_id, s, managers);
  if (who.includes(meId)) return r.stage === "final" ? "Your final OK" : "Your OK";
  const name = who.length === 1 ? people.get(who[0])?.short_name : null;
  if (r.stage === "final") return name ? `Final OK with ${name}` : "Waiting for the final OK";
  return name ? `With ${name}` : "Waiting";
}

const KEY = "leave_requests";

/** My own requests (newest first). */
export function useMyLeave(userId: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "mine", userId],
    enabled,
    queryFn: () =>
      unwrap<LeaveRequest[]>(
        supabase.from("leave_requests").select("*").eq("user_id", userId).order("start_date", { ascending: false }).limit(60),
      ),
  });
}

/** Everyone's waiting and upcoming requests (managers and seniors). */
export function useTeamLeaveRequests(enabled: boolean) {
  return useQuery({
    queryKey: [KEY, "team"],
    enabled,
    queryFn: () =>
      unwrap<LeaveRequest[]>(
        supabase
          .from("leave_requests")
          .select("*")
          .or(`status.eq.pending,and(status.eq.approved,end_date.gte.${todayISO()})`)
          .order("start_date", { ascending: true })
          .limit(200),
      ),
  });
}

export function useLeaveRequest(id: string | null) {
  return useQuery({
    queryKey: [KEY, "one", id],
    enabled: !!id,
    queryFn: () => unwrap<LeaveRequest | null>(supabase.from("leave_requests").select("*").eq("id", id!).maybeSingle()),
  });
}

/** Annual leave balances for a year: mine, or everyone's for managers and seniors. */
export function useLeaveBalances(year: number, enabled = true) {
  return useQuery({
    queryKey: [KEY, "balances", year],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("leave_balances", { p_year: year });
      if (error) throw error;
      return (data ?? []) as LeaveBalance[];
    },
  });
}

/** Who is away between two dates (approved leave and Leave entries on the Calendar). */
export function useTeamLeave(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "away", from, to],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("team_leave", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as TeamLeave[];
    },
  });
}

/** Each person's leave on each working day in a range: "userId|date" -> the leave. */
export function leaveByDay(rows: TeamLeave[], from: string, to: string, workDays?: number[]): Map<string, TeamLeave> {
  const m = new Map<string, TeamLeave>();
  for (const r of rows) {
    const a = r.start_date > from ? r.start_date : from;
    const b = r.end_date < to ? r.end_date : to;
    for (let d = a, i = 0; d <= b && i < 400; d = addDays(d, 1), i++) {
      if (!isWorkday(d, workDays) && r.source === "request") continue;
      const k = `${r.user_id}|${d}`;
      // A request (with its kind) wins over a plain Calendar entry on the same day.
      if (!m.has(k) || r.source === "request") m.set(k, r);
    }
  }
  return m;
}

/** Requests waiting on me, oldest first, plus the bits every leave screen needs. */
export function useLeaveContext() {
  const me = useMe();
  const { canAssign } = useAuth();
  const s = useSignoff();
  const people = usePeople();
  const settings = useSettings().data;
  const managers = useMemo(() => people.active.filter((p) => p.role === "manager"), [people.active]);
  const team = useTeamLeaveRequests(canAssign);
  const toApprove = useMemo(
    () =>
      (team.data ?? [])
        .filter((r) => r.status === "pending" && leaveApprovers(r.stage, r.user_id, s, managers).includes(me.id))
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [team.data, s, managers, me.id],
  );
  return { me, canAssign, signoff: s, people, managers, workDays: settings?.work_days, team, toApprove };
}

export async function requestLeave(input: { kind: LeaveKind; start_date: string; end_date: string; note: string | null }) {
  return unwrap<LeaveRequest>(supabase.from("leave_requests").insert(input).select("*").single());
}

/** Approve, decline or cancel. The database decides what an approval does (it may pass it on). */
export async function setLeaveStatus(id: string, status: "approved" | "declined" | "cancelled", note?: string | null) {
  const patch: Record<string, unknown> = { status };
  if (note !== undefined) patch.decision_note = note?.trim() || null;
  return unwrap<LeaveRequest>(supabase.from("leave_requests").update(patch).eq("id", id).select("*").single());
}
