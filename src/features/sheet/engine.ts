// The formula engine. Knows which cells every formula reads, and after an edit recalculates the
// formulas that depend on it (across sheets, ranges included), in the right order.
// Results are written straight back into the workbook, so saving keeps fresh values.
// Formulas it can't work out (a function it doesn't know) keep the value saved in the file.
import type { Workbook, Worksheet } from "exceljs";
import FormulaParser from "fast-formula-parser";
import { MAX_COL, MAX_ROW, inRect, type Rect } from "./addr";
import { depsOf } from "./refs";
import { isError, toScalar, type Scalar } from "./display";
import { extraFunctions, KEEP_REFS } from "./functions";

const { FormulaError } = FormulaParser;

export interface FormulaInfo {
  key: string;
  wsId: number;
  row: number;
  col: number;
  text: string;
  /** The cells and ranges it reads. */
  deps: { wsId: number; rect: Rect }[];
  /** Uses something the engine can't calculate: the saved value is shown instead. */
  unsupported: boolean;
}

interface RangeDep {
  rect: Rect;
  key: string;
}

/** Ranges up to this many cells are tracked cell by cell; bigger ones as rectangles. */
const SMALL_RANGE = 64;

export const cellKey = (wsId: number, row: number, col: number) => `${wsId}:${row}:${col}`;

export interface DefinedName {
  wsId: number;
  rect: Rect;
}

export class Engine {
  private formulas = new Map<string, FormulaInfo>();
  private cellDeps = new Map<string, Set<string>>();
  private rangeDeps = new Map<number, RangeDep[]>();
  private sheetsByName = new Map<string, Worksheet>();
  private sheetsById = new Map<number, Worksheet>();
  private parser: FormulaParser;
  names = new Map<string, DefinedName>();

