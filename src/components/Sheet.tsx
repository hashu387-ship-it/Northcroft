// The app's pop-up panel (forms, details, confirmations).
//
// On a computer it grows out of the button or row that opened it and shrinks back into it when it
// closes. On a phone it slides up from the bottom and can be dragged down: it follows the finger
// exactly, resists if pulled up past the top, and when let go it either drops away (if it was
// pulled far enough or flicked) or springs back. It can be grabbed again while it's still moving.
// A panel opened over another one pushes the first one back a little. With reduce motion on, it
// fades in and out instead.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { X } from "lucide-react";
import { haptic, isPhoneLayout, prefersReducedMotion, project, recentPress, rubberband, Spring, SPRINGS, VelocityTracker } from "@/lib/motion";

/* ---------------------------------------------------------------- which panel is on top */
const stack: symbol[] = [];
const stackListeners = new Set<() => void>();
const stackChanged = () => stackListeners.forEach((fn) => fn());

interface Drag {
  x0: number;
  y0: number;
  base: number;
  locked: boolean;
  engaged: boolean;
  fromHead: boolean;
  target: EventTarget | null;
}

/** Nothing between the touched element and the panel is scrolled down (so dragging down closes). */
function scrolledToTop(target: EventTarget | null, stop: HTMLElement) {
  let el = target instanceof Element ? target : null;
  while (el && el !== stop) {
    if (el instanceof HTMLElement && el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return false;
    el = el.parentElement;
  }
  return true;
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const [present, setPresent] = useState(open);
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const mounted = useRef(true);
  const s = useRef({
    phone: false,
    reduced: false,
    height: 600,
    closing: false,
    closedOut: false,
    move: null as Spring | null,
    depth: null as Spring | null,
    id: Symbol("sheet"),
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Draw the panel and the dimmed background for the current spring values. */
  const draw = useCallback(() => {
    const st = s.current;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop || !st.move) return;
    const v = st.move.value;
    const d = st.depth?.value ?? 0;
    if (st.reduced) {
      panel.style.transform = d ? `scale(${1 - 0.03 * d})` : "";
      return;
    }
    if (st.phone) {
      // v = how far down it is (0 = fully open).
      const shown = Math.max(0, Math.min(1, 1 - v / Math.max(1, st.height)));
      panel.style.transform = `translate3d(0, ${v}px, 0) scale(${1 - 0.05 * d})`;
      backdrop.style.opacity = String(shown);
    } else {
      // v = 0 (closed, shrunk into the button that opened it) to 1 (open).
      const p = Math.max(0, Math.min(1, v));
      panel.style.transform = `scale(${(0.86 + 0.14 * v) * (1 - 0.03 * d)})`;
      panel.style.opacity = String(Math.min(1, p * 1.4));
      backdrop.style.opacity = String(p);
    }
  }, []);

  const openPos = () => (s.current.phone ? 0 : 1);
  const closedPos = () => (s.current.phone ? s.current.height + 24 : 0);

  /** Move it out of view, then `after`. A flick's speed carries on. */
  const animateOut = useCallback(
    (after: () => void, velocity?: number) => {
      const st = s.current;
      st.closing = true;
      st.closedOut = false;
      const finish = () => {
        st.closedOut = true;
        after();
      };
      if (st.reduced) {
        const panel = panelRef.current;
        const backdrop = backdropRef.current;
        if (panel) panel.style.opacity = "0";
        if (backdrop) backdrop.style.opacity = "0";
        window.setTimeout(finish, 190);
        return;
      }
      st.move?.to(closedPos(), st.phone ? SPRINGS.sheet : { damping: 1, response: 0.26 }, { velocity, onRest: finish });
    },
    [],
  );

  /** Bring it (back) into view. */
  const animateIn = useCallback(() => {
    const st = s.current;
    st.closing = false;
    st.closedOut = false;
    if (st.reduced) {
      const panel = panelRef.current;
      const backdrop = backdropRef.current;
      if (panel) panel.style.opacity = "1";
      if (backdrop) backdrop.style.opacity = "1";
      return;
    }
    st.move?.to(openPos(), st.phone ? SPRINGS.sheet : SPRINGS.standard);
  }, []);

  /** Closed by the person (X, outside tap, Escape, drag): it leaves first, then the screen hears. */
  const requestClose = useCallback(
    (velocity?: number) => {
      if (s.current.closing) return;
      animateOut(() => {
        onCloseRef.current();
        // Some panels refuse to close while they're busy: then it comes back.
        window.setTimeout(() => {
          if (!mounted.current) return;
          if (openRef.current) animateIn();
          else setPresent(false);
        }, 60);
      }, velocity);
    },
    [animateIn, animateOut],
  );

  // Opened and closed from outside (a screen saving and closing it, say).
  useEffect(() => {
    const st = s.current;
    if (open) {
      if (!present) setPresent(true);
      else if (st.closing) animateIn();
    } else if (present) {
      if (st.closedOut) setPresent(false);
      else if (!st.closing) animateOut(() => mounted.current && setPresent(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Set it up before it's first painted: off screen (phone) or shrunk into the button (computer).
  useLayoutEffect(() => {
    if (!present) return;
    const st = s.current;
    const panel = panelRef.current;
    if (!panel) return;
    st.phone = isPhoneLayout();
    st.reduced = prefersReducedMotion();
    st.closing = false;
    st.closedOut = false;
    panel.style.transform = "none";
    st.height = panel.offsetHeight || 600;
    if (!st.phone && !st.reduced) {
      const press = recentPress();
      const r = panel.getBoundingClientRect();
      panel.style.transformOrigin = press ? `${press.x - r.left}px ${press.y - r.top}px` : "50% 50%";
    }
    st.move = new Spring(closedPos(), draw, { precision: st.phone ? 0.5 : 0.002 });
    st.depth = new Spring(0, draw, { precision: 0.002 });
    if (st.reduced) {
      const backdrop = backdropRef.current;
      panel.style.opacity = "0";
      if (backdrop) backdrop.style.opacity = "0";
      panel.style.transition = "opacity 180ms ease";
      if (backdrop) backdrop.style.transition = "opacity 180ms ease";
      st.move.set(openPos());
      requestAnimationFrame(() => {
        panel.style.opacity = "1";
        if (backdrop) backdrop.style.opacity = "1";
      });
    } else {
      draw();
      st.move.to(openPos(), st.phone ? SPRINGS.sheet : SPRINGS.standard);
    }

    // On top of any panel already open; that one steps back.
    stack.push(st.id);
    stackChanged();
    const onStack = () => {
      const top = stack[stack.length - 1] === st.id;
      st.depth?.to(top ? 0 : 1, SPRINGS.standard);
    };
    stackListeners.add(onStack);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === st.id) requestClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      stackListeners.delete(onStack);
      const i = stack.indexOf(st.id);
      if (i >= 0) stack.splice(i, 1);
      stackChanged();
      st.move?.stop();
      st.depth?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  // Drag down to close (phones). Native touch listeners so scrolling can be taken over once the
  // panel's content is at its top and the finger moves down.
  useEffect(() => {
    if (!present) return;
    const panel = panelRef.current;
    if (!panel) return;
    const st = s.current;
    const tracker = new VelocityTracker();
    let g: Drag | null = null;

    const start = (e: TouchEvent) => {
      if (!st.phone || e.touches.length !== 1 || st.closing) return;
      const t = e.touches[0];
      const head = headRef.current;
      g = {
        x0: t.clientX,
        y0: t.clientY,
        base: st.move?.value ?? 0,
        locked: false,
        engaged: false,
        fromHead: !!head && e.target instanceof Node && (head.contains(e.target) || (e.target as Element).classList?.contains("grabber")),
        target: e.target,
      };
    };
    const move = (e: TouchEvent) => {
      if (!g || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      if (!g.locked) {
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
        g.locked = true;
        const downward = Math.abs(dy) > Math.abs(dx);
        const editing = g.target instanceof HTMLElement && /^(INPUT|SELECT)$/.test(g.target.tagName);
        if (!downward || editing || (!g.fromHead && (dy < 0 || !scrolledToTop(g.target, panel)))) {
          g = null;
          return;
        }
        g.engaged = true;
        st.move?.stop();
        g.base = st.move?.value ?? 0;
        g.y0 = t.clientY;
        tracker.reset();
      }
      if (!g.engaged) return;
      e.preventDefault();
      const raw = g.base + (t.clientY - g.y0);
      const y = raw < 0 ? rubberband(raw, st.height) : raw;
      st.move?.set(y);
      tracker.add(y, e.timeStamp);
    };
    const end = (e: TouchEvent) => {
      if (!g) return;
      const drag = g;
      g = null;
      if (!drag.engaged) return;
      const v = tracker.velocity(e.timeStamp);
      const y = st.move?.value ?? 0;
      // Where a flick would carry it decides, not just where the finger let go.
      if (y + project(v) > st.height * 0.45 && v > -150) {
        haptic("tick");
        requestClose(Math.max(v, 0));
      } else {
        st.move?.to(0, SPRINGS.flick, { velocity: v });
      }
    };
    panel.addEventListener("touchstart", start, { passive: true });
    panel.addEventListener("touchmove", move, { passive: false });
    panel.addEventListener("touchend", end);
    panel.addEventListener("touchcancel", end);
    return () => {
      panel.removeEventListener("touchstart", start);
      panel.removeEventListener("touchmove", move);
      panel.removeEventListener("touchend", end);
      panel.removeEventListener("touchcancel", end);
    };
  }, [present, requestClose]);

  if (!present) return null;
  return createPortal(
    <div className="sheet-backdrop" ref={backdropRef} onMouseDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div ref={panelRef} className={clsx("sheet glass-strong", wide && "wide")} role="dialog" aria-modal="true">
        <div className="grabber" />
        <div className="sheet-head" ref={headRef}>
          <h2>{title}</h2>
          <button className="icon-btn small" onClick={() => requestClose()} aria-label="Close" type="button">
            <X />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
