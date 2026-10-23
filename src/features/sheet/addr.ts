// Cell addresses: "A1" <-> {row, col}, column letters, and rectangular ranges. Rows and columns start at 1.

export const MAX_ROW = 1048576;
export const MAX_COL = 16384;

export interface Cell {
  row: number;
  col: number;
}

/** A rectangle of cells, inclusive. */
export interface Rect {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export function colName(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export const cellName = (row: number, col: number) => `${colName(col)}${row}`;

export function parseCell(a1: string): Cell | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a1.trim());
  if (!m) return null;
  const col = colNumber(m[1]);
  const row = Number(m[2]);
  if (row < 1 || row > MAX_ROW || col < 1 || col > MAX_COL) return null;
  return { row, col };
}

/** "B2:D9" or "B2" -> a rectangle. */
export function parseRect(text: string): Rect | null {
  const [a, b] = text.split(":");
  const p = parseCell(a);
  const q = b ? parseCell(b) : p;
  if (!p || !q) return null;
  return norm({ r1: p.row, c1: p.col, r2: q.row, c2: q.col });
}

export function norm(r: Rect): Rect {
  return { r1: Math.min(r.r1, r.r2), c1: Math.min(r.c1, r.c2), r2: Math.max(r.r1, r.r2), c2: Math.max(r.c1, r.c2) };
}

export function rectName(r: Rect): string {
  const a = cellName(r.r1, r.c1);
  return r.r1 === r.r2 && r.c1 === r.c2 ? a : `${a}:${cellName(r.r2, r.c2)}`;
}

export const inRect = (r: Rect, row: number, col: number) => row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;

export const rectsOverlap = (a: Rect, b: Rect) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;
