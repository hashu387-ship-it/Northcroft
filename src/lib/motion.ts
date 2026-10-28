// Motion that feels physical, after Apple's "Designing Fluid Interfaces": springs described by a
// damping ratio (1 = no bounce, lower = a little overshoot) and a response (roughly how quickly it
// gets there, in seconds). A spring always starts from where the thing is on screen right now and
// keeps its speed when it's sent somewhere new, so anything moving can be grabbed and turned back.
//
// Also here: where a flick would come to rest (momentum projection), the soft resistance past an
// edge (rubber band), finger speed, a short vibration for moments that matter (Android only;
// iPhones don't let web apps vibrate), and the phone's reduce-motion and reduce-transparency settings.

export interface SpringParams {
  /** 1 = settles without overshoot; 0.8 = a small, physical bounce. */
  damping: number;
  /** Seconds; lower is snappier. Not a duration: a spring settles when it settles. */
  response: number;
}

/** The app's springs. Most things don't bounce; only something thrown by a finger does. */
export const SPRINGS = {
  /** Things appearing, moving into place. */
  standard: { damping: 1, response: 0.34 },
  /** Sheets and drawers. */
  sheet: { damping: 0.88, response: 0.32 },
  /** After a flick or a drag let go: a little bounce, because the finger gave it momentum. */
  flick: { damping: 0.8, response: 0.36 },
  /** Small, quick things (a row snapping back). */
  snappy: { damping: 1, response: 0.24 },
} satisfies Record<string, SpringParams>;

const reduceMotionQuery = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

/** The phone or computer asks for less motion: cross-fades instead of slides and springs. */
export const prefersReducedMotion = () => !!reduceMotionQuery?.matches;

/**
 * A number moved by a spring (a position, a scale, a 0 to 1 progress). `set` follows a finger
 * exactly; `to` springs to a target from the current value and speed.
 */
export class Spring {
  value: number;
  velocity = 0;
  private target: number;
  private params: SpringParams = SPRINGS.standard;
  private raf = 0;
  private last = 0;
  private done: (() => void) | null = null;
  private precision: number;

  constructor(
    initial: number,
    private onUpdate: (value: number) => void,
    opts: { precision?: number } = {},
  ) {
    this.value = initial;
    this.target = initial;
    this.precision = opts.precision ?? 0.5;
  }

  get moving() {
    return this.raf !== 0;
  }

  /** Put it exactly here (a finger is holding it). */
  set(value: number) {
    this.stop();
    this.value = value;
    this.target = value;
    this.onUpdate(value);
  }

  /** Spring to `target` from wherever it is now. `velocity` (units per second) carries a flick's speed. */
  to(target: number, params: SpringParams = SPRINGS.standard, opts: { velocity?: number; onRest?: () => void } = {}) {
    this.target = target;
    this.params = params;
    if (opts.velocity != null) this.velocity = opts.velocity;
    // A new destination replaces the old one (and whatever was to happen on arriving there).
    this.done = opts.onRest ?? null;
    if (prefersReducedMotion()) {
      // No travel: the value lands at once (callers fade instead).
      this.finish();
      return;
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.done = null;
  }

  private finish() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.value = this.target;
    this.velocity = 0;
    this.onUpdate(this.value);
    const done = this.done;
    this.done = null;
    done?.();
  }

  private tick = (now: number) => {
    // Small fixed steps keep it stable whatever the frame rate, and slow frames still keep time
    // (it doesn't drag in slow motion). A long pause (tab hidden) is capped.
    let dt = Math.max(0, Math.min((now - this.last) / 1000, 1 / 8));
    this.last = now;
    const k = Math.pow((2 * Math.PI) / this.params.response, 2);
    const c = (4 * Math.PI * this.params.damping) / this.params.response;
    const step = 1 / 240;
    while (dt > 0) {
      const h = Math.min(step, dt);
      const force = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
      dt -= h;
    }
    if (Math.abs(this.velocity) < this.precision * 2 && Math.abs(this.value - this.target) < this.precision) {
      this.finish();
      return;
    }
    this.onUpdate(this.value);
    this.raf = requestAnimationFrame(this.tick);
  };
}

/**
 * Where something flicked at `velocity` (px/s) would come to rest, like a scrolling list slowing
 * down. Pick the nearest resting place to this, not to where the finger let go.
 */
export function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Dragged `overshoot` px past an edge: it follows less and less, like something real slowing to a stop. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  const o = Math.abs(overshoot);
  return (Math.sign(overshoot) * (o * dimension * constant)) / (dimension + constant * o);
}

/**
 * The finger's speed (px/s) from its last few moves. Times come from the touch events themselves
 * (when the finger moved), not from when the app got round to them, so a busy moment on the phone
 * doesn't turn a flick into a slow drag.
 */
export class VelocityTracker {
  private points: { t: number; v: number }[] = [];
  reset() {
    this.points = [];
  }
  add(value: number, t = performance.now()) {
    this.points.push({ t, v: value });
    while (this.points.length > 2 && t - this.points[0].t > 100) this.points.shift();
  }
  /** `now`: when the finger lifted (the touchend event's time). */
  velocity(now = performance.now()) {
    if (this.points.length < 2) return 0;
    const a = this.points[0];
    const b = this.points[this.points.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return 0;
    // A finger held still before letting go has no speed left.
    if (now - b.t > 80) return 0;
    return (b.v - a.v) / dt;
  }
}

/**
 * A short vibration for a moment that matters: a swipe action happening, a sheet snapping shut, a
 * refresh starting. Never on ordinary taps. Android only; nothing happens elsewhere.
 */
export function haptic(kind: "tick" | "success" | "warning" = "tick") {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    if (typeof nav.vibrate !== "function") return;
    nav.vibrate(kind === "tick" ? 8 : kind === "success" ? [10, 40, 14] : [16, 60, 16]);
  } catch {
    // Not allowed here; no matter.
  }
}

/** Phone-sized screen (the app's phone layout). */
export const isPhoneLayout = () => typeof window !== "undefined" && window.matchMedia("(max-width: 899px)").matches;

/** The app is installed on the home screen (no browser bar, so no browser back swipe either). */
export const isInstalled = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

/* ---------------------------------------------------------------- where taps happen */
// Sheets open from where they were tapped, so the app remembers the last press for a moment.
let lastPress: { x: number; y: number; t: number } | null = null;
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastPress = { x: e.clientX, y: e.clientY, t: performance.now() };
    },
    { capture: true, passive: true },
  );
}
/** Where the last tap or click was, if it was just now. */
export function recentPress(withinMs = 1200) {
  return lastPress && performance.now() - lastPress.t < withinMs ? lastPress : null;
}
