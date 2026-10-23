// Celebrations: confetti and a glossy card when work is approved, or handed in early.
// Anything in the app calls celebrate(); the CelebrationHost in the app shell shows it.
import { dateOf, diffDays } from "./time";
import type { Task } from "./types";

export interface Celebration {
  /** approved: work signed off. early: handed in a day or more before the due date. on_time: on the due day. */
  kind: "approved" | "early" | "on_time";
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
