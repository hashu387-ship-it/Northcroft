// Excel functions the formula library doesn't have yet but bills of quantities use a lot:
// MAX, MIN, COUNTA, SUMIFS, COUNTIFS, SUBTOTAL, MATCH, XLOOKUP and a few more.
import FormulaParser, { type FormulaError as FErr } from "fast-formula-parser";

const { FormulaError, Criteria } = FormulaParser;

/** One argument as the library hands it over. */
interface Arg {
  value: unknown;
  isArray?: boolean;
  isRangeRef?: boolean;
  isCellRef?: boolean;
  omitted?: boolean;
  ref?: { sheet?: string; row?: number; col?: number; from?: { row: number; col: number }; to?: { row: number; col: number } };
}

/** What the SUBTOTAL function needs to know about the workbook. */
export interface FunctionHost {
  read(sheet: string, row: number, col: number): unknown;
  /** True when that cell holds a SUBTOTAL (those are skipped, so sub-totals aren't counted twice). */
  isSubtotal(sheet: string, row: number, col: number): boolean;
  rowHidden(sheet: string, row: number): boolean;
}

const isErr = (v: unknown): v is FErr => v instanceof FormulaError;

function grid(a: Arg | undefined): unknown[][] {
  if (!a || a.omitted) return [[null]];
  const v = a.value;
  if (Array.isArray(v)) return v.map((row) => (Array.isArray(row) ? row : [row]));
  if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) {
    // A union like (A1:A3, C1:C3): treat as one long column.
    const flat: unknown[][] = [];
    const walk = (x: unknown) => (Array.isArray(x) ? x.forEach(walk) : flat.push([x]));
    walk((v as { data: unknown[] }).data);
    return flat;
  }
  return [[v]];
}

/** Every value in the arguments; `literal` is true for values typed straight into the formula. */
function* items(args: Arg[]): Generator<{ v: unknown; literal: boolean }> {
  for (const a of args) {
    if (!a || a.omitted) continue;
    const literal = !a.isRangeRef && !a.isCellRef && !a.isArray && !a.ref && !Array.isArray(a.value);
    if (literal) {
      yield { v: a.value, literal: true };
      continue;
    }
    for (const row of grid(a)) for (const v of row) yield { v, literal: false };
  }
}

/** The numbers in the arguments, like MAX and MIN read them. Errors are passed on. */
function numbers(args: Arg[]): number[] {
  const out: number[] = [];
  for (const { v, literal } of items(args)) {
    if (isErr(v)) throw v;
    if (typeof v === "number") out.push(v);
    else if (literal) {
      if (typeof v === "boolean") out.push(v ? 1 : 0);
      else if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) out.push(Number(v));
      else if (typeof v === "string") throw FormulaError.VALUE;
    }
  }
  return out;
}

const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);

/** A test for one IFS-style criteria (">10", "Concrete*", "<>", 5, ...). */
function matcher(criteria: unknown): (v: unknown) => boolean {
  if (isErr(criteria)) throw criteria;
  const c = Criteria.parse(criteria ?? "");
  if (c.op === "wc") {
    const re = new RegExp(`^(?:${(c.value as RegExp).source})$`, "is");
    return (v) => typeof v === "string" && re.test(v) === !!c.match;
  }
  const target = c.value;
  const asNum = typeof target === "string" && target.trim() !== "" && !isNaN(Number(target)) ? Number(target) : null;
  return (v) => {
    if (isErr(v)) return isErr(target) && v.error === (target as FErr).error;
    if (target === "" || target == null) {
      const blank = v == null || v === "";
      return c.op === "<>" ? !blank : c.op === "=" ? blank : false;
    }
    let a: unknown = v;
    let b: unknown = target;
    if (typeof b === "number" || asNum != null) {
      b = asNum ?? b;
      if (typeof a === "string" && a.trim() !== "" && !isNaN(Number(a))) a = Number(a);
      if (typeof a !== "number") return c.op === "<>";
    } else if (typeof b === "string") {
      if (typeof a !== "string") return c.op === "<>";
      a = lower(a);
      b = lower(b);
    } else if (typeof b === "boolean" && typeof a !== "boolean") {
      return c.op === "<>";
    }
    switch (c.op) {
      case "=":
        return a === b;
      case "<>":
        return a !== b;
      case ">":
        return (a as number) > (b as number);
      case ">=":
        return (a as number) >= (b as number);
      case "<":
        return (a as number) < (b as number);
      case "<=":
        return (a as number) <= (b as number);
    }
    return false;
  };
}

