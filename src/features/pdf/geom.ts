// Geometry for the PDF tools: page-to-screen mapping (the same maths pdf.js uses), shapes
// built from points, and measurement maths.
import type { BoxBase, Pt } from "./model";

/** [a b c d e f]: x' = a*x + c*y + e, y' = b*x + d*y + f */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** m1 then m2. */
export function mul(m1: Mat, m2: Mat): Mat {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

export function apply(m: Mat, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return IDENTITY;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export interface View {
  /** Page coordinates to screen pixels (CSS) inside the page box. */
  t: Mat;
  inv: Mat;
  width: number;
  height: number;
  scale: number;
  rotation: number;
}

/** Same as pdf.js PageViewport: viewBox [x1 y1 x2 y2], scale, total rotation in degrees. */
export function makeView(viewBox: number[], scale: number, rotation: number): View {
  const [x1, y1, x2, y2] = viewBox;
  const cx = (x2 + x1) / 2;
  const cy = (y2 + y1) / 2;
  let r = rotation % 360;
  if (r < 0) r += 360;
  let a = 1, b = 0, c = 0, d = -1;
  if (r === 90) [a, b, c, d] = [0, 1, 1, 0];
  else if (r === 180) [a, b, c, d] = [-1, 0, 0, 1];
  else if (r === 270) [a, b, c, d] = [0, -1, -1, 0];
  let ox: number, oy: number, width: number, height: number;
  if (a === 0) {
    ox = Math.abs(cy - y1) * scale;
    oy = Math.abs(cx - x1) * scale;
    width = (y2 - y1) * scale;
    height = (x2 - x1) * scale;
  } else {
    ox = Math.abs(cx - x1) * scale;
    oy = Math.abs(cy - y1) * scale;
    width = (x2 - x1) * scale;
    height = (y2 - y1) * scale;
  }
  const t: Mat = [a * scale, b * scale, c * scale, d * scale, ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
  return { t, inv: invert(t), width: Math.abs(width), height: Math.abs(height), scale, rotation: r };
}

export const dist = (p: Pt, q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]);

/** The direction on the page that reads left-to-right on screen, as an angle (radians). */
export function screenRightAngle(view: View): number {
  const a = apply(view.inv, [0, 0]);
  const b = apply(view.inv, [1, 0]);
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}

/** A box's local point (x right, y down from its top-left) on the page. */
export function boxPoint(o: BoxBase, lx: number, ly: number): Pt {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return [o.o[0] + lx * c + ly * s, o.o[1] + lx * s - ly * c];
}

/** The page point back in a box's local frame. */
export function boxLocal(o: BoxBase, p: Pt): Pt {
  const dx = p[0] - o.o[0];
  const dy = p[1] - o.o[1];
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return [dx * c + dy * s, dx * s - dy * c];
}

export function boxCorners(o: BoxBase): Pt[] {
  return [boxPoint(o, 0, 0), boxPoint(o, o.w, 0), boxPoint(o, o.w, o.h), boxPoint(o, 0, o.h)];
}

/** Axis-aligned bounds of points. */
export function bounds(pts: Pt[]): [number, number, number, number] {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of pts) {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
  }
  return [x1, y1, x2, y2];
}

/* ---------------------------------------------------------------- paths */
/** A drawing path in page coordinates: M, L and C commands. Printed for SVG or for pdf-lib. */
export type Seg = ["M", Pt] | ["L", Pt] | ["C", Pt, Pt, Pt] | ["Z"];

const n = (v: number) => (Math.round(v * 100) / 100).toString();

export function pathD(segs: Seg[], flipY = false): string {
  const f = (p: Pt) => `${n(p[0])} ${n(flipY ? -p[1] : p[1])}`;
  return segs
    .map((s) => (s[0] === "M" ? `M ${f(s[1])}` : s[0] === "L" ? `L ${f(s[1])}` : s[0] === "C" ? `C ${f(s[1])} ${f(s[2])} ${f(s[3])}` : "Z"))
    .join(" ");
}

export function polyline(points: Pt[], close = false): Seg[] {
  if (!points.length) return [];
  const segs: Seg[] = [["M", points[0]]];
  for (const p of points.slice(1)) segs.push(["L", p]);
  if (close) segs.push(["Z"]);
  return segs;
}

/** A smooth stroke through freehand points (midpoint curves). */
export function smooth(points: Pt[]): Seg[] {
  if (points.length < 3) return polyline(points);
  const segs: Seg[] = [["M", points[0]]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const prev = segs[segs.length - 1];
    const from: Pt = prev[0] === "M" || prev[0] === "L" ? prev[1] : prev[0] === "C" ? prev[3] : points[0];
    // Quadratic (from, p, mid) as a cubic.
    segs.push(["C", [from[0] + (2 / 3) * (p[0] - from[0]), from[1] + (2 / 3) * (p[1] - from[1])], [mid[0] + (2 / 3) * (p[0] - mid[0]), mid[1] + (2 / 3) * (p[1] - mid[1])], mid]);
  }
  segs.push(["L", points[points.length - 1]]);
  return segs;
}

const K = 0.5522847498;

export function ellipse(a: Pt, b: Pt): Seg[] {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const rx = Math.abs(b[0] - a[0]) / 2;
  const ry = Math.abs(b[1] - a[1]) / 2;
  return [
    ["M", [cx + rx, cy]],
    ["C", [cx + rx, cy + K * ry], [cx + K * rx, cy + ry], [cx, cy + ry]],
    ["C", [cx - K * rx, cy + ry], [cx - rx, cy + K * ry], [cx - rx, cy]],
    ["C", [cx - rx, cy - K * ry], [cx - K * rx, cy - ry], [cx, cy - ry]],
    ["C", [cx + K * rx, cy - ry], [cx + rx, cy - K * ry], [cx + rx, cy]],
    ["Z"],
  ];
}

export function rect(a: Pt, b: Pt): Seg[] {
  return polyline([a, [b[0], a[1]], b, [a[0], b[1]]], true);
}

/** A revision cloud: scallops all the way round the rectangle, bulging outwards. */
export function cloud(a: Pt, b: Pt, bump = 14): Seg[] {
  const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]);
  const y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
  const corners: Pt[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const segs: Seg[] = [["M", corners[0]]];
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    const q = corners[(i + 1) % 4];
    const len = dist(p, q);
    const count = Math.max(1, Math.round(len / bump));
    const dx = (q[0] - p[0]) / count;
    const dy = (q[1] - p[1]) / count;
    // Outward normal for a counter-clockwise outline (corners go anticlockwise in page space).
    const L = Math.hypot(dx, dy) || 1;
    const nx = dy / L;
    const ny = -dx / L;
    const h = Math.min(bump, Math.hypot(dx, dy)) * 0.55;
    for (let k = 0; k < count; k++) {
      const s: Pt = [p[0] + dx * k, p[1] + dy * k];
      const e: Pt = [p[0] + dx * (k + 1), p[1] + dy * (k + 1)];
      segs.push(["C", [s[0] + nx * h, s[1] + ny * h], [e[0] + nx * h, e[1] + ny * h], e]);
    }
  }
  segs.push(["Z"]);
  return segs;
}

