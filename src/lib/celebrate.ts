// Celebrations: confetti and a glossy card when work is approved, handed in early, or someone
// checks in before 8:00 am. Anything in the app calls celebrate(); the CelebrationHost in the app
// shell shows it.
import { supabase } from "./supabase";
import { dateOf, diffDays, fmtTime, fmtTime12, todayISO, weekStart } from "./time";
import type { Task } from "./types";

export interface Celebration {
  /**
   * approved: work signed off. early: handed in a day or more before the due date. on_time: on the
   * due day. early_start: checked in before 8:00 am.
   */
  kind: "approved" | "early" | "on_time" | "early_start";
  headline: string;
  line: string;
  /** The task title (or titles). */
  detail?: string;
  /** A gold chip under the text, such as "Finished 2 days early". */
  chip?: string;
}

const EVENT = "nc-celebrate";

export function celebrate(c: Celebration) {
  window.dispatchEvent(new CustomEvent<Celebration>(EVENT, { detail: c }));
}

export function onCelebrate(fn: (c: Celebration) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<Celebration>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** How many days before its due date the task was handed in (0 if on the day or late, or never handed in). */
export function earlyDays(t: Pick<Task, "submitted_at" | "due_date">): number {
  if (!t.submitted_at || !t.due_date) return 0;
  return Math.max(0, diffDays(t.due_date, dateOf(t.submitted_at)));
}

export const daysText = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/* ---------------------------------------------------------------- early starts */
/** Checking in before this time (Riyadh) counts as an early start. */
export const EARLY_START = "08:00";

/** True when a check-in time is before 8:00 am in Riyadh. */
export function isEarlyStart(ts: string | null | undefined): boolean {
  return !!ts && fmtTime(ts) < EARLY_START;
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The streak line: "Your first early start this week", "Your 3rd early start this week". */
export function earlyStreakText(n: number): string {
  return n <= 1 ? "Your first early start this week" : `Your ${ordinal(n)} early start this week`;
}

/**
 * Confetti and a "Great job" card for checking in before 8:00 am, with how many early starts
 * this person has made this week (Sunday to today). With no signal the streak is left off.
 */
export async function celebrateEarlyStart(userId: string, name: string, at: string) {
  if (!isEarlyStart(at)) return;
  let streak: number | null = null;
  try {
    const today = todayISO();
    const { data, error } = await supabase
      .from("attendance")
      .select("work_date, check_in_at")
      .eq("user_id", userId)
      .gte("work_date", weekStart(today))
      .lte("work_date", today);
    if (error) throw error;
    const days = new Set((data ?? []).filter((r) => isEarlyStart(r.check_in_at)).map((r) => r.work_date as string));
    // Today counts even if the check-in is still waiting on the phone to be sent.
    days.add(dateOf(at));
    streak = days.size;
  } catch {
    streak = null;
  }
  celebrate({
    kind: "early_start",
    headline: `Great job, ${name}!`,
    line: `You're in at ${fmtTime12(at)}, before 8:00. That's a strong start to the day.`,
    chip: streak ? earlyStreakText(streak) : undefined,
  });
}

/* ---------------------------------------------------------------- sound and buzz */
const SOUND_KEY = "nc-celebrate-sound";

/** The chime and buzz are on unless switched off in Settings > Appearance (per device). */
export function extrasOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}
export function setExtrasOn(on: boolean) {
  try {
    if (on) localStorage.removeItem(SOUND_KEY);
    else localStorage.setItem(SOUND_KEY, "off");
  } catch {
    /* still applies for this visit */
  }
}

let audio: AudioContext | null = null;

/** A soft rising chime, made on the spot (no sound file). iPhones keep it quiet on silent. */
export function chime(big: boolean) {
  try {
    // Ask Safari to treat it like a game sound, which the silent switch mutes.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "ambient";
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const ctx = audio;
    if (ctx.state === "suspended") void ctx.resume();
    const notes = big ? [659.25, 830.61, 987.77, 1318.51] : [783.99, 1046.5];
    const start = ctx.currentTime + 0.02;
    notes.forEach((freq, i) => {
      const t = start + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  } catch {
    /* no sound is fine */
  }
}

/** A short double buzz. Android only: iPhones don't let web apps vibrate. */
export function buzz(big: boolean) {
  try {
    navigator.vibrate?.(big ? [22, 60, 34] : [18]);
  } catch {
    /* not supported */
  }
}
