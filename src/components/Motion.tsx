// Small moving parts: the flip tile for the countdown and the progress ring. Both stand still
// with reduce motion on.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/** A tile that flips like a departure board when its value changes. */
export function Flip({ value }: { value: string }) {
  // What the tile showed before the flip that's under way (the same as `value` when it's still).
  const [shown, setShown] = useState(value);
  const reduce = prefersReducedMotion();
  useEffect(() => {
    if (reduce) setShown(value);
  }, [value, reduce]);
  const flipping = !reduce && shown !== value;
  return (
    <span className="flip" aria-hidden>
      <span className="flip-half flip-top">{value}</span>
      <span className="flip-half flip-bottom">{flipping ? shown : value}</span>
      {flipping && (
        <span key={`t${value}`} className="flip-half flip-top flip-fold-top">
          {shown}
        </span>
      )}
      {flipping && (
        <span key={`b${value}`} className="flip-half flip-bottom flip-fold-bottom" onAnimationEnd={() => setShown(value)}>
          {value}
        </span>
      )}
    </span>
  );
}

/** A ring that fills to a percentage, with something in the middle (a number, a count). */
export function Ring({
  value,
  size = 44,
  stroke = 5,
  color,
  label,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  children?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, value));
  // Starts empty and fills once it's on screen.
  const [drawn, setDrawn] = useState(prefersReducedMotion() ? pct : 0);
  useEffect(() => {
    const t = requestAnimationFrame(() => setDrawn(pct));
    return () => cancelAnimationFrame(t);
  }, [pct]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ ["--size" as string]: `${size}px`, ["--ring" as string]: color } as CSSProperties} role="img" aria-label={label ?? `${Math.round(pct)}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="ring-bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - drawn / 100)}
        />
      </svg>
      {children != null && <span className="ring-label">{children}</span>}
    </span>
  );
}
