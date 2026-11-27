// Whole-screen phone gestures, attached to the app's scrolling content area:
//   * Swipe from the left edge to go back (in the installed app; the browser has its own). The
//     page follows the finger; let go past halfway, or flick, and it goes back, otherwise it
//     springs into place.
//   * Pull down at the top of a page to refresh. It stretches and resists like a rubber band, a
//     tick at the point where letting go refreshes, then a spinner while the page reloads.
// Neither starts on maps, drawings, PDFs, spreadsheets or photos (they use the finger themselves),
// nor while a sheet is open.
import { useEffect, useRef, type RefObject } from "react";
import { haptic, isInstalled, isPhoneLayout, project, rubberband, Spring, SPRINGS, VelocityTracker } from "./motion";

/** Places that use sideways or downward drags for themselves. */
const OWN_GESTURES = ".leaflet-container, .dwg-viewer, .pdf-editor, .sheet-editor, .xgrid, .img-viewer, .file-view, canvas, [data-own-gestures]";

/** Places where pulling down at the top shouldn't refresh (an open chat: that's its oldest messages). */
const NO_PULL = ".chat-pane, [data-no-pull]";

const sheetOpen = () => !!document.querySelector(".sheet-backdrop");

/** Every scrolling box between the touched element and the content area is at its top. */
function atTop(target: EventTarget | null, stop: HTMLElement) {
  let el = target instanceof Element ? target : null;
  while (el && el !== stop) {
    if (el instanceof HTMLElement && el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return false;
    el = el.parentElement;
  }
  return stop.scrollTop <= 0;
}

/**
 * The rest of a touch goes to the element it started on, even after that element has been taken
 * off the page (a list redrawn because new data came in). From then on it no longer reaches the
 * content area, so a gesture part-way through would never hear the finger lift and the page would
 * stay where the finger left it. So the moves and the lift are also heard on that element itself,
 * for as long as the touch lasts. Returns what stops listening.
 */
function followTouch(target: EventTarget | null, move: (e: TouchEvent) => void, end: (e: TouchEvent) => void) {
  if (!(target instanceof Node)) return () => undefined;
  const onMove = move as EventListener;
  const onEnd = end as EventListener;
  target.addEventListener("touchmove", onMove, { passive: false });
  target.addEventListener("touchend", onEnd);
  target.addEventListener("touchcancel", onEnd);
  return () => {
    target.removeEventListener("touchmove", onMove);
    target.removeEventListener("touchend", onEnd);
    target.removeEventListener("touchcancel", onEnd);
  };
}

/** Wraps a handler so an event heard twice (on the touched element and on the content area) counts once. */
function oncePerEvent(fn: (e: TouchEvent) => void) {
  const seen = new WeakSet<Event>();
  return (e: TouchEvent) => {
    if (seen.has(e)) return;
    seen.add(e);
    fn(e);
  };
}

/**
 * Swipe from the left edge to go back. `canGoBack` is asked when the swipe starts; `goBack` runs
 * once the page has slid away. `layer` is what slides (the page inside the content area).
 * `pageKey` changes with every page change: whatever happens, a new page is never shown shifted.
 */
export function useEdgeSwipeBack(area: RefObject<HTMLElement>, layer: RefObject<HTMLElement>, canGoBack: () => boolean, goBack: () => void, ready = true, pageKey?: unknown) {
  // The latest callbacks, read when they're needed. The gesture itself is set up once: setting it
  // up again on each page change (navigate changes then) used to stop a slide part-way and leave
  // the page stuck across the screen.
  const canGoBackRef = useRef(canGoBack);
  canGoBackRef.current = canGoBack;
  const goBackRef = useRef(goBack);
  goBackRef.current = goBack;
  const resetRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const tracker = new VelocityTracker();
    let g: { x0: number; y0: number; locked: boolean; engaged: boolean } | null = null;
    let unfollow = () => {};
    const spring = new Spring(0, (x) => {
      const page = layer.current;
      if (!page) return;
      page.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
      el.style.setProperty("--edge-progress", String(Math.min(1, x / Math.max(1, el.clientWidth))));
      el.classList.toggle("edge-swiping", x > 0);
    });

    /** A swipe that never heard the finger lift is over: the page goes back into place. */
    const abandon = () => {
      unfollow();
      unfollow = () => {};
      const was = g;
      g = null;
      if (was?.engaged) spring.to(0, SPRINGS.snappy);
    };

    const start = (e: TouchEvent) => {
      // A new first finger while a swipe is still open: the last one ended somewhere we didn't hear.
      if (g && e.touches.length === 1) abandon();
      if (e.touches.length !== 1 || !isPhoneLayout() || !isInstalled() || sheetOpen()) return;
      const t = e.touches[0];
      if (t.clientX > 24) return;
      if (e.target instanceof Element && e.target.closest(OWN_GESTURES)) return;
      if (!canGoBackRef.current()) return;
      g = { x0: t.clientX, y0: t.clientY, locked: false, engaged: false };
      unfollow = followTouch(e.target, move, end);
    };
    const move = oncePerEvent((e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.locked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.locked = true;
        if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * 1.2) {
          abandon();
          return;
        }
        g.engaged = true;
        g.x0 = t.clientX;
        spring.stop();
        tracker.reset();
      }
      e.preventDefault();
      const x = Math.max(0, t.clientX - g.x0);
      spring.set(x);
      tracker.add(x, e.timeStamp);
    });
    const end = oncePerEvent((e: TouchEvent) => {
      if (!g) return;
      // Another finger lifting while this one is still down isn't the end of the swipe.
      if (e.type === "touchend" && e.touches.length > 0) return;
      const was = g;
      g = null;
      unfollow();
      unfollow = () => {};
      if (!was.engaged) return;
      const width = el.clientWidth || 390;
      const v = e.type === "touchcancel" ? 0 : tracker.velocity(e.timeStamp);
      const x = spring.value;
      if (e.type !== "touchcancel" && x + project(v) > width * 0.5 && v > -100) {
        spring.to(width, SPRINGS.standard, {
          velocity: Math.max(v, 0),
          onRest: () => {
            // The old page has slid away: the one going back to settles in where it was (AppShell
            // reads this flag), once the browser has actually gone back. Not before, or the old
            // page would flash back for a moment.
            const page = layer.current;
            if (page) page.dataset.swiped = "true";
            let done = false;
            const settle = (wentBack: boolean) => {
              if (done) return;
              done = true;
              window.removeEventListener("popstate", onPop);
              // Nowhere to go back to after all: the page simply comes back.
              if (!wentBack && page) delete page.dataset.swiped;
              requestAnimationFrame(() => spring.set(0));
            };
            const onPop = () => settle(true);
            window.addEventListener("popstate", onPop);
            window.setTimeout(() => settle(false), 700);
            goBackRef.current();
          },
        });
      } else {
        // Cancelled by the phone (a call, the app put away) or not far enough: back into place.
        spring.to(0, SPRINGS.flick, { velocity: v });
      }
    });
    // The app put away mid-swipe (iOS may never send the end of that touch), or back in the app
    // with a page left part-way across: it comes back into place.
    const onVisibility = () => {
      if (g) {
        abandon();
        return;
      }
      if (document.visibilityState !== "visible" || spring.moving || layer.current?.dataset.swiped) return;
      if (spring.value !== 0 || layer.current?.style.transform) spring.set(0);
    };
    // A new page: nothing left over from a swipe on the last one.
    resetRef.current = () => {
      if (g) abandon();
      if (spring.moving && !layer.current?.dataset.swiped && spring.value > 0) return; // springing back already
      if (layer.current?.dataset.swiped) return; // a finished swipe settles itself in a moment
      spring.stop();
      if (spring.value !== 0 || layer.current?.style.transform) spring.set(0);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unfollow();
      spring.stop();
      resetRef.current = () => undefined;
      // Never leave the page shifted sideways when the gesture goes away.
      if (layer.current) layer.current.style.transform = "";
      el.classList.remove("edge-swiping");
      el.style.removeProperty("--edge-progress");
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [area, layer, ready]);

  useEffect(() => {
    resetRef.current();
  }, [pageKey]);
}

