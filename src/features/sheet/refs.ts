// Finding and rewriting cell references inside formula text.
// Used to keep formulas pointing at the right cells when rows or columns are inserted or removed,
// when formulas are copied and pasted, and when a sheet is renamed. Also lists what a formula reads.
import { MAX_COL, MAX_ROW, colName, colNumber, parseCell, type Rect } from "./addr";

export interface RefEnd {
  /** null for whole-row references like 3:5 */
  col: number | null;
  /** null for whole-column references like A:C */
  row: number | null;
  colAbs: boolean;
  rowAbs: boolean;
}

export interface RefToken {
  /** Where the whole reference (with any sheet prefix) sits in the formula text. */
  start: number;
  end: number;
  /** The sheet prefix exactly as written, including "!" (empty when there is none). */
  prefix: string;
  /** The sheet name without quotes, or null when the formula's own sheet is meant. */
  sheet: string | null;
  kind: "cell" | "range" | "cols" | "rows";
  a: RefEnd;
  b: RefEnd | null;
}

export interface NameToken {
  start: number;
  end: number;
  name: string;
  sheet: string | null;
}

const WORD = /[A-Za-z0-9_.$\\À-￿]/;
const AFTER_REF = /[A-Za-z0-9_.(!À-￿]/;
const RE_RANGE = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}):(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/y;
const RE_COLS = /(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})/y;
const RE_ROWS = /(\$?)(\d{1,7}):(\$?)(\d{1,7})/y;
const RE_CELL = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/y;
const RE_ERROR = /#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!|GETTING_DATA)/y;

function boundaryOk(text: string, end: number) {
  return end >= text.length || !AFTER_REF.test(text[end]);
}

function end(colAbs: string, col: string | null, rowAbs: string, row: string | null): RefEnd {
  return { col: col == null ? null : colNumber(col), row: row == null ? null : Number(row), colAbs: !!colAbs, rowAbs: !!rowAbs };
}

/** Try to read a reference starting exactly at `i`. */
function readRef(text: string, i: number): { kind: RefToken["kind"]; a: RefEnd; b: RefEnd | null; end: number } | null {
  let m: RegExpExecArray | null;
  RE_RANGE.lastIndex = i;
  if ((m = RE_RANGE.exec(text)) && boundaryOk(text, RE_RANGE.lastIndex)) {
    const a = end(m[1], m[2], m[3], m[4]);
    const b = end(m[5], m[6], m[7], m[8]);
    if (a.col! <= MAX_COL && b.col! <= MAX_COL && a.row! >= 1 && b.row! >= 1 && a.row! <= MAX_ROW && b.row! <= MAX_ROW) {
      return { kind: "range", a, b, end: RE_RANGE.lastIndex };
    }
  }
  RE_COLS.lastIndex = i;
  if ((m = RE_COLS.exec(text)) && boundaryOk(text, RE_COLS.lastIndex)) {
    const a = end(m[1], m[2], "", null);
    const b = end(m[3], m[4], "", null);
    if (a.col! <= MAX_COL && b.col! <= MAX_COL) return { kind: "cols", a, b, end: RE_COLS.lastIndex };
  }
  RE_ROWS.lastIndex = i;
  if ((m = RE_ROWS.exec(text)) && boundaryOk(text, RE_ROWS.lastIndex)) {
    const a = end("", null, m[1], m[2]);
    const b = end("", null, m[3], m[4]);
    if (a.row! >= 1 && b.row! >= 1 && a.row! <= MAX_ROW && b.row! <= MAX_ROW) return { kind: "rows", a, b, end: RE_ROWS.lastIndex };
  }
  RE_CELL.lastIndex = i;
  if ((m = RE_CELL.exec(text)) && boundaryOk(text, RE_CELL.lastIndex)) {
    const a = end(m[1], m[2], m[3], m[4]);
    if (a.col! <= MAX_COL && a.row! >= 1 && a.row! <= MAX_ROW) return { kind: "cell", a, b: null, end: RE_CELL.lastIndex };
  }
  return null;
}

