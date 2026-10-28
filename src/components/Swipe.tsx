// A list row that can be swiped sideways on a phone to reveal a quick action behind it (Mark read,
// Archive, Start, Open...). The row follows the finger exactly; past a point the action lights up
// (and the phone gives a tiny tick), and letting go there, or flicking, does it. Otherwise the row
// springs back. Vertical scrolling is left alone: the swipe only starts once the finger is clearly
// moving sideways. Mouse and keyboard users have the same actions as buttons, so nothing is swipe-only.
import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { haptic, project, rubberband, Spring, SPRINGS, VelocityTracker } from "@/lib/motion";

export interface SwipeAction {
  label: string;
  icon: ReactNode;
  /** The colour behind the row. */
  color: string;
  run: () => unknown;
  /** The row slides away (it's leaving the list, like Archive). Otherwise it springs back. */
  leave?: boolean;
}

export function SwipeRow({
  leading,
  trailing,
  children,
  className,
}: {
  /** Revealed by swiping right. */
  leading?: SwipeAction | null;
  /** Revealed by swiping left. */
  trailing?: SwipeAction | null;
  children: ReactNode;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const acts = useRef({ leading, trailing });
  acts.current = { leading, trailing };

  useEffect(() => {
    const el = wrap.current;
    const fr = front.current;
    if (!el || !fr) return;
    const tracker = new VelocityTracker();
    let armed: "lead" | "trail" | null = null;
    let suppressClick = 0;
    const spring = new Spring(0, (x) => {
      fr.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
      el.dataset.side = x > 0 ? "lead" : x < 0 ? "trail" : "";
      const width = el.clientWidth || 1;
      el.style.setProperty("--reveal", String(Math.min(1, Math.abs(x) / (width * 0.38))));
      if (x === 0 && !g) el.classList.remove("swiping", "armed");
    });
    let g: { x0: number; y0: number; base: number; locked: boolean; engaged: boolean } | null = null;

    const threshold = () => (el.clientWidth || 300) * 0.38;
    const setArmed = (side: "lead" | "trail" | null) => {
      if (side === armed) return;
      armed = side;
      el.classList.toggle("armed", !!side);
      if (side) haptic("tick");
    };

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      g = { x0: t.clientX, y0: t.clientY, base: spring.value, locked: false, engaged: false };
    };
    const move = (e: TouchEvent) => {
      if (!g || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - g.x0;
      const dy = t.clientY - g.y0;
      const { leading: lead, trailing: trail } = acts.current;
      if (!g.locked) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        g.locked = true;
        // Clearly sideways, and there's something on that side: it's a swipe, not a scroll.
        if (Math.abs(dx) < Math.abs(dy) * 1.3 || (dx > 0 && !lead && g.base >= 0) || (dx < 0 && !trail && g.base <= 0)) {
          g = null;
          return;
        }
        g.engaged = true;
        spring.stop();
        g.base = spring.value;
        g.x0 = t.clientX;
        tracker.reset();
        el.classList.add("swiping");
      }
      if (!g.engaged) return;
      e.preventDefault();
      const width = el.clientWidth || 300;
      let x = g.base + (t.clientX - g.x0);
      // No action that way, or pulled a long way: it resists.
      if ((x > 0 && !lead) || (x < 0 && !trail)) x = rubberband(x, width, 0.2);
      else if (Math.abs(x) > width * 0.7) x = Math.sign(x) * (width * 0.7 + rubberband(Math.abs(x) - width * 0.7, width));
      spring.set(x);
      tracker.add(x, e.timeStamp);
      setArmed(x > threshold() && lead ? "lead" : x < -threshold() && trail ? "trail" : null);
    };
    const end = (e: TouchEvent) => {
      if (!g) return;
      const was = g;
      g = null;
      if (!was.engaged) return;
      suppressClick = performance.now();
      const v = tracker.velocity(e.timeStamp);
      const x = spring.value;
      const landing = x + project(v, 0.99);
      const { leading: lead, trailing: trail } = acts.current;
      const side = landing > threshold() && x > 0 && lead ? "lead" : landing < -threshold() && x < 0 && trail ? "trail" : null;
      setArmed(null);
      if (!side) {
        spring.to(0, SPRINGS.snappy, { velocity: v });
        return;
      }
      const action = side === "lead" ? lead! : trail!;
      haptic("success");
      if (action.leave) {
        const width = el.clientWidth || 300;
        spring.to(side === "lead" ? width : -width, SPRINGS.standard, {
          velocity: v,
          onRest: () => {
            Promise.resolve(action.run()).finally(() => {
              // Still here (the list kept it): back into place.
              if (wrap.current) spring.to(0, SPRINGS.snappy);
            });
          },
        });
      } else {
        spring.to(0, SPRINGS.flick, { velocity: v });
        void action.run();
      }
    };
    // A swipe isn't a tap: the row doesn't open when the finger lifts after swiping.
    const click = (e: MouseEvent) => {
      if (performance.now() - suppressClick < 400) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    el.addEventListener("click", click, true);
    return () => {
      spring.stop();
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      el.removeEventListener("click", click, true);
    };
  }, []);

  return (
    <div className={clsx("swipe-row", className)} ref={wrap}>
      {leading && (
        <div className="swipe-act swipe-lead" style={{ background: leading.color }} aria-hidden>
          {leading.icon}
          <span>{leading.label}</span>
        </div>
      )}
      {trailing && (
        <div className="swipe-act swipe-trail" style={{ background: trailing.color }} aria-hidden>
          <span>{trailing.label}</span>
          {trailing.icon}
        </div>
      )}
      <div className="swipe-front" ref={front}>
        {children}
      </div>
    </div>
  );
}