/** Rows and columns where every (range, criteria) pair matches, for SUMIFS and friends. */
function ifsHits(pairs: Arg[], shapeOf: unknown[][]): boolean[][] {
  if (pairs.length < 2 || pairs.length % 2) throw FormulaError.VALUE;
  const rows = shapeOf.length;
  const cols = shapeOf[0]?.length ?? 0;
  const hits = shapeOf.map((r) => r.map(() => true));
  for (let i = 0; i < pairs.length; i += 2) {
    const range = grid(pairs[i]);
    if (range.length !== rows || (range[0]?.length ?? 0) !== cols) throw FormulaError.VALUE;
    const test = matcher(pairs[i + 1]?.value);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (hits[r][c] && !test(range[r][c])) hits[r][c] = false;
  }
  return hits;
}

function stats(xs: number[], kind: "stdevs" | "stdevp" | "vars" | "varp"): number {
  const n = xs.length;
  const sample = kind === "stdevs" || kind === "vars";
  if (n < (sample ? 2 : 1)) throw FormulaError.DIV0;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const v = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (sample ? n - 1 : n);
  return kind.startsWith("stdev") ? Math.sqrt(v) : v;
}

function flat1d(a: Arg): unknown[] {
  const g = grid(a);
  if (g.length === 1) return g[0];
  if (g.every((r) => r.length === 1)) return g.map((r) => r[0]);
  throw FormulaError.NA;
}

function sameValue(a: unknown, b: unknown) {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  // Excel's order: numbers < text < booleans
  const rank = (x: unknown) => (typeof x === "number" ? 0 : typeof x === "string" ? 1 : typeof x === "boolean" ? 2 : 3);
  return rank(a) - rank(b);
}

function wildcardTest(pattern: string): (v: unknown) => boolean {
  const src = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/~\*/g, "\u0001")
    .replace(/~\?/g, "\u0002")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
    .replace(/\u0001/g, "\\*")
    .replace(/\u0002/g, "\\?");
  const re = new RegExp(`^${src}$`, "is");
  return (v) => typeof v === "string" && re.test(v);
}

