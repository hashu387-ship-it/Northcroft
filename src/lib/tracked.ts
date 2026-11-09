// Tracked tasks (EI-116 first): each person on the task has their own steps on its checklist,
// ticks them in their daily update ("3 of 5 done"), times their work with a stopwatch, and
// everyone sees a countdown to the deadline. The database does the counting and the pushes
// (migration 0051); these are the hooks and helpers the screens use.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap, useSettings } from "./api";
import { supabase } from "./supabase";
import type { ChecklistItem, Task, TimeLog } from "./types";

/* ---------------------------------------------------------------- the deadline and the countdown */

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes the time zone is ahead of UTC at that moment (Riyadh: 180). */
function zoneOffset(at: Date, tz: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return Math.round((wall - at.getTime()) / 60_000);
  } catch {
    return 180;
  }
}

/** The deadline: the due date at the end of the working day, in the team's time zone. */
export function deadlineOf(due: string | null | undefined, workEnd = "17:30:00", tz = "Asia/Riyadh"): Date | null {
  if (!due) return null;
  const [h = 17, m = 30] = workEnd.split(":").map(Number);
  const asIfUtc = new Date(`${due}T${pad(h)}:${pad(m)}:00Z`);
  return new Date(asIfUtc.getTime() - zoneOffset(asIfUtc, tz) * 60_000);
}

/** A task's deadline, from the team settings. */
export function useDeadline(task: Pick<Task, "due_date"> | null | undefined): Date | null {
  const s = useSettings().data;
  return useMemo(() => deadlineOf(task?.due_date, s?.work_end, s?.timezone), [task?.due_date, s?.work_end, s?.timezone]);
}

/** The time now, ticking every `ms` (every second by default) while the screen is open. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export interface Left {
  late: boolean;
  days: number;
  hours: number;
  mins: number;
  secs: number;
  /** red under a day or late, orange under 3 days, blue otherwise. */
  tone: "red" | "orange" | "blue";
}

/** How long until (or since) the deadline. */
export function timeLeft(deadline: Date, now: number): Left {
  const ms = deadline.getTime() - now;
  const late = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const mins = Math.floor(s / 60);
  const secs = s - mins * 60;
  const tone = late || ms < 86_400_000 ? "red" : ms < 3 * 86_400_000 ? "orange" : "blue";
  return { late, days, hours, mins, secs, tone };
}

/** "Thu 12 Nov, 5:30 pm" in the team's time zone. */
export function fmtDeadline(d: Date, tz = "Asia/Riyadh"): string {
  try {
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d).toLowerCase();
    return `${day}, ${time}`;
  } catch {
    return d.toLocaleString();
  }
}

/* ---------------------------------------------------------------- steps */

/** "Step 1" and so on: a step its owner hasn't named yet. */
export const isUnnamedStep = (text: string) => /^step \d+$/i.test(text.trim());

export interface OwnerSteps {
  userId: string;
  steps: ChecklistItem[];
  done: number;
  total: number;
}

/** Each person on the task with their own steps, in the order they're on the task. */
export function stepsByOwner(task: Pick<Task, "assignees">, items: ChecklistItem[]): OwnerSteps[] {
  const order = [...(task.assignees ?? [])];
  for (const i of items) if (i.assignee_id && !order.includes(i.assignee_id)) order.push(i.assignee_id);
  return order.map((userId) => {
    const steps = items
      .filter((i) => i.assignee_id === userId && !i.removed_at)
      .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
    return { userId, steps, done: steps.filter((s) => s.done).length, total: steps.length };
  });
}

/** Everyone's steps on these tasks (one query for the Home card and the daily update). */
export function useTrackedSteps(taskIds: string[]) {
  const key = taskIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["task_checklist", "tracked", key],
    enabled: taskIds.length > 0,
    queryFn: () =>
      unwrap<ChecklistItem[]>(
        supabase.from("task_checklist").select("*").in("task_id", taskIds).is("removed_at", null).order("position").order("created_at"),
      ),
  });
}

/** The tracked tasks still open or waiting for review. */
export function useTrackedTasks() {
  return useQuery({
    queryKey: ["tasks", "tracked"],
    queryFn: () =>
      unwrap<Task[]>(
        supabase.from("tasks").select("*").eq("tracked", true).is("approval", null).neq("status", "done").order("due_date").order("title"),
      ),
  });
}

export async function setStepDone(item: ChecklistItem, done: boolean) {
  const { error } = await supabase.from("task_checklist").update({ done }).eq("id", item.id);
  if (error) throw error;
}

export async function renameStep(item: ChecklistItem, text: string) {
  const t = text.trim().slice(0, 200);
  if (!t || t === item.text) return;
  const { error } = await supabase.from("task_checklist").update({ text: t }).eq("id", item.id);
  if (error) throw error;
}

/* ---------------------------------------------------------------- the stopwatch */

export function useTimeLogs(taskIds: string[]) {
  const key = taskIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["task_time_logs", key],
    enabled: taskIds.length > 0,
    queryFn: () =>
      unwrap<TimeLog[]>(supabase.from("task_time_logs").select("*").in("task_id", taskIds).order("started_at")),
  });
}

export async function startStopwatch(taskId: string) {
  const { error } = await supabase.rpc("stopwatch_start", { p_task: taskId });
  if (error) throw error;
}

/** Stops my stopwatch; returns the seconds that stretch ran. */
export async function stopStopwatch(): Promise<number> {
  const { data, error } = await supabase.rpc("stopwatch_stop");
  if (error) throw error;
  return (data as number) ?? 0;
}

const secsOf = (l: TimeLog, now: number) =>
  Math.max(0, Math.floor(((l.stopped_at ? new Date(l.stopped_at).getTime() : now) - new Date(l.started_at).getTime()) / 1000));

export interface TimeTotals {
  running: TimeLog | null;
  /** The stretch that's running now, in seconds. */
  runningSecs: number;
  todaySecs: number;
  totalSecs: number;
}

/** One person's time on one task: what's running, today and in all. `dayStart` is local midnight. */
export function timeTotals(logs: TimeLog[], taskId: string, userId: string, now: number, dayStart: number): TimeTotals {
  let todaySecs = 0;
  let totalSecs = 0;
  let running: TimeLog | null = null;
  for (const l of logs) {
    if (l.task_id !== taskId || l.user_id !== userId) continue;
    const s = secsOf(l, now);
    totalSecs += s;
    const start = new Date(l.started_at).getTime();
    const end = l.stopped_at ? new Date(l.stopped_at).getTime() : now;
    if (end > dayStart) todaySecs += Math.max(0, Math.floor((end - Math.max(start, dayStart)) / 1000));
    if (!l.stopped_at) running = l;
  }
  return { running, runningSecs: running ? secsOf(running, now) : 0, todaySecs, totalSecs };
}

export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "1:05:09" (or "05:09" under an hour), for a running stopwatch. */
export function fmtClockSecs(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "3h 05m", "42m" or "0m", for time spent. */
export function fmtSpent(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}
