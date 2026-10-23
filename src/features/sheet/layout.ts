// Sizes and looks: row heights and column widths in pixels, and how a cell's formatting draws.
import type { Style, Worksheet } from "exceljs";
import { luminance, resolveColor } from "./colors";

/** Excel column width (in characters of the default font) to pixels at 100%. */
export const colPx = (chars: number) => Math.round(chars * 7 + 5);
/** Row height in points to pixels. */
export const rowPx = (pt: number) => Math.round((pt * 4) / 3);

export const HEADER_H = 24;

export interface Geometry {
  rows: number;
  cols: number;
  /** rowTop[r] = y of row r (row 1 at 0); rowTop[rows + 1] = total height. Already zoomed. */
  rowTop: Float64Array;
  colLeft: Float64Array;
  frozenRows: number;
  frozenCols: number;
  frozenH: number;
  frozenW: number;
  headerW: number;
  headerH: number;
}

let measureCtx: CanvasRenderingContext2D | null = null;
const measureCache = new Map<string, number>();

/** Width of text in pixels for a CSS font. */
export function textWidth(text: string, font: string): number {
  const key = `${font}|${text}`;
  const hit = measureCache.get(key);
  if (hit != null) return hit;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  const w = measureCtx.measureText(text).width;
  if (measureCache.size > 20000) measureCache.clear();
  measureCache.set(key, w);
  return w;
}

export function fontFamily(name: string | undefined) {
  const n = (name ?? "Calibri").replace(/["']/g, "");
  return `"${n}", Calibri, Carlito, "Segoe UI", Arial, sans-serif`;
}

function columnWidth(ws: Worksheet, c: number): { width: number; hidden: boolean } {
  const def = (ws as unknown as { _columns?: ({ width?: number; hidden?: boolean } | undefined)[] })._columns?.[c - 1];
  const fallback = (ws.properties as { defaultColWidth?: number }).defaultColWidth ?? 8.43;
  return { width: def?.width ?? fallback, hidden: !!def?.hidden };
}

/** Rows with wrapped text and no set height grow to fit, like Excel does. */
function autoHeight(ws: Worksheet, r: number, base: number): number {
  const row = ws.findRow(r);
  if (!row) return base;
  let need = base;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (!cell.style?.alignment?.wrapText || cell.value == null) return;
    if (cell.isMerged && cell.master !== cell) return;
    const text = String(cell.text ?? "");
    if (!text) return;
    const size = cell.style.font?.size ?? 11;
    const font = `${cell.style.font?.bold ? "600 " : ""}${(size * 4) / 3}px ${fontFamily(cell.style.font?.name)}`;
    const width = Math.max(10, colPx(columnWidth(ws, Number(cell.col)).width) - 6);
    let lines = 0;
    for (const para of text.split("\n")) {
      const words = para.split(/\s+/);
      let line = "";
      let count = 1;
      for (const w of words) {
        const next = line ? `${line} ${w}` : w;
        if (line && textWidth(next, font) > width) {
          count++;
          line = w;
        } else line = next;
      }
      lines += count;
    }
    need = Math.max(need, Math.ceil(lines * ((size * 4) / 3) * 1.22 + 4));
  });
  return need;
}

export function geometry(ws: Worksheet, frozen: { rows: number; cols: number }, zoom: number): Geometry {
  const rows = Math.min(Math.max(ws.rowCount + 60, 120, frozen.rows + 60), 200000);
  const cols = Math.min(Math.max(ws.columnCount + 8, 26, frozen.cols + 10), 16384);
  const defaultPt = (ws.properties as { defaultRowHeight?: number }).defaultRowHeight ?? 15;
  const basePx = rowPx(defaultPt);
  const rowTop = new Float64Array(rows + 2);
  for (let r = 1; r <= rows; r++) {
    const row = r <= ws.rowCount ? ws.findRow(r) : undefined;
    let h = 0;
    if (!row?.hidden) h = row?.height ? rowPx(row.height) : row ? autoHeight(ws, r, basePx) : basePx;
    rowTop[r + 1] = rowTop[r] + h * zoom;
  }
  const colLeft = new Float64Array(cols + 2);
  for (let c = 1; c <= cols; c++) {
    const { width, hidden } = columnWidth(ws, c);
    colLeft[c + 1] = colLeft[c] + (hidden ? 0 : colPx(width)) * zoom;
  }
  const digits = String(rows).length;
  return {
    rows,
    cols,
    rowTop,
    colLeft,
    frozenRows: Math.min(frozen.rows, rows),
    frozenCols: Math.min(frozen.cols, cols),
    frozenH: rowTop[Math.min(frozen.rows, rows) + 1],
    frozenW: colLeft[Math.min(frozen.cols, cols) + 1],
    headerW: Math.max(34, digits * 8 + 14),
    headerH: HEADER_H,
  };
}