export function arrowHead(a: Pt, b: Pt, width: number): Pt[] {
  const len = Math.max(7, width * 4.5);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const spread = 0.42;
  return [
    b,
    [b[0] - len * Math.cos(ang - spread), b[1] - len * Math.sin(ang - spread)],
    [b[0] - len * Math.cos(ang + spread), b[1] - len * Math.sin(ang + spread)],
  ];
}

/** Where the arrow's shaft should stop so the line doesn't poke through the head. */
export function arrowShaftEnd(a: Pt, b: Pt, width: number): Pt {
  const len = Math.max(7, width * 4.5) * 0.8;
  const d = dist(a, b) || 1;
  return [b[0] - ((b[0] - a[0]) / d) * len, b[1] - ((b[1] - a[1]) / d) * len];
}

/* ---------------------------------------------------------------- measuring */
/** Metres per point at a drawing scale of 1:N (points to paper millimetres, times N). */
export const metresPerPoint = (denominator: number) => (25.4 / 72 / 1000) * denominator;

export function polyLength(points: Pt[], closed = false): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += dist(points[i - 1], points[i]);
  if (closed && points.length > 2) s += dist(points[points.length - 1], points[0]);
  return s;
}

export function polyArea(points: Pt[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

export function centroid(points: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

export const fmt2 = (v: number) => v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "12.00 m", "96.00 m²", "5" for a measurement, or null before the scale is set. */
export function measureLabel(kind: "length" | "area" | "count", points: Pt[], mpp: number | undefined): string | null {
  if (kind === "count") return `${points.length}`;
  if (!mpp) return null;
  if (kind === "length") return `${fmt2(polyLength(points) * mpp)} m`;
  return `${fmt2(polyArea(points) * mpp * mpp)} m²`;
}

/* ---------------------------------------------------------------- colours */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}

export const rgbCss = (c: [number, number, number]) => `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
