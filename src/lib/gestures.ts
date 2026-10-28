// Whole-screen phone gestures, attached to the app's scrolling content area:
//   * Swipe from the left edge to go back (in the installed app; the browser has its own). The
//     page follows the finger; let go past halfway, or flick, and it goes back, otherwise it
//     springs into place.
//   * Pull down at the top of a page to refresh. It stretches and resists like a rubber band, a
//     tick at the point where letting go refreshes, then a spinner while the page reloads.
// Neither starts on maps, drawings, PDFs, spreadsheets or photos (they use the finger themselves),
// nor while a sheet is open.
import { useEffect, type RefObject } from "react";
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
 * Swipe from the left edge to go back. `canGoBack` is asked when the swipe starts; `goBack` runs
 * once the page has slid away. `layer` is what slides (the page inside the content area).
 */
export function useEdgeSwipeBack(area: RefObject<HTMLElement>, layer: RefObject<HTMLElement>, canGoBack: () => boolean, goBack: () => void, ready = true) {
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const tracker = new VelocityTracker();
    let g: { x0: number; y0: number; locked: boolean; engaged: boolean } | null = null;
    const spring = new Spring(0, (x) => {
      const page = layer.current;
      if (!page) return;
      page.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
      el.style.setProperty("--edge-progress", String(Math.min(1, x / Math.max(1, el.clientWidth))));
      el.classList.toggle("edge-swiping", x > 0);
    });

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !isPhoneLayout() || !isInstalled() || sheetOpen()) return;
      const t = e.touches[0];
      if (t.clientX > 24) return;
      if (e.target instanceof Element && e.target.closest(OWN_GESTURES)) return;
      if (!canGoBack()) return;
      g = { x0: t.clientX, y0: t.clientY, locked: false, engaged: false };
    };
    const move = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.locked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.locked = true;
        if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * 1.2) {
          g = null;
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
    };
    const end = (e: TouchEvent) => {
      if (!g) return;
      const was = g;
      g = null;
      if (!was.engaged) return;
      const width = el.clientWidth || 390;
      const v = tracker.velocity(e.timeStamp);
      const x = spring.value;
      if (x + project(v) > width * 0.5 && v > -100) {
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
            goBack();
          },
        });
      } else {
        spring.to(0, SPRINGS.flick, { velocity: v });
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      spring.stop();
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [area, layer, canGoBack, goBack, ready]);
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

    const start = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1 || !isPhoneLayout() || sheetOpen()) return;
      if (e.target instanceof Element && e.target.closest(`${OWN_GESTURES}, ${NO_PULL}`)) return;
      if (!atTop(e.target, el)) return;
      const t = e.touches[0];
      // Leave the left edge to swipe-back.
      if (t.clientX <= 24 && isInstalled()) return;
      g = { x0: t.clientX, y0: t.clientY, locked: false, engaged: false, target: e.target };
    };
    const move = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.locked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        g.locked = true;
        if (dy <= 0 || Math.abs(dy) < Math.abs(dx) * 1.2 || !atTop(g.target, el)) {
          g = null;
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
    };
    const end = () => {
      if (!g) return;
      const was = g;
      g = null;
      if (!was.engaged) return;
      indicator.current?.classList.remove("armed");
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
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      spring.stop();
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [area, layer, indicator, refresh, ready]);
}
