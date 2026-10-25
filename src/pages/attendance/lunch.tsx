// Lunch breaks and the office check: shared hooks, times and the status shown on the board,
// in history and in the monthly export.
import { useQuery } from "@tanstack/react-query";
import { Utensils } from "lucide-react";
import { unwrap } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { TZ } from "@/lib/config";
import { fmtClock } from "@/lib/time";
import type { AppSettings, LunchBreak, Profile } from "@/lib/types";
import { Pill } from "@/components/ui";

const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Minutes since midnight in the team's timezone. */
export function teamMinutes(d: Date): number {
  const [h, m] = hmFmt.format(d).split(":").map(Number);
  return h * 60 + m;
}

function toMinutes(t: string | undefined, fallback: string): number {
  const [h, m] = (t || fallback).split(":").map(Number);
  return h * 60 + m;
}

/** "12:35 pm" from minutes since midnight. */
export function minutesClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  return fmtClock(`${h}:${String(min % 60).padStart(2, "0")}`);
}

/** "12" or "12:30", the way the 12:00 message says it. */
export function shortHour(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const hh = h % 12 === 0 ? 12 : h % 12;
  return min % 60 ? `${hh}:${String(min % 60).padStart(2, "0")}` : String(hh);
}

export interface LunchRules {
  on: boolean;
  /** Minutes since midnight, team time. */
  start: number;
  end: number;
  confirm: number;
  minutes: number;
}

export function lunchRules(s: AppSettings | undefined): LunchRules {
  const start = toMinutes(s?.break_start, "12:00");
  const minutes = s?.break_minutes ?? 60;
  return {
    on: s?.break_rules_on !== false,
    start,
    end: start + minutes,
    confirm: toMinutes(s?.break_confirm_at, "12:35"),
    minutes,
  };
}

/** Whether break rules apply to this person at all (they check in and follow break rules). */
export function followsBreakRules(p: Profile | undefined): boolean {
  return !!p && p.active && !p.attendance_exempt && p.break_rules !== false;
}

/** People who hear about breaks and the office check: the ones who see the team's check-in times. */
export function watcherNames(people: Profile[]): string {
  const names = people
    .filter((p) => p.active && p.attendance_times !== false && (p.role === "manager" || (p.can_assign && !p.attendance_exempt)))
    .map((p) => p.short_name);
  if (!names.length) return "your manager";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function useMyLunch(userId: string, date: string, enabled = true) {
  return useQuery({
    queryKey: ["lunch_breaks", "mine", userId, date],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("lunch_breaks").select("*").eq("user_id", userId).eq("work_date", date).maybeSingle();
      if (error) throw error;
      return (data as LunchBreak | null) ?? null;
    },
  });
}

/** Everyone's lunch for a range of days (only attendance watchers see other people's). */
export function useLunchRange(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["lunch_breaks", "range", from, to],
    enabled,
    queryFn: () => unwrap<LunchBreak[]>(supabase.from("lunch_breaks").select("*").gte("work_date", from).lte("work_date", to)),
  });
}

/** My own breaks for the history list. */
export function useMyLunchHistory(userId: string, from: string) {
  return useQuery({
    queryKey: ["lunch_breaks", "history", userId, from],
    queryFn: () => unwrap<LunchBreak[]>(supabase.from("lunch_breaks").select("*").eq("user_id", userId).gte("work_date", from)),
  });
}

const t12 = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
/** "12:05" (no am or pm: it's lunch). */
export function lunchClock(ts: string | null | undefined): string {
  if (!ts) return "";
  return t12.format(new Date(ts)).replace(/\s?[ap]\.?m\.?$/i, "").trim();
}

export function breakLength(b: LunchBreak, now = Date.now()): number | null {
  if (!b.break_start_at) return null;
  const end = b.break_end_at ? new Date(b.break_end_at).getTime() : now;
  return Math.max(0, Math.round((end - new Date(b.break_start_at).getTime()) / 60000));
}

export function roughDistance(m: number | null | undefined): string | null {
  if (m == null) return null;
  if (m < 1000) return `about ${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `about ${(m / 1000).toFixed(1)} km`;
}

export interface LunchBadge {
  label: string;
  tone: string;
}

/**
 * What the board shows for someone's lunch. `isToday` and `nowMin` decide whether an open break is
 * still running or was never closed, and whether "Not confirmed" applies yet.
 */
export function lunchBadges(b: LunchBreak | undefined, rules: LunchRules, isToday: boolean, now = new Date()): LunchBadge[] {
  if (!b) return [];
  const out: LunchBadge[] = [];
  if (b.break_start_at) {
    const len = breakLength(b, now.getTime()) ?? 0;
    const over = len - rules.minutes;
    if (b.break_end_at) {
      out.push({ label: `Out ${lunchClock(b.break_start_at)} to ${lunchClock(b.break_end_at)}`, tone: "blue" });
      if (over > 0) out.push({ label: `Over by ${over} min`, tone: "red" });
      if (b.end_in_office === false) out.push({ label: "Closed away from the office", tone: "red" });
    } else if (isToday) {
      out.push({ label: `Out since ${lunchClock(b.break_start_at)}`, tone: over > 0 ? "red" : "orange" });
      if (over > 0) out.push({ label: `Over by ${over} min`, tone: "red" });
    } else {
      out.push({ label: `Out from ${lunchClock(b.break_start_at)}, never closed`, tone: "red" });
    }
    return out;
  }
  if (b.confirmed_at) {
    if (b.confirm_in_office) {
      out.push({ label: `Confirmed in office ${lunchClock(b.confirmed_at)}`, tone: "green" });
      if (b.outside_at) out.push({ label: `Outside at ${lunchClock(b.outside_at)} first`, tone: "orange" });
    } else {
      out.push({ label: "Confirmed from outside", tone: "orange" });
    }
    return out;
  }
  if (b.confirm_asked_at || b.missed_at) out.push({ label: "Not confirmed", tone: b.missed_at ? "red" : "orange" });
  return out;
}

export function LunchLine({ badges }: { badges: LunchBadge[] }) {
  if (!badges.length) return null;
  return (
    <div className="row wrap lunch-line" style={{ gap: 6 }}>
      <span className="lunch-tag small">
        <Utensils /> Lunch
      </span>
      {badges.map((x) => (
        <Pill key={x.label} tone={x.tone}>
          {x.label}
        </Pill>
      ))}
    </div>
  );
}

/** One line for the monthly export. */
export function officeCheckText(b: LunchBreak | undefined): string {
  if (!b) return "";
  if (b.confirmed_at) {
    if (b.confirm_in_office) return `In the office ${lunchClock(b.confirmed_at)}${b.outside_at ? ` (outside at ${lunchClock(b.outside_at)} first)` : ""}`;
    return `From outside ${lunchClock(b.confirmed_at)}${b.confirm_distance_m != null ? `, ${roughDistance(b.confirm_distance_m)} away` : ""}`;
  }
  if (b.break_start_at) return "Went out";
  if (b.confirm_asked_at || b.missed_at) return "Not confirmed";
  return "";
}
