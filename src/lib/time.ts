// All dates shown in the app are Riyadh time. Plain dates (due dates, work dates) are "YYYY-MM-DD" strings.
import { TZ } from "./config";

const isoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const time12Fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });

/** Today's date in Riyadh as YYYY-MM-DD. */
export function todayISO(): string {
  return isoFmt.format(new Date());
}

/** Calendar date in Riyadh for a timestamp. */
export function dateOf(ts: string | Date): string {
  return isoFmt.format(typeof ts === "string" ? new Date(ts) : ts);
}

function parse(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86400000);
}

/** 0 = Sunday ... 6 = Saturday */
export function dow(iso: string): number {
  return parse(iso).getUTCDay();
}

/** Sunday that starts the week containing iso. */
export function weekStart(iso: string): string {
  return addDays(iso, -dow(iso));
}

export function monthStart(iso: string): string {
  return iso.slice(0, 8) + "01";
}

export function isWorkday(iso: string, workDays: number[] = [0, 1, 2, 3, 4]): boolean {
  return workDays.includes(dow(iso));
}

export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(parse(iso));
}

export function fmtLongDate(iso: string): string {
  return fmtDate(iso, { weekday: "long", day: "numeric", month: "long" });
}

export function fmtMonth(iso: string): string {
  return fmtDate(iso, { month: "long", year: "numeric" });
}

/** "Today", "Tomorrow", "Yesterday", "Sun 25 Oct" or "12 Mar 2027". */
export function fmtDue(iso: string | null | undefined): string {
  if (!iso) return "No date";
  const t = todayISO();
  const d = diffDays(iso, t);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (Math.abs(d) < 150) return fmtDate(iso, { weekday: "short", day: "numeric", month: "short" });
  return fmtDate(iso, { day: "numeric", month: "short", year: "numeric" });
}

export type DueState = "overdue" | "today" | "soon" | "later" | "none";
export function dueState(iso: string | null | undefined, done = false): DueState {
  if (!iso || done) return "none";
  const d = diffDays(iso, todayISO());
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 3) return "soon";
  return "later";
}

export function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "";
  return timeFmt.format(new Date(ts));
}

export function fmtTime12(ts: string | null | undefined): string {
  if (!ts) return "";
  return time12Fmt.format(new Date(ts));
}

/** "08:30:00" -> "8:30 am" */
export function fmtClock(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function fmtDateTime(ts: string | null | undefined): string {
  if (!ts) return "";
  return `${fmtDue(dateOf(ts))}, ${fmtTime12(ts)}`;
}

/** Short relative time: "now", "5m", "3h", "Yesterday", "12 Oct". */
export function timeAgo(ts: string | null | undefined): string {
  if (!ts) return "";
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400 && dateOf(ts) === todayISO()) return `${Math.round(s / 3600)}h`;
  const d = diffDays(todayISO(), dateOf(ts));
  if (d === 1) return "Yesterday";
  if (d < 7) return DOW_SHORT[dow(dateOf(ts))];
  return fmtDate(dateOf(ts));
}

export function greeting(): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** Minutes between two timestamps, formatted "7h 45m". */
export function fmtDuration(from: string, to: string | null): string {
  const end = to ? new Date(to).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - new Date(from).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
