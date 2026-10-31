// Weekly updates: on Thursday at 5:45 pm each person's daily updates from Sunday to Thursday become
// their weekly update, and the team's week becomes one report for managers and seniors (topped up at
// 9:30 pm for daily updates that came in late). The `weekly` Edge Function writes them (migration
// 0045 holds the table and the Thursday schedule);
// these are the types, hooks and week helpers the app uses.
// Once the week is written each person checks theirs (migration 0046): it shows in My tasks as
// "Check your weekly update" until Sunday 12 pm, they can change the words and add lines, and what
// they send back goes straight into the report.
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "./api";
import { looksOffline, supabase } from "./supabase";
import { addDays, dateOf, dow, DOW_SHORT, fmtDate, fmtTime12, todayISO, weekStart } from "./time";

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

/** One line of a weekly update: the project and what was done. */
export interface Line {
  project: string;
  text: string;
}

/** A person's week in sections (how it's written from 1 Nov 2026). */
export interface SectionWords {
  headline: string;
  finished: Line[];
  in_progress: Line[];
  waiting: Line[];
  next: Line[];
  /** Anything the person added when they checked it. */
  added?: string;
}

/** How a person's week was written before the sections (older weeks stay like this). */
export interface OldWords {
  summary: string;
  projects: { project: string; summary: string }[];
  other_work: string;
  blockers: string;
  added?: string;
}

export type PersonSummary = SectionWords | OldWords;

/** Written in sections (rather than the older paragraphs)? */
export function isSections(s: unknown): s is SectionWords {
  return !!s && typeof s === "object" && ("headline" in s || "finished" in s);
}

/** The sections, in order, with their names. */
export const SECTIONS = [
  { key: "finished", label: "Finished" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting", label: "Blocked or waiting" },
  { key: "next", label: "Next week" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

/** One project's block in the team's report. */
export interface TeamProject {
  project: string;
  people: string[];
  finished: string[];
  in_progress: string[];
  waiting: string[];
  next: string[];
}
export interface TeamSections {
  headline: string;
  projects: TeamProject[];
}
/** The team's report as it was written before the sections. */
export interface OldTeam {
  headline: string;
  projects: { project: string; summary: string }[];
  attention: string[];
}
export type TeamSummary = TeamSections | OldTeam;

/** The team's report written by project with sections? */
export function isTeamSections(s: unknown): s is TeamSections {
  if (!s || typeof s !== "object" || "attention" in s) return false;
  const ps = (s as { projects?: unknown }).projects;
  return Array.isArray(ps) && ps.every((p) => p && typeof p === "object" && "finished" in p);
}

export type ReportKind = "week" | "rolling" | "custom";

interface Row<F, S> {
  id: string;
  kind: ReportKind;
  period_start: string;
  period_end: string;
  status: WeeklyStatus;
  facts: F | Record<string, never>;
  summary: S | null;
  error: string | null;
  generated_at: string | null;
  generated_by: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
  /** Checking (the Thursday week only): when they were asked, until when, and when they sent it back. */
  check_sent_at?: string | null;
  check_due?: string | null;
  checked_at?: string | null;
  checked_by?: string | null;
  /** They changed the words or added something when they sent it back. */
  check_edited?: boolean;
  /** The words as they were written, before the person changed them. */
  written_summary?: S | null;
}
export type PersonWeek = Row<PersonFacts, PersonSummary> & { user_id: string };
export type TeamWeek = Row<TeamFacts, TeamSummary> & { user_id: null };
export type WeeklyUpdate = PersonWeek | TeamWeek;

/** Facts only count once something has been written into them. */
export function hasFacts<F extends object>(f: F | Record<string, never> | null | undefined): f is F {
  return !!f && Object.keys(f).length > 0;
}

const KEY = "weekly_updates";

/** One report: the team's (if there is one) and each person's, by name. */
export interface Report {
  team: TeamWeek | null;
  people: PersonWeek[];
}
function toReport(rows: WeeklyUpdate[]): Report {
  const team = (rows.find((r) => r.user_id === null) as TeamWeek | undefined) ?? null;
  const people = rows.filter((r): r is PersonWeek => r.user_id !== null).sort(byName);
  return { team, people };
}

/** Everything for one stretch of days (each person sees only their own; managers everyone's). */
export function useReport(kind: ReportKind, start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "report", kind, start, end],
    enabled: enabled && !!start && !!end,
    queryFn: async () =>
      toReport(
        await unwrap<WeeklyUpdate[]>(
          supabase.from("weekly_updates").select("*").eq("kind", kind).eq("period_start", start).eq("period_end", end),
        ),
      ),
  });
}

