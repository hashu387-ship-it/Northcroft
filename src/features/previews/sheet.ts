// The preview for a spreadsheet (Excel or CSV): the top of its first sheet, up to 25 rows, drawn
// the way the app's spreadsheet screen shows it. The sheet's own column widths and row heights,
// fills, bold and coloured text, borders and merged cells, with the column letters and row numbers
// along the edges so it reads as a spreadsheet at a glance.
import type { Worksheet } from "exceljs";
import { Book } from "@/features/sheet/book";
import { colName } from "@/features/sheet/addr";
import { autoHeight, colPx, columnWidth, cssFont, lookOf, rowPx, textWidth, type Edge, type Look } from "@/features/sheet/layout";

const MAX_ROWS = 25;
const MIN_ROWS = 10;
// The window onto the sheet, in pixels at 100%: narrow enough that the text stays readable when
// the picture is shown on a phone, wide enough to show a few columns of a BOQ.
const MIN_W = 480;
const MAX_W = 700;
const MAX_H = 540;
const HEAD_W = 34;
const HEAD_H = 20;
const LONG_SIDE = 1400;
const GRID = "#e1e4e8";
const HEAD_BG = "#f3f4f6";
const HEAD_LINE = "#cfd4da";
const HEAD_TEXT = "#5f6670";

/** A JPEG of the top of the first sheet, or null when the file can't be read as a spreadsheet. */
export async function sheetPicture(data: ArrayBuffer, name: string): Promise<Blob | null> {
  let book: Book;
  try {
    book = await Book.open(data, name);
  } catch {
    return null;
  }
  const ws = book.sheets()[0];
  if (!ws) return null;
  const canvas = draw(book, ws);
  if (!canvas) return null;
  return new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.88));
}

