// Rows of tabs that run past the side of the screen (a project's tabs, My tasks, Inbox on a phone):
// the edge that has more tabs behind it fades out, and the chosen tab is brought into view, so tabs
// like Files, Chat and Activity are easy to find. Works on every .segmented and .tabs row.
const ROWS = ".segmented, .tabs";

function mark(row: HTMLElement) {
  const max = row.scrollWidth - row.clientWidth;
  const more =
    max > 2
      ? [row.scrollLeft > 2 ? "left" : "", row.scrollLeft < max - 2 ? "right" : ""].filter(Boolean).join(" ")
      : "";
  if ((row.dataset.more ?? "") === more) return;
  if (more) row.dataset.more = more;
  else delete row.dataset.more;
}

/** Scroll the row so this tab is fully in view (without moving the page up or down). */
function reveal(row: HTMLElement, tab: HTMLElement, center: boolean) {
  const r = row.getBoundingClientRect();
  const t = tab.getBoundingClientRect();
  const left = t.left - r.left + row.scrollLeft;
  if (center) row.scrollLeft = left - (row.clientWidth - t.width) / 2;
  else if (t.left < r.left + 24) row.scrollTo({ left: left - 24, behavior: "smooth" });
  else if (t.right > r.right - 24) row.scrollTo({ left: left + t.width - row.clientWidth + 24, behavior: "smooth" });
}

let started = false;
export function startScrollHints() {
  if (started || typeof document === "undefined") return;
  started = true;
  const seen = new WeakSet<HTMLElement>();
  const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver((list) => list.forEach((e) => mark(e.target as HTMLElement))) : null;

  let queued = false;
  const scan = () => {
    queued = false;
    document.querySelectorAll<HTMLElement>(ROWS).forEach((row) => {
      if (!seen.has(row)) {
        seen.add(row);
        resize?.observe(row);
        const active = row.querySelector<HTMLElement>(".active, [aria-selected='true']");
        if (active && row.scrollWidth > row.clientWidth) reveal(row, active, true);
      }
      mark(row);
    });
  };
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  };

  new MutationObserver(later).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.addEventListener(
    "scroll",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t.matches(ROWS)) mark(t);
    },
    { capture: true, passive: true },
  );
  // A tab tapped at the edge slides fully into view.
  document.addEventListener("click", (e) => {
    const tab = (e.target as Element | null)?.closest?.("a, button") as HTMLElement | null;
    const row = tab?.parentElement?.closest?.(ROWS) as HTMLElement | null;
    if (tab && row && row.scrollWidth > row.clientWidth) reveal(row, tab, false);
  });
  later();
}
