// The spreadsheet grid. Only the rows and columns in view are drawn, so big sheets scroll smoothly.
// Frozen rows and columns, and the row and column headers, stay put using sticky layers inside one
// scrolling area, so scrolling itself is native (smooth on phones).
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import clsx from "clsx";
import type { Worksheet } from "exceljs";
import { MAX_COL, MAX_ROW, colName, type Rect } from "./addr";
import type { Book } from "./book";
import { cssFont, geometry, indexAt, lookOf, textWidth, type Edge, type Geometry } from "./layout";

export interface CellPos {
  row: number;
  col: number;
}

export interface Sel {
  anchor: CellPos;
  focus: CellPos;
}

export interface Editing {
  row: number;
  col: number;
  text: string;
  /** "enter": started by typing (arrow keys finish it); "edit": started with F2 or a double tap (arrows move the caret). */
  mode: "enter" | "edit";
  where: "cell" | "bar";
  original: string;
}

export interface GridHandle {
  scrollToCell(row: number, col: number): void;
  focus(): void;
  /** How many rows fit on screen, for Page Up and Page Down. */
  pageRows(): number;
}

interface Props {
  book: Book;
  ws: Worksheet;
  version: number;
  zoom: number;
  dark: boolean;
  sel: Sel;
  selRect: Rect;
  editing: Editing | null;
  hit: CellPos | null;
  onSelect(sel: Sel): void;
  onStartEdit(row: number, col: number): void;
  onEditText(text: string): void;
  onEditKey(e: KeyboardEvent<HTMLTextAreaElement>): void;
  onEditBlur(): void;
  /** The first character typed on a selected cell (editing starts with it). */
  onTypeStart(text: string): void;
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void;
  onCopy(e: ClipboardEvent<HTMLDivElement>): void;
  onCut(e: ClipboardEvent<HTMLDivElement>): void;
  onPaste(e: ClipboardEvent<HTMLDivElement>): void;
  onHeaderMenu(kind: "row" | "col", x: number, y: number): void;
}

const OVERSCAN_ROWS = 5;
const OVERSCAN_COLS = 2;

type Hit =
  | { type: "cell"; row: number; col: number }
  | { type: "row"; row: number }
  | { type: "col"; col: number }
  | { type: "corner" }
  | { type: "handle" }
  | null;

function locate(el: Element | null): Hit {
  const t = el?.closest?.("[data-r],[data-hr],[data-hc],[data-corner],[data-handle]") as HTMLElement | null;
  if (!t) return null;
  if (t.dataset.handle != null) return { type: "handle" };
  if (t.dataset.corner != null) return { type: "corner" };
  if (t.dataset.hr) return { type: "row", row: Number(t.dataset.hr) };
  if (t.dataset.hc) return { type: "col", col: Number(t.dataset.hc) };
  return { type: "cell", row: Number(t.dataset.r), col: Number(t.dataset.c) };
}

const JUSTIFY: Record<string, string> = {
  left: "flex-start",
  center: "center",
  centerContinuous: "center",
  right: "flex-end",
  justify: "flex-start",
  distributed: "flex-start",
  fill: "flex-start",
};
const ALIGN: Record<string, string> = { top: "flex-start", middle: "center", center: "center", bottom: "flex-end", justify: "flex-start", distributed: "center" };

/**
 * A "General" number that's too wide for its column: Excel rounds it to fit (576574.75 -> 576575),
 * then switches to scientific (5.8E+05). Only fixed formats show ####.
 */