function draw(book: Book, ws: Worksheet): HTMLCanvasElement | null {
  // Column edges (colLeft[c] = x of column c, column 1 at 0) and row edges, grown as needed.
  const colLeft = [0, 0];
  const colX = (c: number) => {
    while (colLeft.length <= c + 1) {
      const k = colLeft.length - 1;
      const { width, hidden } = columnWidth(ws, k);
      colLeft.push(colLeft[k] + (hidden ? 0 : colPx(width)));
    }
    return colLeft[c];
  };
  const basePx = rowPx((ws.properties as { defaultRowHeight?: number }).defaultRowHeight ?? 15);
  const rowTop = [0, 0];
  const rowY = (r: number) => {
    while (rowTop.length <= r + 1) {
      const k = rowTop.length - 1;
      const row = k <= ws.rowCount ? ws.findRow(k) : undefined;
      const h = row?.hidden ? 0 : row?.height ? rowPx(row.height) : row ? autoHeight(ws, k, basePx) : basePx;
      rowTop.push(rowTop[k] + h);
    }
    return rowTop[r];
  };

  // How much of the sheet to show: its used columns, kept between MIN_W and MAX_W wide (a
  // narrow sheet shows some empty columns, a wide one is cut at the edge like a window), and the
  // first 25 rows, or fewer when they're tall.
  const used = Math.max(1, ws.columnCount);
  let cols = 1;
  while (cols < 200 && (colX(cols + 1) < MAX_W) && (cols < used || colX(cols + 1) < MIN_W)) cols++;
  const width = Math.min(MAX_W, Math.max(colX(cols + 1), 1));
  // Whole rows only, and a short sheet (a few lines of a CSV) gets a shorter picture.
  const wanted = Math.min(MAX_ROWS, Math.max(MIN_ROWS, ws.rowCount + 3));
  let rows = 1;
  while (rows < wanted && rowY(rows + 2) <= MAX_H) rows++;
  const height = Math.min(MAX_H, Math.max(rowY(rows + 1), 1));

  const W = HEAD_W + width;
  const H = HEAD_H + height;
  const scale = Math.min(2, LONG_SIDE / Math.max(W, H));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // The cells, drawn inside the area below and right of the letters and numbers.
  ctx.save();
  ctx.beginPath();
  ctx.rect(HEAD_W, HEAD_H, width, height);
  ctx.clip();
  ctx.translate(HEAD_W, HEAD_H);

  if (book.gridLines(ws)) {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c <= cols; c++) {
      if (colX(c + 1) > colX(c)) line(ctx, colX(c + 1) - 0.5, 0, colX(c + 1) - 0.5, height);
    }
    for (let r = 1; r <= rows; r++) {
      if (rowY(r + 1) > rowY(r)) line(ctx, 0, rowY(r + 1) - 0.5, width, rowY(r + 1) - 0.5);
    }
    ctx.stroke();
  }

  const merges = book.merges(ws);
  const done = new Set<string>();
  const edges: { x1: number; y1: number; x2: number; y2: number; e: Edge }[] = [];
  for (let r = 1; r <= rows; r++) {
    if (rowY(r + 1) <= rowY(r)) continue;
    for (let c = 1; c <= cols; c++) {
      if (colX(c + 1) <= colX(c)) continue;
      let row = r;
      let col = c;
      let r2 = r;
      let c2 = c;
      const m = merges.cover.get(`${r}:${c}`);
      if (m) {
        if (done.has(m.key)) continue;
        done.add(m.key);
        row = m.r1;
        col = m.c1;
        r2 = m.r2;
        c2 = m.c2;
      }
      const left = colX(col);
      const top = rowY(row);
      const w = colX(c2 + 1) - left;
      const h = rowY(r2 + 1) - top;
      if (w <= 0 || h <= 0) continue;
      const cell = ws.findCell(row, col);
      const look = lookOf(cell?.style, book.palette, false);
      if (look.background) {
        ctx.fillStyle = look.background;
        ctx.fillRect(left, top, w, h);
      } else if (m) {
        // A merged block hides the grid lines inside it.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(left, top, w - 1, h - 1);
      }
      const shown = book.shown(ws, row, col);
      if (shown.text) drawText(ctx, ws, { row, col, left, top, w, h, look, merged: !!m, cols, colX, shown, merges: merges.cover });
      const b = look.borders;
      if (b.top) edges.push({ x1: left, y1: top, x2: left + w, y2: top, e: b.top });
      if (b.bottom) edges.push({ x1: left, y1: top + h, x2: left + w, y2: top + h, e: b.bottom });
      if (b.left) edges.push({ x1: left, y1: top, x2: left, y2: top + h, e: b.left });
      if (b.right) edges.push({ x1: left + w, y1: top, x2: left + w, y2: top + h, e: b.right });
    }
  }
  // Borders last, so neighbouring fills don't cover them.
  for (const { x1, y1, x2, y2, e } of edges) {
    ctx.strokeStyle = e.color;
    ctx.lineWidth = e.style === "double" ? 1 : e.width;
    ctx.setLineDash(e.style === "dashed" ? [4, 2] : e.style === "dotted" ? [1, 2] : []);
    const half = ctx.lineWidth % 2 ? 0.5 : 0;
    ctx.beginPath();
    if (y1 === y2) {
      line(ctx, x1, y1 - half, x2, y2 - half);
      if (e.style === "double") line(ctx, x1, y1 + 1.5, x2, y2 + 1.5);
    } else {
      line(ctx, x1 - half, y1, x2 - half, y2);
      if (e.style === "double") line(ctx, x1 + 1.5, y1, x2 + 1.5, y2);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // Column letters and row numbers.
  ctx.fillStyle = HEAD_BG;
  ctx.fillRect(0, 0, W, HEAD_H);
  ctx.fillRect(0, 0, HEAD_W, H);
  ctx.strokeStyle = HEAD_LINE;
  ctx.lineWidth = 1;
  ctx.fillStyle = HEAD_TEXT;
  ctx.font = `400 11px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.beginPath();
  line(ctx, 0, HEAD_H - 0.5, W, HEAD_H - 0.5);
  line(ctx, HEAD_W - 0.5, 0, HEAD_W - 0.5, H);
  for (let c = 1; c <= cols; c++) {
    const x0 = HEAD_W + colX(c);
    const x1 = HEAD_W + colX(c + 1);
    if (x1 <= x0) continue;
    if (x1 - x0 > 12) ctx.fillText(colName(c), Math.min((x0 + x1) / 2, (x0 + W) / 2), HEAD_H / 2 + 0.5);
    if (x1 < W) line(ctx, x1 - 0.5, 0, x1 - 0.5, HEAD_H);
  }
  for (let r = 1; r <= rows; r++) {
    const y0 = HEAD_H + rowY(r);
    const y1 = HEAD_H + rowY(r + 1);
    if (y1 <= y0) continue;
    if (y1 - y0 > 9) ctx.fillText(String(r), HEAD_W / 2, Math.min((y0 + y1) / 2, (y0 + H) / 2) + 0.5);
    if (y1 < H) line(ctx, 0, y1 - 0.5, HEAD_W, y1 - 0.5);
  }
  ctx.stroke();
  return canvas;
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
}

interface TextJob {
  row: number;
  col: number;
  left: number;
  top: number;
  w: number;
  h: number;
  look: Look;
  merged: boolean;
  cols: number;
  colX: (c: number) => number;
  shown: { text: string; color?: string; kind: string };
  merges: Map<string, unknown>;
}

/** A cell's text, placed and cut off the way the spreadsheet screen does it. */
function drawText(ctx: CanvasRenderingContext2D, ws: Worksheet, j: TextJob) {
  const { look, shown } = j;
  const font = cssFont(look, 1);
  const size = (look.size * 4) / 3;
  const pad = 3;
  const indent = look.indent * 9;
  const horizontal = look.h && look.h !== "general" ? look.h : shown.kind === "number" ? "right" : shown.kind === "bool" || shown.kind === "error" ? "center" : "left";
  const v = (ws.findCell(j.row, j.col)?.value ?? null) as { hyperlink?: string } | null;
  const link = !!v && typeof v === "object" && "hyperlink" in v;
  ctx.font = font;
  ctx.fillStyle = shown.color ?? (link ? "#0563C1" : look.color ?? "#000000");

  let text = shown.text;
  let room = j.w;
  let lines: string[] = [text];
  if (look.wrap) {
    lines = wrapLines(text, font, Math.max(8, j.w - pad * 2 - indent));
  } else {
    const need = textWidth(text, font) + pad * 2 + indent;
    if (need > j.w) {
      if (shown.kind === "number") {
        // Too wide for its column: Excel shows ####.
        const hw = textWidth("#", font) || 7;
        text = "#".repeat(Math.max(1, Math.floor((j.w - pad * 2) / hw)));
        lines = [text];
      } else if (horizontal === "left" && !j.merged) {
        // Text runs on over the empty cells to its right.
        for (let k = j.col + 1; k <= j.cols + 1 && room < need; k++) {
          const next = ws.findCell(j.row, k);
          if ((next && next.value != null && next.value !== "") || j.merges.has(`${j.row}:${k}`)) break;
          room += j.colX(k + 1) - j.colX(k);
        }
        room = Math.min(room, need);
        if (room > j.w) {
          // Hide the grid lines the text runs over.
          ctx.save();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(j.left + j.w - 1, j.top, room - j.w, j.h - 1);
          ctx.restore();
          ctx.fillStyle = shown.color ?? (link ? "#0563C1" : look.color ?? "#000000");
        }
      }
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(j.left, j.top, Math.max(room, j.w), j.h);
  ctx.clip();
  const lineH = size * 1.2;
  const block = lines.length * lineH;
  const vAlign = look.v ?? "bottom";
  let y = vAlign === "top" ? j.top + 2 : vAlign === "center" || vAlign === "middle" ? j.top + (j.h - block) / 2 : j.top + j.h - block - 2;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (const ln of lines) {
    const tw = textWidth(ln, font);
    const x =
      horizontal === "right"
        ? j.left + j.w - pad - indent - tw
        : horizontal === "center" || horizontal === "centerContinuous"
          ? j.left + (j.w - tw) / 2
          : j.left + pad + indent;
    const ty = y + (lineH - size) / 2;
    ctx.fillText(ln, x, ty);
    if (look.underline || link) ctx.fillRect(x, ty + size * 0.95, tw, Math.max(1, size / 14));
    if (look.strike) ctx.fillRect(x, ty + size * 0.5, tw, Math.max(1, size / 14));
    y += lineH;
  }
  ctx.restore();
}

function wrapLines(text: string, font: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, font) > width) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}
