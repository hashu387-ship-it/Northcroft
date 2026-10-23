// Cell values as the formula engine sees them, and how they're shown (Excel number formats via ssf).
import * as SSF from "ssf";
import type { CellValue } from "exceljs";

export interface ErrorValue {
  error: string;
}
export type Scalar = number | string | boolean | null | ErrorValue;

export const isError = (v: unknown): v is ErrorValue => !!v && typeof v === "object" && typeof (v as ErrorValue).error === "string";

const EPOCH = Date.UTC(1899, 11, 30);

/** Excel stores dates as days since 30 Dec 1899 (or 1 Jan 1904 in some Mac files). */
export function dateToSerial(d: Date, date1904 = false): number {
  const s = (d.getTime() - EPOCH) / 86400000;
  return date1904 ? s - 1462 : s;
}

export function serialToDate(n: number, date1904 = false): Date {
  return new Date(EPOCH + (date1904 ? n + 1462 : n) * 86400000);
}

/** Flatten an ExcelJS cell value (formula results, rich text, links, dates) to a plain value. */
export function toScalar(v: CellValue | undefined, date1904 = false): Scalar {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (v instanceof Date) return dateToSerial(v, date1904);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("formula" in o || "sharedFormula" in o) return toScalar(o.result as CellValue, date1904);
    if ("richText" in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("hyperlink" in o) return toScalar(o.text as CellValue, date1904);
    if ("error" in o) return { error: String(o.error) };
  }
  return null;
}

/** Split a number format into its sections (positive;negative;zero;text), ignoring ";" inside quotes. */
function sections(fmt: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') quoted = !quoted;
    if (ch === "\\" && i + 1 < fmt.length) {
      cur += ch + fmt[++i];
      continue;
    }
    if (ch === ";" && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const NAMED: Record<string, string> = {
  red: "#E00000",
  blue: "#0047FF",
  green: "#008A00",
  magenta: "#C000C0",
  cyan: "#008B8B",
  yellow: "#B08C00",
  black: "#000000",
  white: "#FFFFFF",
};

export interface Shown {
  text: string;
  /** Set by formats like [Red] for negative numbers. */
  color?: string;
  kind: "number" | "text" | "bool" | "error" | "empty";
}

const isDateFormat = (fmt: string) => {
  try {
    return SSF.is_date(fmt);
  } catch {
    return false;
  }
};

/** The text Excel would show for a value with a number format. */
export function show(v: Scalar, numFmt: string | undefined, date1904 = false): Shown {
  if (v == null || v === "") return { text: "", kind: "empty" };
  if (isError(v)) return { text: v.error, kind: "error" };
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", kind: "bool" };
  const fmt = numFmt && numFmt.trim() ? numFmt : "General";
  if (typeof v === "string") {
    const parts = sections(fmt);
    if (parts.length >= 4 && parts[3].includes("@")) {
      try {
        return { text: SSF.format(parts[3], v), kind: "text" };
      } catch {
        /* fall through */
      }
    }
    return { text: v, kind: "text" };
  }
  if (!Number.isFinite(v)) return { text: "#NUM!", kind: "error" };
  let color: string | undefined;
  const parts = sections(fmt);
  const part = parts.length > 1 && v < 0 ? parts[1] : parts.length > 2 && v === 0 ? parts[2] : parts[0];
  const named = /\[(red|blue|green|magenta|cyan|yellow|black|white)\]/i.exec(part);
  if (named) color = NAMED[named[1].toLowerCase()];
  try {
    const text = SSF.format(fmt, v, { date1904 });
    return { text, color, kind: "number" };
  } catch {
    // An unusual format ssf can't read: fall back to a plain number.
    return { text: isDateFormat(fmt) ? serialToDate(v, date1904).toISOString().slice(0, 10) : String(Math.round(v * 1e10) / 1e10), color, kind: "number" };
  }
}

/** What the formula bar shows for a plain value: numbers in full, dates as dd/mm/yyyy. */
export function editText(v: Scalar, numFmt: string | undefined, date1904 = false): string {
  if (v == null) return "";
  if (isError(v)) return v.error;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    if (numFmt && isDateFormat(numFmt)) {
      const d = serialToDate(v, date1904);
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const frac = v - Math.floor(v);
      const time = frac > 1e-9 ? ` ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : "";
      return `${dd}/${mm}/${d.getUTCFullYear()}${time}`;
    }
    if (numFmt && /%/.test(numFmt) && !/"[^"]*%[^"]*"/.test(numFmt)) return `${parseFloat((v * 100).toPrecision(15))}%`;
    return String(parseFloat(v.toPrecision(15)));
  }
  return v;
}

export { isDateFormat };
