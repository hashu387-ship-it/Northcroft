// Liquid Glass look: the floating tab bar slims down while a page is scrolled down and comes back
// as soon as it's scrolled up (or near the top), like iOS 26. Sets data-scroll-down on <html>;
// the look's CSS (styles/liquidglass.css) does the rest. Other looks ignore it.
export function startLiquidGlassScroll() {
  const root = document.documentElement;
  const last = new WeakMap<EventTarget, number>();
  let down = false;
  const set = (v: boolean) => {
    if (v === down) return;
    down = v;
    if (v) root.dataset.scrollDown = "true";
    else delete root.dataset.scrollDown;
  };
  const onScroll = (ev: Event) => {
    if (root.dataset.palette !== "liquid") return set(false);
    const t = ev.target;
    const el = t === document ? document.scrollingElement : (t as Element | null);
    if (!el || !(el instanceof Element)) return;
    // Only page-sized scrollers (not a sideways chip row or a small list in a card).
    if (el !== document.scrollingElement && el.clientHeight < window.innerHeight * 0.6) return;
    const y = el.scrollTop;
    const prev = last.get(el) ?? y;
    last.set(el, y);
    if (y < 80) return set(false);
    if (y - prev > 6) set(true);
    else if (prev - y > 6) set(false);
  };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  // A new page starts with the full bar.
  window.addEventListener("popstate", () => set(false));
}

// Liquid Glass look: the light on a pressed button sits where the finger is, like iOS 26 and 27.
// Sets --lg-x and --lg-y on the control (styles/liquidglass-all.css draws the highlight).
const LIT = ".btn, .icon-btn, .chip-toggle, .fab, .segmented button, .tabs a, .tabs button";
export function startLiquidGlassLight() {
  const root = document.documentElement;
  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (root.dataset.palette !== "liquid") return;
      const el = (ev.target as Element | null)?.closest?.(LIT) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty("--lg-x", `${(((ev.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
      el.style.setProperty("--lg-y", `${(((ev.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
    },
    { capture: true, passive: true },
  );
}