/** Everything for one Thursday week. */
export const useWeek = (week: string, enabled = true) => useReport("week", week, weekEnd(week), enabled);

/** My Thursday weekly updates, newest first. */
export function useMyWeeklyUpdates(userId: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "mine", userId],
    enabled: enabled && !!userId,
    queryFn: () =>
      unwrap<PersonWeek[]>(
        supabase.from("weekly_updates").select("*").eq("kind", "week").eq("user_id", userId).order("period_start", { ascending: false }).limit(12),
      ),
  });
}

/**
 * The newest last-7-days write-up for the card on Home: the team's for managers and seniors, the
 * person's own otherwise.
 */
export function useLastSevenDays(userId: string, team: boolean, enabled = true) {
  return useQuery({
    queryKey: [KEY, "rolling", team ? "team" : userId],
    enabled: enabled && !!userId,
    queryFn: async () => {
      let q = supabase.from("weekly_updates").select("*").eq("kind", "rolling");
      q = team ? q.is("user_id", null) : q.eq("user_id", userId);
      const rows = await unwrap<WeeklyUpdate[]>(q.order("period_end", { ascending: false }).limit(1));
      return rows[0] ?? null;
    },
  });
}

/** A stretch of picked days someone generated, for the list on the Weekly tab. */
export interface Generated {
  start: string;
  end: string;
  /** Whose: null for the team's. */
  userId: string | null;
  status: WeeklyStatus;
  generatedAt: string | null;
  generatedBy: string | null;
  line: string;
}

/** The days picked with Generate update, newest first: the team's and single people's for managers, your own otherwise. */
export function useGenerated(userId: string, manager: boolean, enabled = true) {
  return useQuery({
    queryKey: [KEY, "custom", manager ? "all" : userId],
    enabled: enabled && !!userId,
    queryFn: async () => {
      let q = supabase.from("weekly_updates").select("period_start, period_end, user_id, status, generated_at, generated_by, updated_at, facts").eq("kind", "custom");
      if (!manager) q = q.eq("user_id", userId);
      const rows = await unwrap<(Pick<WeeklyUpdate, "period_start" | "period_end" | "user_id" | "status" | "generated_at" | "generated_by" | "updated_at"> & { facts: { line?: string } })[]>(
        q.order("updated_at", { ascending: false }).limit(300),
      );
      // One entry per stretch of days: the team's when there is one (its people are part of it),
      // otherwise each single person's.
      const teamDays = new Set(rows.filter((r) => r.user_id === null).map((r) => `${r.period_start}|${r.period_end}`));
      const out = new Map<string, Generated>();
      for (const r of rows) {
        const days = `${r.period_start}|${r.period_end}`;
        if (r.user_id !== null && manager && teamDays.has(days)) continue;
        const key = `${days}|${r.user_id ?? "team"}`;
        if (out.has(key)) continue;
        out.set(key, { start: r.period_start, end: r.period_end, userId: r.user_id, status: r.status, generatedAt: r.generated_at, generatedBy: r.generated_by, line: r.facts?.line ?? "" });
      }
      return [...out.values()].slice(0, 40);
    },
  });
}

