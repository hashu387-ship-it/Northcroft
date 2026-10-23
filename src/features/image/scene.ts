// The photo and its marks, drawn the same way on screen and into the saved file.
// Marks are kept in the pixels of the finished photo (after any rotation), so they stay exactly
// where they were drawn whatever the zoom.

export type Rotation = 0 | 90 | 180 | 270;
export type Pt = { x: number; y: number };
export type Tool = "view" | "select" | "pen" | "arrow" | "line" | "rect" | "ellipse" | "text";

export type Mark =
  | { id: string; kind: "pen"; color: string; width: number; points: Pt[] }
  | { id: string; kind: "line" | "arrow" | "rect" | "ellipse"; color: string; width: number; a: Pt; b: Pt }
  | { id: string; kind: "text"; color: string; size: number; at: Pt; text: string };

export interface Scene {
  rotation: Rotation;
  marks: Mark[];
}

export const COLORS: { c: string; label: string }[] = [
  { c: "#e8343e", label: "Red" },
  { c: "#ffd60a", label: "Yellow" },
  { c: "#ffffff", label: "White" },
  { c: "#111111", label: "Black" },
  { c: "#0a84ff", label: "Blue" },
  { c: "#30d158", label: "Green" },
];

export const WIDTHS = [
  { k: 1, label: "Thin" },
  { k: 2, label: "Medium" },
  { k: 3.5, label: "Thick" },
];

export const TEXT_SIZES = [
  { key: "S", k: 5, label: "Small" },
  { key: "M", k: 7.5, label: "Medium" },
  { key: "L", k: 11, label: "Large" },
] as const;

export const FONT = '600 {size}px Inter, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif';

/** One "unit" of line width for this photo: marks look the same on a phone snap and a 24 MP camera shot. */
export function unitFor(w: number, h: number) {
  return Math.max(1.5, Math.min(w, h) / 250);
}

/** Size of the finished photo for a rotation. */
export function outSize(w: number, h: number, r: Rotation) {
  return r % 180 === 0 ? { w, h } : { w: h, h: w };
}

export const uid = () => Math.random().toString(36).slice(2, 10);

/* ---------------------------------------------------------------- text labels */

let measurer: CanvasRenderingContext2D | null = null;
function measureCtx() {
  if (!measurer) measurer = document.createElement("canvas").getContext("2d")!;
  return measurer;
}

