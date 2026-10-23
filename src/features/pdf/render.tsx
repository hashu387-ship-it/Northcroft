// Drawing the marks on screen (an SVG over each page), and finding what was tapped.
// Shapes are drawn in the page's own coordinates inside one transform, exactly as they'll be saved.
import { Fragment } from "react";
import {
  apply,
  arrowHead,
  arrowShaftEnd,
  bounds,
  boxCorners,
  boxLocal,
  centroid,
  cloud,
  dist,
  ellipse,
  measureLabel,
  pathD,
  polyline,
  rect,
  rgbCss,
  smooth,
  type Mat,
  type View,
} from "./geom";
import type { BoxBase, Obj, Pt, TextEdit } from "./model";
import { LINE, STAMP, textPad, wrap } from "./text";

const m6 = (m: Mat) => `matrix(${m.map((v) => +v.toFixed(5)).join(" ")})`;

/** A box's own frame (x right, y down) to page coordinates. */
export function boxMatrix(o: BoxBase): Mat {
  const c = Math.cos(o.angle);
  const s = Math.sin(o.angle);
  return [c, s, s, -c, o.o[0], o.o[1]];
}

const HELV_ASCENT = 0.718;
export const FONT_STACK = "Helvetica, Arial, 'Liberation Sans', sans-serif";
const familyCss = (f: TextEdit["family"]) =>
  f === "Times" ? "'Times New Roman', Times, 'Liberation Serif', serif" : f === "Courier" ? "'Courier New', Courier, 'Liberation Mono', monospace" : FONT_STACK;

export function ObjShape({ o, mpp }: { o: Obj; mpp?: number }) {
  switch (o.type) {
    case "ink":
      return (
        <path
          d={pathD(smooth(o.points))}
          fill="none"
          stroke={o.color}
          strokeWidth={o.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={o.tool === "highlighter" ? 0.38 : 1}
        />
      );
    case "line": {
      const end = o.arrow ? arrowShaftEnd(o.a, o.b, o.width) : o.b;
      return (
        <>
          <path d={pathD(polyline([o.a, end]))} stroke={o.color} strokeWidth={o.width} strokeLinecap="round" fill="none" />
          {o.arrow && <path d={pathD(polyline(arrowHead(o.a, o.b, o.width), true))} fill={o.color} />}
        </>
      );
    }
    case "shape": {
      const segs = o.shape === "rect" ? rect(o.a, o.b) : o.shape === "ellipse" ? ellipse(o.a, o.b) : cloud(o.a, o.b);
      return <path d={pathD(segs)} stroke={o.color} strokeWidth={o.width} fill="none" strokeLinejoin="round" />;
    }
    case "text":
      return <TextBox o={o} />;
    case "image":
      return (
        <g transform={m6(boxMatrix(o))}>
          <image href={o.src} x={0} y={0} width={o.w} height={o.h} preserveAspectRatio="none" />
        </g>
      );
    case "stamp":
      return (
        <g transform={m6(boxMatrix(o))}>
          <rect x={0.8} y={0.8} width={o.w - 1.6} height={o.h - 1.6} rx={5} fill="#ffffff" fillOpacity={0.55} stroke={o.color} strokeWidth={1.6} />
          <text x={o.w / 2} y={STAMP.padY + STAMP.label * 0.78} textAnchor="middle" fontFamily={FONT_STACK} fontWeight={700} fontSize={STAMP.label} fill={o.color}>
            {o.label}
          </text>
          <text x={o.w / 2} y={STAMP.padY + STAMP.label * 0.78 + STAMP.gap + STAMP.sub + 1.5} textAnchor="middle" fontFamily={FONT_STACK} fontSize={STAMP.sub} fill={o.color}>
            {o.sub}
          </text>
        </g>
      );
    case "measure":
      return <MeasureShape o={o} mpp={mpp} />;
  }
}

function TextBox({ o }: { o: Extract<Obj, { type: "text" }> }) {
  const pad = textPad(o.note);
  const lines = wrap(o.text, o.size, o.bold, Math.max(4, o.w - pad * 2));
  return (
    <g transform={m6(boxMatrix(o))}>
      {o.note && <rect x={0} y={0} width={o.w} height={o.h} fill="#fff1a8" stroke="#e2b714" strokeWidth={0.8} />}
      {lines.map((line, i) => (
        <text
          key={i}
          x={pad}
          y={pad + HELV_ASCENT * o.size + i * o.size * LINE}
          fontFamily={FONT_STACK}
          fontSize={o.size}
          fontWeight={o.bold ? 700 : 400}
          fill={o.color}
          style={{ whiteSpace: "pre" }}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function MeasureShape({ o }: { o: Extract<Obj, { type: "measure" }>; mpp?: number }) {
  if (o.kind === "count") {
    return (
      <>
        {o.points.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={6} fill={o.color} stroke="#fff" strokeWidth={0.8} />
        ))}
      </>
    );
  }
  const closed = o.kind === "area";
  return (
    <>
      <path d={pathD(polyline(o.points, closed))} stroke={o.color} strokeWidth={1.4} fill={closed ? o.color : "none"} fillOpacity={0.14} strokeLinejoin="round" />
      {o.points.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={1.8} fill={o.color} />
      ))}
    </>
  );
}

/** Labels that must read upright on screen: measurements and count numbers. Drawn in screen pixels. */
export function ScreenLabels({ objects, view, mpp }: { objects: Obj[]; view: View; mpp?: number }) {
  return (
    <>
      {objects.map((o) => {
        if (o.type !== "measure" || !o.points.length) return null;
        if (o.kind === "count") {
          return (
            <Fragment key={o.id}>
              {o.points.map((p, i) => {
                const [x, y] = apply(view.t, p);
                return (
                  <text key={i} x={x} y={y + 3.2 * Math.min(2, view.scale)} textAnchor="middle" fontSize={Math.max(8, 7 * view.scale)} fontWeight={700} fill="#fff" fontFamily={FONT_STACK}>
                    {i + 1}
                  </text>
                );
              })}
              <Tag at={apply(view.t, o.points[0])} dx={22 * view.scale + 18} dy={-14 * view.scale} text={`Count: ${o.points.length}`} color={o.color} />
            </Fragment>
          );
        }
        const text = measureLabel(o.kind, o.points, mpp);
        const anchor = o.kind === "area" ? centroid(o.points) : midOfLongest(o.points);
        return <Tag key={o.id} at={apply(view.t, anchor)} text={text ?? "Set the scale"} color={o.color} />;
      })}
    </>
  );
}

function Tag({ at, text, color, dx = 0, dy = 0 }: { at: Pt; text: string; color: string; dx?: number; dy?: number }) {
  const w = text.length * 6.6 + 12;
  return (
    <g transform={`translate(${at[0] + dx} ${at[1] + dy})`}>
      <rect x={-w / 2} y={-10} width={w} height={20} rx={6} fill="#fff" fillOpacity={0.95} stroke={color} strokeWidth={1} />
      <text x={0} y={4} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={color} fontFamily={FONT_STACK}>
        {text}
      </text>
    </g>
  );
}

function midOfLongest(pts: Pt[]): Pt {
  let best = -1;
  let at: Pt = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (d >= best) {
      best = d;
      at = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2];
    }
  }
  return at;
}

