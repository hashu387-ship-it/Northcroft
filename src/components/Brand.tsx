// The QS Team logo: "QS TEAM", "Estimate | Analyse | Deliver", the building, crane and red sweep.
// The Northcroft name, flower and "Middle East & Africa" were taken off it (Nov 2026); the original
// files are still in public/brand.
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

/**
 * The logo comes in two colours: blue (white lettering with a soft glow) in dark mode and wherever it
 * sits on something dark, and ink (navy lettering, no glow) in light mode. Red stays red in both.
 */
export type LogoTone = "blue" | "ink";

/** The tone for the current look. `onDark`: the logo always sits on a dark background there. */
function readTone(onDark: boolean): LogoTone {
  if (typeof document === "undefined") return "blue";
  const theme = document.documentElement.dataset.theme;
  const dark = theme ? theme === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  return dark || onDark ? "blue" : "ink";
}

/** Calls back when the look changes: Settings > Appearance, or the phone switching light and dark. */
function onLookChange(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette"] });
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener?.("change", cb);
  return () => {
    mo.disconnect();
    mq?.removeEventListener?.("change", cb);
  };
}

/** The logo tone for the current look, following changes as they happen. */
export function useLogoTone(onDark = false): LogoTone {
  return useSyncExternalStore(onLookChange, () => readTone(onDark), () => "blue");
}

const LOGO = "/brand/qs-team-logo-";
/** Width over height of the logo files. */
const LOGO_RATIO = 1550 / 546;
/** The logo comes in three widths; the browser picks the smallest that is sharp on the screen. */
const logoSrcSet = (tone: LogoTone) => `${LOGO}${tone}-600.webp 600w, ${LOGO}${tone}-1000.webp 1000w, ${LOGO}${tone}-1550.webp 1550w`;

/**
 * The full QS Team logo. Used on the opening screen, sign-in, the Face ID lock, Settings > About and
 * the weekly report. `size` is its height. `onDark` keeps the light version where the background is
 * always dark (the opening screen, the Face ID lock); `tone` fixes the colour (the report). `print`
 * always uses the largest file, for the report's printout and PDF.
 */
export function QsLogo({
  size = 120,
  print,
  onDark,
  tone,
  style,
  className,
}: {
  size?: number;
  print?: boolean;
  onDark?: boolean;
  tone?: LogoTone;
  style?: CSSProperties;
  className?: string;
}) {
  const auto = useLogoTone(!!onDark);
  // Some light looks still have a dark side menu, so the place decides too: light text around the
  // logo means a dark background, which needs the light version.
  const ref = useRef<HTMLSpanElement>(null);
  const [darkHere, setDarkHere] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (tone || onDark || !ref.current) return;
    const m = getComputedStyle(ref.current).color.match(/[\d.]+/g);
    if (!m) return;
    const [r, g, b] = m.map(Number);
    setDarkHere((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55);
  }, [auto, tone, onDark]);
  let t = tone ?? auto;
  if (!tone && !onDark && darkHere !== null && (t === "blue" || t === "ink")) t = darkHere ? "blue" : "ink";
  return (
    <span ref={ref} className={`qs-logo tone-${t}${className ? ` ${className}` : ""}`} style={style}>
      <img
        src={print ? `${LOGO}${t}-1550.webp` : `${LOGO}${t}-1000.webp`}
        srcSet={print ? undefined : logoSrcSet(t)}
        sizes={print ? undefined : `${Math.round(size * LOGO_RATIO)}px`}
        width={Math.round(size * LOGO_RATIO)}
        height={size}
        alt="QS Team"
        decoding="async"
        draggable={false}
      />
    </span>
  );
}


/**
 * The square QS Team mark: the building, crane and red sweep on dark navy (the app icon's picture).
 * Used where the full logo would be too small to read: the side menu and Team chat. `size` is its side.
 */
export function QsMark({ size = 40, style, className }: { size?: number; style?: CSSProperties; className?: string }) {
  const src = size > 80 ? "/brand/qs-team-mark-blue-512.webp" : "/brand/qs-team-mark-blue-160.webp";
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="QS Team"
      className={className ? `qs-mark ${className}` : "qs-mark"}
      style={{ background: "#041234", ...style }}
      decoding="async"
      draggable={false}
    />
  );
}
