import { CURRENCY } from "./config";

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function sar(n: number | null | undefined, opts: { compact?: boolean; blank?: string } = {}): string {
  if (n === null || n === undefined || Number.isNaN(n)) return opts.blank ?? "–";
  const s = opts.compact ? compact.format(Math.abs(n)) : money.format(Math.abs(n));
  return `${n < 0 ? "-" : ""}${CURRENCY} ${s}`;
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return money.format(n);
}

export function pct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  return `${n.toFixed(digits)}%`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Parse "1,234.50" or "1234" into a number, or null when blank. */
export function parseMoney(s: string): number | null {
  const clean = s.replace(/[^0-9.-]/g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

export function randomPassword(): string {
  const words = ["Falcon", "Cedar", "Harbor", "Summit", "Desert", "Oasis", "Granite", "Palm", "Atlas", "Beacon", "Crest", "Dune"];
  const a = new Uint32Array(3);
  crypto.getRandomValues(a);
  return `${words[a[0] % words.length]}-${1000 + (a[1] % 9000)}-${(a[2] % 65536).toString(16).toUpperCase().padStart(4, "0")}`;
}