/** Retyped text on screen: the old words covered, the new words in their place. */
export function EditShape({ e }: { e: TextEdit }) {
  const [a, b, c, d, x, y] = e.run.m;
  const size = Math.hypot(c, d) || 10;
  const lx = Math.hypot(a, b) || 1;
  const m: Mat = [a / lx, b / lx, -c / size, -d / size, x, y];
  const top = -(Math.max(e.run.ascent, 0.78) * size + 0.8);
  const bottom = -Math.min(e.run.descent, -0.22) * size + 0.8;
  return (
    <g transform={m6(m)}>
      <rect x={-0.8} y={top} width={e.run.width + 1.6} height={bottom - top} fill={rgbCss(e.bg)} />
      <text
        x={0}
        y={0}
        fontFamily={familyCss(e.family)}
        fontWeight={e.bold ? 700 : 400}
        fontStyle={e.italic ? "italic" : "normal"}
        fontSize={size}
        fill={rgbCss(e.color)}
        style={{ whiteSpace: "pre" }}
      >
        {e.text}
      </text>
    </g>
  );
}

/* ---------------------------------------------------------------- hit testing */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

function nearLine(p: Pt, pts: Pt[], tol: number, closed = false): boolean {
  if (pts.length === 1) return dist(p, pts[0]) <= tol;
  for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= tol) return true;
  if (closed && pts.length > 2 && segDist(p, pts[pts.length - 1], pts[0]) <= tol) return true;
  return false;
}

function insidePoly(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Does tapping page point `p` hit this mark? `tol` is in points. */
export function hits(o: Obj, p: Pt, tol: number): boolean {
  switch (o.type) {
    case "ink":
      return nearLine(p, o.points, o.width / 2 + tol);
    case "line":
      return nearLine(p, [o.a, o.b], o.width / 2 + tol);
    case "shape": {
      const [x1, y1, x2, y2] = bounds([o.a, o.b]);
      return p[0] >= x1 - tol && p[0] <= x2 + tol && p[1] >= y1 - tol && p[1] <= y2 + tol;
    }
    case "text":
    case "image":
    case "stamp": {
      const [lx, ly] = boxLocal(o, p);
      return lx >= -tol && lx <= o.w + tol && ly >= -tol && ly <= o.h + tol;
    }
    case "measure":
      if (o.kind === "count") return o.points.some((q) => dist(p, q) <= 6 + tol);
      return nearLine(p, o.points, tol + 1, o.kind === "area") || (o.kind === "area" && insidePoly(p, o.points));
  }
}

/** The mark's outline points (for the selection frame). */
export function outline(o: Obj): Pt[] {
  switch (o.type) {
    case "ink":
    case "measure":
      return o.type === "measure" && o.kind === "count" ? o.points.flatMap((q) => [[q[0] - 6, q[1] - 6] as Pt, [q[0] + 6, q[1] + 6] as Pt]) : o.points;
    case "line":
      return [o.a, o.b];
    case "shape":
      return [o.a, o.b];
    default:
      return boxCorners(o);
  }
}

/** Move a mark by (dx, dy) page points. */
export function moved(o: Obj, dx: number, dy: number): Obj {
  const mv = (p: Pt): Pt => [p[0] + dx, p[1] + dy];
  switch (o.type) {
    case "ink":
    case "measure":
      return { ...o, points: o.points.map(mv) };
    case "line":
    case "shape":
      return { ...o, a: mv(o.a), b: mv(o.b) };
    default:
      return { ...o, o: mv(o.o) };
  }
}