/** How far to pull before letting go refreshes, and where the page waits while it does. */
const PULL_TRIGGER = 72;
const PULL_HOLD = 56;

/**
 * Pull down at the top of the page to refresh. `indicator` is the round arrow that appears above
 * the page; `refresh` reloads what's on screen.
 */
export function usePullToRefresh(area: RefObject<HTMLElement>, layer: RefObject<HTMLElement>, indicator: RefObject<HTMLElement>, refresh: () => Promise<unknown>, ready = true) {
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    let g: { x0: number; y0: number; locked: boolean; engaged: boolean; target: EventTarget | null } | null = null;
    let armed = false;
    let busy = false;
    let unfollow = () => {};
    const draw = (y: number) => {
      const page = layer.current;
      if (page) page.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
      const ind = indicator.current;
      if (ind) {
        const p = Math.min(1, y / PULL_TRIGGER);
        ind.style.opacity = String(Math.min(1, p * 1.2));
        ind.style.transform = `translate3d(-50%, ${Math.min(y, PULL_TRIGGER + 20) - 40}px, 0) rotate(${p * 270}deg) scale(${0.6 + 0.4 * p})`;
      }
    };
    const spring = new Spring(0, draw);

    /** A pull that never heard the finger lift is over: the page goes back up without refreshing. */
    const abandon = () => {
      unfollow();
      unfollow = () => {};
      const was = g;
      g = null;
      armed = false;
      indicator.current?.classList.remove("armed");
      if (was?.engaged && !busy) spring.to(0, SPRINGS.snappy);
    };

    const start = (e: TouchEvent) => {
      // A new first finger while a pull is still open: the last one ended somewhere we didn't hear.
      if (g && e.touches.length === 1) abandon();
      if (busy || e.touches.length !== 1 || !isPhoneLayout() || sheetOpen()) return;
      if (e.target instanceof Element && e.target.closest(`${OWN_GESTURES}, ${NO_PULL}`)) return;
      if (!atTop(e.target, el)) return;
      const t = e.touches[0];
      // Leave the left edge to swipe-back.
      if (t.clientX <= 24 && isInstalled()) return;
      g = { x0: t.clientX, y0: t.clientY, locked: false, engaged: false, target: e.target };
      unfollow = followTouch(e.target, move, end);
    };
    const move = oncePerEvent((e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.locked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.locked = true;
        if (dy <= 0 || Math.abs(dy) < Math.abs(dx) * 1.2 || !atTop(g.target, el)) {
          abandon();
          return;
        }
        g.engaged = true;
        g.y0 = t.clientY;
        spring.stop();
        armed = false;
      }
      e.preventDefault();
      const pulled = Math.max(0, t.clientY - g.y0);
      // The further it's pulled, the more it resists.
      const y = rubberband(pulled, el.clientHeight || 700, 0.55);
      spring.set(y);
      const nowArmed = y >= PULL_TRIGGER;
      if (nowArmed && !armed) haptic("tick");
      armed = nowArmed;
      indicator.current?.classList.toggle("armed", armed);
    });
    const end = oncePerEvent((e: TouchEvent) => {
      if (!g) return;
      // Another finger lifting while this one is still down isn't the end of the pull.
      if (e.type === "touchend" && e.touches.length > 0) return;
      const was = g;
      g = null;
      unfollow();
      unfollow = () => {};
      if (!was.engaged) return;
      indicator.current?.classList.remove("armed");
      // Cancelled by the phone (a call, the app put away): no refresh, just back into place.
      if (e.type === "touchcancel") armed = false;
      if (!armed) {
        spring.to(0, SPRINGS.snappy);
        return;
      }
      armed = false;
      busy = true;
      indicator.current?.classList.add("spinning");
      spring.to(PULL_HOLD, SPRINGS.standard);
      const started = performance.now();
      Promise.resolve(refresh())
        .catch(() => undefined)
        .then(() => new Promise((r) => setTimeout(r, Math.max(0, 450 - (performance.now() - started)))))
        .finally(() => {
          indicator.current?.classList.remove("spinning");
          spring.to(0, SPRINGS.standard, { onRest: () => (busy = false) });
        });
    });
    // The app put away mid-pull: no refresh, the page goes back up.
    const onVisibility = () => {
      if (g) abandon();
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unfollow();
      spring.stop();
      // Never leave the page pulled down when the gesture goes away.
      if (layer.current) layer.current.style.transform = "";
      indicator.current?.classList.remove("armed", "spinning");
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [area, layer, indicator, refresh, ready]);
}
