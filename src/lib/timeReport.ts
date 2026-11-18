// The Time report: the stopwatch's stretches over a period, added up per person, per task and per
// day, and the same as an Excel file. Managers see everyone; a team member sees their own time.
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "./api";
import { supabase } from "./supabase";
import { addDays, monthStart, todayISO, weekStart } from "./time";
import type { Profile, Project, Task, TimeLog } from "./types";
import { XLSX_MIME } from "./vologExcel";

export type Period = "today" | "week" | "last-week" | "month";

export const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "month", label: "This month" },
];

/** The days a period covers, first to last (local dates). */
export function periodDays(p: Period, today = todayISO()): { from: string; to: string } {
  if (p === "today") return { from: today, to: today };
  if (p === "week") return { from: weekStart(today), to: today };
  if (p === "last-week") {
    const start = addDays(weekStart(today), -7);
    return { from: start, to: addDays(start, 6) };
  }
  return { from: monthStart(today), to: today };
}

/** Local midnight of a date, as an instant. */
const localStart = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

export type LogWithTask = TimeLog & { task: Pick<Task, "id" | "title" | "project_id" | "status"> | null };

/** Stretches that overlap the period (running ones too), with their task. */
export function useTimeReport(from: string, to: string, userId?: string) {
  const startIso = new Date(localStart(from)).toISOString();
  const endIso = new Date(localStart(addDays(to, 1))).toISOString();
  return useQuery({
    queryKey: ["task_time_logs", "report", from, to, userId ?? "all"],
    queryFn: () => {
      let q = supabase
        .from("task_time_logs")
        .select("*, task:tasks(id, title, project_id, status)")
        .lt("started_at", endIso)
        .or(`stopped_at.is.null,stopped_at.gt.${startIso}`)
        .order("started_at");
      if (userId) q = q.eq("user_id", userId);
      return unwrap<LogWithTask[]>(q);
    },
    refetchInterval: 60_000,
  });
}

/** Seconds of this stretch inside [a, b). */
function overlap(l: TimeLog, a: number, b: number, now: number): number {
  const s = Math.max(new Date(l.started_at).getTime(), a);
  const e = Math.min(l.stopped_at ? new Date(l.stopped_at).getTime() : now, b);
  return Math.max(0, Math.floor((e - s) / 1000));
}

export interface ReportRow {
  key: string;
  secs: number;
  /** Seconds per day, in the same order as `days`. */
  perDay: number[];
  running: boolean;
}
export interface PersonRow extends ReportRow {
  userId: string;
  tasks: (ReportRow & { taskId: string; title: string; projectId: string | null })[];
}
export interface TaskRowT extends ReportRow {
  taskId: string;
  title: string;
  projectId: string | null;
  people: { userId: string; secs: number }[];
}

export interface Report {
  days: string[];
  total: number;
  perDay: number[];
  people: PersonRow[];
  tasks: TaskRowT[];
}

/** Adds the stretches up: per person (with their tasks), per task (with its people), per day. */
export function buildReport(logs: LogWithTask[], from: string, to: string, now = Date.now()): Report {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const bounds = days.map((d) => [localStart(d), localStart(addDays(d, 1))] as const);
  const people = new Map<string, PersonRow>();
  const tasks = new Map<string, TaskRowT>();
  const perDayAll = days.map(() => 0);
  let total = 0;

  for (const l of logs) {
    const per = bounds.map(([a, b]) => overlap(l, a, b, now));
    const secs = per.reduce((n, x) => n + x, 0);
    if (!secs && l.stopped_at) continue;
    total += secs;
    per.forEach((x, i) => (perDayAll[i] += x));
    const title = l.task?.title ?? "A task that was removed";
    const projectId = l.task?.project_id ?? null;

    let p = people.get(l.user_id);
    if (!p) people.set(l.user_id, (p = { key: l.user_id, userId: l.user_id, secs: 0, perDay: days.map(() => 0), running: false, tasks: [] }));
    p.secs += secs;
    per.forEach((x, i) => (p!.perDay[i] += x));
    if (!l.stopped_at) p.running = true;
    let pt = p.tasks.find((t) => t.taskId === l.task_id);
    if (!pt) p.tasks.push((pt = { key: l.task_id, taskId: l.task_id, title, projectId, secs: 0, perDay: days.map(() => 0), running: false }));
    pt.secs += secs;
    per.forEach((x, i) => (pt!.perDay[i] += x));
    if (!l.stopped_at) pt.running = true;

    let t = tasks.get(l.task_id);
    if (!t) tasks.set(l.task_id, (t = { key: l.task_id, taskId: l.task_id, title, projectId, secs: 0, perDay: days.map(() => 0), running: false, people: [] }));
    t.secs += secs;
    per.forEach((x, i) => (t!.perDay[i] += x));
    if (!l.stopped_at) t.running = true;
    const tp = t.people.find((x) => x.userId === l.user_id);
    if (tp) tp.secs += secs;
    else t.people.push({ userId: l.user_id, secs });
  }

  const bySecs = <T extends { secs: number }>(a: T, b: T) => b.secs - a.secs;
  const ps = [...people.values()].sort(bySecs);
  ps.forEach((p) => p.tasks.sort(bySecs));
  const ts = [...tasks.values()].sort(bySecs);
  ts.forEach((t) => t.people.sort(bySecs));
  return { days, total, perDay: perDayAll, people: ps, tasks: ts };
}

