// Long-press menus, the way iOS does them: press and hold a row (or right-click it on a computer)
// and the row lifts out of the page, everything behind it blurs, and a glass menu of actions grows
// out of it. Tap an action, tap outside, press Escape or scroll to close.
//
//   const menu = useContextMenu(() => [{ label: "Mark as read", icon: <MailOpen />, run: ... }]);
//   <div {...menu}>...</div>
//
// The lifted row is a still copy of what was pressed, so it can be anything. Holding still for half
// a second opens the menu; moving the finger first (to scroll or swipe) cancels it, so it never
// fights with scrolling or with the swipe actions on the same row.
import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { haptic, prefersReducedMotion } from "@/lib/motion";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  run: () => unknown;
  danger?: boolean;
  disabled?: boolean;
}

/** Items, with null between groups for a divider. */
export type MenuItems = (MenuItem | null | false | undefined)[];

interface Open {
  rect: DOMRect;
  clone: HTMLElement;
  items: MenuItem[][];
  title?: string;
}

let setOpenGlobal: ((o: Open | null) => void) | null = null;

/** Put once near the top of the app: where the menus appear. */
export function ContextMenuHost() {
  const [open, setOpen] = useState<Open | null>(null);
  useEffect(() => {
    setOpenGlobal = setOpen;
    return () => {
      setOpenGlobal = null;
    };
  }, []);
  if (!open) return null;
  return <MenuLayer open={open} onClose={() => setOpen(null)} />;
}

function MenuLayer({ open, onClose }: { open: Open; onClose: () => void }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; shift: number; origin: string; scale: number } | null>(null);

  useLayoutEffect(() => {
    const host = previewRef.current;
    if (host && !host.firstChild) host.appendChild(open.clone);
    const menu = menuRef.current;
    if (!menu) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const safeTop = 54;
    const safeBottom = 24;
    const r = open.rect;
    const mh = menu.offsetHeight;
    const mw = menu.offsetWidth;
    const gap = 10;
    // A very tall row shrinks a little so the menu still fits.
    const room = vh - safeTop - safeBottom - mh - gap;
    const scale = r.height > room ? Math.max(0.5, room / r.height) : 1;
    const h = r.height * scale;
    let top = r.top;
    let shift = 0;
    if (r.top + h + gap + mh > vh - safeBottom) {
      // Not enough room below: the row moves up until the menu fits under it.
      const wanted = vh - safeBottom - mh - gap - h;
      shift = Math.max(safeTop, wanted) - r.top;
      top = r.top + shift;
    }
    if (top < safeTop) {
      shift += safeTop - top;
      top = safeTop;
    }
    let menuTop = top + h + gap;
    if (menuTop + mh > vh - safeBottom) menuTop = Math.max(safeTop, top - gap - mh);
    const alignRight = r.left + r.width / 2 > vw / 2;
    const left = Math.min(Math.max(12, alignRight ? r.right - mw : r.left), vw - mw - 12);
    setPos({ top: menuTop, left, shift, scale, origin: `${alignRight ? "right" : "left"} ${menuTop < top ? "bottom" : "top"}` });
  }, [open]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const scroll = () => onClose();
    window.addEventListener("keydown", key);
    window.addEventListener("resize", scroll);
    window.addEventListener("scroll", scroll, { capture: true, passive: true });
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", scroll);
      window.removeEventListener("scroll", scroll, { capture: true });
    };
  }, [onClose]);

  const r = open.rect;
  return createPortal(
    <>
      <div className="ctx-layer" onClick={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div
        ref={previewRef}
        className="ctx-preview"
        aria-hidden
        style={{
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
          transformOrigin: "top center",
          transform: pos ? `translateY(${pos.shift}px) scale(${pos.scale * 1.02})` : undefined,
          transition: prefersReducedMotion() ? "none" : "transform 0.45s var(--spring)",
        }}
      />
      <div
        ref={menuRef}
        className="ctx-menu"
        role="menu"
        aria-label={open.title ?? "Actions"}
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? 0, ["--ctx-origin" as string]: pos?.origin ?? "top left", visibility: pos ? "visible" : "hidden" }}
      >
        {open.title && <div className="ctx-title">{open.title}</div>}
        {open.items.map((group, gi) => (
          <div key={gi} className="ctx-group">
            {gi > 0 && <div className="ctx-sep" />}
            {group.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={clsx(it.danger && "danger")}
                disabled={it.disabled}
                onClick={() => {
                  onClose();
                  // After the menu has gone, so anything it opens (a sheet, a page) isn't behind it.
                  window.setTimeout(() => void it.run(), 0);
                }}
              >
                {it.label}
                {it.icon}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>,
    document.body,
  );
}

function groupsOf(items: MenuItems): MenuItem[][] {
  const out: MenuItem[][] = [[]];
  for (const it of items) {
    if (it === null) {
      if (out[out.length - 1].length) out.push([]);
    } else if (it) out[out.length - 1].push(it);
  }
  return out.filter((g) => g.length);
}

/** Open a menu for an element straight away (from a ··· button, say). */
export function openContextMenu(el: HTMLElement, items: MenuItems, title?: string) {
  const groups = groupsOf(items);
  if (!groups.length || !setOpenGlobal) return;
  const rect = el.getBoundingClientRect();
  const clone = el.cloneNode(true) as HTMLElement;
  clone.style.margin = "0";
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.transform = "none";
  clone.removeAttribute("id");
  haptic("press");
  setOpenGlobal({ rect, clone, items: groups, title });
}

/**
 * Long press (touch) and right-click (mouse) on an element open its menu. Spread the result on the
 * element. `items` is read when the menu opens, so it can depend on the latest state.
 */
export function useContextMenu(items: () => MenuItems, opts: { title?: () => string | undefined; disabled?: boolean } = {}) {
  const timer = useRef<number>(0);
  const start = useRef<{ x: number; y: number; el: HTMLElement } | null>(null);
  const fired = useRef(false);
  const latest = useRef({ items, opts });
  latest.current = { items, opts };

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const fire = useCallback((el: HTMLElement) => {
    fired.current = true;
    openContextMenu(el, latest.current.items(), latest.current.opts.title?.());
  }, []);

  if (opts.disabled) return {};

  return {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const el = e.currentTarget;
      fired.current = false;
      start.current = { x: t.clientX, y: t.clientY, el };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (start.current) fire(start.current.el);
        start.current = null;
      }, 480);
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      const s = start.current;
      if (!s) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - s.x) > 8 || Math.abs(t.clientY - s.y) > 8) cancel();
    },
    onTouchEnd: (e: React.TouchEvent<HTMLElement>) => {
      cancel();
      // The press opened the menu: the finger lifting isn't also a tap on the row.
      if (fired.current) e.preventDefault();
    },
    onTouchCancel: cancel,
    onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
      if (fired.current) {
        fired.current = false;
        e.preventDefault();
        e.stopPropagation();
      }
    },
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      cancel();
      fire(e.currentTarget);
    },
  };
}

/** The same, for an element made inside a loop: wraps one element and gives it the menu. */
export function MenuTarget({ items, title, children }: { items: () => MenuItems; title?: string; children: ReactElement<Record<string, unknown>> }) {
  const menu = useContextMenu(items, { title: () => title });
  return cloneElement(children, menu);
}