/** The box a text label takes, with its padding: x, y is the top-left. */
export function textBox(m: Extract<Mark, { kind: "text" }>, ctx?: CanvasRenderingContext2D) {
  const c = ctx ?? measureCtx();
  c.save();
  c.font = FONT.replace("{size}", String(m.size));
  const lines = (m.text || " ").split("\n");
  const widths = lines.map((l) => c.measureText(l || " ").width);
  c.restore();
  const pad = m.size * 0.38;
  const lineH = m.size * 1.22;
  return {
    x: m.at.x,
    y: m.at.y,
    w: Math.max(...widths) + pad * 2,
    h: lines.length * lineH + pad * 2 - (lineH - m.size) * 0.5,
    pad,
    lineH,
    lines,
  };
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Light text sits on a dark label, dark text on a light one, so it reads on any photo. */
export function labelBackground(color: string) {
  return luminance(color) > 0.45 ? "rgba(10, 14, 26, 0.72)" : "rgba(255, 255, 255, 0.88)";
}

/* ---------------------------------------------------------------- drawing */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function drawMark(ctx: CanvasRenderingContext2D, m: Mark) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (m.kind === "text") {
    const box = textBox(m, ctx);
    ctx.fillStyle = labelBackground(m.color);
    roundRect(ctx, box.x, box.y, box.w, box.h, m.size * 0.3);
    ctx.fill();
    ctx.fillStyle = m.color;
    ctx.font = FONT.replace("{size}", String(m.size));
    ctx.textBaseline = "top";
    box.lines.forEach((line, i) => ctx.fillText(line, box.x + box.pad, box.y + box.pad + i * box.lineH));
    ctx.restore();
    return;
  }
  ctx.strokeStyle = m.color;
  ctx.fillStyle = m.color;
  ctx.lineWidth = m.width;
  // A thin dark edge under light marks (white, yellow) so they show up on bright skies and walls.
  if (luminance(m.color) > 0.6) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = m.width * 0.8;
  }
  if (m.kind === "pen") {
    const p = m.points;
    ctx.beginPath();
    if (p.length === 1) {
      ctx.arc(p[0].x, p[0].y, m.width / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(p[0].x, p[0].y);
      for (let i = 1; i < p.length - 1; i++) {
        const mx = (p[i].x + p[i + 1].x) / 2;
        const my = (p[i].y + p[i + 1].y) / 2;
        ctx.quadraticCurveTo(p[i].x, p[i].y, mx, my);
      }
      ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y);
      ctx.stroke();
    }
  } else if (m.kind === "line") {
    ctx.beginPath();
    ctx.moveTo(m.a.x, m.a.y);
    ctx.lineTo(m.b.x, m.b.y);
    ctx.stroke();
  } else if (m.kind === "arrow") {
    const dx = m.b.x - m.a.x;
    const dy = m.b.y - m.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const head = Math.min(len * 0.6, Math.max(m.width * 3.6, 10));
    const ux = dx / len;
    const uy = dy / len;
    const baseX = m.b.x - ux * head;
    const baseY = m.b.y - uy * head;
    ctx.beginPath();
    ctx.moveTo(m.a.x, m.a.y);
    ctx.lineTo(baseX + ux * head * 0.2, baseY + uy * head * 0.2);
    ctx.stroke();
    const half = head * 0.55;
    ctx.beginPath();
    ctx.moveTo(m.b.x, m.b.y);
    ctx.lineTo(baseX - uy * half, baseY + ux * half);
    ctx.lineTo(baseX + uy * half, baseY - ux * half);
    ctx.closePath();
    ctx.lineWidth = Math.max(1, m.width * 0.5);
    ctx.fill();
    ctx.stroke();
  } else if (m.kind === "rect") {
    const x = Math.min(m.a.x, m.b.x);
    const y = Math.min(m.a.y, m.b.y);
    ctx.strokeRect(x, y, Math.abs(m.b.x - m.a.x), Math.abs(m.b.y - m.a.y));
  } else if (m.kind === "ellipse") {
    const cx = (m.a.x + m.b.x) / 2;
    const cy = (m.a.y + m.b.y) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.max(0.5, Math.abs(m.b.x - m.a.x) / 2), Math.max(0.5, Math.abs(m.b.y - m.a.y) / 2), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Draw the photo, turned, filling the finished photo's area (0, 0, out.w, out.h). */
export function drawPhoto(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, r: Rotation) {
  const out = outSize(w, h, r);
  ctx.save();
  ctx.translate(out.w / 2, out.h / 2);
  ctx.rotate((r * Math.PI) / 180);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/* ---------------------------------------------------------------- picking and moving marks */

export function bounds(m: Mark): { x: number; y: number; w: number; h: number } {
  if (m.kind === "text") {
    const b = textBox(m);
    return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
  const pts = m.kind === "pen" ? m.points : [m.a, m.b];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const pad = m.width / 2;
  return { x: x - pad, y: y - pad, w: Math.max(...xs) - x + pad * 2, h: Math.max(...ys) - y + pad * 2 };
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 0 = on the mark's line, 1 = inside a box or circle, null = missed. */
function hit(m: Mark, p: Pt, tol: number): 0 | 1 | null {
  if (m.kind === "text") {
    const b = bounds(m);
    return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol ? 0 : null;
  }
  const reach = tol + m.width / 2;
  if (m.kind === "pen") {
    const pts = m.points;
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= reach ? 0 : null;
    for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= reach) return 0;
    return null;
  }
  if (m.kind === "line" || m.kind === "arrow") return segDist(p, m.a, m.b) <= reach ? 0 : null;
  const x0 = Math.min(m.a.x, m.b.x);
  const x1 = Math.max(m.a.x, m.b.x);
  const y0 = Math.min(m.a.y, m.b.y);
  const y1 = Math.max(m.a.y, m.b.y);
  if (m.kind === "rect") {
    const inside = p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
    const nearEdge =
      p.x >= x0 - reach && p.x <= x1 + reach && p.y >= y0 - reach && p.y <= y1 + reach &&
      (Math.abs(p.x - x0) <= reach || Math.abs(p.x - x1) <= reach || Math.abs(p.y - y0) <= reach || Math.abs(p.y - y1) <= reach);
    return nearEdge ? 0 : inside ? 1 : null;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.max(1, (x1 - x0) / 2);
  const ry = Math.max(1, (y1 - y0) / 2);
  const d = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
  const edge = Math.abs(d - 1) * Math.min(rx, ry) <= reach;
  return edge ? 0 : d < 1 ? 1 : null;
}

/** The mark under a point: the top one whose line is touched first, then the top box it falls inside. */
export function pick(marks: Mark[], p: Pt, tol: number): Mark | null {
  let inside: Mark | null = null;
  for (let i = marks.length - 1; i >= 0; i--) {
    const h = hit(marks[i], p, tol);
    if (h === 0) return marks[i];
    if (h === 1 && !inside) inside = marks[i];
  }
  return inside;
}

const shift = (p: Pt, dx: number, dy: number) => ({ x: p.x + dx, y: p.y + dy });

export function moved(m: Mark, dx: number, dy: number): Mark {
  if (m.kind === "pen") return { ...m, points: m.points.map((p) => shift(p, dx, dy)) };
  if (m.kind === "text") return { ...m, at: shift(m.at, dx, dy) };
  return { ...m, a: shift(m.a, dx, dy), b: shift(m.b, dx, dy) };
}

/**
 * Turn the marks with the photo, a quarter turn right (cw) or left. `w` and `h` are the finished
 * photo's size before turning. Text labels move with the photo but stay upright.
 */
export function turnMarks(marks: Mark[], cw: boolean, w: number, h: number): Mark[] {
  const turn = (p: Pt): Pt => (cw ? { x: h - p.y, y: p.x } : { x: p.y, y: w - p.x });
  return marks.map((m) => {
    if (m.kind === "pen") return { ...m, points: m.points.map(turn) };
    if (m.kind === "text") {
      const b = textBox(m);
      const c = turn({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      return { ...m, at: { x: c.x - b.w / 2, y: c.y - b.h / 2 } };
    }
    return { ...m, a: turn(m.a), b: turn(m.b) };
  });
}

/* ---------------------------------------------------------------- saving */

/** iPhones refuse canvases much over 16 megapixels or 4096 px a side: big photos are scaled to fit. */
export const MAX_SIDE = 4096;
export const MAX_PIXELS = 16_000_000;

export function exportScale(w: number, h: number) {
  return Math.min(1, MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
}

export type OutType = { mime: "image/jpeg" | "image/png" | "image/webp"; extension?: string };

/** Keep the file's type where the browser can write it; anything else becomes a JPEG. */
export function outputType(mime: string | null, name: string): OutType {
  const m = (mime ?? "").toLowerCase();
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg" || ext === "jpg" || ext === "jpeg") return { mime: "image/jpeg" };
  if (m === "image/png" || ext === "png") return { mime: "image/png" };
  if (m === "image/webp" || ext === "webp") return { mime: "image/webp" };
  return { mime: "image/jpeg", extension: ".jpg" };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo couldn't be prepared on this device. Try a smaller photo."))), type, quality),
  );
}

/** The finished photo with its marks, at full size (capped for phones). */
export async function renderOut(
  img: CanvasImageSource,
  w: number,
  h: number,
  scene: Scene,
  type: OutType,
): Promise<{ blob: Blob; extension?: string; width: number; height: number }> {
  const out = outSize(w, h, scene.rotation);
  const k = exportScale(out.w, out.h);
  const cw = Math.max(1, Math.round(out.w * k));
  const ch = Math.max(1, Math.round(out.h * k));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The photo couldn't be prepared on this device.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // JPEG has no see-through parts: give those a white background rather than black.
  if (type.mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cw, ch);
  }
  ctx.scale(cw / out.w, ch / out.h);
  drawPhoto(ctx, img, w, h, scene.rotation);
  for (const m of scene.marks) drawMark(ctx, m);
  let blob = await toBlob(canvas, type.mime, type.mime === "image/png" ? undefined : 0.92);
  let extension = type.extension;
  // Some browsers can't write WEBP and quietly hand back a PNG: name it as one.
  if (type.mime === "image/webp" && blob.type !== "image/webp") {
    blob = await toBlob(canvas, "image/png");
    extension = ".png";
  }
  canvas.width = canvas.height = 1;
  return { blob, extension, width: cw, height: ch };
}