function fitGeneral(v: number, room: number, font: string): string | null {
  const abs = Math.abs(v);
  if (v === 0 || (abs >= 1e-4 && abs < 1e11)) {
    for (let d = 9; d >= 0; d--) {
      const t = String(parseFloat(v.toFixed(d)));
      if (textWidth(t, font) <= room) return t;
    }
  }
  for (let d = 5; d >= 0; d--) {
    const [m, e] = v.toExponential(d).split("e");
    const exp = Number(e);
    const t = `${m}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
    if (textWidth(t, font) <= room) return t;
  }
  return null;
}

function edgeStyle(e: Edge, horizontal: boolean): CSSProperties {
  const line = `${e.width}px ${e.style} ${e.color}`;
  return horizontal ? { borderTop: line, height: 0 } : { borderLeft: line, width: 0 };
}

export const Grid = forwardRef<GridHandle, Props>(function Grid(p, ref) {
  const { book, ws, version, zoom, dark, sel, selRect, editing } = p;
  const scroller = useRef<HTMLDivElement>(null);
  // One text box, always there, holds the keyboard: typing goes straight into it and it becomes the
  // cell editor, so fast typing never loses a key, and copy and paste events always arrive.
  const keysRef = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState({ top: 0, left: 0, w: 900, h: 600 });
  const frame = useRef(0);
  const drag = useRef<{ kind: "cells" | "rows" | "cols" | "handle" | "tap"; id: number; x: number; y: number; moved: boolean; start: Hit } | null>(null);
  const lastTap = useRef<{ row: number; col: number; at: number } | null>(null);

  const frozen = useMemo(() => book.frozen(ws), [book, ws, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const geo: Geometry = useMemo(() => geometry(ws, frozen, zoom), [ws, frozen, zoom, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const merges = useMemo(() => book.merges(ws), [book, ws, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const showCache = useMemo(() => new Map<string, ReturnType<Book["shown"]>>(), [ws, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const grid = book.gridLines(ws);

  const shown = (r: number, c: number) => {
    const k = `${r}:${c}`;
    let s = showCache.get(k);
    if (!s) showCache.set(k, (s = book.shown(ws, r, c)));
    return s;
  };

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setView((v) => ({ ...v, w: el.clientWidth, h: el.clientHeight })));
    ro.observe(el);
    setView({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // A different sheet starts at the top-left.
  useEffect(() => {
    const el = scroller.current;
    if (el) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }, [ws]);

  useEffect(() => {
    if (editing?.where === "cell" && keysRef.current) {
      const t = keysRef.current;
      if (document.activeElement !== t) t.focus({ preventScroll: true });
      const n = t.value.length;
      t.setSelectionRange(n, n);
    }
  }, [editing?.row, editing?.col, editing?.where]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    scrollToCell(row, col) {
      const el = scroller.current;
      if (!el) return;
      const r = Math.min(row, geo.rows);
      const c = Math.min(col, geo.cols);
      const visH = el.clientHeight - geo.headerH - geo.frozenH;
      const visW = el.clientWidth - geo.headerW - geo.frozenW;
      if (r > geo.frozenRows) {
        const y = geo.rowTop[r] - geo.frozenH;
        const y2 = geo.rowTop[r + 1] - geo.frozenH;
        if (y < el.scrollTop) el.scrollTop = y;
        else if (y2 > el.scrollTop + visH) el.scrollTop = y2 - visH;
      }
      if (c > geo.frozenCols) {
        const x = geo.colLeft[c] - geo.frozenW;
        const x2 = geo.colLeft[c + 1] - geo.frozenW;
        if (x < el.scrollLeft) el.scrollLeft = x;
        else if (x2 > el.scrollLeft + visW) el.scrollLeft = x2 - visW;
      }
    },
    focus() {
      keysRef.current?.focus({ preventScroll: true });
    },
    pageRows() {
      const h = (scroller.current?.clientHeight ?? 600) - geo.headerH - geo.frozenH;
      return Math.max(1, Math.floor(h / ((geo.rowTop[geo.rows + 1] / geo.rows) || 20)) - 1);
    },
  }));

  function onScroll() {
    const el = scroller.current;
    if (!el || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setView((v) => ({ ...v, top: el.scrollTop, left: el.scrollLeft }));
    });
  }

  /* ---------------------------------------------------------------- pointer */

  /** The cell, header or corner under a point on screen (empty cells aren't drawn, so this uses sizes). */
  function hitAt(clientX: number, clientY: number): Hit {
    const el = scroller.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    if (x < 0 || y < 0 || x > el.clientWidth || y > el.clientHeight) return null;
    const colAt = (vx: number) => {
      const sx = vx - geo.headerW;
      return indexAt(geo.colLeft, geo.cols, sx < geo.frozenW ? sx : sx + el.scrollLeft);
    };
    const rowAt = (vy: number) => {
      const sy = vy - geo.headerH;
      return indexAt(geo.rowTop, geo.rows, sy < geo.frozenH ? sy : sy + el.scrollTop);
    };
    if (y < geo.headerH && x < geo.headerW) return { type: "corner" };
    if (y < geo.headerH) return { type: "col", col: colAt(x) };
    if (x < geo.headerW) return { type: "row", row: rowAt(y) };
    return { type: "cell", row: rowAt(y), col: colAt(x) };
  }

  // Whole rows and columns run to the sheet's real edge, so "insert a row" means one row.
  const fullRow = (row: number): Sel => ({ anchor: { row, col: 1 }, focus: { row, col: MAX_COL } });
  const fullCol = (col: number): Sel => ({ anchor: { row: 1, col }, focus: { row: MAX_ROW, col } });

  function applyHit(h: Hit, extend: boolean) {
    if (!h) return;
    if (h.type === "cell") p.onSelect(extend ? { anchor: sel.anchor, focus: { row: h.row, col: h.col } } : { anchor: { row: h.row, col: h.col }, focus: { row: h.row, col: h.col } });
    else if (h.type === "row") p.onSelect(extend ? { anchor: { row: sel.anchor.row, col: 1 }, focus: { row: h.row, col: MAX_COL } } : fullRow(h.row));
    else if (h.type === "col") p.onSelect(extend ? { anchor: { row: 1, col: sel.anchor.col }, focus: { row: MAX_ROW, col: h.col } } : fullCol(h.col));
    else if (h.type === "corner") p.onSelect({ anchor: { row: 1, col: 1 }, focus: { row: MAX_ROW, col: MAX_COL } });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("textarea")) return;
    if (e.button === 2) return;
    const h = (e.target as HTMLElement).closest("[data-handle]") ? locate(e.target as Element) : hitAt(e.clientX, e.clientY);
    if (!h) return;
    const touch = e.pointerType === "touch";
    if (h.type === "handle") {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      drag.current = { kind: "handle", id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, start: h };
      return;
    }
    if (touch) {
      // A touch might be the start of a scroll: decide on release. (Stopping the default here only
      // stops the follow-up mouse events, which would pull focus away from the formula bar.)
      e.preventDefault();
      drag.current = { kind: "tap", id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, start: h };
      return;
    }
    e.preventDefault();
    keysRef.current?.focus({ preventScroll: true });
    applyHit(h, e.shiftKey && h.type !== "corner");
    drag.current = { kind: h.type === "row" ? "rows" : h.type === "col" ? "cols" : "cells", id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, start: h };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 8) d.moved = true;
    if (d.kind === "tap") return;
    const h = hitAt(e.clientX, e.clientY);
    if (!h) return;
    if ((d.kind === "cells" || d.kind === "handle") && h.type === "cell") p.onSelect({ anchor: sel.anchor, focus: { row: h.row, col: h.col } });
    if (d.kind === "rows" && (h.type === "row" || h.type === "cell")) p.onSelect({ anchor: { row: sel.anchor.row, col: 1 }, focus: { row: h.row, col: MAX_COL } });
    if (d.kind === "cols" && (h.type === "col" || h.type === "cell")) p.onSelect({ anchor: { row: 1, col: sel.anchor.col }, focus: { row: MAX_ROW, col: h.col } });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || d.kind !== "tap" || d.moved) return;
    const h = d.start;
    if (!h) return;
    applyHit(h, false);
    if (h.type === "cell") {
      const now = Date.now();
      const last = lastTap.current;
      if (last && last.row === h.row && last.col === h.col && now - last.at < 400) {
        lastTap.current = null;
        p.onStartEdit(h.row, h.col);
      } else lastTap.current = { row: h.row, col: h.col, at: now };
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("textarea")) return;
    const h = hitAt(e.clientX, e.clientY);
    if (h?.type === "cell") p.onStartEdit(h.row, h.col);
  }

  function onContextMenu(e: React.MouseEvent) {
    const h = hitAt(e.clientX, e.clientY);
    if (h?.type === "row" || h?.type === "col") {
      e.preventDefault();
      const inside =
        h.type === "row" ? h.row >= selRect.r1 && h.row <= selRect.r2 && selRect.c1 === 1 && selRect.c2 >= MAX_COL : h.col >= selRect.c1 && h.col <= selRect.c2 && selRect.r1 === 1 && selRect.r2 >= MAX_ROW;
      if (!inside) applyHit(h, false);
      p.onHeaderMenu(h.type, e.clientX, e.clientY);
    }
  }

  /* ---------------------------------------------------------------- what's in view */

  const fr = geo.frozenRows;
  const fc = geo.frozenCols;
  const rowFrom = Math.max(fr + 1, indexAt(geo.rowTop, geo.rows, view.top + geo.frozenH) - OVERSCAN_ROWS);
  const rowTo = Math.min(geo.rows, indexAt(geo.rowTop, geo.rows, view.top + Math.max(0, view.h - geo.headerH)) + OVERSCAN_ROWS);
  const colFrom = Math.max(fc + 1, indexAt(geo.colLeft, geo.cols, view.left + geo.frozenW) - OVERSCAN_COLS);
  const colTo = Math.min(geo.cols, indexAt(geo.colLeft, geo.cols, view.left + Math.max(0, view.w - geo.headerW)) + OVERSCAN_COLS);

  interface Region {
    key: string;
    r0: number;
    r1: number;
    c0: number;
    c1: number;
    ox: number;
    oy: number;
  }
  const regions: Region[] = [
    { key: "main", r0: rowFrom, r1: rowTo, c0: colFrom, c1: colTo, ox: geo.headerW, oy: geo.headerH },
    { key: "frows", r0: 1, r1: fr, c0: colFrom, c1: colTo, ox: geo.headerW, oy: 0 },
    { key: "fcols", r0: rowFrom, r1: rowTo, c0: 1, c1: fc, ox: 0, oy: geo.headerH },
    { key: "fcorner", r0: 1, r1: fr, c0: 1, c1: fc, ox: 0, oy: 0 },
  ];

  const palette = book.palette;
  const notes = (r: number, c: number) => {
    const n = ws.findCell(r, c)?.note as unknown;
    if (!n) return null;
    if (typeof n === "string") return n;
    const texts = (n as { texts?: { text: string }[] }).texts;
    return texts ? texts.map((t) => t.text).join("") : null;
  };

  function drawRegion(rg: Region): ReactNode[] {
    const out: ReactNode[] = [];
    const lines = new Map<string, { x: number; y: number; len: number; edge: Edge; horizontal: boolean }>();
    const done = new Set<string>();
    if (rg.r1 < rg.r0 || rg.c1 < rg.c0) return out;
    const x0 = rg.ox + geo.colLeft[rg.c0];
    const x1 = rg.ox + geo.colLeft[rg.c1 + 1];
    const y0 = rg.oy + geo.rowTop[rg.r0];
    const y1 = rg.oy + geo.rowTop[rg.r1 + 1];
    // Frozen panes cover what scrolls underneath them.
    if (rg.key !== "main") out.push(<div key="bg" className="xpane" style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }} />);
    if (grid) {
      for (let c = rg.c0; c <= rg.c1; c++) {
        if (geo.colLeft[c + 1] > geo.colLeft[c]) out.push(<div key={`gv${c}`} className="xgl" style={{ left: rg.ox + geo.colLeft[c + 1] - 1, top: y0, width: 1, height: y1 - y0 }} />);
      }
      for (let r = rg.r0; r <= rg.r1; r++) {
        if (geo.rowTop[r + 1] > geo.rowTop[r]) out.push(<div key={`gh${r}`} className="xgl" style={{ left: x0, top: rg.oy + geo.rowTop[r + 1] - 1, width: x1 - x0, height: 1 }} />);
      }
    }
    const putLine = (key: string, x: number, y: number, len: number, edge: Edge, horizontal: boolean) => {
      const old = lines.get(key);
      if (!old || old.edge.width < edge.width) lines.set(key, { x, y, len, edge, horizontal });
    };
    for (let r = rg.r0; r <= rg.r1; r++) {
      const h0 = geo.rowTop[r + 1] - geo.rowTop[r];
      if (h0 <= 0) continue;
      for (let c = rg.c0; c <= rg.c1; c++) {
        const w0 = geo.colLeft[c + 1] - geo.colLeft[c];
        if (w0 <= 0) continue;
        let row = r;
        let col = c;
        let width = w0;
        let height = h0;
        const m = merges.cover.get(`${r}:${c}`);
        if (m) {
          if (done.has(m.key)) continue;
          done.add(m.key);
          row = m.r1;
          col = m.c1;
          width = geo.colLeft[Math.min(m.c2, geo.cols) + 1] - geo.colLeft[m.c1];
          height = geo.rowTop[Math.min(m.r2, geo.rows) + 1] - geo.rowTop[m.r1];
        }
        const cell = ws.findCell(row, col);
        const look = lookOf(cell?.style, palette, dark);
        const s = shown(row, col);
        const left = rg.ox + geo.colLeft[col];
        const top = rg.oy + geo.rowTop[row];
        const font = cssFont(look, zoom);
        const pad = 3 * zoom;
        let text = s.text;
        const horizontal = look.h && look.h !== "general" ? look.h : s.kind === "number" ? "right" : s.kind === "bool" || s.kind === "error" ? "center" : "left";
        let spill = 0;
        if (text && !look.wrap) {
          const tw = textWidth(text, font) + pad * 2 + look.indent * 9 * zoom;
          if (tw > width) {
            if (s.kind === "number") {
              const fmt = book.numFmt(ws, row, col);
              const raw = book.value(ws, row, col);
              const fitted = (!fmt || fmt === "General") && typeof raw === "number" ? fitGeneral(raw, width - pad * 2, font) : null;
              const hw = textWidth("#", font) || 7;
              text = fitted ?? "#".repeat(Math.max(1, Math.floor((width - pad * 2) / hw)));
            } else if (horizontal === "left" && !m) {
              // Text runs on over empty cells to its right, like Excel.
              let room = width;
              for (let k = col + 1; k <= Math.min(geo.cols, col + 40) && room < tw; k++) {
                const next = ws.findCell(row, k);
                if ((next && next.value != null && next.value !== "") || merges.cover.has(`${row}:${k}`)) break;
                room += geo.colLeft[k + 1] - geo.colLeft[k];
              }
              spill = Math.min(room, tw);
            }
          }
        }
        const v = cell?.value as { hyperlink?: string } | null | undefined;
        const link = !!v && typeof v === "object" && "hyperlink" in (v as object);
        const unsupported = !!cell?.formula && book.isUnsupported(ws, row, col);
        const note = cell?.note ? notes(row, col) : null;
        const isHit = !!p.hit && p.hit.row === row && p.hit.col === col;
        const b = look.borders;
        const hasBorder = !!(b.top || b.right || b.bottom || b.left);
        // Nothing to draw: the grid lines already show an empty cell.
        if (!text && !look.background && !hasBorder && !m && !isHit && !note && !unsupported) continue;
        // Merged and overflowing cells hide the grid lines they cover but keep their own outline.
        const covers = !!m || !!spill;
        const inset = look.background ? 0 : 1;
        const style: CSSProperties = {
          left,
          top,
          width: (spill ? Math.max(width, spill) : width) - (covers ? inset : 0),
          height: height - (covers ? inset : 0),
          background: look.background ?? (covers ? "var(--xbg)" : undefined),
          color: s.color ?? (link ? "#0563C1" : look.color),
          font,
          textDecoration: [look.underline || link ? "underline" : "", look.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
          justifyContent: JUSTIFY[horizontal] ?? "flex-start",
          alignItems: ALIGN[look.v ?? "bottom"] ?? "flex-end",
          textAlign: horizontal === "right" ? "right" : horizontal === "center" || horizontal === "centerContinuous" ? "center" : "left",
          padding: `0 ${pad}px`,
          paddingLeft: pad + look.indent * 9 * zoom,
          zIndex: spill ? 1 : undefined,
        };
        out.push(
          <div
            key={`${row}:${col}`}
            data-r={row}
            data-c={col}
            className={clsx("xc", look.wrap && "wrap", isHit && "hit")}
            style={style}
            title={note ?? (unsupported ? "This formula is worked out in Excel. The app can't recalculate it, so it shows the value saved in the file." : undefined)}
          >
            {text && <span className="xt">{text}</span>}
            {note && <i className="xnote" aria-hidden />}
            {unsupported && <i className="xstale" aria-hidden />}
          </div>,
        );
        // Borders are drawn on the grid lines so neighbours don't double up.
        const r2 = m ? m.r2 : row;
        const c2 = m ? m.c2 : col;
        if (b.top) putLine(`h:${row}:${col}`, left, top, width, b.top, true);
        if (b.bottom) putLine(`h:${r2 + 1}:${col}`, left, top + height, width, b.bottom, true);
        if (b.left) putLine(`v:${row}:${col}`, left, top, height, b.left, false);
        if (b.right) putLine(`v:${row}:${c2 + 1}`, left + width, top, height, b.right, false);
      }
    }
    for (const [key, l] of lines) {
      const t = l.edge.width;
      out.push(
        <div
          key={`b-${key}`}
          className="xb"
          style={{
            left: l.horizontal ? l.x : l.x - Math.floor(t / 2),
            top: l.horizontal ? l.y - Math.floor(t / 2) : l.y,
            width: l.horizontal ? l.len : undefined,
            height: l.horizontal ? undefined : l.len,
            ...edgeStyle(l.edge, l.horizontal),
          }}
        />,
      );
    }
    // The selection, drawn in each layer it reaches.
    const r0 = Math.max(selRect.r1, rg.key === "main" || rg.key === "fcols" ? fr + 1 : 1);
    const r1 = Math.min(selRect.r2, rg.key === "main" || rg.key === "fcols" ? geo.rows : fr);
    const c0 = Math.max(selRect.c1, rg.key === "main" || rg.key === "frows" ? fc + 1 : 1);
    const c1 = Math.min(selRect.c2, rg.key === "main" || rg.key === "frows" ? geo.cols : fc);
    if (r0 <= r1 && c0 <= c1) {
      const x = rg.ox + geo.colLeft[c0];
      const y = rg.oy + geo.rowTop[r0];
      const w = geo.colLeft[c1 + 1] - geo.colLeft[c0];
      const h = geo.rowTop[r1 + 1] - geo.rowTop[r0];
      const multi = selRect.r1 !== selRect.r2 || selRect.c1 !== selRect.c2;
      out.push(<div key="sel" className={clsx("xsel", multi && "multi")} style={{ left: x - 1, top: y - 1, width: w + 1, height: h + 1 }} />);
      if (r1 === selRect.r2 && c1 === selRect.c2 && !editing) {
        out.push(<div key="handle" className="xhandle" data-handle="" style={{ left: x + w - 5, top: y + h - 5 }} />);
      }
    }
    // The active cell inside a bigger selection.
    const a = sel.anchor;
    const am = merges.cover.get(`${a.row}:${a.col}`);
    const ar1 = am ? am.r1 : a.row;
    const ac1 = am ? am.c1 : a.col;
    const ar2 = am ? am.r2 : a.row;
    const ac2 = am ? am.c2 : a.col;
    const inRegion = ar1 >= (rg.key === "main" || rg.key === "fcols" ? fr + 1 : 1) && ar1 <= (rg.key === "main" || rg.key === "fcols" ? geo.rows : fr) && ac1 >= (rg.key === "main" || rg.key === "frows" ? fc + 1 : 1) && ac1 <= (rg.key === "main" || rg.key === "frows" ? geo.cols : fc);
    if (inRegion && (selRect.r1 !== selRect.r2 || selRect.c1 !== selRect.c2)) {
      out.push(
        <div
          key="active"
          className="xactive"
          style={{
            left: rg.ox + geo.colLeft[ac1],
            top: rg.oy + geo.rowTop[ar1],
            width: geo.colLeft[Math.min(ac2, geo.cols) + 1] - geo.colLeft[ac1],
            height: geo.rowTop[Math.min(ar2, geo.rows) + 1] - geo.rowTop[ar1],
          }}
        />,
      );
    }
    return out;
  }

  /* ---------------------------------------------------------------- headers */

  const selectedRows = (r: number) => r >= selRect.r1 && r <= selRect.r2;
  const selectedCols = (c: number) => c >= selRect.c1 && c <= selRect.c2;
  const wholeRows = selRect.c1 === 1 && selRect.c2 >= MAX_COL;
  const wholeCols = selRect.r1 === 1 && selRect.r2 >= MAX_ROW;

  function colHeaders(c0: number, c1: number, ox: number) {
    const out: ReactNode[] = [];
    for (let c = c0; c <= c1; c++) {
      const w = geo.colLeft[c + 1] - geo.colLeft[c];
      if (w <= 0) continue;
      out.push(
        <div key={c} data-hc={c} className={clsx("xh xhc", selectedCols(c) && "on", selectedCols(c) && wholeCols && "all")} style={{ left: ox + geo.colLeft[c], width: w, height: geo.headerH }}>
          {colName(c)}
        </div>,
      );
    }
    return out;
  }

  function rowHeaders(r0: number, r1: number, oy: number) {
    const out: ReactNode[] = [];
    for (let r = r0; r <= r1; r++) {
      const h = geo.rowTop[r + 1] - geo.rowTop[r];
      if (h <= 0) continue;
      out.push(
        <div key={r} data-hr={r} className={clsx("xh xhr", selectedRows(r) && "on", selectedRows(r) && wholeRows && "all")} style={{ top: oy + geo.rowTop[r], height: h, width: geo.headerW }}>
          {r}
        </div>,
      );
    }
    return out;
  }

  const cellEditing = editing?.where === "cell";
  const boxRow = cellEditing ? editing!.row : sel.anchor.row;
  const boxCol = cellEditing ? editing!.col : sel.anchor.col;
  const bm = merges.cover.get(`${boxRow}:${boxCol}`);
  const br = Math.min(bm ? bm.r1 : boxRow, geo.rows);
  const bc = Math.min(bm ? bm.c1 : boxCol, geo.cols);
  const boxX = geo.headerW + geo.colLeft[bc] - (bc > fc ? view.left : 0);
  const boxY = geo.headerH + geo.rowTop[br] - (br > fr ? view.top : 0);
  let keysStyle: CSSProperties = { left: Math.max(0, boxX), top: Math.max(0, boxY), width: 1, height: 1 };
  if (cellEditing) {
    const cell = ws.findCell(br, bc);
    const look = lookOf(cell?.style, palette, dark);
    const font = cssFont(look, zoom);
    const w0 = geo.colLeft[Math.min(bm ? bm.c2 : bc, geo.cols) + 1] - geo.colLeft[bc];
    const h0 = geo.rowTop[Math.min(bm ? bm.r2 : br, geo.rows) + 1] - geo.rowTop[br];
    const longest = Math.max(...editing!.text.split("\n").map((line) => textWidth(line, font)));
    keysStyle = {
      left: boxX,
      top: boxY,
      width: Math.min(Math.max(w0, longest + 14 * zoom), Math.max(w0, view.w - 20)),
      height: Math.max(h0, (editing!.text.split("\n").length * ((look.size * 4) / 3) * 1.2 + 6) * zoom),
      font,
      background: look.background,
    };
  }

  const totalW = geo.headerW + geo.colLeft[geo.cols + 1];
  const totalH = geo.headerH + geo.rowTop[geo.rows + 1];

  return (
    <div
      ref={scroller}
      className={clsx("xgrid", dark && "dark")}
      tabIndex={-1}
      role="grid"
      aria-label={`${ws.name} sheet`}
      aria-rowcount={geo.rows}
      aria-colcount={geo.cols}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onCopy={p.onCopy}
      onCut={p.onCut}
      onPaste={p.onPaste}
    >
      <div className="xcanvas" style={{ width: totalW, height: totalH }}>
        <div className="xlayer xmain">{drawRegion(regions[0])}</div>
        {fc > 0 && (
          <div className="xband xfcols" style={{ left: geo.headerW }}>
            {drawRegion(regions[2])}
          </div>
        )}
        {fr > 0 && (
          <div className="xband xfrows" style={{ top: geo.headerH }}>
            {drawRegion(regions[1])}
          </div>
        )}
        {fr > 0 && fc > 0 && (
          <div className="xband xfcorner" style={{ top: geo.headerH, left: geo.headerW }}>
            {drawRegion(regions[3])}
          </div>
        )}
        {(fr > 0 || fc > 0) && (
          <div className="xband xfreeze" style={{ top: geo.headerH, left: geo.headerW }} aria-hidden>
            {fr > 0 && <div className="xfreeze-h" style={{ top: geo.frozenH - 1, width: Math.max(0, view.w - geo.headerW) }} />}
            {fc > 0 && <div className="xfreeze-v" style={{ left: geo.frozenW - 1, height: Math.max(0, view.h - geo.headerH) }} />}
          </div>
        )}
        <div className="xband xrowh" style={{ left: 0 }}>
          {rowHeaders(rowFrom, rowTo, geo.headerH)}
        </div>
        {fr > 0 && (
          <div className="xband xrowh-f" style={{ top: geo.headerH, left: 0 }}>
            {rowHeaders(1, fr, 0)}
          </div>
        )}
        <div className="xband xcolh" style={{ top: 0 }}>
          {colHeaders(colFrom, colTo, geo.headerW)}
        </div>
        {fc > 0 && (
          <div className="xband xcolh-f" style={{ top: 0, left: geo.headerW }}>
            {colHeaders(1, fc, 0)}
          </div>
        )}
        <div className="xband xoverlay" style={{ top: 0, left: 0 }}>
          <textarea
            ref={keysRef}
            className={clsx("xkeys", cellEditing && "on")}
            value={cellEditing ? editing!.text : ""}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            aria-label={cellEditing ? `Edit ${colName(bc)}${br}` : `${ws.name}, cell ${colName(bc)}${br}`}
            onChange={(e) => (cellEditing ? p.onEditText(e.target.value) : e.target.value && p.onTypeStart(e.target.value))}
            onKeyDown={(e) => (cellEditing ? p.onEditKey(e) : p.onKeyDown(e))}
            onBlur={() => cellEditing && p.onEditBlur()}
            style={keysStyle}
          />
        </div>
        <div className="xband xcorner" style={{ top: 0, left: 0 }}>
          <div className="xh xcornerbox" data-corner="" style={{ width: geo.headerW, height: geo.headerH }} title="Select the whole sheet" />
        </div>
      </div>
    </div>
  );
});
