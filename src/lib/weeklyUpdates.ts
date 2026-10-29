// Weekly updates: on Friday morning each person's daily updates from Sunday to Thursday become
// their weekly update, and the team's week becomes one report for managers and seniors. The
// `weekly` Edge Function writes them (migration 0045 holds the table and the Friday schedule);
// these are the types, hooks and week helpers the app uses.
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "./api";
import { looksOffline, supabase } from "./supabase";
import { addDays, dow, DOW_SHORT, fmtDate, todayISO, weekStart } from "./time";

export type WeeklyStatus = "pending" | "ready" | "empty" | "failed";

export interface WeeklyTask {
  task_id: string;
  title: string;
  project: string | null;
  /** % at the start of the week (before the first update that mentions it). */
  start: number;
  /** % at the end of the week (the last update that mentions it). */
  end: number;
  handed_in: boolean;
  status: string | null;
  /** How many daily updates mention it. */
  days: number;
  notes: { date: string; note: string }[];
}

export interface PersonFacts {
  name: string;
  short_name: string;
  title: string | null;
  projects: string[];
  work_days: string[];
  leave_days: string[];
  sent_days: string[];
  missed_days: string[];
  days_sent: number;
  days_expected: number;
  tasks: WeeklyTask[];
  moved: number;
  handed_in: number;
  other_work: { date: string; text: string }[];
  blockers: { date: string; text: string; cleared: boolean; replies: { by: string; body: string }[] }[];
  open_blockers: number;
  /** "3 tasks moved on, 1 handed in, 1 blocker open" */
  line: string;
}

export interface TeamFacts {
  people: number;
  sent_all: number;
  missing: { name: string; days: string[] }[];
  no_updates: string[];
  moved: number;
  handed_in: number;
  open_blockers: { name: string; text: string }[];
  projects: { project: string; people: string[]; tasks: number; moved: number; handed_in: number }[];
  line: string;
}

export interface PersonSummary {
  summary: string;
  projects: { project: string; summary: string }[];
  other_work: string;
  blockers: string;
}

export interface TeamSummary {
  headline: string;
  projects: { project: string; summary: string }[];
  attention: string[];
}

interface Row<F, S> {
  id: string;
  week_start: string;
  week_end: string;
  status: WeeklyStatus;
  facts: F | Record<string, never>;
  summary: S | null;
  error: string | null;
  generated_at: string | null;
  generated_by: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
}
export type PersonWeek = Row<PersonFacts, PersonSummary> & { user_id: string };
export type TeamWeek = Row<TeamFacts, TeamSummary> & { user_id: null };
export type WeeklyUpdate = PersonWeek | TeamWeek;

/** Facts only count once something has been written into them. */
export function hasFacts<F extends object>(f: F | Record<string, never> | null | undefined): f is F {
  return !!f && Object.keys(f).length > 0;
}

const KEY = "weekly_updates";

/** My weekly updates, newest first (everyone sees only their own). */
export function useMyWeeklyUpdates(userId: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "mine", userId],
    enabled: enabled && !!userId,
    queryFn: () =>
      unwrap<PersonWeek[]>(
        supabase.from("weekly_updates").select("*").eq("user_id", userId).order("week_start", { ascending: false }).limit(12),
      ),
  });
}

/** Everything for one week: the team report and each person's (managers and seniors). */
export function useWeek(week: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "week", week],
    enabled,
    queryFn: async () => {
      const rows = await unwrap<WeeklyUpdate[]>(supabase.from("weekly_updates").select("*").eq("week_start", week));
      const team = (rows.find((r) => r.user_id === null) as TeamWeek | undefined) ?? null;
      const people = rows.filter((r): r is PersonWeek => r.user_id !== null);
      return { team, people };
    },
  });
}

/**
 * Ask for the week to be written (again): everyone's, or one person's (and the team report with
 * it). Managers and seniors only. It answers straight away; the rows fill in over a minute or two.
 */
export async function makeWeeklyUpdate(opts: { week_start: string; user_id?: string }): Promise<void> {
  if (looksOffline()) throw new Error("Writing the weekly update needs signal. Try again when you're back online.");
  const { error } = await supabase.functions.invoke("weekly", { body: { week_start: opts.week_start, user_id: opts.user_id, mode: "all" } });
  if (!error) return;
  let msg = "The weekly update didn't start. Try again in a moment.";
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const j = await ctx.json();
      if (j?.error) msg = j.error;
    } else if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
      msg = "No connection. Check your internet and try again.";
    }
  } catch {
    /* keep the friendly default */
  }
  throw new Error(msg);
}

/* ---------------------------------------------------------------- weeks (Sunday to Thursday) */

/** The Sunday of the week we're in. */
export const thisWeek = (today = todayISO()) => weekStart(today);

/** The Sunday of the last week that's over: from Friday it's this week, before that last week. */
export function lastFinishedWeek(today = todayISO()): string {
  const d = dow(today);
  return addDays(today, d >= 5 ? -d : -d - 7);
}

export const weekEnd = (week: string) => addDays(week, 4);

/** Thursday has passed. */
export const weekIsOver = (week: string, today = todayISO()) => today > weekEnd(week);

/** "Sun 25 Oct", or "Sun 25 Oct 2026" */
export function dayLabel(iso: string, withYear = false): string {
  return `${DOW_SHORT[dow(iso)]} ${fmtDate(iso, withYear ? { day: "numeric", month: "short", year: "numeric" } : undefined)}`;
}

/** "Sun 25 Oct to Thu 29 Oct", or "... Thu 29 Oct 2026" */
export function weekLabel(week: string, withYear = false): string {
  return `${dayLabel(week)} to ${dayLabel(weekEnd(week), withYear)}`;
}

/** A valid Sunday from the address bar, no later than this week. */
export function weekFromParam(v: string | null, today = todayISO()): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  if (dow(v) !== 0 || v > thisWeek(today)) return null;
  return v;
}

/** Order people's weeks the way the team reads them: by name. */
export const byName = (a: PersonWeek, b: PersonWeek) =>
  (hasFacts(a.facts) ? a.facts.name : "").localeCompare(hasFacts(b.facts) ? b.facts.name : "");