  constructor(
    private wb: Workbook,
    private date1904: boolean,
    private hiddenRow: (ws: Worksheet, row: number) => boolean,
  ) {
    const host = {
      read: (sheet: string, row: number, col: number) => this.forParser(this.sheet(sheet), row, col),
      isSubtotal: (sheet: string, row: number, col: number) => {
        const ws = this.sheet(sheet);
        const f = ws && this.formulas.get(cellKey(ws.id, row, col));
        return !!f && /^\s*(SUBTOTAL|AGGREGATE)\s*\(/i.test(f.text);
      },
      rowHidden: (sheet: string, row: number) => {
        const ws = this.sheet(sheet);
        return !!ws && this.hiddenRow(ws, row);
      },
    };
    this.parser = new FormulaParser({
      functions: extraFunctions(host) as never,
      onCell: (ref) => this.forParser(this.sheet(ref.sheet), ref.row, ref.col),
      onRange: (ref) => this.rangeForParser(this.sheet(ref.sheet), ref.from, ref.to),
      onVariable: (name) => {
        const n = this.names.get(name.toUpperCase());
        const ws = n && this.sheetsById.get(n.wsId);
        if (!n || !ws) return null;
        if (n.rect.r1 === n.rect.r2 && n.rect.c1 === n.rect.c2) return { sheet: ws.name, row: n.rect.r1, col: n.rect.c1 };
        return { sheet: ws.name, from: { row: n.rect.r1, col: n.rect.c1 }, to: { row: n.rect.r2, col: n.rect.c2 } };
      },
    });
    this.parser.funsPreserveRef.push(...KEEP_REFS);
  }

  sheet(name: string | null | undefined): Worksheet | undefined {
    return name == null ? undefined : this.sheetsByName.get(name.toLowerCase());
  }

  /* ---------------------------------------------------------------- reading cells */

  /** A cell's value as formulas see it (merged-over cells are blank, like in Excel). */
  read(ws: Worksheet | undefined, row: number, col: number): Scalar {
    if (!ws) return null;
    const cell = ws.findCell(row, col);
    if (!cell) return null;
    if (cell.isMerged && cell.master !== cell) return null;
    return toScalar(cell.value, this.date1904);
  }

  private forParser(ws: Worksheet | undefined, row: number, col: number): unknown {
    const v = this.read(ws, row, col);
    return isError(v) ? new FormulaError(v.error) : v;
  }

  private rangeForParser(ws: Worksheet | undefined, from: { row: number; col: number }, to: { row: number; col: number }): unknown[][] {
    // Whole columns (A:A) and whole rows (3:3) stop at the last used cell.
    const lastRow = to.row >= MAX_ROW ? Math.max(from.row, Math.min(to.row, ws ? Math.max(ws.rowCount, 1) : from.row)) : to.row;
    const lastCol = to.col >= MAX_COL ? Math.max(from.col, Math.min(to.col, ws ? Math.max(ws.columnCount, 1) : from.col)) : to.col;
    const out: unknown[][] = [];
    for (let r = from.row; r <= lastRow; r++) {
      const row: unknown[] = [];
      for (let c = from.col; c <= lastCol; c++) row.push(this.forParser(ws, r, c));
      out.push(row);
    }
    return out;
  }

  /* ---------------------------------------------------------------- the formula list */

  /** Read every formula in the workbook afresh (after opening, or after rows or columns move). */
  rebuild() {
    this.formulas.clear();
    this.cellDeps.clear();
    this.rangeDeps.clear();
    this.sheetsByName.clear();
    this.sheetsById.clear();
    for (const ws of this.wb.worksheets) {
      this.sheetsByName.set(ws.name.toLowerCase(), ws);
      this.sheetsById.set(ws.id, ws);
    }
    for (const ws of this.wb.worksheets) {
      ws.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const f = cell.formula;
          if (f && !(cell.isMerged && cell.master !== cell)) this.register(ws, Number(cell.row), Number(cell.col), f);
        });
      });
    }
  }

  formulaAt(wsId: number, row: number, col: number) {
    return this.formulas.get(cellKey(wsId, row, col));
  }

  allFormulas() {
    return this.formulas.values();
  }

  private register(ws: Worksheet, row: number, col: number, text: string) {
    const key = cellKey(ws.id, row, col);
    this.unregister(key);
    const { deps, names } = depsOf(text);
    const out: FormulaInfo["deps"] = [];
    for (const d of deps) {
      const target = d.sheet == null ? ws : this.sheet(d.sheet);
      if (target) out.push({ wsId: target.id, rect: d.rect });
    }
    for (const n of names) {
      const def = this.names.get(n.name.toUpperCase());
      if (def) out.push({ wsId: def.wsId, rect: def.rect });
    }
    const info: FormulaInfo = { key, wsId: ws.id, row, col, text, deps: out, unsupported: false };
    this.formulas.set(key, info);
    for (const d of out) {
      const area = (d.rect.r2 - d.rect.r1 + 1) * (d.rect.c2 - d.rect.c1 + 1);
      if (area <= SMALL_RANGE) {
        for (let r = d.rect.r1; r <= d.rect.r2; r++) {
          for (let c = d.rect.c1; c <= d.rect.c2; c++) {
            const k = cellKey(d.wsId, r, c);
            let set = this.cellDeps.get(k);
            if (!set) this.cellDeps.set(k, (set = new Set()));
            set.add(key);
          }
        }
      } else {
        let list = this.rangeDeps.get(d.wsId);
        if (!list) this.rangeDeps.set(d.wsId, (list = []));
        list.push({ rect: d.rect, key });
      }
    }
    return info;
  }

  private unregister(key: string) {
    const old = this.formulas.get(key);
    if (!old) return;
    this.formulas.delete(key);
    for (const d of old.deps) {
      const area = (d.rect.r2 - d.rect.r1 + 1) * (d.rect.c2 - d.rect.c1 + 1);
      if (area <= SMALL_RANGE) {
        for (let r = d.rect.r1; r <= d.rect.r2; r++) for (let c = d.rect.c1; c <= d.rect.c2; c++) this.cellDeps.get(cellKey(d.wsId, r, c))?.delete(key);
      } else {
        const list = this.rangeDeps.get(d.wsId);
        if (list) this.rangeDeps.set(d.wsId, list.filter((x) => x.key !== key));
      }
    }
  }

  /** Call after a cell's content changed: picks up a new, changed or removed formula. */
  cellChanged(ws: Worksheet, row: number, col: number): string {
    const key = cellKey(ws.id, row, col);
    const cell = ws.findCell(row, col);
    const f = cell && !(cell.isMerged && cell.master !== cell) ? cell.formula : undefined;
    if (f) this.register(ws, row, col, f);
    else this.unregister(key);
    return key;
  }

  /** The formulas that read this cell directly. */
  private dependents(key: string): string[] {
    const [wsIdText, rowText, colText] = key.split(":");
    const wsId = Number(wsIdText);
    const row = Number(rowText);
    const col = Number(colText);
    const out = [...(this.cellDeps.get(key) ?? [])];
    for (const d of this.rangeDeps.get(wsId) ?? []) if (inRect(d.rect, row, col)) out.push(d.key);
    return out;
  }

  /* ---------------------------------------------------------------- recalculating */

  /**
   * Recalculate after `changed` cells changed. Formulas among them are recalculated too, then
   * everything that depends on them, each after the cells it reads.
   */
  recalc(changed: string[]) {
    const dirty = new Set<string>();
    const queue: string[] = [];
    for (const k of changed) {
      if (this.formulas.has(k) && !dirty.has(k)) {
        dirty.add(k);
      }
      queue.push(k);
    }
    while (queue.length) {
      const k = queue.pop()!;
      for (const f of this.dependents(k)) {
        if (!dirty.has(f)) {
          dirty.add(f);
          queue.push(f);
        }
      }
    }
    if (!dirty.size) return 0;
    const order = this.order(dirty);
    for (const k of order) this.evaluate(this.formulas.get(k)!);
    return order.length;
  }

  /** Recalculate every formula with no saved value (new files, or files saved without results). */
  fillMissing() {
    const missing: string[] = [];
    for (const f of this.formulas.values()) {
      const cell = this.sheetsById.get(f.wsId)?.findCell(f.row, f.col);
      // ExcelJS reports a missing saved result as 0, so look at the stored value itself.
      const saved = (cell?.value as { result?: unknown } | undefined)?.result;
      if (cell && (saved === undefined || saved === null)) missing.push(f.key);
    }
    return missing.length ? this.recalc(missing) : 0;
  }

  /** An order where every formula comes after the formulas it reads. Circular ones are left out. */
  private order(dirty: Set<string>): string[] {
    const bySheet = new Map<number, FormulaInfo[]>();
    for (const k of dirty) {
      const f = this.formulas.get(k)!;
      let list = bySheet.get(f.wsId);
      if (!list) bySheet.set(f.wsId, (list = []));
      list.push(f);
    }
    const before = (f: FormulaInfo): string[] => {
      const out: string[] = [];
      for (const d of f.deps) {
        const area = (d.rect.r2 - d.rect.r1 + 1) * (d.rect.c2 - d.rect.c1 + 1);
        if (area === 1) {
          const k = cellKey(d.wsId, d.rect.r1, d.rect.c1);
          if (dirty.has(k)) out.push(k);
        } else {
          for (const g of bySheet.get(d.wsId) ?? []) if (inRect(d.rect, g.row, g.col)) out.push(g.key);
        }
      }
      return out;
    };
    const state = new Map<string, 1 | 2>();
    const cyclic = new Set<string>();
    const out: string[] = [];
    const start = [...dirty].sort((a, b) => {
      const fa = this.formulas.get(a)!;
      const fb = this.formulas.get(b)!;
      return fa.wsId - fb.wsId || fa.row - fb.row || fa.col - fb.col;
    });
    for (const s of start) {
      if (state.has(s)) continue;
      const stack: { key: string; next: string[]; i: number }[] = [{ key: s, next: before(this.formulas.get(s)!), i: 0 }];
      state.set(s, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.i < top.next.length) {
          const child = top.next[top.i++];
          const st = state.get(child);
          if (!st) {
            state.set(child, 1);
            stack.push({ key: child, next: before(this.formulas.get(child)!), i: 0 });
          } else if (st === 1) {
            // Goes round in a circle: Excel warns about these; keep their saved values.
            for (const frame of stack) cyclic.add(frame.key);
          }
        } else {
          state.set(top.key, 2);
          stack.pop();
          out.push(top.key);
        }
      }
    }
    return out.filter((k) => !cyclic.has(k));
  }

  private evaluate(f: FormulaInfo) {
    const ws = this.sheetsById.get(f.wsId);
    const cell = ws?.findCell(f.row, f.col);
    if (!ws || !cell) return;
    let out: Scalar;
    try {
      let res = this.parser.parse(f.text, { sheet: ws.name, row: f.row, col: f.col }, false);
      while (Array.isArray(res)) res = res[0];
      if (res instanceof FormulaError) out = { error: res.error };
      else if (res == null) out = 0;
      else if (typeof res === "number" || typeof res === "string" || typeof res === "boolean") out = res;
      else out = { error: "#VALUE!" };
      f.unsupported = false;
    } catch (e) {
      // A function the engine doesn't know, or something it can't read: keep the saved value.
      f.unsupported = true;
      if (!(e instanceof FormulaError)) console.warn("Formula not calculated", f.text, e);
      return;
    }
    cell.value = { formula: f.text, result: isError(out) ? ({ error: out.error } as never) : (out as never) };
  }
}

/** Is the text a formula the engine can read? Returns a short reason when it isn't. */
export function checkFormula(text: string, sheetName: string): string | null {
  try {
    new FormulaParser.DepParser().parse(text, { sheet: sheetName, row: 1, col: 1 });
    let depth = 0;
    let quoted = false;
    for (const ch of text) {
      if (ch === '"') quoted = !quoted;
      if (quoted) continue;
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (depth < 0) return "There's a closing bracket without an opening one.";
    }
    if (quoted) return "A quote mark isn't closed.";
    if (depth > 0) return "A bracket isn't closed.";
    return null;
  } catch {
    return "That formula isn't quite right. Check the brackets, commas and cell names.";
  }
}
