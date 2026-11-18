// Cards that open into pages. Tapping a card (a task row, a project) names it for the browser's
// view transition and goes to the page; the page's matching "hero" takes over the name, so the
// card grows into the page. Going back with the app's back button shrinks it into the card again.
// Where the browser can't do it, or with reduce motion on, the page changes the usual way.
import { flushSync } from "react-dom";
import type { NavigateFunction } from "react-router-dom";
import { prefersReducedMotion } from "./motion";

interface ViewTransition {
  finished: Promise<void>;
}
type Starter = (update: () => Promise<void> | void) => ViewTransition;

const NAME = "morph";
const starter = (): Starter | null => {
  const d = document as Document & { startViewTransition?: Starter };
  return typeof d.startViewTransition === "function" ? d.startViewTransition.bind(d) : null;
};
export const canMorph = () => !!starter() && !prefersReducedMotion();

let morphing = false;
/** A card is growing into a page (or back) right now: the page skips its own slide. */
export const isMorphing = () => morphing;
/** The last card that opened into a page, so Back can shrink the page into it again. */
let last: { key: string; to: string } | null = null;

const sel = (attr: string, key: string) => `[${attr}="${key.replace(/["\\]/g, "\\$&")}"]`;
const hero = (key: string) => document.querySelector<HTMLElement>(sel("data-morph", key));
const sources = (key: string) => [...document.querySelectorAll<HTMLElement>(sel("data-morph-src", key))];

function inView(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
}

/** Wait (a short while) for something to be on the page. Timers, not frames: the screen is held still. */
function waitFor<T>(find: () => T | null | undefined, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      const got = find();
      if (got) resolve(got);
      else if (performance.now() - t0 > ms) resolve(null);
      else window.setTimeout(tick, 16);
    };
    tick();
  });
}

/** Go to a page with this card growing into it. `key` matches the page's data-morph. */
export function morphTo(navigate: NavigateFunction, to: string, key: string, card: HTMLElement | null) {
  const start = starter();
  if (!card || !start || prefersReducedMotion()) {
    navigate(to);
    return;
  }
  card.style.viewTransitionName = NAME;
  morphing = true;
  let vt: ViewTransition;
  try {
    vt = start(async () => {
      card.style.viewTransitionName = "";
      flushSync(() => navigate(to));
      const target = await waitFor(() => hero(key), 500);
      if (target) target.style.viewTransitionName = NAME;
    });
  } catch {
    card.style.viewTransitionName = "";
    morphing = false;
    navigate(to);
    return;
  }
  last = { key, to };
  const done = () => {
    morphing = false;
    const t = hero(key);
    if (t) t.style.viewTransitionName = "";
  };
  vt.finished.then(done, done);
}

/** Back from a page a card opened into: the page shrinks into its card. False when there's
 *  nothing to shrink into; the caller then goes back the usual way. */
export function morphBack(navigate: NavigateFunction): boolean {
  const start = starter();
  if (!last || !start || prefersReducedMotion() || window.location.pathname !== last.to) return false;
  const { key } = last;
  last = null;
  const page = hero(key);
  if (!page) return false;
  page.style.viewTransitionName = NAME;
  morphing = true;
  let vt: ViewTransition;
  try {
    vt = start(async () => {
      page.style.viewTransitionName = "";
      const popped = new Promise<void>((r) => window.addEventListener("popstate", () => r(), { once: true }));
      navigate(-1);
      await Promise.race([popped, new Promise<void>((r) => window.setTimeout(r, 400))]);
      const card = await waitFor(() => sources(key).find(inView), 350);
      if (card) card.style.viewTransitionName = NAME;
    });
  } catch {
    page.style.viewTransitionName = "";
    morphing = false;
    return false;
  }
  const done = () => {
    morphing = false;
    for (const s of sources(key)) s.style.viewTransitionName = "";
  };
  vt.finished.then(done, done);
  return true;
}