export function extraFunctions(host: FunctionHost) {
  const subtotal = (fnArg: Arg, ...refs: Arg[]) => {
    const fn = Number(fnArg?.value);
    const code = fn > 100 ? fn - 100 : fn;
    if (!(code >= 1 && code <= 11)) throw FormulaError.VALUE;
    const skipHidden = fn > 100;
    const values: unknown[] = [];
    for (const a of refs) {
      const ref = a?.ref;
      if (ref?.from && ref.to && ref.sheet) {
        for (let r = ref.from.row; r <= ref.to.row; r++) {
          if (skipHidden && host.rowHidden(ref.sheet, r)) continue;
          for (let c = ref.from.col; c <= ref.to.col; c++) {
            if (host.isSubtotal(ref.sheet, r, c)) continue;
            values.push(host.read(ref.sheet, r, c));
          }
        }
      } else if (ref?.row && ref.col && ref.sheet) {
        if (!(skipHidden && host.rowHidden(ref.sheet, ref.row)) && !host.isSubtotal(ref.sheet, ref.row, ref.col)) values.push(host.read(ref.sheet, ref.row, ref.col));
      } else {
        for (const row of grid(a)) values.push(...row);
      }
    }
    for (const v of values) if (isErr(v)) throw v;
    const nums = values.filter((v): v is number => typeof v === "number");
    switch (code) {
      case 1:
        if (!nums.length) throw FormulaError.DIV0;
        return nums.reduce((s, x) => s + x, 0) / nums.length;
      case 2:
        return nums.length;
      case 3:
        return values.filter((v) => v != null && v !== "").length;
      case 4:
        return nums.length ? Math.max(...nums) : 0;
      case 5:
        return nums.length ? Math.min(...nums) : 0;
      case 6:
        return nums.reduce((s, x) => s * x, 1);
      case 7:
        return stats(nums, "stdevs");
      case 8:
        return stats(nums, "stdevp");
      case 9:
        return nums.reduce((s, x) => s + x, 0);
      case 10:
        return stats(nums, "vars");
      default:
        return stats(nums, "varp");
    }
  };

  const fns: Record<string, (...args: Arg[]) => unknown> = {
    MAX: (...a) => {
      const xs = numbers(a);
      return xs.length ? Math.max(...xs) : 0;
    },
    MIN: (...a) => {
      const xs = numbers(a);
      return xs.length ? Math.min(...xs) : 0;
    },
    MEDIAN: (...a) => {
      const xs = numbers(a).sort((x, y) => x - y);
      if (!xs.length) throw FormulaError.NUM;
      const m = Math.floor(xs.length / 2);
      return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
    },
    LARGE: (range, k) => {
      const xs = numbers([range]).sort((x, y) => y - x);
      const n = Number(k?.value);
      if (!(n >= 1 && n <= xs.length)) throw FormulaError.NUM;
      return xs[Math.ceil(n) - 1];
    },
    SMALL: (range, k) => {
      const xs = numbers([range]).sort((x, y) => x - y);
      const n = Number(k?.value);
      if (!(n >= 1 && n <= xs.length)) throw FormulaError.NUM;
      return xs[Math.ceil(n) - 1];
    },
    COUNTA: (...a) => {
      let n = 0;
      for (const { v, literal } of items(a)) if (literal || (v != null && v !== "")) n++;
      return n;
    },
    COUNTBLANK: (range) => grid(range).reduce((n, row) => n + row.filter((v) => v == null || v === "").length, 0),
    "STDEV.S": (...a) => stats(numbers(a), "stdevs"),
    STDEV: (...a) => stats(numbers(a), "stdevs"),
    "STDEV.P": (...a) => stats(numbers(a), "stdevp"),
    STDEVP: (...a) => stats(numbers(a), "stdevp"),
    "VAR.S": (...a) => stats(numbers(a), "vars"),
    VAR: (...a) => stats(numbers(a), "vars"),
    "VAR.P": (...a) => stats(numbers(a), "varp"),
    VARP: (...a) => stats(numbers(a), "varp"),
    SUMIFS: (sumRange, ...pairs) => {
      const sums = grid(sumRange);
      const hits = ifsHits(pairs, sums);
      let total = 0;
      sums.forEach((row, r) => row.forEach((v, c) => hits[r][c] && typeof v === "number" && (total += v)));
      return total;
    },
    COUNTIFS: (...pairs) => {
      const hits = ifsHits(pairs, grid(pairs[0]));
      return hits.reduce((n, row) => n + row.filter(Boolean).length, 0);
    },
    AVERAGEIFS: (avgRange, ...pairs) => {
      const vals = grid(avgRange);
      const hits = ifsHits(pairs, vals);
      let total = 0;
      let n = 0;
      vals.forEach((row, r) =>
        row.forEach((v, c) => {
          if (hits[r][c] && typeof v === "number") {
            total += v;
            n++;
          }
        }),
      );
      if (!n) throw FormulaError.DIV0;
      return total / n;
    },
    MAXIFS: (range, ...pairs) => {
      const vals = grid(range);
      const hits = ifsHits(pairs, vals);
      const xs: number[] = [];
      vals.forEach((row, r) => row.forEach((v, c) => hits[r][c] && typeof v === "number" && xs.push(v)));
      return xs.length ? Math.max(...xs) : 0;
    },
    MINIFS: (range, ...pairs) => {
      const vals = grid(range);
      const hits = ifsHits(pairs, vals);
      const xs: number[] = [];
      vals.forEach((row, r) => row.forEach((v, c) => hits[r][c] && typeof v === "number" && xs.push(v)));
      return xs.length ? Math.min(...xs) : 0;
    },
    SUBTOTAL: subtotal,
    MATCH: (lookup, array, type) => {
      const want = lookup?.value;
      if (isErr(want)) throw want;
      const list = flat1d(array);
      const mode = type && !type.omitted && type.value !== "" ? Number(type.value) : 1;
      if (mode === 0) {
        const test = typeof want === "string" && /[*?]/.test(want) ? wildcardTest(want) : (v: unknown) => sameValue(v, want);
        const i = list.findIndex(test);
        if (i < 0) throw FormulaError.NA;
        return i + 1;
      }
      let best = -1;
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (v == null || v === "") continue;
        const cmp = compareValues(v, want);
        if (mode > 0 ? cmp <= 0 : cmp >= 0) best = i;
        else break;
      }
      if (best < 0) throw FormulaError.NA;
      return best + 1;
    },
    XLOOKUP: (lookup, lookupArr, returnArr, ifNotFound, matchMode, searchMode) => {
      const want = lookup?.value;
      if (isErr(want)) throw want;
      const keys = flat1d(lookupArr);
      const back = grid(returnArr);
      const vertical = back.length === keys.length;
      const pick = (i: number) => (vertical ? back[i][0] : back[0][i]);
      const mode = matchMode && !matchMode.omitted && matchMode.value !== "" ? Number(matchMode.value) : 0;
      const order = searchMode && !searchMode.omitted && Number(searchMode.value) < 0 ? -1 : 1;
      const idx = keys.map((_, i) => i);
      if (order < 0) idx.reverse();
      let found = -1;
      if (mode === 2 && typeof want === "string") {
        const test = wildcardTest(want);
        found = idx.find((i) => test(keys[i])) ?? -1;
      } else {
        found = idx.find((i) => sameValue(keys[i], want)) ?? -1;
        if (found < 0 && (mode === -1 || mode === 1)) {
          let best = -1;
          for (const i of idx) {
            const k = keys[i];
            if (k == null || k === "") continue;
            const cmp = compareValues(k, want);
            if (mode === -1 && cmp < 0 && (best < 0 || compareValues(k, keys[best]) > 0)) best = i;
            if (mode === 1 && cmp > 0 && (best < 0 || compareValues(k, keys[best]) < 0)) best = i;
          }
          found = best;
        }
      }
      if (found < 0) {
        if (ifNotFound && !ifNotFound.omitted) return ifNotFound.value;
        throw FormulaError.NA;
      }
      if (!vertical && back[0]?.length !== keys.length) throw FormulaError.VALUE;
      return pick(found);
    },
    TEXTJOIN: (delim, ignoreEmpty, ...rest) => {
      const d = delim?.value == null ? "" : String(delim.value);
      const skip = !!ignoreEmpty?.value;
      const parts: string[] = [];
      for (const { v } of items(rest)) {
        if (isErr(v)) throw v;
        if (skip && (v == null || v === "")) continue;
        parts.push(v == null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));
      }
      return parts.join(d);
    },
    SWITCH: (expr, ...rest) => {
      const v = expr?.value;
      if (isErr(v)) throw v;
      for (let i = 0; i + 1 < rest.length; i += 2) if (sameValue(rest[i].value, v)) return rest[i + 1].value;
      if (rest.length % 2) return rest[rest.length - 1].value;
      throw FormulaError.NA;
    },
  };
  return fns;
}

/** Functions whose arguments must arrive with their cell addresses (see SUBTOTAL). */
export const KEEP_REFS = ["SUBTOTAL"];
