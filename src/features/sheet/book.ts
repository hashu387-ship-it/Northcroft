// An open spreadsheet: loading (Excel, old .xls, CSV), edits with undo and redo, inserting and
// removing rows and columns (formulas, merges and names follow), copy and paste, and saving.
// ExcelJS holds the cells and their formatting; the Engine keeps formulas up to date.
import * as ExcelJSNs from "exceljs";
import type { Cell as XCell, CellValue, Style, Workbook, Worksheet } from "exceljs";
import { norm, parseCell, rectName, type Rect } from "./addr";
import { themePalette } from "./colors";
import { editText, isDateFormat, isError, show, toScalar, type Scalar } from "./display";
import { cellKey, checkFormula, Engine } from "./engine";
import { renameSheetInFormula, scan, shiftCell, shiftFormula, shiftRect, translateFormula, type Shift } from "./refs";

const ExcelJS = ((ExcelJSNs as unknown as { default?: typeof ExcelJSNs }).default ?? ExcelJSNs) as typeof ExcelJSNs;

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export type BookKind = "xlsx" | "xlsm" | "xls" | "csv";

export interface Notice {
  tone: "info" | "warn";
  text: string;
}

export interface Step {
  label: string;
  wsId: number;
  sel: Rect;
  undo: () => void;
  redo: () => void;
}

interface Snap {
  wsId: number;
  row: number;
  col: number;
  value: CellValue;
  style: Partial<Style>;
}

export interface Clip {
  tsv: string;
  wsId: number;
  rect: Rect;
  cells: { value: CellValue; style: Partial<Style>; formula?: string }[][];
}

export interface Merge extends Rect {
  key: string;
}

export interface MergeIndex {
  /** "row:col" of a top-left cell -> its merge */
  masters: Map<string, Merge>;
  /** "row:col" of any merged cell -> its merge */
  cover: Map<string, Merge>;
}

const clone = <T,>(v: T): T => (v == null || typeof v !== "object" ? v : structuredClone(v));

/* ---------------------------------------------------------------- zip contents */

