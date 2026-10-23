// Spreadsheet viewer and editor for Excel (.xlsx, .xlsm, old .xls) and CSV files.
// Edits recalculate formulas straight away; "Save as new version" keeps the original untouched.
import "./sheet.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Eraser,
  Info,
  Italic,
  PaintBucket,
  Pencil,
  Plus,
  Redo2,
  Rows3,
  Save,
  Scissors,
  Search,
  TriangleAlert,
  Underline,
  Undo2,
  WrapText,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Style, Worksheet } from "exceljs";
import { useToast } from "@/components/ui";
import type { EditorProps } from "@/features/files/editor";
import { MAX_COL, MAX_ROW, cellName, colName, norm, parseRect, rectName, type Rect } from "./addr";
import { Book, type Clip } from "./book";
import { SWATCHES } from "./colors";
import { Grid, type Editing, type GridHandle, type Sel } from "./Grid";

const ZOOMS = [0.5, 0.67, 0.75, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];

const FORMATS: { label: string; hint: string; fmt: string }[] = [
  { label: "General", hint: "As typed", fmt: "General" },
  { label: "Number", hint: "1,234.50", fmt: "#,##0.00" },
  { label: "SAR", hint: "SAR 1,234.50", fmt: '"SAR "#,##0.00' },
  { label: "Percent", hint: "12.50%", fmt: "0.00%" },
  { label: "Date", hint: "23 Oct 2026", fmt: "dd mmm yyyy" },
];

function isDarkNow() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function useDark() {
  const [dark, setDark] = useState(isDarkNow);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const update = () => setDark(isDarkNow());
    mq?.addEventListener?.("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq?.removeEventListener?.("change", update);
      mo.disconnect();
    };
  }, []);
  return dark;
}

const coarse = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;

function money(n: number) {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 2, minimumFractionDigits: Math.abs(n % 1) > 0 ? 2 : 0 });
}