async function invokeWeekly(body: Record<string, unknown>, fallback: string): Promise<{ start: string; end: string }> {
  if (looksOffline()) throw new Error("Writing an update needs signal. Try again when you're back online.");
  const { data, error } = await supabase.functions.invoke("weekly", { body });
  if (!error) return data as { start: string; end: string };
  let msg = fallback;
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

/**
 * Ask for the Thursday week to be written (again): everyone's, or one person's (and the team report
 * with it). Managers and seniors only. It answers straight away; the rows fill in over a minute or two.
 */
export async function makeWeeklyUpdate(opts: { week_start: string; user_id?: string }): Promise<void> {
  await invokeWeekly({ kind: "week", week_start: opts.week_start, user_id: opts.user_id, mode: "all" }, "The weekly update didn't start. Try again in a moment.");
}

/**
 * Generate an update for days someone picks. Managers and seniors: the team's and everyone's, or one
 * person's (user_id). Members: always their own. Returns the days as the function took them.
 */
export async function generateUpdate(opts: { start: string; end: string; user_id?: string | null }) {
  return invokeWeekly({ kind: "custom", start: opts.start, end: opts.end, user_id: opts.user_id ?? undefined }, "The update didn't start. Try again in a moment.");
}

/* ---------------------------------------------------------------- checking it and sending it back */

/**
 * Where someone's weekly update stands on checking:
 *   none: never sent to them to check (an older week, or no daily updates);
 *   open: waiting for them until Sunday 12 pm;
 *   sent: they sent it back (as it was, or changed);
 *   missed: Sunday 12 pm passed, so it stays as it was written.
 */
export type CheckState = "none" | "open" | "sent" | "missed";
export function checkState(r: Pick<PersonWeek, "check_sent_at" | "check_due" | "checked_at"> | null | undefined, now = Date.now()): CheckState {
  if (!r || !r.check_sent_at || !r.check_due) return "none";
  if (r.checked_at) return "sent";
  return now < Date.parse(r.check_due) ? "open" : "missed";
}

/** "Sun 1 Nov, 12 pm" */
export function dueLabel(ts: string | null | undefined): string {
  if (!ts) return "";
  return `${dayLabel(dateOf(ts))}, ${fmtTime12(ts).replace(":00", "")}`;
}

/** "Sat 31 Oct, 3:10 pm" */
export const whenLabel = (ts: string | null | undefined) => (ts ? `${dayLabel(dateOf(ts))}, ${fmtTime12(ts)}` : "");

/** Where someone checks their week. */
export const checkLink = (week: string) => `/updates/check?week=${week}`;

/** My weekly updates waiting for me to check (for My tasks). */
export function useMyChecks(userId: string, enabled = true) {
  return useQuery({
    queryKey: [KEY, "to-check", userId],
    enabled: enabled && !!userId,
    // Looked at again each minute, so it goes at 12 pm on Sunday without a reload.
    refetchInterval: 60_000,
    queryFn: async () => {
      const rows = await unwrap<PersonWeek[]>(
        supabase
          .from("weekly_updates")
          .select("*")
          .eq("kind", "week")
          .eq("user_id", userId)
          .not("check_sent_at", "is", null)
          .is("checked_at", null)
          .order("period_start", { ascending: false })
          .limit(4),
      );
      return rows.filter((r) => checkState(r) === "open");
    },
  });
}

const cut = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
/** One section's lines, tidied: empty lines dropped, a line with no project goes under General. */
const cleanLines = (a: unknown): Line[] =>
  (Array.isArray(a) ? a : [])
    .filter((l): l is Line => !!l && typeof l === "object")
    .map((l) => ({ project: cut(l.project, 200) || "General", text: cut(l.text, 400) }))
    .filter((l) => l.text)
    .slice(0, 40);

/** The words someone may change, tidied the way the database keeps them (either layout). */
export function cleanWords(s: Partial<SectionWords> | Partial<OldWords> | null | undefined): PersonSummary {
  if (isSections(s)) {
    return {
      headline: cut(s.headline, 600),
      finished: cleanLines(s.finished),
      in_progress: cleanLines(s.in_progress),
      waiting: cleanLines(s.waiting),
      next: cleanLines(s.next),
      added: cut(s.added, 3000),
    };
  }
  const o = (s ?? {}) as Partial<OldWords>;
  return {
    summary: (o.summary ?? "").trim(),
    projects: (o.projects ?? []).map((p) => ({ project: (p.project ?? "").trim(), summary: (p.summary ?? "").trim() })).filter((p) => p.project),
    other_work: (o.other_work ?? "").trim(),
    blockers: (o.blockers ?? "").trim(),
    added: (o.added ?? "").trim(),
  };
}

/** The same words (after tidying)? */
export const sameWords = (a: Partial<SectionWords> | Partial<OldWords> | null | undefined, b: Partial<SectionWords> | Partial<OldWords> | null | undefined) =>
  JSON.stringify(cleanWords(a)) === JSON.stringify(cleanWords(b));

/**
 * Send my weekly update back, changed or as it was, before Sunday 12 pm. It goes straight into the
 * report; if I changed it, the team report is written again with it.
 */
export async function sendBack(id: string, words: PersonSummary): Promise<{ edited: boolean }> {
  if (looksOffline()) throw new Error("Sending it back needs signal. Your changes are kept here; try again when you're back online.");
  const { data, error } = await supabase.rpc("weekly_update_send_back", { p_id: id, p_summary: cleanWords(words) });
  if (error) {
    const msg = error.message || "";
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) throw new Error("No connection. Your changes are kept here; try again in a moment.");
    if (/JWT expired|invalid JWT/i.test(msg)) throw new Error("Your session expired. Please sign in again; your changes are kept here.");
    throw new Error(msg && msg.length < 160 ? msg : "It didn't send. Try again in a moment.");
  }
  return { edited: !!(data as { edited?: boolean } | null)?.edited };
}

