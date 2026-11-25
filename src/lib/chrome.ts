// The floating bars react to scrolling, the way iOS 26 and 27 do it:
//   data-scrolled      the page has moved under the top bar: its soft glass edge fades in
//   data-title-shown   the large title has scrolled away: the top bar shows the title, small
//   data-scroll-down   scrolling down a long page on a phone: the tab bar shrinks to the current tab
//                      (it comes back as soon as you scroll up, or near the top)
// The top bar's small title is copied from the page's large title (.page-head h1).
// Styles: styles/core.css (.topbar, .tabbar).
export function startChrome() {
  const root = document.documentElement;
  const last = new WeakMap<Element, number>();
  let frame = 0;
  let pending: Element | null = null;

  const flag = (name: string, on: boolean) => {
    if (on) root.dataset[name] = "true";
    else delete root.dataset[name];
  };

  const scroller = (): Element | null =>
    root.classList.contains("shell-scroll") ? document.querySelector(".main") : document.scrollingElement;

  const syncTitle = () => {
    const h1 = document.querySelector(".main .page-head h1, .main .home-title h1");
    const bar = document.querySelector(".topbar .title");
    const text = h1?.textContent?.trim() ?? "";
    if (bar && bar.textContent !== text) bar.textContent = text;
    return h1;
  };

  const update = (el: Element | null) => {
    if (!el) return;
    const y = el.scrollTop;
    flag("scrolled", y > 4);
    const h1 = syncTitle();
    if (h1) {
      const r = h1.getBoundingClientRect();
      const barBottom = (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) || 60;
      flag("titleShown", r.bottom < barBottom);
    } else {
      flag("titleShown", y > 40);
    }
    const prev = last.get(el) ?? y;
    last.set(el, y);
    if (window.innerWidth >= 900 || y < 80) flag("scrollDown", false);
    else if (y - prev > 8) flag("scrollDown", true);
    else if (prev - y > 8) flag("scrollDown", false);
  };

  const onScroll = (ev: Event) => {
    const t = ev.target;
    const el = t === document ? document.scrollingElement : (t as Element | null);
    if (!el || !(el instanceof Element)) return;
    // Only the page itself (not a sideways row of chips or a small list inside a card).
    if (el !== scroller()) return;
    pending = el;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update(pending);
    });
  };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });

  // A new page: reset to the top state and pick up its title.
  const reset = () => {
    flag("scrollDown", false);
    requestAnimationFrame(() => update(scroller()));
  };
  window.addEventListener("popstate", reset);
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncTitle();
    });
  });
  const watch = () => {
    const main = document.querySelector(".main-inner");
    if (main) observer.observe(main, { childList: true, subtree: true });
    else setTimeout(watch, 400);
  };
  watch();
  window.addEventListener("nc-route", reset);
}