/** A small menu that opens under its button (in a floating layer, so the scrolling toolbar can't clip it). */
function Pop({ open, onClose, children, anchor, at, className }: { open: boolean; onClose: () => void; children: ReactNode; anchor?: HTMLElement | null; at?: { x: number; y: number }; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = ref.current?.getBoundingClientRect();
      const w = box?.width ?? 220;
      const h = box?.height ?? 200;
      let left = at ? at.x : anchor ? anchor.getBoundingClientRect().left : 12;
      let top = at ? at.y : anchor ? anchor.getBoundingClientRect().bottom + 6 : 12;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      if (top + h > window.innerHeight - 8) top = Math.max(8, (at ? at.y : anchor ? anchor.getBoundingClientRect().top : top) - h - 6);
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, anchor, at]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(anchor && anchor.contains(e.target as Node))) onClose();
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={clsx("xpop", className)}
      role="menu"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && (e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export default function SheetEditor({ attachment, data, saveVersion, setDirty }: EditorProps) {
  const toast = useToast();
  const dark = useDark();
  const [book, setBook] = useState<Book | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [wsId, setWsId] = useState<number>(0);
  const [sel, setSel] = useState<Sel>({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } });
  const [editing, setEditing] = useState<Editing | null>(null);
  // Phones start a little smaller so more of a bill fits on screen.
  const [zoom, setZoom] = useState(() => (window.innerWidth < 600 ? 0.8 : 1));
  const [, setTick] = useState(0);
  const [menu, setMenu] = useState<null | "fill" | "color" | "format" | "rows" | "more">(null);
  const [rowMenuAt, setRowMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ wsId: number; row: number; col: number }[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [renaming, setRenaming] = useState<{ wsId: number; name: string } | null>(null);
  const [goto, setGoto] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<GridHandle>(null);
  const barRef = useRef<HTMLInputElement>(null);
  const clipRef = useRef<Clip | null>(null);
  const savedVersion = useRef(0);
  const findRef = useRef<HTMLInputElement>(null);
  const anchors = useRef<Record<string, HTMLElement | null>>({});
  // Some browsers don't send copy and paste events to the grid: these catch that case.
  const pendingCopy = useRef<{ cut: boolean } | null>(null);
  const pendingPaste = useRef(false);
  const focusingFor = useRef<Editing | null>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Open the file (once per version of it).
  useEffect(() => {
    let alive = true;
    setBook(null);
    setFailed(null);
    Book.open(data, attachment.name)
      .then((b) => {
        if (!alive) return;
        setBook(b);
        setWsId(b.sheets()[0]?.id ?? b.wb.worksheets[0].id);
        savedVersion.current = b.version;
      })
      .catch((e) => {
        console.error(e);
        if (alive) setFailed("This file couldn't be opened here. It may be damaged or in a format the app doesn't read. You can still download it.");
      });
    return () => {
      alive = false;
    };
    // The contents only change with the file version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id]);

  // With a mouse and keyboard, the sheet takes the keyboard as soon as it opens, so arrows and
  // shortcuts work straight away. Phones skip this: focusing would pop the on-screen keyboard up.
  useEffect(() => {
    if (!book || coarse()) return;
    const id = requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || a === document.body) gridRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [book]);

  const ws: Worksheet | undefined = book ? book.sheetById(wsId) ?? book.sheets()[0] : undefined;
  const version = book?.version ?? 0;

  // Tell the file screen about unsaved changes.
  useEffect(() => {
    if (book) setDirty(book.version !== savedVersion.current);
  }, [book, version, setDirty]);

  const selRect: Rect = useMemo(() => {
    let r = norm({ r1: sel.anchor.row, c1: sel.anchor.col, r2: sel.focus.row, c2: sel.focus.col });
    if (!book || !ws) return r;
    // Grow the selection to cover merged cells it touches, like Excel.
    const merges = book.merges(ws);
    if (!merges.masters.size) return r;
    for (let pass = 0; pass < 4; pass++) {
      let grown = false;
      for (const m of merges.masters.values()) {
        if (m.r1 <= r.r2 && r.r1 <= m.r2 && m.c1 <= r.c2 && r.c1 <= m.c2) {
          const next = { r1: Math.min(r.r1, m.r1), c1: Math.min(r.c1, m.c1), r2: Math.max(r.r2, m.r2), c2: Math.max(r.c2, m.c2) };
          if (next.r1 !== r.r1 || next.c1 !== r.c1 || next.r2 !== r.r2 || next.c2 !== r.c2) {
            r = next;
            grown = true;
          }
        }
      }
      if (!grown) break;
    }
    return r;
  }, [sel, book, ws, version]);

  const active = book && ws ? book.master(ws, sel.anchor.row, sel.anchor.col) : sel.anchor;
  const activeCell = ws?.findCell(active.row, active.col);
  const activeStyle: Partial<Style> = activeCell?.style ?? {};
  const isCsv = book?.kind === "csv";

  /* ---------------------------------------------------------------- selection and moving */

  const select = useCallback(
    (s: Sel) => {
      setSel(s);
      gridRef.current?.scrollToCell(s.focus.row, s.focus.col);
    },
    [],
  );

  function hiddenRow(r: number) {
    return !!ws?.findRow(r)?.hidden;
  }
  function hiddenCol(c: number) {
    return !!(ws as unknown as { _columns?: ({ hidden?: boolean } | undefined)[] } | undefined)?._columns?.[c - 1]?.hidden;
  }

  function step(from: { row: number; col: number }, dr: number, dc: number) {
    if (!book || !ws) return from;
    let { row, col } = from;
    const m = book.merges(ws).cover.get(`${row}:${col}`);
    if (m) {
      if (dr > 0) row = m.r2;
      if (dc > 0) col = m.c2;
      if (dr < 0) row = m.r1;
      if (dc < 0) col = m.c1;
    }
    do {
      row = Math.max(1, row + dr);
      col = Math.max(1, col + dc);
    } while (((dr && hiddenRow(row) && row > 1) || (dc && hiddenCol(col) && col > 1)) && row < 1048576 && col < 16384);
    const target = book.master(ws, row, col);
    return target;
  }

  /** Ctrl + arrow: jump to the edge of the data, like Excel. */
  function jump(from: { row: number; col: number }, dr: number, dc: number) {
    if (!book || !ws) return from;
    const filled = (r: number, c: number) => {
      const v = book.value(ws, r, c);
      return v != null && v !== "";
    };
    const maxR = Math.max(ws.rowCount, 1);
    const maxC = Math.max(ws.columnCount, 1);
    let { row, col } = from;
    const inside = (r: number, c: number) => r >= 1 && c >= 1 && r <= maxR && c <= maxC;
    const nextFilled = filled(row + dr, col + dc);
    if (filled(row, col) && nextFilled) {
      while (inside(row + dr, col + dc) && filled(row + dr, col + dc)) {
        row += dr;
        col += dc;
      }
    } else {
      row += dr;
      col += dc;
      while (inside(row, col) && !filled(row, col)) {
        row += dr;
        col += dc;
      }
      if (!inside(row, col)) {
        row = dr > 0 ? maxR : dr < 0 ? 1 : row - dr;
        col = dc > 0 ? maxC : dc < 0 ? 1 : col - dc;
      }
    }
    return { row: Math.max(1, row), col: Math.max(1, col) };
  }

  /* ---------------------------------------------------------------- editing */

  function startEdit(row: number, col: number, initial?: string, mode: Editing["mode"] = "edit") {
    if (!book || !ws) return;
    const at = book.master(ws, row, col);
    const original = book.inputText(ws, at.row, at.col);
    const where = coarse() ? "bar" : "cell";
    const next: Editing = { row: at.row, col: at.col, text: initial ?? original, mode, where, original };
    setSel({ anchor: at, focus: at });
    setEditing(next);
    if (where === "bar") {
      // Focus now, inside the tap, so the phone's keyboard opens.
      focusingFor.current = next;
      barRef.current?.focus();
      focusingFor.current = null;
    }
  }

  function commit(move: "down" | "up" | "right" | "left" | "none"): boolean {
    if (!book || !ws || !editing) return true;
    if (editing.text !== editing.original) {
      const problem = book.setInput(ws, editing.row, editing.col, editing.text);
      if (problem) {
        toast(problem, "error");
        return false;
      }
    }
    setEditing(null);
    refresh();
    const from = { row: editing.row, col: editing.col };
    const to = move === "down" ? step(from, 1, 0) : move === "up" ? step(from, -1, 0) : move === "right" ? step(from, 0, 1) : move === "left" ? step(from, 0, -1) : from;
    select({ anchor: to, focus: to });
    if (!coarse()) requestAnimationFrame(() => gridRef.current?.focus());
    return true;
  }

  function cancelEdit() {
    setEditing(null);
    if (!coarse()) requestAnimationFrame(() => gridRef.current?.focus());
  }

  function onEditKey(e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) {
    if (!editing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === "Enter" && !e.altKey) {
      e.preventDefault();
      commit(e.shiftKey ? "up" : "down");
      return;
    }
    if (e.key === "Enter" && e.altKey && editing.where === "cell") {
      e.preventDefault();
      const t = e.currentTarget as HTMLTextAreaElement;
      const pos = t.selectionStart ?? editing.text.length;
      const text = `${editing.text.slice(0, pos)}\n${editing.text.slice(t.selectionEnd ?? pos)}`;
      setEditing({ ...editing, text });
      requestAnimationFrame(() => t.setSelectionRange(pos + 1, pos + 1));
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      commit(e.shiftKey ? "left" : "right");
      return;
    }
    if (editing.mode === "enter" && editing.where === "cell" && ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      commit(e.key === "ArrowDown" ? "down" : e.key === "ArrowUp" ? "up" : e.key === "ArrowLeft" ? "left" : "right");
    }
  }

  /* ---------------------------------------------------------------- changes */

  const changed = () => {
    refresh();
  };

  function undo() {
    if (!book) return;
    setEditing(null);
    const s = book.undo();
    if (s) {
      if (s.wsId !== wsId && book.sheetById(s.wsId)) setWsId(s.wsId);
      setSel({ anchor: { row: s.sel.r1, col: s.sel.c1 }, focus: { row: s.sel.r2, col: s.sel.c2 } });
      changed();
    }
  }
  function redo() {
    if (!book) return;
    setEditing(null);
    const s = book.redo();
    if (s) {
      if (s.wsId !== wsId && book.sheetById(s.wsId)) setWsId(s.wsId);
      setSel({ anchor: { row: s.sel.r1, col: s.sel.c1 }, focus: { row: s.sel.r2, col: s.sel.c2 } });
      changed();
    }
  }

  function formatSel(label: string, fn: (s: Partial<Style>) => Partial<Style>) {
    if (!book || !ws || isCsv) return;
    book.format(ws, selRect, label, fn);
    changed();
  }

  const toggleFont = (key: "bold" | "italic" | "underline") => {
    const on = !activeStyle.font?.[key];
    formatSel(key, (s) => ({ ...s, font: { ...(s.font ?? {}), [key]: on } }));
  };

  const setAlign = (horizontal: "left" | "center" | "right") => {
    const same = activeStyle.alignment?.horizontal === horizontal;
    formatSel("alignment", (s) => ({ ...s, alignment: { ...(s.alignment ?? {}), horizontal: same ? undefined : horizontal } }));
  };

  const toggleWrap = () => {
    const on = !activeStyle.alignment?.wrapText;
    formatSel("wrap text", (s) => ({ ...s, alignment: { ...(s.alignment ?? {}), wrapText: on } }));
  };

  const setFill = (hex: string | null) => {
    setMenu(null);
    formatSel("fill colour", (s) => {
      const out = { ...s };
      if (hex) out.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex.slice(1)}` } };
      else delete out.fill;
      return out;
    });
  };

  const setColor = (hex: string | null) => {
    setMenu(null);
    formatSel("text colour", (s) => {
      const font = { ...(s.font ?? {}) };
      if (hex) font.color = { argb: `FF${hex.slice(1)}` };
      else delete font.color;
      return { ...s, font };
    });
  };

  const setNumFmt = (fmt: string) => {
    setMenu(null);
    formatSel("number format", (s) => ({ ...s, numFmt: fmt }));
  };

  function clearSel() {
    if (!book || !ws) return;
    book.clear(ws, selRect);
    changed();
  }

  /* ---------------------------------------------------------------- rows and columns */

  const nRows = selRect.r2 - selRect.r1 + 1;
  const nCols = selRect.c2 - selRect.c1 + 1;
  const wholeCols = selRect.r1 === 1 && selRect.r2 >= MAX_ROW;
  const wholeRows = selRect.c1 === 1 && selRect.c2 >= MAX_COL;
  const rowsLabel = (n: number) => (n === 1 ? "row" : `${n} rows`);
  const colsLabel = (n: number) => (n === 1 ? "column" : `${n} columns`);
  // Rows: selecting whole columns shouldn't offer to insert a million rows.
  const rowCount = wholeCols ? 1 : Math.min(nRows, 500);
  const colCount = wholeRows ? 1 : Math.min(nCols, 100);

  function rowsAction(kind: "above" | "below" | "remove-rows" | "left" | "right" | "remove-cols") {
    if (!book || !ws) return;
    setMenu(null);
    setRowMenuAt(null);
    setEditing(null);
    if (kind === "above") book.insertRows(ws, selRect.r1, rowCount);
    if (kind === "below") book.insertRows(ws, selRect.r1 + rowCount, rowCount);
    if (kind === "remove-rows") book.deleteRows(ws, selRect.r1, Math.min(nRows, Math.max(ws.rowCount - selRect.r1 + 1, 1)));
    if (kind === "left") book.insertCols(ws, selRect.c1, colCount);
    if (kind === "right") book.insertCols(ws, selRect.c1 + colCount, colCount);
    if (kind === "remove-cols") book.deleteCols(ws, selRect.c1, Math.min(nCols, Math.max(ws.columnCount - selRect.c1 + 1, 1)));
    changed();
  }

  const rowsMenu = (
    <>
      <button type="button" role="menuitem" onClick={() => rowsAction("above")}>
        Insert {rowsLabel(rowCount)} above
      </button>
      <button type="button" role="menuitem" onClick={() => rowsAction("below")}>
        Insert {rowsLabel(rowCount)} below
      </button>
      <button type="button" role="menuitem" className="danger" onClick={() => rowsAction("remove-rows")}>
        Remove {rowsLabel(wholeCols ? 1 : nRows)}
      </button>
      <hr />
      <button type="button" role="menuitem" onClick={() => rowsAction("left")}>
        Insert {colsLabel(colCount)} left
      </button>
      <button type="button" role="menuitem" onClick={() => rowsAction("right")}>
        Insert {colsLabel(colCount)} right
      </button>
      <button type="button" role="menuitem" className="danger" onClick={() => rowsAction("remove-cols")}>
        Remove {colsLabel(wholeRows ? 1 : nCols)}
      </button>
    </>
  );

  /* ---------------------------------------------------------------- clipboard */

  function doCopy(cut: boolean): string | null {
    if (!book || !ws) return null;
    const rect = { ...selRect, r2: Math.min(selRect.r2, Math.max(ws.rowCount, selRect.r1)), c2: Math.min(selRect.c2, Math.max(ws.columnCount, selRect.c1)) };
    const clip = book.copy(ws, rect);
    clipRef.current = clip;
    if (cut) {
      book.clear(ws, rect);
      changed();
    }
    return clip.tsv;
  }

  function doPaste(text: string) {
    if (!book || !ws) return;
    const at = { row: selRect.r1, col: selRect.c1 };
    const clip = clipRef.current;
    const norm1 = (t: string) => t.replace(/\r\n/g, "\n").replace(/\n$/, "");
    const rect = clip && norm1(clip.tsv) === norm1(text) ? book.pasteClip(ws, at, clip) : book.pasteText(ws, at, text);
    if (rect) setSel({ anchor: { row: rect.r1, col: rect.c1 }, focus: { row: rect.r2, col: rect.c2 } });
    changed();
  }

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    pendingCopy.current = null;
    if (editing) return;
    const tsv = doCopy(false);
    if (tsv == null) return;
    e.clipboardData.setData("text/plain", tsv);
    e.preventDefault();
  };
  const onCut = (e: ClipboardEvent<HTMLDivElement>) => {
    pendingCopy.current = null;
    if (editing) return;
    const tsv = doCopy(true);
    if (tsv == null) return;
    e.clipboardData.setData("text/plain", tsv);
    e.preventDefault();
  };
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    pendingPaste.current = false;
    if (editing) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    doPaste(text);
  };

  async function copyButton(cut: boolean, quiet = false) {
    setMenu(null);
    const tsv = doCopy(cut);
    if (tsv == null) return;
    try {
      await navigator.clipboard.writeText(tsv);
    } catch {
      /* the app's own copy still works for pasting inside the sheet */
    }
    if (!quiet) toast(cut ? "Cut. Paste where you want it." : "Copied", "info");
  }

  async function pasteButton() {
    setMenu(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text) doPaste(text);
    } catch {
      if (clipRef.current) doPaste(clipRef.current.tsv);
      else toast("Use your keyboard's paste (Ctrl+V or Cmd+V) to paste here.", "info");
    }
  }

  /* ---------------------------------------------------------------- keyboard */

  function onGridKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!book || !ws || editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const moveTo = (to: { row: number; col: number }) => {
      e.preventDefault();
      select(e.shiftKey ? { anchor: sel.anchor, focus: to } : { anchor: to, focus: to });
    };
    const from = e.shiftKey ? sel.focus : sel.anchor;
    if (k === "ArrowDown") return moveTo(mod ? jump(from, 1, 0) : step(from, 1, 0));
    if (k === "ArrowUp") return moveTo(mod ? jump(from, -1, 0) : step(from, -1, 0));
    if (k === "ArrowRight") return moveTo(mod ? jump(from, 0, 1) : step(from, 0, 1));
    if (k === "ArrowLeft") return moveTo(mod ? jump(from, 0, -1) : step(from, 0, -1));
    if (k === "PageDown") return moveTo({ row: from.row + (gridRef.current?.pageRows() ?? 20), col: from.col });
    if (k === "PageUp") return moveTo({ row: Math.max(1, from.row - (gridRef.current?.pageRows() ?? 20)), col: from.col });
    if (k === "Home") return moveTo(mod ? { row: 1, col: 1 } : { row: from.row, col: 1 });
    if (k === "End" && mod) return moveTo({ row: Math.max(1, ws.rowCount), col: Math.max(1, ws.columnCount) });
    if (k === "Enter") {
      e.preventDefault();
      const to = step(sel.anchor, e.shiftKey ? -1 : 1, 0);
      return select({ anchor: to, focus: to });
    }
    if (k === "Tab") {
      e.preventDefault();
      const to = step(sel.anchor, 0, e.shiftKey ? -1 : 1);
      return select({ anchor: to, focus: to });
    }
    if (k === "F2") {
      e.preventDefault();
      return startEdit(sel.anchor.row, sel.anchor.col);
    }
    if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      return clearSel();
    }
    if (mod && !e.shiftKey && (k === "c" || k === "C" || k === "x" || k === "X")) {
      // Let the browser's copy event run; if it doesn't arrive, copy here instead.
      pendingCopy.current = { cut: k.toLowerCase() === "x" };
      window.setTimeout(() => {
        const pending = pendingCopy.current;
        pendingCopy.current = null;
        if (pending) void copyButton(pending.cut, true);
      }, 80);
      return;
    }
    if (mod && !e.shiftKey && (k === "v" || k === "V")) {
      pendingPaste.current = true;
      window.setTimeout(() => {
        if (!pendingPaste.current) return;
        pendingPaste.current = false;
        void pasteButton();
      }, 80);
      return;
    }
    if (mod && (k === "z" || k === "Z")) {
      e.preventDefault();
      return e.shiftKey ? redo() : undo();
    }
    if (mod && (k === "y" || k === "Y")) {
      e.preventDefault();
      return redo();
    }
    if (mod && (k === "b" || k === "B")) {
      e.preventDefault();
      return toggleFont("bold");
    }
    if (mod && (k === "i" || k === "I")) {
      e.preventDefault();
      return toggleFont("italic");
    }
    if (mod && (k === "u" || k === "U")) {
      e.preventDefault();
      return toggleFont("underline");
    }
    if (mod && (k === "f" || k === "F")) {
      e.preventDefault();
      return openFind();
    }
    if (mod && (k === "a" || k === "A")) {
      e.preventDefault();
      return setSel({ anchor: { row: 1, col: 1 }, focus: { row: MAX_ROW, col: MAX_COL } });
    }
    if (mod && (k === "s" || k === "S")) {
      e.preventDefault();
      void save();
      return;
    }
    // Any other character goes into the grid's text box and starts editing (see onTypeStart).
  }

  /* ---------------------------------------------------------------- find */

  function openFind() {
    setFinding(true);
    requestAnimationFrame(() => findRef.current?.select());
  }

  function runFind(q: string) {
    setQuery(q);
    if (!book) return;
    const found = book.find(q);
    setHits(found);
    setHitIndex(0);
    if (found[0]) goHit(found[0]);
  }

  function goHit(h: { wsId: number; row: number; col: number }) {
    if (h.wsId !== wsId) setWsId(h.wsId);
    setSel({ anchor: { row: h.row, col: h.col }, focus: { row: h.row, col: h.col } });
    requestAnimationFrame(() => gridRef.current?.scrollToCell(h.row, h.col));
  }

  function nextHit(dir: 1 | -1) {
    if (!hits.length) return;
    const i = (hitIndex + dir + hits.length) % hits.length;
    setHitIndex(i);
    goHit(hits[i]);
  }

  /* ---------------------------------------------------------------- sheets */

  function switchSheet(id: number) {
    if (editing && !commit("none")) return;
    setWsId(id);
    setSel({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } });
  }

  function addSheet() {
    if (!book) return;
    const s = book.addSheet();
    setWsId(s.id);
    setSel({ anchor: { row: 1, col: 1 }, focus: { row: 1, col: 1 } });
    changed();
  }

  function finishRename() {
    if (!book || !renaming) return;
    const target = book.sheetById(renaming.wsId);
    if (!target) return setRenaming(null);
    const problem = book.renameSheet(target, renaming.name);
    if (problem) {
      toast(problem, "error");
      return;
    }
    setRenaming(null);
    changed();
  }

  /* ---------------------------------------------------------------- go to a cell */

  function finishGoto() {
    const text = (goto ?? "").trim().toUpperCase();
    setGoto(null);
    if (!text) return;
    const rect = parseRect(text);
    if (!rect) {
      toast("Type a cell like B12 or a range like A1:F20.", "error");
      return;
    }
    select({ anchor: { row: rect.r1, col: rect.c1 }, focus: { row: rect.r2, col: rect.c2 } });
    requestAnimationFrame(() => gridRef.current?.focus());
  }

  /* ---------------------------------------------------------------- saving */

  async function save() {
    if (!book || saving) return;
    if (editing && !commit("none")) return;
    setSaving(true);
    try {
      const { blob, extension } = await book.save();
      await saveVersion(blob, extension ? { extension } : undefined);
      savedVersion.current = book.version;
      setDirty(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "The file couldn't be saved. Your changes are still here; try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------------------------------------------- drawing */

  if (failed) {
    return (
      <div className="file-loader">
        <b>This spreadsheet didn't open</b>
        <div className="muted small">{failed}</div>
      </div>
    );
  }
  if (!book || !ws) {
    return (
      <div className="file-loader" role="status">
        <div className="muted small">Opening the spreadsheet...</div>
      </div>
    );
  }

  const dirty = book.version !== savedVersion.current;

  const curFmt = activeStyle.numFmt ?? "General";
  const fmtLabel = FORMATS.find((f) => f.fmt === curFmt)?.label ?? (curFmt === "General" ? "General" : "Custom");
  const barText = editing ? editing.text : book.inputText(ws, active.row, active.col);
  const activeMerge = book.merges(ws).cover.get(`${active.row}:${active.col}`);
  const onlyActive =
    (selRect.r1 === selRect.r2 && selRect.c1 === selRect.c2) ||
    (!!activeMerge && activeMerge.r1 === selRect.r1 && activeMerge.c1 === selRect.c1 && activeMerge.r2 === selRect.r2 && activeMerge.c2 === selRect.c2);
  const stats = onlyActive ? null : book.stats(ws, { ...selRect, r2: Math.min(selRect.r2, Math.max(ws.rowCount, 1)), c2: Math.min(selRect.c2, Math.max(ws.columnCount, 1)) });
  const nameBox = onlyActive
    ? cellName(active.row, active.col)
    : selRect.r1 === 1 && selRect.r2 >= MAX_ROW && selRect.c1 === 1 && selRect.c2 >= MAX_COL
      ? "All"
      : selRect.r1 === 1 && selRect.r2 >= MAX_ROW
        ? `${colName(selRect.c1)}:${colName(selRect.c2)}`
        : selRect.c1 === 1 && selRect.c2 >= MAX_COL
          ? `${selRect.r1}:${selRect.r2}`
          : rectName(selRect);
  const notices = book.notices.map((n, i) => ({ ...n, i })).filter((n) => !dismissed.includes(n.i));
  const unsupported = book.isUnsupported(ws, active.row, active.col);
  const align = activeStyle.alignment?.horizontal;
  const fontColor = activeStyle.font?.color?.argb ? `#${activeStyle.font.color.argb.slice(-6)}` : undefined;
  const fillColor = (activeStyle.fill as { fgColor?: { argb?: string } } | undefined)?.fgColor?.argb ? `#${(activeStyle.fill as { fgColor: { argb: string } }).fgColor.argb.slice(-6)}` : undefined;

  // Ctrl+Z, Ctrl+Y, Ctrl+F and Ctrl+S work wherever you are in the tool (not while typing in a box).
  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest(".xgrid") || t.closest("input, textarea")) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (!mod) return;
    if (k === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (k === "y") {
      e.preventDefault();
      redo();
    } else if (k === "f") {
      e.preventDefault();
      openFind();
    } else if (k === "s") {
      e.preventDefault();
      void save();
    }
  };
  // Clicking toolbar buttons with a mouse keeps the keyboard on the grid.
  const keepFocus = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && (e.target as HTMLElement).closest("button")) e.preventDefault();
  };

  return (
    <div className="xs" onKeyDown={onRootKey}>
      <div className="xtools" role="toolbar" aria-label="Spreadsheet tools" onPointerDown={keepFocus}>
        <div className="xtools-scroll">
          <div className="xgroup">
            <button className="icon-btn small plain" type="button" onClick={undo} disabled={!book.canUndo()} aria-label="Undo" title="Undo (Ctrl+Z)">
              <Undo2 />
            </button>
            <button className="icon-btn small plain" type="button" onClick={redo} disabled={!book.canRedo()} aria-label="Redo" title="Redo (Ctrl+Y)">
              <Redo2 />
            </button>
          </div>
          <div className="xgroup">
            <button className={clsx("icon-btn small plain", activeStyle.font?.bold && "on")} type="button" onClick={() => toggleFont("bold")} disabled={isCsv} aria-label="Bold" aria-pressed={!!activeStyle.font?.bold} title="Bold (Ctrl+B)">
              <Bold />
            </button>
            <button className={clsx("icon-btn small plain", activeStyle.font?.italic && "on")} type="button" onClick={() => toggleFont("italic")} disabled={isCsv} aria-label="Italic" aria-pressed={!!activeStyle.font?.italic} title="Italic (Ctrl+I)">
              <Italic />
            </button>
            <button className={clsx("icon-btn small plain", activeStyle.font?.underline && "on")} type="button" onClick={() => toggleFont("underline")} disabled={isCsv} aria-label="Underline" aria-pressed={!!activeStyle.font?.underline} title="Underline (Ctrl+U)">
              <Underline />
            </button>
            <span className="xpop-wrap">
              <button className="icon-btn small plain xswatch-btn" type="button" ref={(el) => (anchors.current.fill = el)} onClick={() => setMenu(menu === "fill" ? null : "fill")} disabled={isCsv} aria-label="Fill colour" aria-haspopup="menu" aria-expanded={menu === "fill"} title="Fill colour">
                <PaintBucket />
                <i style={{ background: fillColor ?? "transparent" }} />
              </button>
              <Pop open={menu === "fill"} anchor={anchors.current.fill} onClose={() => setMenu(null)}>
                <div className="xswatches">
                  {SWATCHES.map((c) => (
                    <button key={c} type="button" className="xsw" style={{ background: c }} onClick={() => setFill(c)} aria-label={`Fill ${c}`} />
                  ))}
                </div>
                <button type="button" role="menuitem" onClick={() => setFill(null)}>
                  No fill
                </button>
              </Pop>
            </span>
            <span className="xpop-wrap">
              <button className="icon-btn small plain xswatch-btn" type="button" ref={(el) => (anchors.current.color = el)} onClick={() => setMenu(menu === "color" ? null : "color")} disabled={isCsv} aria-label="Text colour" aria-haspopup="menu" aria-expanded={menu === "color"} title="Text colour">
                <Baseline />
                <i style={{ background: fontColor ?? "currentColor" }} />
              </button>
              <Pop open={menu === "color"} anchor={anchors.current.color} onClose={() => setMenu(null)}>
                <div className="xswatches">
                  {SWATCHES.map((c) => (
                    <button key={c} type="button" className="xsw" style={{ background: c }} onClick={() => setColor(c)} aria-label={`Text ${c}`} />
                  ))}
                </div>
                <button type="button" role="menuitem" onClick={() => setColor(null)}>
                  Automatic
                </button>
              </Pop>
            </span>
          </div>
          <div className="xgroup">
            <span className="xpop-wrap">
              <button className="btn small ghost xfmt-btn" type="button" ref={(el) => (anchors.current.format = el)} onClick={() => setMenu(menu === "format" ? null : "format")} disabled={isCsv} aria-haspopup="menu" aria-expanded={menu === "format"} title="Number format">
                {fmtLabel} <ChevronDown />
              </button>
              <Pop open={menu === "format"} anchor={anchors.current.format} onClose={() => setMenu(null)}>
                {FORMATS.map((f) => (
                  <button key={f.fmt} type="button" role="menuitemradio" aria-checked={curFmt === f.fmt} className={clsx(curFmt === f.fmt && "on")} onClick={() => setNumFmt(f.fmt)}>
                    <span>{f.label}</span>
                    <span className="faint">{f.hint}</span>
                  </button>
                ))}
              </Pop>
            </span>
            <button className={clsx("icon-btn small plain", align === "left" && "on")} type="button" onClick={() => setAlign("left")} disabled={isCsv} aria-label="Align left" aria-pressed={align === "left"}>
              <AlignLeft />
            </button>
            <button className={clsx("icon-btn small plain", align === "center" && "on")} type="button" onClick={() => setAlign("center")} disabled={isCsv} aria-label="Centre" aria-pressed={align === "center"}>
              <AlignCenter />
            </button>
            <button className={clsx("icon-btn small plain", align === "right" && "on")} type="button" onClick={() => setAlign("right")} disabled={isCsv} aria-label="Align right" aria-pressed={align === "right"}>
              <AlignRight />
            </button>
            <button className={clsx("icon-btn small plain", activeStyle.alignment?.wrapText && "on")} type="button" onClick={toggleWrap} disabled={isCsv} aria-label="Wrap text" aria-pressed={!!activeStyle.alignment?.wrapText} title="Wrap text">
              <WrapText />
            </button>
          </div>
          <div className="xgroup">
            <span className="xpop-wrap">
              <button className="btn small ghost" type="button" ref={(el) => (anchors.current.rows = el)} onClick={() => setMenu(menu === "rows" ? null : "rows")} aria-haspopup="menu" aria-expanded={menu === "rows"} title="Insert or remove rows and columns">
                <Rows3 /> Rows and columns <ChevronDown />
              </button>
              <Pop open={menu === "rows"} anchor={anchors.current.rows} onClose={() => setMenu(null)}>
                {rowsMenu}
              </Pop>
            </span>
            <button className="icon-btn small plain" type="button" onClick={clearSel} aria-label="Clear cells" title="Clear cells (Delete)">
              <Eraser />
            </button>
            <button className="icon-btn small plain" type="button" onClick={() => void copyButton(false)} aria-label="Copy" title="Copy (Ctrl+C)">
              <Copy />
            </button>
            <button className="icon-btn small plain" type="button" onClick={() => void copyButton(true)} aria-label="Cut" title="Cut (Ctrl+X)">
              <Scissors />
            </button>
            <button className="icon-btn small plain" type="button" onClick={() => void pasteButton()} aria-label="Paste" title="Paste (Ctrl+V)">
              <ClipboardPaste />
            </button>
          </div>
          <div className="xgroup">
            <button className={clsx("icon-btn small plain", finding && "on")} type="button" onClick={() => (finding ? setFinding(false) : openFind())} aria-label="Find" title="Find (Ctrl+F)">
              <Search />
            </button>
            <button className="icon-btn small plain" type="button" onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.findIndex((z) => z >= zoom) - 1)])} disabled={zoom <= ZOOMS[0]} aria-label="Zoom out">
              <ZoomOut />
            </button>
            <button className="xzoom" type="button" onClick={() => setZoom(1)} title="Back to 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button className="icon-btn small plain" type="button" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.findIndex((z) => z > zoom))] ?? zoom)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in">
              <ZoomIn />
            </button>
          </div>
        </div>
        <button className="btn small primary xsave" type="button" onClick={() => void save()} disabled={!dirty || saving}>
          <Save /> <span className="xsave-long">{saving ? "Saving..." : "Save as new version"}</span>
          <span className="xsave-short">{saving ? "Saving" : "Save"}</span>
        </button>
      </div>

      <div className="xbar">
        {goto != null ? (
          <input
            className="xname"
            autoFocus
            value={goto}
            onChange={(e) => setGoto(e.target.value)}
            onBlur={finishGoto}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishGoto();
              if (e.key === "Escape") setGoto(null);
            }}
            aria-label="Go to cell"
          />
        ) : (
          <button className="xname" type="button" onClick={() => setGoto(nameBox)} title="Go to a cell">
            {nameBox}
          </button>
        )}
        <span className="xfx" aria-hidden>
          fx
        </span>
        <input
          ref={barRef}
          className="xinput"
          value={barText}
          spellCheck={false}
          aria-label="Cell contents"
          onFocus={() => {
            if (focusingFor.current) return setEditing(focusingFor.current);
            if (!editing) setEditing({ row: active.row, col: active.col, text: book.inputText(ws, active.row, active.col), mode: "edit", where: "bar", original: book.inputText(ws, active.row, active.col) });
            else if (editing.where === "cell") setEditing({ ...editing, where: "bar" });
          }}
          onChange={(e) => editing && setEditing({ ...editing, text: e.target.value })}
          onKeyDown={onEditKey}
          onBlur={() => {
            if (editing?.where === "bar") commit("none");
          }}
        />
        {editing?.where === "bar" && (
          <span className="xbar-acts">
            <button className="icon-btn small plain" type="button" onPointerDown={(e) => e.preventDefault()} onClick={cancelEdit} aria-label="Cancel">
              <X />
            </button>
          </span>
        )}
      </div>
      {unsupported && !editing && (
        <div className="xnotice info small">
          <Info /> <span>This formula was worked out in Excel. The app can't recalculate it, so it shows the value saved in the file.</span>
        </div>
      )}

      {notices.map((n) => (
        <div key={n.i} className={clsx("xnotice", n.tone)} role="note">
          {n.tone === "warn" ? <TriangleAlert /> : <Info />}
          <span>{n.text}</span>
          <button className="icon-btn small plain" type="button" onClick={() => setDismissed((d) => [...d, n.i])} aria-label="Hide this message">
            <X />
          </button>
        </div>
      ))}

      {finding && (
        <div className="xfind">
          <Search />
          <input
            ref={findRef}
            className="input"
            value={query}
            placeholder="Find in this workbook"
            aria-label="Find in this workbook"
            onChange={(e) => runFind(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                nextHit(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") {
                setFinding(false);
                gridRef.current?.focus();
              }
            }}
          />
          <span className="faint small xfind-count">{query ? (hits.length ? `${hitIndex + 1} of ${hits.length}${hits.length >= 5000 ? "+" : ""}` : "No matches") : ""}</span>
          <button className="icon-btn small plain" type="button" onClick={() => nextHit(-1)} disabled={!hits.length} aria-label="Previous match">
            <ChevronUp />
          </button>
          <button className="icon-btn small plain" type="button" onClick={() => nextHit(1)} disabled={!hits.length} aria-label="Next match">
            <ChevronDown />
          </button>
          <button className="icon-btn small plain" type="button" onClick={() => setFinding(false)} aria-label="Close find">
            <X />
          </button>
        </div>
      )}

      <div className="xgrid-wrap">
        <Grid
          ref={gridRef}
          book={book}
          ws={ws}
          version={version}
          zoom={zoom}
          dark={dark}
          sel={sel}
          selRect={selRect}
          editing={editing}
          hit={finding && hits[hitIndex]?.wsId === ws.id ? hits[hitIndex] : null}
          onSelect={(s) => {
            if (editing && !commit("none")) return;
            setSel(s);
          }}
          onStartEdit={(r, c) => startEdit(r, c)}
          onEditText={(text) => editing && setEditing({ ...editing, text })}
          onEditKey={onEditKey}
          onEditBlur={() => {
            if (editing?.where === "cell") commit("none");
          }}
          onKeyDown={onGridKey}
          onTypeStart={(text) => startEdit(sel.anchor.row, sel.anchor.col, text, "enter")}
          onCopy={onCopy}
          onCut={onCut}
          onPaste={onPaste}
          onHeaderMenu={(_kind, x, y) => setRowMenuAt({ x, y })}
        />
        <Pop open={!!rowMenuAt} at={rowMenuAt ?? undefined} onClose={() => setRowMenuAt(null)}>
          {rowsMenu}
        </Pop>
      </div>

      <div className="xtabs">
        <div className="xtabs-scroll" role="tablist" aria-label="Sheets">
          {book.sheets().map((s) =>
            renaming?.wsId === s.id ? (
              <input
                key={s.id}
                className="xtab-input"
                autoFocus
                value={renaming.name}
                maxLength={31}
                onChange={(e) => setRenaming({ wsId: s.id, name: e.target.value })}
                onBlur={finishRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finishRename();
                  if (e.key === "Escape") setRenaming(null);
                }}
                aria-label="Sheet name"
              />
            ) : (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={s.id === ws.id}
                className={clsx("xtab", s.id === ws.id && "on")}
                onClick={() => switchSheet(s.id)}
                onDoubleClick={() => !isCsv && setRenaming({ wsId: s.id, name: s.name })}
              >
                {s.name}
                {s.id === ws.id && !isCsv && (
                  <span
                    className="xtab-edit"
                    role="button"
                    tabIndex={-1}
                    aria-label={`Rename ${s.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenaming({ wsId: s.id, name: s.name });
                    }}
                  >
                    <Pencil />
                  </span>
                )}
              </button>
            ),
          )}
          {!isCsv && (
            <button className="icon-btn small plain xtab-add" type="button" onClick={addSheet} aria-label="Add a sheet" title="Add a sheet">
              <Plus />
            </button>
          )}
        </div>
        {stats && (
          <div className="xstats" aria-live="polite">
            {stats.numbers > 0 ? (
              <>
                <span>
                  Sum <b>{money(stats.sum)}</b>
                </span>
                <span className="xstats-more">
                  Average <b>{money(stats.sum / stats.numbers)}</b>
                </span>
              </>
            ) : null}
            <span>
              Count <b>{stats.count}</b>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