/** Hours with one decimal, for the Excel file. */
const hours = (secs: number) => Math.round((secs / 3600) * 100) / 100;

/** The report as an Excel file: By person (with their tasks), By task, and By day. */
export async function buildTimeWorkbook(
  r: Report,
  label: string,
  people: (id: string) => Profile | undefined,
  projects: Map<string, Project>,
): Promise<Blob> {
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Northcroft";
  wb.created = new Date();
  const navy = "FF0B1F35";
  const head = (ws: import("exceljs").Worksheet, title: string, cols: { header: string; width: number }[]) => {
    ws.addRow([title]).font = { bold: true, size: 14, color: { argb: navy } };
    ws.addRow([label]).font = { italic: true, color: { argb: "FF555555" } };
    ws.addRow([]);
    const h = ws.addRow(cols.map((c) => c.header));
    h.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: navy } };
      c.alignment = { vertical: "middle" };
    });
    cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
    ws.views = [{ state: "frozen", ySplit: 4 }];
  };
  const name = (id: string) => people(id)?.full_name ?? "Former team member";
  const proj = (id: string | null) => (id ? projects.get(id)?.name ?? "" : "");

  const a = wb.addWorksheet("By person");
  head(a, "Time by person", [
    { header: "Person", width: 30 },
    { header: "Task", width: 46 },
    { header: "Project", width: 26 },
    { header: "Hours", width: 10 },
  ]);
  for (const p of r.people) {
    const row = a.addRow([name(p.userId), "All tasks", "", hours(p.secs)]);
    row.font = { bold: true };
    for (const t of p.tasks) a.addRow(["", t.title, proj(t.projectId), hours(t.secs)]);
  }
  a.addRow(["Total", "", "", hours(r.total)]).font = { bold: true };
  a.getColumn(4).numFmt = "0.00";

  const b = wb.addWorksheet("By task");
  head(b, "Time by task", [
    { header: "Task", width: 46 },
    { header: "Project", width: 26 },
    { header: "People", width: 40 },
    { header: "Hours", width: 10 },
  ]);
  for (const t of r.tasks) {
    b.addRow([t.title, proj(t.projectId), t.people.map((x) => `${people(x.userId)?.short_name ?? "Someone"} ${hours(x.secs)}h`).join(", "), hours(t.secs)]);
  }
  b.addRow(["Total", "", "", hours(r.total)]).font = { bold: true };
  b.getColumn(4).numFmt = "0.00";

  const c = wb.addWorksheet("By day");
  head(c, "Time by day", [{ header: "Person", width: 30 }, ...r.days.map((d) => ({ header: d, width: 12 })), { header: "Total", width: 10 }]);
  for (const p of r.people) c.addRow([name(p.userId), ...p.perDay.map(hours), hours(p.secs)]);
  c.addRow(["Total", ...r.perDay.map(hours), hours(r.total)]).font = { bold: true };
  for (let i = 2; i <= r.days.length + 2; i++) c.getColumn(i).numFmt = "0.00";

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}
