// Text measuring and line-wrapping shared by the screen and the saved file, using the same font
// metrics as the PDF (Helvetica), so what you see is what gets saved.
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";

export type Family = "Helvetica" | "Times" | "Courier";

export function standardFontName(family: Family, bold: boolean, italic = false): StandardFonts {
  if (family === "Times") {
    return bold && italic ? StandardFonts.TimesRomanBoldItalic : bold ? StandardFonts.TimesRomanBold : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  }
  if (family === "Courier") {
    return bold && italic ? StandardFonts.CourierBoldOblique : bold ? StandardFonts.CourierBold : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  }
  return bold && italic ? StandardFonts.HelveticaBoldOblique : bold ? StandardFonts.HelveticaBold : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

let doc: PDFDocument | null = null;
const fonts = new Map<string, PDFFont>();

/** Load the measuring fonts once (call before using `measure`). */
export async function loadMetrics(): Promise<void> {
  if (doc) return;
  const d = await PDFDocument.create();
  for (const name of [StandardFonts.Helvetica, StandardFonts.HelveticaBold]) fonts.set(name, await d.embedFont(name));
  doc = d;
}

export async function metricsFont(name: StandardFonts): Promise<PDFFont> {
  await loadMetrics();
  let f = fonts.get(name);
  if (!f) {
    f = await doc!.embedFont(name);
    fonts.set(name, f);
  }
  return f;
}

/** Characters the standard PDF fonts can't write (Arabic, some symbols) become "?". */
export function safeText(font: PDFFont, s: string): { text: string; replaced: boolean } {
  let replaced = false;
  let out = "";
  for (const ch of s) {
    if (ch === "\n") {
      out += ch;
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
      replaced = true;
    }
  }
  return { text: out, replaced };
}

/** Width of text in points (falls back to an estimate before the fonts are loaded). */
export function measure(text: string, size: number, bold = false): number {
  const f = fonts.get(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  if (!f) return text.length * size * 0.55;
  try {
    return f.widthOfTextAtSize(text, size);
  } catch {
    return f.widthOfTextAtSize(safeText(f, text).text, size);
  }
}

/** Break text into lines that fit `width` points. Words longer than a line are broken up. */
export function wrap(text: string, size: number, bold: boolean, width: number, m: (t: string, s: number, b: boolean) => number = measure): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = "";
    for (const w of words) {
      const next = line + w;
      if (!line || m(next.trimEnd(), size, bold) <= width) {
        line = next;
        continue;
      }
      lines.push(line.trimEnd());
      line = /^\s+$/.test(w) ? "" : w;
      // A single long word: split it.
      while (line && m(line, size, bold) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && m(line.slice(0, cut), size, bold) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export const LINE = 1.22;
export const textPad = (note: boolean) => (note ? 6 : 2);

/** Height a text box needs for its lines. */
export function textHeight(lines: number, size: number, note: boolean): number {
  return Math.max(1, lines) * size * LINE + textPad(note) * 2;
}

/** Riyadh date, "23 Oct 2026". */
export function todayLabel(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", day: "numeric", month: "short", year: "numeric" }).format(new Date());
}

export const STAMP = { label: 15, sub: 7.5, padX: 10, padY: 6, gap: 3 };

export function stampSize(label: string, sub: string): [number, number] {
  const w = Math.max(measure(label, STAMP.label, true), measure(sub, STAMP.sub, false)) + STAMP.padX * 2;
  const h = STAMP.label * 0.95 + STAMP.sub + STAMP.gap + STAMP.padY * 2;
  return [w, h];
}