/** Every cell reference and defined name in a formula (formula text without the leading "="). */
export function scan(text: string): { refs: RefToken[]; names: NameToken[] } {
  const refs: RefToken[] = [];
  const names: NameToken[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      // A string: skip to its closing quote ("" is a quote inside the string).
      i++;
      while (i < n) {
        if (text[i] === '"') {
          if (text[i + 1] === '"') i += 2;
          else break;
        } else i++;
      }
      i++;
      continue;
    }
    if (ch === "[") {
      // Table or external workbook references: left alone.
      const close = text.indexOf("]", i);
      i = close < 0 ? n : close + 1;
      continue;
    }
    if (ch === "#") {
      RE_ERROR.lastIndex = i;
      if (RE_ERROR.exec(text)) {
        i = RE_ERROR.lastIndex;
        continue;
      }
      i++;
      continue;
    }
    const prefixStart = i;
    let sheet: string | null = null;
    let at = i;
    if (ch === "'") {
      // 'Quoted sheet name'!
      let j = i + 1;
      let name = "";
      while (j < n) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            name += "'";
            j += 2;
            continue;
          }
          break;
        }
        name += text[j++];
      }
      if (text[j] === "'" && text[j + 1] === "!") {
        sheet = name;
        at = j + 2;
      } else {
        i = j + 1;
        continue;
      }
    } else if (WORD.test(ch)) {
      if (i > 0 && WORD.test(text[i - 1])) {
        i++;
        continue;
      }
      let j = i;
      while (j < n && WORD.test(text[j])) j++;
      const word = text.slice(i, j);
      if (text[j] === "!" && !/^\d/.test(word)) {
        sheet = word;
        at = j + 1;
      } else if (text[j] === "(") {
        i = j + 1; // a function name
        continue;
      } else {
        const ref = readRef(text, i);
        if (ref) {
          refs.push({ start: i, end: ref.end, prefix: "", sheet: null, kind: ref.kind, a: ref.a, b: ref.b });
          i = ref.end;
          continue;
        }
        if (/^[A-Za-z_\\À-￿]/.test(word) && !/^(TRUE|FALSE)$/i.test(word)) {
          names.push({ start: i, end: j, name: word, sheet: null });
        }
        i = j;
        continue;
      }
    } else {
      i++;
      continue;
    }
    // After a sheet prefix: a reference or a sheet-level name.
    const ref = readRef(text, at);
    if (ref) {
      refs.push({ start: prefixStart, end: ref.end, prefix: text.slice(prefixStart, at), sheet, kind: ref.kind, a: ref.a, b: ref.b });
      i = ref.end;
    } else {
      let j = at;
      while (j < n && WORD.test(text[j])) j++;
      if (j > at && text[j] !== "(") names.push({ start: prefixStart, end: j, name: text.slice(at, j), sheet });
      i = Math.max(j, at + 1);
    }
  }
  return { refs, names };
}

function endText(e: RefEnd): string {
  return (e.col != null ? `${e.colAbs ? "$" : ""}${colName(e.col)}` : "") + (e.row != null ? `${e.rowAbs ? "$" : ""}${e.row}` : "");
}

export function refText(t: Pick<RefToken, "prefix" | "kind" | "a" | "b">): string {
  return t.prefix + endText(t.a) + (t.b ? `:${endText(t.b)}` : "");
}

/** Rebuild a formula, replacing references. `fn` returns new text for a reference, or null to keep it. */
export function rewrite(text: string, fn: (t: RefToken) => string | null, names?: (t: NameToken) => string | null): string {
  const { refs, names: nameTokens } = scan(text);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const t of refs) {
    const out = fn(t);
    if (out != null) edits.push({ start: t.start, end: t.end, text: out });
  }
  if (names) {
    for (const t of nameTokens) {
      const out = names(t);
      if (out != null) edits.push({ start: t.start, end: t.end, text: out });
    }
  }
  if (!edits.length) return text;
  edits.sort((x, y) => x.start - y.start);
  let out = "";
  let pos = 0;
  for (const e of edits) {
    out += text.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + text.slice(pos);
}

/* ---------------------------------------------------------------- inserting and removing */