/** File names inside a zip (xlsx files are zips), read from its central directory. */
export function zipEntries(buf: ArrayBuffer): string[] {
  const dv = new DataView(buf);
  const n = buf.byteLength;
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const names: string[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count && p + 46 <= n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    names.push(dec.decode(new Uint8Array(buf, p + 46, nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function partsNotices(names: string[], kind: BookKind): Notice[] {
  const has = (re: RegExp) => names.some((n) => re.test(n));
  const lost: string[] = [];
  if (has(/^xl\/charts\//i)) lost.push("charts");
  if (has(/^xl\/pivot(Tables|Cache)\//i)) lost.push("pivot tables");
  if (has(/^xl\/slicers?\//i)) lost.push("slicers");
  const drawings = names.filter((n) => /^xl\/drawings\/drawing\d+\.xml$/i.test(n)).length;
  const pictures = has(/^xl\/media\//i);
  const out: Notice[] = [];
  if (kind === "xlsm" || has(/vbaProject\.bin$/i)) {
    out.push({
      tone: "warn",
      text: "This file has macros. They can't run here and won't be in the saved copy, which is saved as a normal Excel file (.xlsx). The original keeps them.",
    });
  }
  if (lost.length) {
    const list = lost.length === 1 ? lost[0] : `${lost.slice(0, -1).join(", ")} and ${lost[lost.length - 1]}`;
    out.push({ tone: "warn", text: `This workbook has ${list}. They can't be shown or edited here and won't be in the saved copy. The original keeps them.` });
  }
  if (pictures) out.push({ tone: "info", text: "Pictures in this workbook aren't shown here. They're kept when you save." });
  else if (drawings && !lost.includes("charts")) {
    out.push({ tone: "warn", text: "This workbook has shapes or text boxes. They can't be shown here and won't be in the saved copy. The original keeps them." });
  }
  return out;
}

/* ---------------------------------------------------------------- CSV */

function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, 5000).split(/\r?\n/)[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const d of [",", ";", "\t", "|"]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** CSV or tab-separated text to rows of strings (quotes, doubled quotes and line breaks in quotes handled). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"' && cur === "") {
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

function csvField(text: string, delimiter: string): string {
  return /["\r\n]/.test(text) || text.includes(delimiter) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A plain number written in a CSV ("72.5", "-3", "1e3"), but not codes like "007". */
const CSV_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/;

/* ---------------------------------------------------------------- typing into a cell */

export type Parsed = { value: CellValue; numFmt?: string } | { formula: string };

/** What someone typed, as Excel would read it. */
export function parseInput(text: string, currentFmt: string | undefined): Parsed {
  const general = !currentFmt || currentFmt === "General";
  if (text === "") return { value: null };
  if (text.startsWith("=") && text.length > 1) return { formula: text.slice(1).trim() };
  if (text.startsWith("'")) return { value: text.slice(1) };
  const t = text.trim();
  if (/^(true|false)$/i.test(t)) return { value: /^true$/i.test(t) };
  const num = /^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?$/;
  if (num.test(t) && /\d/.test(t)) return { value: Number(t.replace(/,/g, "")) };
  const pct = /^([-+]?[\d,]*\.?\d+)\s*%$/.exec(t);
  if (pct) {
    const v = Number(pct[1].replace(/,/g, "")) / 100;
    return { value: v, numFmt: general ? (pct[1].includes(".") ? "0.00%" : "0%") : undefined };
  }
  const sar = /^(?:SAR|SR)\s*([-+]?[\d,]*\.?\d+)$/i.exec(t);
  if (sar) return { value: Number(sar[1].replace(/,/g, "")), numFmt: general ? '"SAR "#,##0.00' : undefined };
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    if (d.getUTCDate() === Number(m[1])) return { value: d, numFmt: general ? "dd/mm/yyyy" : undefined };
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCDate() === Number(m[3])) return { value: d, numFmt: general ? "dd/mm/yyyy" : undefined };
  }
  return { value: text };
}

/* ---------------------------------------------------------------- the workbook */

export class Book {
  engine: Engine;
  palette: string[];
  date1904: boolean;
  notices: Notice[] = [];
  /** Changes every time anything changes, so the screen knows to redraw. */
  version = 0;
  csv: { delimiter: string; eol: string; bom: boolean } | null = null;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private mergeCache = new Map<number, { v: number; index: MergeIndex }>();
  private mergeVersion = 0;

  private constructor(
    public wb: Workbook,
    public kind: BookKind,
  ) {
    this.date1904 = !!(wb.properties as { date1904?: boolean }).date1904;
    const themes = (wb as unknown as { _themes?: Record<string, string> })._themes;
    this.palette = themePalette(themes?.theme1);
    this.engine = new Engine(wb, this.date1904, (ws, row) => !!ws.findRow(row)?.hidden);
    this.loadNames();
    this.normaliseFormulas();
    this.engine.rebuild();
    this.engine.fillMissing();
  }

  static async open(data: ArrayBuffer, fileName: string): Promise<Book> {
    const ext = (/\.([a-z0-9]+)$/i.exec(fileName)?.[1] ?? "xlsx").toLowerCase();
    if (ext === "csv" || ext === "txt") return Book.fromCsv(data, fileName);
    if (ext === "xls") return Book.fromXls(data);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data.slice(0));
    if (!wb.worksheets.length) wb.addWorksheet("Sheet1");
    const kind: BookKind = ext === "xlsm" ? "xlsm" : "xlsx";
    const book = new Book(wb, kind);
    book.notices = partsNotices(zipEntries(data), kind);
    return book;
  }

  private static fromCsv(data: ArrayBuffer, fileName: string): Book {
    let text = new TextDecoder("utf-8").decode(data);
    const bom = text.charCodeAt(0) === 0xfeff;
    if (bom) text = text.slice(1);
    const delimiter = detectDelimiter(text);
    const eol = /\r\n/.test(text.slice(0, 20000)) ? "\r\n" : "\n";
    const rows = parseDelimited(text, delimiter);
    const wb = new ExcelJS.Workbook();
    const name = sheetNameFrom(fileName);
    const ws = wb.addWorksheet(name);
    const widths: number[] = [];
    rows.forEach((r, i) => {
      r.forEach((v, j) => {
        if (v === "") return;
        ws.getCell(i + 1, j + 1).value = CSV_NUMBER.test(v.trim()) ? Number(v.trim()) : v;
        widths[j] = Math.max(widths[j] ?? 0, Math.min(60, v.length));
      });
    });
    widths.forEach((w, j) => {
      if (w > 9) ws.getColumn(j + 1).width = Math.round(w * 1.1 + 2);
    });
    const book = new Book(wb, "csv");
    book.csv = { delimiter, eol, bom };
    book.notices = [{ tone: "info", text: "CSV files hold values only, so colours and number formats aren't available here." }];
    return book;
  }

  private static async fromXls(data: ArrayBuffer): Promise<Book> {
    const XLSX = await import("xlsx");
    const src = XLSX.read(new Uint8Array(data), { type: "array", cellFormula: true, cellNF: true, cellStyles: true, cellDates: false });
    const wb = new ExcelJS.Workbook();
    for (const name of src.SheetNames) {
      const sh = src.Sheets[name];
      const ws = wb.addWorksheet(name.slice(0, 31) || `Sheet${wb.worksheets.length + 1}`);
      for (const addr of Object.keys(sh)) {
        if (addr.startsWith("!")) continue;
        const c = sh[addr] as { t: string; v?: unknown; f?: string; z?: string; w?: string; s?: { patternType?: string; fgColor?: { rgb?: string } } };
        const pos = XLSX.utils.decode_cell(addr);
        const cell = ws.getCell(pos.r + 1, pos.c + 1);
        const plain: CellValue =
          c.t === "n" ? (c.v as number) : c.t === "b" ? (c.v as boolean) : c.t === "e" ? ({ error: c.w ?? "#N/A" } as CellValue) : c.v == null ? null : String(c.v);
        cell.value = c.f ? ({ formula: c.f, result: plain ?? undefined } as CellValue) : plain;
        const style: Partial<Style> = {};
        if (c.z && c.z !== "General") style.numFmt = String(c.z);
        if (c.s?.patternType === "solid" && c.s.fgColor?.rgb) style.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${c.s.fgColor.rgb.slice(-6)}` } };
        if (Object.keys(style).length) cell.style = style;
      }
      for (const m of (sh["!merges"] as { s: { r: number; c: number }; e: { r: number; c: number } }[] | undefined) ?? []) {
        try {
          ws.mergeCells(m.s.r + 1, m.s.c + 1, m.e.r + 1, m.e.c + 1);
        } catch {
          /* overlapping merges in an old file: skip */
        }
      }
      ((sh["!cols"] as { wch?: number; wpx?: number; hidden?: boolean }[] | undefined) ?? []).forEach((col, i) => {
        if (!col) return;
        const def = ws.getColumn(i + 1);
        if (col.wch) def.width = col.wch;
        else if (col.wpx) def.width = Math.max(1, (col.wpx - 5) / 7);
        if (col.hidden) def.hidden = true;
      });
      ((sh["!rows"] as { hpt?: number; hpx?: number; hidden?: boolean }[] | undefined) ?? []).forEach((row, i) => {
        if (!row) return;
        const r = ws.getRow(i + 1);
        if (row.hpt) r.height = row.hpt;
        else if (row.hpx) r.height = row.hpx * 0.75;
        if (row.hidden) r.hidden = true;
      });
    }
    if (!wb.worksheets.length) wb.addWorksheet("Sheet1");
    const book = new Book(wb, "xls");
    book.notices = [
      {
        tone: "info",
        text: "This is an older Excel file (.xls). Your changes are saved as a new .xlsx copy with the values, formulas, number formats and merged cells. Some colours and borders may not carry over. The original stays as it was.",
      },
    ];
    return book;
  }

  /** Formulas filled down in Excel are stored "shared"; give each cell its own copy so they can be moved and edited. */
  private normaliseFormulas() {
    for (const ws of this.wb.worksheets) {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const v = cell.value as unknown as Record<string, unknown> | null;
          if (!v || typeof v !== "object") return;
          if ("sharedFormula" in v || v.shareType === "shared") {
            const f = cell.formula;
            if (f) cell.value = { formula: f, result: cell.result } as CellValue;
          }
        });
      });
    }
  }

  private loadNames() {
    this.engine.names.clear();
    const model = (this.wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model ?? [];
    for (const n of model) {
      const ref = n.ranges?.[0] ? scan(n.ranges[0]).refs[0] : undefined;
      if (!ref?.sheet) continue;
      const ws = this.wb.worksheets.find((w) => w.name.toLowerCase() === ref.sheet!.toLowerCase());
      if (!ws || ref.a.row == null || ref.a.col == null) continue;
      const b = ref.b ?? ref.a;
      if (b.row == null || b.col == null) continue;
      this.engine.names.set(n.name.toUpperCase(), { wsId: ws.id, rect: norm({ r1: ref.a.row, c1: ref.a.col, r2: b.row, c2: b.col }) });
    }
  }

  /* ---------------------------------------------------------------- reading */

  sheets(): Worksheet[] {
    return this.wb.worksheets.filter((ws) => ws.state !== "hidden" && ws.state !== "veryHidden");
  }

  sheetById(id: number) {
    return this.wb.worksheets.find((ws) => ws.id === id);
  }

  /** The frozen rows and columns at the top-left. */
  frozen(ws: Worksheet): { rows: number; cols: number } {
    const v = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    if (v?.state !== "frozen") return { rows: 0, cols: 0 };
    return { rows: Math.max(0, Math.floor(v.ySplit ?? 0)), cols: Math.max(0, Math.floor(v.xSplit ?? 0)) };
  }

  gridLines(ws: Worksheet) {
    return (ws.views?.[0] as { showGridLines?: boolean } | undefined)?.showGridLines !== false;
  }

  merges(ws: Worksheet): MergeIndex {
    const cached = this.mergeCache.get(ws.id);
    if (cached && cached.v === this.mergeVersion) return cached.index;
    const index: MergeIndex = { masters: new Map(), cover: new Map() };
    for (const m of mergeRects(ws)) {
      const merge: Merge = { ...m, key: `${m.r1}:${m.c1}` };
      index.masters.set(merge.key, merge);
      const area = (m.r2 - m.r1 + 1) * (m.c2 - m.c1 + 1);
      if (area > 200000) continue;
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) index.cover.set(`${r}:${c}`, merge);
    }
    this.mergeCache.set(ws.id, { v: this.mergeVersion, index });
    return index;
  }

  /** The top-left cell of a merged block, or the cell itself. */
  master(ws: Worksheet, row: number, col: number): { row: number; col: number } {
    const m = this.merges(ws).cover.get(`${row}:${col}`);
    return m ? { row: m.r1, col: m.c1 } : { row, col };
  }

  value(ws: Worksheet, row: number, col: number): Scalar {
    return this.engine.read(ws, row, col);
  }

  formula(ws: Worksheet, row: number, col: number): string | undefined {
    const cell = ws.findCell(row, col);
    return cell?.formula || undefined;
  }

  isUnsupported(ws: Worksheet, row: number, col: number) {
    return !!this.engine.formulaAt(ws.id, row, col)?.unsupported;
  }

  numFmt(ws: Worksheet, row: number, col: number): string | undefined {
    return ws.findCell(row, col)?.style?.numFmt;
  }

  /** The text shown in the cell. */
  shown(ws: Worksheet, row: number, col: number) {
    return show(this.value(ws, row, col), this.numFmt(ws, row, col), this.date1904);
  }

  /** What the formula bar shows for a cell. */
  inputText(ws: Worksheet, row: number, col: number): string {
    const f = this.formula(ws, row, col);
    if (f) return `=${f}`;
    const cell = ws.findCell(row, col);
    if (!cell) return "";
    const v = toScalar(cell.value, this.date1904);
    if (typeof v === "string") {
      // Text that would otherwise read as a number, date or formula keeps a leading apostrophe.
      const p = parseInput(v, cell.style?.numFmt);
      return !("formula" in p) && p.value === v ? v : `'${v}`;
    }
    return editText(v, cell.style?.numFmt, this.date1904);
  }

  canUndo() {
    return this.undoStack.length > 0;
  }
  canRedo() {
    return this.redoStack.length > 0;
  }

  /* ---------------------------------------------------------------- recording changes */

  private snap(ws: Worksheet, row: number, col: number): Snap {
    const cell = ws.findCell(row, col);
    return { wsId: ws.id, row, col, value: clone(cell?.value ?? null), style: cell?.style ?? {} };
  }

  private restore(snaps: Snap[]) {
    const touched: string[] = [];
    for (const s of snaps) {
      const ws = this.sheetById(s.wsId);
      if (!ws) continue;
      const exists = ws.findCell(s.row, s.col);
      if (!exists && s.value == null && !Object.keys(s.style ?? {}).length) continue;
      const cell = ws.getCell(s.row, s.col);
      cell.value = clone(s.value);
      cell.style = s.style ?? {};
      touched.push(this.engine.cellChanged(ws, s.row, s.col));
    }
    this.engine.recalc(touched);
  }

  private push(step: Step) {
    this.undoStack.push(step);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.version++;
  }

  /**
   * Change some cells as one undoable step. `fn` gets each cell (made if needed) and changes it;
   * merged-over cells are skipped for values. Returns how many formulas were recalculated.
   */
  private editCells(ws: Worksheet, cells: { row: number; col: number }[], label: string, sel: Rect, fn: (cell: XCell, row: number, col: number) => void) {
    const before = cells.map((c) => this.snap(ws, c.row, c.col));
    const touched: string[] = [];
    for (const c of cells) {
      const cell = ws.getCell(c.row, c.col);
      fn(cell, c.row, c.col);
      touched.push(this.engine.cellChanged(ws, c.row, c.col));
    }
    this.engine.recalc(touched);
    const after = cells.map((c) => this.snap(ws, c.row, c.col));
    this.push({
      label,
      wsId: ws.id,
      sel,
      undo: () => this.restore(before),
      redo: () => this.restore(after),
    });
  }

  undo(): Step | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    step.undo();
    this.redoStack.push(step);
    this.version++;
    return step;
  }

  redo(): Step | null {
    const step = this.redoStack.pop();
    if (!step) return null;
    step.redo();
    this.undoStack.push(step);
    this.version++;
    return step;
  }

  /* ---------------------------------------------------------------- editing */

  /** Put what someone typed into a cell. Returns a message when it can't be used. */
  setInput(ws: Worksheet, row: number, col: number, text: string): string | null {
    const at = this.master(ws, row, col);
    const fmt = this.numFmt(ws, at.row, at.col);
    const parsed = parseInput(text, fmt);
    if ("formula" in parsed) {
      const problem = checkFormula(parsed.formula, ws.name);
      if (problem) return problem;
    }
    this.editCells(ws, [at], "typing", { r1: at.row, c1: at.col, r2: at.row, c2: at.col }, (cell) => {
      if ("formula" in parsed) {
        cell.value = { formula: parsed.formula, result: undefined } as unknown as CellValue;
      } else {
        cell.value = parsed.value;
        if (parsed.numFmt) cell.style = { ...cell.style, numFmt: parsed.numFmt };
      }
    });
    return null;
  }

  /** Cells in a rectangle that hold content or formatting, plus every cell when `all`. */
  private cellsIn(ws: Worksheet, rect: Rect, all: boolean): { row: number; col: number }[] {
    const out: { row: number; col: number }[] = [];
    const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
    if (all && area <= 250000) {
      for (let r = rect.r1; r <= rect.r2; r++) for (let c = rect.c1; c <= rect.c2; c++) out.push({ row: r, col: c });
      return out;
    }
    const lastRow = Math.min(rect.r2, ws.rowCount);
    for (let r = rect.r1; r <= lastRow; r++) {
      const row = ws.findRow(r);
      if (!row) continue;
      row.eachCell({ includeEmpty: false }, (cell) => {
        const c = Number(cell.col);
        if (c >= rect.c1 && c <= rect.c2) out.push({ row: r, col: c });
      });
    }
    return out;
  }

  clear(ws: Worksheet, rect: Rect) {
    const merges = this.merges(ws);
    const cells = this.cellsIn(ws, rect, false).filter((c) => {
      const m = merges.cover.get(`${c.row}:${c.col}`);
      return !m || (m.r1 === c.row && m.c1 === c.col);
    });
    const withContent = cells.filter((c) => ws.findCell(c.row, c.col)?.value != null);
    if (!withContent.length) return;
    this.editCells(ws, withContent, "clear", rect, (cell) => {
      cell.value = null;
    });
  }

  /** Change the formatting of every cell in a rectangle. */
  format(ws: Worksheet, rect: Rect, label: string, change: (style: Partial<Style>) => Partial<Style>) {
    const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
    // Whole columns or rows: only cells that exist, so a click doesn't create a million cells.
    const cells = this.cellsIn(ws, rect, area <= 20000);
    if (!cells.length) return;
    this.editCells(ws, cells, label, rect, (cell) => {
      cell.style = change({ ...(cell.style ?? {}) });
    });
  }

  copy(ws: Worksheet, rect: Rect): Clip {
    const cells: Clip["cells"] = [];
    const lines: string[] = [];
    for (let r = rect.r1; r <= rect.r2; r++) {
      const row: Clip["cells"][number] = [];
      const texts: string[] = [];
      for (let c = rect.c1; c <= rect.c2; c++) {
        const cell = ws.findCell(r, c);
        const f = cell?.formula;
        row.push({ value: clone(cell?.value ?? null), style: cell?.style ?? {}, formula: f || undefined });
        const t = this.shown(ws, r, c).text;
        texts.push(/[\t\r\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
      }
      cells.push(row);
      lines.push(texts.join("\t"));
    }
    return { tsv: lines.join("\r\n"), wsId: ws.id, rect, cells };
  }

  /** Paste copied cells (formulas move with them, like Excel) with the top-left at `at`. */
  pasteClip(ws: Worksheet, at: { row: number; col: number }, clip: Clip): Rect {
    const rows = clip.cells.length;
    const cols = clip.cells[0]?.length ?? 0;
    const rect = { r1: at.row, c1: at.col, r2: at.row + rows - 1, c2: at.col + cols - 1 };
    const targets: { row: number; col: number }[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) targets.push({ row: at.row + r, col: at.col + c });
    const dr = at.row - clip.rect.r1;
    const dc = at.col - clip.rect.c1;
    this.editCells(ws, targets, "paste", rect, (cell, row, col) => {
      const src = clip.cells[row - at.row][col - at.col];
      if (src.formula) cell.value = { formula: translateFormula(src.formula, dr, dc), result: (src.value as { result?: unknown })?.result } as CellValue;
      else cell.value = clone(src.value);
      cell.style = src.style ?? {};
    });
    return rect;
  }

  /** Paste text copied from Excel or anywhere else (tab-separated). */
  pasteText(ws: Worksheet, at: { row: number; col: number }, text: string): Rect | null {
    const rows = parseDelimited(text.replace(/\r?\n$/, ""), "\t");
    if (!rows.length) return null;
    const width = Math.max(...rows.map((r) => r.length));
    const rect = { r1: at.row, c1: at.col, r2: at.row + rows.length - 1, c2: at.col + width - 1 };
    const targets: { row: number; col: number }[] = [];
    rows.forEach((r, i) => r.forEach((_, j) => targets.push({ row: at.row + i, col: at.col + j })));
    this.editCells(ws, targets, "paste", rect, (cell, row, col) => {
      const raw = rows[row - at.row][col - at.col];
      const parsed = parseInput(raw, cell.style?.numFmt);
      if ("formula" in parsed) {
        cell.value = checkFormula(parsed.formula, ws.name) ? raw : ({ formula: parsed.formula, result: undefined } as unknown as CellValue);
      } else {
        cell.value = parsed.value;
        if (parsed.numFmt) cell.style = { ...cell.style, numFmt: parsed.numFmt };
      }
    });
    return rect;
  }

  /* ---------------------------------------------------------------- rows and columns */

  insertRows(ws: Worksheet, at: number, n: number) {
    this.structural(ws, { sheet: ws.name, axis: "row", at, n }, n === 1 ? "insert a row" : `insert ${n} rows`);
  }
  deleteRows(ws: Worksheet, at: number, n: number) {
    this.structural(ws, { sheet: ws.name, axis: "row", at, n: -n }, n === 1 ? "remove a row" : `remove ${n} rows`);
  }
  insertCols(ws: Worksheet, at: number, n: number) {
    this.structural(ws, { sheet: ws.name, axis: "col", at, n }, n === 1 ? "insert a column" : `insert ${n} columns`);
  }
  deleteCols(ws: Worksheet, at: number, n: number) {
    this.structural(ws, { sheet: ws.name, axis: "col", at, n: -n }, n === 1 ? "remove a column" : `remove ${n} columns`);
  }

  private structural(ws: Worksheet, s: Shift, label: string) {
    const sel: Rect = s.axis === "row" ? { r1: s.at, c1: 1, r2: s.at + Math.abs(s.n) - 1, c2: Math.max(1, ws.columnCount) } : { r1: 1, c1: s.at, r2: Math.max(1, ws.rowCount), c2: s.at + Math.abs(s.n) - 1 };
    let record = this.applyShift(ws, s);
    this.push({
      label,
      wsId: ws.id,
      sel,
      undo: () => this.undoShift(ws, s, record),
      redo: () => {
        record = this.applyShift(ws, s);
      },
    });
  }

  private applyShift(ws: Worksheet, s: Shift) {
    const k = Math.abs(s.n);
    // 1. Every formula in the workbook that points at the moved cells.
    const formulaChanges: { wsId: number; row: number; col: number; old: CellValue; text: string }[] = [];
    for (const f of [...this.engine.allFormulas()]) {
      const fws = this.sheetById(f.wsId);
      if (!fws) continue;
      const text = shiftFormula(f.text, fws.name, s);
      if (text !== f.text) formulaChanges.push({ wsId: f.wsId, row: f.row, col: f.col, old: clone(fws.findCell(f.row, f.col)?.value ?? null), text });
    }
    // 2. What's being removed, so undo can put it back.
    const removed: Snap[] = [];
    const removedRows: { row: number; height?: number; hidden: boolean }[] = [];
    const colsBefore = columnDefs(ws);
    if (s.n < 0) {
      if (s.axis === "row") {
        for (let r = s.at; r < s.at + k; r++) {
          const row = ws.findRow(r);
          removedRows.push({ row: r, height: row?.height, hidden: !!row?.hidden });
          row?.eachCell({ includeEmpty: false }, (cell) => removed.push(this.snap(ws, r, Number(cell.col))));
        }
      } else {
        ws.eachRow({ includeEmpty: false }, (row, r) => {
          for (let c = s.at; c < s.at + k; c++) if (row.findCell(c)) removed.push(this.snap(ws, r, c));
        });
      }
    }
    // 3. Merged cells, names, conditional formatting and data validation on this sheet.
    const mergesBefore = mergeRects(ws);
    const mergesAfter = mergesBefore.map((m) => shiftRect(m, s)).filter((m): m is Rect => !!m && (m.r1 !== m.r2 || m.c1 !== m.c2));
    const namesBefore = clone((this.wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model ?? []);
    const namesAfter = namesBefore
      .map((n) => ({ ...n, ranges: n.ranges.map((r) => shiftFormula(r, ws.name, s)).filter((r) => !r.includes("#REF!")) }))
      .filter((n) => n.ranges.length);
    const cfBefore = clone((ws as unknown as { conditionalFormattings?: { ref: string }[] }).conditionalFormattings ?? []);
    const cfAfter = cfBefore
      .map((cf) => ({ ...cf, ref: shiftRefList(cf.ref, s) }))
      .filter((cf) => cf.ref);
    const dvBefore = clone(dataValidations(ws));
    const dvAfter: Record<string, unknown> = {};
    for (const [addr, rule] of Object.entries(dvBefore)) {
      const moved = shiftRefList(addr, s);
      if (moved) dvAfter[moved] = rule;
    }

    // Apply.
    for (const m of mergesBefore) ws.unMergeCells(rectName(m));
    if (s.axis === "row") {
      if (s.n > 0) ws.insertRows(s.at, Array.from({ length: k }, () => []), "i");
      else ws.spliceRows(s.at, k);
    } else {
      if (s.n > 0) {
        ws.spliceColumns(s.at, 0, ...Array.from({ length: k }, () => []));
        // New columns take the formatting of the column to their left, like Excel.
        if (s.at > 1) {
          ws.eachRow({ includeEmpty: false }, (row) => {
            const left = row.findCell(s.at - 1);
            if (left?.style && Object.keys(left.style).length) for (let c = s.at; c < s.at + k; c++) row.getCell(c).style = left.style;
          });
        }
      } else ws.spliceColumns(s.at, k);
      setColumnDefs(ws, shiftColumnDefs(colsBefore, s));
    }
    for (const m of mergesAfter) {
      try {
        ws.mergeCells(rectName(m));
      } catch {
        /* overlapping after the change: leave unmerged */
      }
    }
    for (const ch of formulaChanges) {
      const fws = this.sheetById(ch.wsId)!;
      const pos = fws === ws ? shiftCell(ch.row, ch.col, s) : { row: ch.row, col: ch.col };
      if (!pos) continue;
      fws.getCell(pos.row, pos.col).value = { formula: ch.text, result: (ch.old as { result?: unknown })?.result } as CellValue;
    }
    (this.wb.definedNames as unknown as { model: unknown }).model = namesAfter;
    (ws as unknown as { conditionalFormattings: unknown }).conditionalFormattings = cfAfter;
    setDataValidations(ws, dvAfter);
    this.mergeVersion++;
    this.loadNames();
    this.engine.rebuild();
    this.engine.recalc(
      formulaChanges
        .map((ch) => {
          const fws = this.sheetById(ch.wsId)!;
          const pos = fws === ws ? shiftCell(ch.row, ch.col, s) : { row: ch.row, col: ch.col };
          return pos ? cellKey(ch.wsId, pos.row, pos.col) : "";
        })
        .filter(Boolean),
    );
    return { formulaChanges, removed, removedRows, colsBefore, mergesBefore, namesBefore, cfBefore, dvBefore };
  }

  private undoShift(ws: Worksheet, s: Shift, rec: ReturnType<Book["applyShift"]>) {
    const k = Math.abs(s.n);
    for (const m of mergeRects(ws)) ws.unMergeCells(rectName(m));
    if (s.axis === "row") {
      if (s.n > 0) ws.spliceRows(s.at, k);
      else {
        ws.spliceRows(s.at, 0, ...Array.from({ length: k }, () => []));
        for (const r of rec.removedRows) {
          const row = ws.getRow(r.row);
          row.height = r.height as number;
          row.hidden = r.hidden;
        }
      }
    } else {
      if (s.n > 0) ws.spliceColumns(s.at, k);
      else ws.spliceColumns(s.at, 0, ...Array.from({ length: k }, () => []));
      setColumnDefs(ws, rec.colsBefore);
    }
    for (const sn of rec.removed) {
      const cell = ws.getCell(sn.row, sn.col);
      cell.value = clone(sn.value);
      cell.style = sn.style ?? {};
    }
    for (const ch of rec.formulaChanges) {
      const fws = this.sheetById(ch.wsId);
      if (fws) fws.getCell(ch.row, ch.col).value = clone(ch.old);
    }
    for (const m of rec.mergesBefore) {
      try {
        ws.mergeCells(rectName(m));
      } catch {
        /* skip */
      }
    }
    (this.wb.definedNames as unknown as { model: unknown }).model = clone(rec.namesBefore);
    (ws as unknown as { conditionalFormattings: unknown }).conditionalFormattings = clone(rec.cfBefore);
    setDataValidations(ws, clone(rec.dvBefore));
    this.mergeVersion++;
    this.loadNames();
    this.engine.rebuild();
    this.engine.recalc(rec.formulaChanges.map((ch) => cellKey(ch.wsId, ch.row, ch.col)));
  }

  /* ---------------------------------------------------------------- sheets */

  /** Why a sheet name can't be used, or null when it's fine. */
  nameProblem(name: string, except?: Worksheet): string | null {
    const n = name.trim();
    if (!n) return "Give the sheet a name.";
    if (n.length > 31) return "Sheet names can be up to 31 characters.";
    if (/[\\/?*[\]:]/.test(n)) return "Sheet names can't use \\ / ? * [ ] or :";
    if (n.startsWith("'") || n.endsWith("'")) return "Sheet names can't start or end with an apostrophe.";
    if (this.wb.worksheets.some((ws) => ws !== except && ws.name.toLowerCase() === n.toLowerCase())) return "There's already a sheet with that name.";
    return null;
  }

  addSheet(): Worksheet {
    let i = this.wb.worksheets.length + 1;
    while (this.wb.worksheets.some((ws) => ws.name.toLowerCase() === `sheet${i}`)) i++;
    const name = `Sheet${i}`;
    let ws = this.wb.addWorksheet(name);
    this.engine.rebuild();
    this.push({
      label: "add a sheet",
      wsId: ws.id,
      sel: { r1: 1, c1: 1, r2: 1, c2: 1 },
      undo: () => {
        this.wb.removeWorksheet(ws.id);
        this.engine.rebuild();
      },
      redo: () => {
        ws = this.wb.addWorksheet(name);
        this.engine.rebuild();
      },
    });
    return ws;
  }

  renameSheet(ws: Worksheet, name: string): string | null {
    const problem = this.nameProblem(name, ws);
    if (problem) return problem;
    const oldName = ws.name;
    const newName = name.trim();
    if (oldName === newName) return null;
    const run = (from: string, to: string) => {
      for (const f of [...this.engine.allFormulas()]) {
        const text = renameSheetInFormula(f.text, from, to);
        if (text === f.text) continue;
        const cell = this.sheetById(f.wsId)?.getCell(f.row, f.col);
        if (cell) cell.value = { formula: text, result: cell.result } as CellValue;
      }
      const names = (this.wb.definedNames as unknown as { model: { name: string; ranges: string[] }[] }).model ?? [];
      (this.wb.definedNames as unknown as { model: unknown }).model = names.map((n) => ({ ...n, ranges: n.ranges.map((r) => renameSheetInFormula(r, from, to)) }));
      ws.name = to;
      this.loadNames();
      this.engine.rebuild();
    };
    run(oldName, newName);
    this.push({ label: "rename the sheet", wsId: ws.id, sel: { r1: 1, c1: 1, r2: 1, c2: 1 }, undo: () => run(newName, oldName), redo: () => run(oldName, newName) });
    return null;
  }

  /* ---------------------------------------------------------------- finding */

  find(query: string): { wsId: number; row: number; col: number }[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { wsId: number; row: number; col: number }[] = [];
    for (const ws of this.sheets()) {
      ws.eachRow({ includeEmpty: false }, (row, r) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (out.length >= 5000) return;
          const c = Number(cell.col);
          if (cell.isMerged && cell.master !== cell) return;
          if (this.shown(ws, r, c).text.toLowerCase().includes(q) || (cell.formula ?? "").toLowerCase().includes(q)) out.push({ wsId: ws.id, row: r, col: c });
        });
      });
    }
    return out;
  }

  /** Sum, average and count of the selected numbers, like Excel's status bar. */
  stats(ws: Worksheet, rect: Rect): { sum: number; count: number; numbers: number } | null {
    const area = (rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1);
    if (area < 2) return null;
    let sum = 0;
    let count = 0;
    let numbers = 0;
    for (const c of this.cellsIn(ws, rect, false)) {
      const v = this.value(ws, c.row, c.col);
      if (v == null || v === "") continue;
      count++;
      if (typeof v === "number") {
        sum += v;
        numbers++;
      }
    }
    return { sum, count, numbers };
  }

  /* ---------------------------------------------------------------- saving */

  async save(): Promise<{ blob: Blob; extension?: string }> {
    if (this.kind === "csv") return { blob: new Blob([this.toCsv()], { type: "text/csv" }) };
    this.wb.calcProperties = { ...(this.wb.calcProperties ?? {}), fullCalcOnLoad: true };
    const buf = await this.wb.xlsx.writeBuffer();
    return { blob: new Blob([buf], { type: XLSX_MIME }), extension: this.kind === "xlsx" ? undefined : ".xlsx" };
  }

  private toCsv(): string {
    const ws = this.wb.worksheets[0];
    const { delimiter, eol, bom } = this.csv ?? { delimiter: ",", eol: "\r\n", bom: false };
    const lines: string[] = [];
    const cols = ws.columnCount;
    for (let r = 1; r <= ws.rowCount; r++) {
      const fields: string[] = [];
      for (let c = 1; c <= cols; c++) {
        const v = this.value(ws, r, c);
        const fmt = this.numFmt(ws, r, c);
        let text: string;
        if (v == null) text = "";
        else if (typeof v === "number") text = fmt && isDateFormat(fmt) ? show(v, fmt, this.date1904).text : String(parseFloat(v.toPrecision(15)));
        else if (isError(v)) text = v.error;
        else if (typeof v === "boolean") text = v ? "TRUE" : "FALSE";
        else text = v;
        fields.push(csvField(text, delimiter));
      }
      while (fields.length && fields[fields.length - 1] === "") fields.pop();
      lines.push(fields.join(delimiter));
    }
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    return (bom ? "﻿" : "") + lines.join(eol) + eol;
  }
}

/* ---------------------------------------------------------------- helpers */

function sheetNameFrom(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/\s*\(v\d+\)$/i, "");
  return base.replace(/[\\/?*[\]:]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Sheet1";
}

function mergeRects(ws: Worksheet): Rect[] {
  const merges = (ws as unknown as { _merges?: Record<string, { model: { top: number; left: number; bottom: number; right: number } }> })._merges ?? {};
  return Object.values(merges).map((m) => ({ r1: m.model.top, c1: m.model.left, r2: m.model.bottom, c2: m.model.right }));
}

interface ColDef {
  width?: number;
  hidden: boolean;
  style?: Partial<Style>;
}

function columnDefs(ws: Worksheet): ColDef[] {
  const cols = (ws as unknown as { _columns?: ({ width?: number; hidden?: boolean; style?: Partial<Style> } | undefined)[] })._columns ?? [];
  return cols.map((c) => ({ width: c?.width, hidden: !!c?.hidden, style: c?.style }));
}

function shiftColumnDefs(defs: ColDef[], s: Shift): ColDef[] {
  const out = defs.slice();
  const i = s.at - 1;
  if (s.n > 0) {
    const like = i > 0 ? out[i - 1] : undefined;
    out.splice(i, 0, ...Array.from({ length: s.n }, () => ({ width: like?.width, hidden: false, style: like?.style })));
  } else {
    out.splice(i, -s.n);
  }
  return out;
}

function setColumnDefs(ws: Worksheet, defs: ColDef[]) {
  const existing = columnDefs(ws).length;
  const count = Math.max(existing, defs.length);
  for (let c = 1; c <= count; c++) {
    const d = defs[c - 1];
    const col = ws.getColumn(c);
    col.width = d?.width as number;
    col.hidden = !!d?.hidden;
  }
}

function dataValidations(ws: Worksheet): Record<string, unknown> {
  return ((ws as unknown as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations?.model ?? {}) as Record<string, unknown>;
}

function setDataValidations(ws: Worksheet, model: Record<string, unknown>) {
  const dv = (ws as unknown as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations;
  if (dv) dv.model = model;
}

/** Shift a space-separated list of ranges ("A1:B5 D2") on its own sheet; "" when all are gone. */
function shiftRefList(list: string, s: Shift): string {
  return list
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const [a, b] = part.split(":");
      const p = parseCell(a);
      const q = b ? parseCell(b) : p;
      if (!p || !q) return part;
      const moved = shiftRect({ r1: p.row, c1: p.col, r2: q.row, c2: q.col }, s);
      return moved ? rectName(moved) : "";
    })
    .filter(Boolean)
    .join(" ");
}