/** The first index i (1..n) with arr[i + 1] > y, i.e. the row or column under offset y. */
export function indexAt(arr: Float64Array, n: number, y: number): number {
  let lo = 1;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid + 1] > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/* ---------------------------------------------------------------- how a cell looks */

export interface Edge {
  width: number;
  style: "solid" | "dashed" | "dotted" | "double";
  color: string;
}

export interface Look {
  background?: string;
  color?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** Font size in points. */
  size: number;
  family: string;
  h?: string;
  v?: string;
  wrap: boolean;
  indent: number;
  borders: { top?: Edge; right?: Edge; bottom?: Edge; left?: Edge };
}

const EDGE: Record<string, [number, Edge["style"]]> = {
  hair: [1, "dotted"],
  dotted: [1, "dotted"],
  thin: [1, "solid"],
  dashed: [1, "dashed"],
  dashDot: [1, "dashed"],
  dashDotDot: [1, "dashed"],
  medium: [2, "solid"],
  mediumDashed: [2, "dashed"],
  mediumDashDot: [2, "dashed"],
  mediumDashDotDot: [2, "dashed"],
  slantDashDot: [2, "dashed"],
  thick: [3, "solid"],
  double: [3, "double"],
};

const looks = { light: new WeakMap<object, Look>(), dark: new WeakMap<object, Look>() };
const EMPTY_STYLE = {};

export function lookOf(style: Partial<Style> | undefined, palette: string[], dark: boolean): Look {
  const key = (style ?? EMPTY_STYLE) as object;
  const cache = dark ? looks.dark : looks.light;
  const hit = cache.get(key);
  if (hit) return hit;
  const s = style ?? {};
  const fill = s.fill as { type?: string; pattern?: string; fgColor?: object; bgColor?: object } | undefined;
  let background: string | undefined;
  if (fill?.type === "pattern" && fill.pattern && fill.pattern !== "none") {
    background = resolveColor((fill.pattern === "solid" ? fill.fgColor : fill.fgColor ?? fill.bgColor) as never, palette) ?? undefined;
  } else if (fill?.type === "gradient") {
    const stops = (fill as { stops?: { color: object }[] }).stops;
    background = stops?.[0] ? resolveColor(stops[0].color as never, palette) ?? undefined : undefined;
  }
  let color = resolveColor(s.font?.color as never, palette) ?? undefined;
  if (dark && background && !color) {
    // "Automatic" text on a coloured cell: dark on light fills, light on dark ones.
    color = luminance(background) > 0.35 ? "#111827" : "#f2f4f7";
  } else if (dark && !background) {
    // Dark text on the dark grid would vanish: lighten it. Bright colours stay as they are.
    if (!color || luminance(color) < 0.22) color = undefined;
  }
  if (!dark && !background && color && luminance(color) > 0.9) color = undefined; // white text on white
  const borders: Look["borders"] = {};
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const b = s.border?.[side] as { style?: string; color?: object } | undefined;
    if (!b?.style || !EDGE[b.style]) continue;
    const [width, st] = EDGE[b.style];
    let c = resolveColor(b.color as never, palette) ?? "#000000";
    if (dark && luminance(c) < 0.22) c = "#c9ced6";
    borders[side] = { width, style: st, color: c };
  }
  const look: Look = {
    background,
    color,
    bold: !!s.font?.bold,
    italic: !!s.font?.italic,
    underline: !!s.font?.underline,
    strike: !!s.font?.strike,
    size: s.font?.size ?? 11,
    family: fontFamily(s.font?.name),
    h: s.alignment?.horizontal,
    v: s.alignment?.vertical,
    wrap: !!s.alignment?.wrapText,
    indent: s.alignment?.indent ?? 0,
    borders,
  };
  cache.set(key, look);
  return look;
}

export function cssFont(look: Look, zoom: number) {
  return `${look.italic ? "italic " : ""}${look.bold ? "700 " : "400 "}${((look.size * 4) / 3) * zoom}px ${look.family}`;
}