/** Where a report opens. */
export function reportLink(kind: ReportKind, start: string, end: string, who?: string | null): string {
  const q = new URLSearchParams({ kind, from: start, to: end });
  if (who) q.set("who", who);
  return `/updates/report?${q.toString()}`;
}

/* ---------------------------------------------------------------- weeks (Sunday to Thursday) */

/** The Sunday of the week we're in. */
export const thisWeek = (today = todayISO()) => weekStart(today);

export const weekEnd = (week: string) => addDays(week, 4);

/** The week closes on Thursday at 5:45 pm Riyadh: it's written up then and people are told. */
export const WEEK_CLOSES = "5:45 pm";
const closesAt = (week: string) => new Date(`${weekEnd(week)}T17:45:00+03:00`).getTime();

/** Thursday 5:45 pm has passed. */
export const weekIsOver = (week: string, now = Date.now()) => now >= closesAt(week);

/** The Sunday of the last week that's closed: from Thursday 5:45 pm it's this week, before that last week. */
export function lastFinishedWeek(today = todayISO(), now = Date.now()): string {
  const sunday = addDays(today, -dow(today));
  return weekIsOver(sunday, now) ? sunday : addDays(sunday, -7);
}

/** "Sun 25 Oct", or "Sun 25 Oct 2026" */
export function dayLabel(iso: string, withYear = false): string {
  return `${DOW_SHORT[dow(iso)]} ${fmtDate(iso, withYear ? { day: "numeric", month: "short", year: "numeric" } : undefined)}`;
}

/** "Sun 25 Oct to Thu 29 Oct", or "... Thu 29 Oct 2026" */
export function weekLabel(week: string, withYear = false): string {
  return rangeLabel(week, weekEnd(week), withYear);
}

/** "Mon 26 Oct to Wed 28 Oct", one day as "Mon 26 Oct". */
export function rangeLabel(start: string, end: string, withYear = false): string {
  return start === end ? dayLabel(start, withYear) : `${dayLabel(start)} to ${dayLabel(end, withYear)}`;
}

/** A valid Sunday from the address bar, no later than this week. */
export function weekFromParam(v: string | null, today = todayISO()): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  if (dow(v) !== 0 || v > thisWeek(today)) return null;
  return v;
}

/** A day from the address bar, or null. */
export const dayFromParam = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** Order people's write-ups the way the team reads them: by name. */
export function byName(a: PersonWeek, b: PersonWeek) {
  return (hasFacts(a.facts) ? a.facts.name : "").localeCompare(hasFacts(b.facts) ? b.facts.name : "");
}