export interface Shift {
  /** The sheet being changed (any case). */
  sheet: string;
  axis: "row" | "col";
  /** First row or column inserted or removed. */
  at: number;
  /** How many: positive inserts, negative removes. */
  n: number;
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** Move one row/column number for an insert or removal; null means it was removed. */
function moveIndex(v: number, s: Shift): number | null {
  if (s.n > 0) return v >= s.at ? v + s.n : v;
  const last = s.at - s.n - 1;
  if (v < s.at) return v;
  if (v > last) return v + s.n;
  return null;
}

/** Shift a span [v1, v2] for an insert or removal; null when it's removed entirely. */
function moveSpan(v1: number, v2: number, s: Shift): [number, number] | null {
  if (s.n > 0) return [v1 >= s.at ? v1 + s.n : v1, v2 >= s.at ? v2 + s.n : v2];
  const k = -s.n;
  const last = s.at + k - 1;
  if (v1 >= s.at && v2 <= last) return null;
  const a = v1 < s.at ? v1 : v1 > last ? v1 - k : s.at;
  const b = v2 < s.at ? v2 : v2 > last ? v2 - k : s.at - 1;
  return b < a ? null : [a, b];
}

/** Rewrite one reference for an insert or removal. Returns null when unchanged, "#REF!" when it's gone. */
export function shiftRef(t: RefToken, ownSheet: string, s: Shift): string | null {
  if (!same(t.sheet ?? ownSheet, s.sheet)) return null;
  const key = s.axis === "row" ? "row" : "col";
  const limit = s.axis === "row" ? MAX_ROW : MAX_COL;
  const a = { ...t.a };
  const b = t.b ? { ...t.b } : null;
  if (a[key] == null) return null; // whole columns are untouched by row changes (and the other way round)
  if (!b) {
    const v = moveIndex(a[key]!, s);
    if (v == null || v > limit) return "#REF!";
    if (v === a[key]) return null;
    a[key] = v;
  } else {
    const span = moveSpan(a[key]!, b[key]!, s);
    if (!span || span[1] > limit) return "#REF!";
    if (span[0] === a[key] && span[1] === b[key]) return null;
    a[key] = span[0];
    b[key] = Math.min(span[1], limit);
  }
  return refText({ prefix: t.prefix, kind: t.kind, a, b });
}

export function shiftFormula(text: string, ownSheet: string, s: Shift): string {
  return rewrite(text, (t) => shiftRef(t, ownSheet, s));
}

/** Where a rectangle ends up after an insert or removal on its own sheet; null when removed entirely. */
export function shiftRect(r: Rect, s: Shift): Rect | null {
  if (s.axis === "row") {
    const span = moveSpan(r.r1, r.r2, s);
    return span ? { ...r, r1: span[0], r2: span[1] } : null;
  }
  const span = moveSpan(r.c1, r.c2, s);
  return span ? { ...r, c1: span[0], c2: span[1] } : null;
}

/** Where one cell ends up; null when its row or column was removed. */
export function shiftCell(row: number, col: number, s: Shift): { row: number; col: number } | null {
  if (s.axis === "row") {
    const r = moveIndex(row, s);
    return r == null ? null : { row: r, col };
  }
  const c = moveIndex(col, s);
  return c == null ? null : { row, col: c };
}

/* ---------------------------------------------------------------- copying and pasting */

/** Move the relative parts of every reference by (dr, dc), as Excel does when a formula is pasted elsewhere. */
export function translateFormula(text: string, dr: number, dc: number): string {
  if (!dr && !dc) return text;
  return rewrite(text, (t) => {
    const move = (e: RefEnd): RefEnd | null => {
      const out = { ...e };
      if (e.row != null && !e.rowAbs) out.row = e.row + dr;
      if (e.col != null && !e.colAbs) out.col = e.col + dc;
      if ((out.row != null && (out.row < 1 || out.row > MAX_ROW)) || (out.col != null && (out.col < 1 || out.col > MAX_COL))) return null;
      return out;
    };
    const a = move(t.a);
    const b = t.b ? move(t.b) : null;
    if (!a || (t.b && !b)) return "#REF!";
    return refText({ prefix: t.prefix, kind: t.kind, a, b });
  });
}

/* ---------------------------------------------------------------- sheet names */

/** How a sheet name is written in a formula: bare when safe, otherwise in single quotes. */
export function sheetPrefix(name: string): string {
  const bare = /^[A-Za-z_À-￿][A-Za-z0-9_.À-￿]*$/.test(name) && !parseCell(name) && !/^R\d*C\d*$/i.test(name);
  return bare ? `${name}!` : `'${name.replace(/'/g, "''")}'!`;
}

export function renameSheetInFormula(text: string, oldName: string, newName: string): string {
  return rewrite(
    text,
    (t) => (t.sheet != null && same(t.sheet, oldName) ? refText({ ...t, prefix: sheetPrefix(newName) }) : null),
    (t) => (t.sheet != null && same(t.sheet, oldName) ? sheetPrefix(newName) + t.name : null),
  );
}

/* ---------------------------------------------------------------- what a formula reads */

export interface Dep {
  /** Sheet name, or null for the formula's own sheet. */
  sheet: string | null;
  rect: Rect;
}

export function depsOf(text: string): { deps: Dep[]; names: NameToken[] } {
  const { refs, names } = scan(text);
  const deps: Dep[] = refs.map((t) => {
    const b = t.b ?? t.a;
    const rect: Rect =
      t.kind === "cols"
        ? { r1: 1, r2: MAX_ROW, c1: Math.min(t.a.col!, b.col!), c2: Math.max(t.a.col!, b.col!) }
        : t.kind === "rows"
          ? { c1: 1, c2: MAX_COL, r1: Math.min(t.a.row!, b.row!), r2: Math.max(t.a.row!, b.row!) }
          : { r1: Math.min(t.a.row!, b.row!), r2: Math.max(t.a.row!, b.row!), c1: Math.min(t.a.col!, b.col!), c2: Math.max(t.a.col!, b.col!) };
    return { sheet: t.sheet, rect };
  });
  return { deps, names };
}
