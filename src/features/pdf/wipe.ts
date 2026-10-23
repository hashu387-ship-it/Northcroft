// Wiping retyped text out of a page for good.
//
// The page's drawing instructions (its content stream) are read the way a PDF viewer reads them:
// every text instruction is followed with the current position, font, size and spacing, so the
// app knows where each letter lands on the page. Letters that fall inside a run the person retyped
// are taken out of the instruction, and replaced by an equal gap so everything after them stays
// exactly where it was. Nothing else in the page is touched (the rest of the bytes are copied as
// they are).
//
// When a run can't be wiped safely (the text sits inside a separate drawing object, the font's
// letter widths are unknown, or the text is an invisible layer over a scan), it's left alone here
// and the caller covers it instead.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  decodePDFRawStream,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { IDENTITY, apply, mul, type Mat } from "./geom";
import type { Pt } from "./model";

/* ---------------------------------------------------------------- reading the instructions */
type Val = number | boolean | null | { name: string } | { bytes: Uint8Array } | Val[] | { dict: Map<string, Val> };

export interface Op {
  op: string;
  args: Val[];
  /** Byte range of the whole instruction (its operands and the operator). */
  s: number;
  e: number;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

class Lexer {
  pos = 0;
  constructor(private b: Uint8Array) {}

  skip() {
    const b = this.b;
    for (;;) {
      while (this.pos < b.length && WS.has(b[this.pos])) this.pos++;
      if (b[this.pos] === 37) {
        while (this.pos < b.length && b[this.pos] !== 10 && b[this.pos] !== 13) this.pos++;
        continue;
      }
      return;
    }
  }

  /** The next value or operator keyword; undefined at the end. */
  next(): Val | { kw: string } | undefined {
    this.skip();
    const b = this.b;
    if (this.pos >= b.length) return undefined;
    const c = b[this.pos];
    if (c === 40) return { bytes: this.literal() };
    if (c === 60) {
      if (b[this.pos + 1] === 60) {
        this.pos += 2;
        return this.dict();
      }
      return { bytes: this.hex() };
    }
    if (c === 91) {
      this.pos++;
      const arr: Val[] = [];
      for (;;) {
        this.skip();
        if (b[this.pos] === 93) {
          this.pos++;
          return arr;
        }
        if (this.pos >= b.length) return arr;
        const v = this.next();
        if (v === undefined) return arr;
        if (v && typeof v === "object" && "kw" in v) arr.push(null);
        else arr.push(v as Val);
      }
    }
    if (c === 47) {
      this.pos++;
      let name = "";
      while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) {
        if (b[this.pos] === 35 && this.pos + 2 < b.length) {
          name += String.fromCharCode(parseInt(String.fromCharCode(b[this.pos + 1], b[this.pos + 2]), 16));
          this.pos += 3;
        } else name += String.fromCharCode(b[this.pos++]);
      }
      return { name };
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) {
      // Stray delimiter: skip it.
      this.pos++;
      return this.next();
    }
    let word = "";
    while (this.pos < b.length && !WS.has(b[this.pos]) && !DELIM.has(b[this.pos])) word += String.fromCharCode(b[this.pos++]);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (/^[+-]?\d*\.?\d*$/.test(word) && word.replace(/[+-.]/g, "") === "") return 0;
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return { kw: word };
  }

  private dict(): Val {
    const map = new Map<string, Val>();
    const b = this.b;
    for (;;) {
      this.skip();
      if (this.pos >= b.length) break;
      if (b[this.pos] === 62 && b[this.pos + 1] === 62) {
        this.pos += 2;
        break;
      }
      const k = this.next();
      const v = this.next();
      if (k && typeof k === "object" && "name" in k) map.set(k.name, v && typeof v === "object" && "kw" in v ? null : (v as Val));
    }
    return { dict: map };
  }

  private literal(): Uint8Array {
    const b = this.b;
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < b.length) {
      const c = b[this.pos++];
      if (c === 92) {
        const d = b[this.pos++];
        if (d === 110) out.push(10);
        else if (d === 114) out.push(13);
        else if (d === 116) out.push(9);
        else if (d === 98) out.push(8);
        else if (d === 102) out.push(12);
        else if (d === 13) {
          if (b[this.pos] === 10) this.pos++;
        } else if (d === 10) {
          /* line continuation */
        } else if (d >= 48 && d <= 55) {
          let v = d - 48;
          for (let k = 0; k < 2 && b[this.pos] >= 48 && b[this.pos] <= 55; k++) v = v * 8 + (b[this.pos++] - 48);
          out.push(v & 255);
        } else out.push(d);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return new Uint8Array(out);
  }

  private hex(): Uint8Array {
    const b = this.b;
    this.pos++;
    let digits = "";
    while (this.pos < b.length && b[this.pos] !== 62) {
      const ch = String.fromCharCode(b[this.pos++]);
      if (/[0-9a-fA-F]/.test(ch)) digits += ch;
    }
    this.pos++;
    if (digits.length % 2) digits += "0";
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    return out;
  }

  /** After "ID": skip the raw picture bytes up to the closing "EI". */
  skipInlineImage() {
    const b = this.b;
    this.pos++; // the single space after ID
    for (let i = this.pos; i < b.length - 1; i++) {
      if (b[i] === 69 && b[i + 1] === 73 && WS.has(b[i - 1]) && (i + 2 >= b.length || WS.has(b[i + 2]) || DELIM.has(b[i + 2]))) {
        this.pos = i + 2;
        return;
      }
    }
    this.pos = b.length;
  }
}

export function parseContent(bytes: Uint8Array): Op[] {
  const lx = new Lexer(bytes);
  const ops: Op[] = [];
  let args: Val[] = [];
  let start = -1;
  for (;;) {
    lx.skip();
    const at = lx.pos;
    const v = lx.next();
    if (v === undefined) break;
    if (start < 0) start = at;
    if (v && typeof v === "object" && "kw" in v) {
      if (v.kw === "BI") {
        // Inline picture: its settings run to "ID", then raw bytes to "EI".
        for (;;) {
          const w = lx.next();
          if (w === undefined || (w && typeof w === "object" && "kw" in w && w.kw === "ID")) break;
        }
        lx.skipInlineImage();
        ops.push({ op: "BI", args: [], s: start, e: lx.pos });
      } else {
        ops.push({ op: v.kw, args, s: start, e: lx.pos });
      }
      args = [];
      start = -1;
    } else {
      args.push(v as Val);
    }
  }
  return ops;
}

/* ---------------------------------------------------------------- fonts */
interface FontWidths {
  /** Bytes per character code. */
  bytes: 1 | 2;
  /** Width of a code in thousandths of the font size, or undefined if unknown. */
  width: (code: number) => number | undefined;
}

const STANDARD: Record<string, StandardFonts> = {
  Helvetica: StandardFonts.Helvetica,
  "Helvetica-Bold": StandardFonts.HelveticaBold,
  "Helvetica-Oblique": StandardFonts.HelveticaOblique,
  "Helvetica-BoldOblique": StandardFonts.HelveticaBoldOblique,
  "Times-Roman": StandardFonts.TimesRoman,
  "Times-Bold": StandardFonts.TimesRomanBold,
  "Times-Italic": StandardFonts.TimesRomanItalic,
  "Times-BoldItalic": StandardFonts.TimesRomanBoldItalic,
  Courier: StandardFonts.Courier,
  "Courier-Bold": StandardFonts.CourierBold,
  "Courier-Oblique": StandardFonts.CourierOblique,
  "Courier-BoldOblique": StandardFonts.CourierBoldOblique,
  Arial: StandardFonts.Helvetica,
  ArialMT: StandardFonts.Helvetica,
  "Arial-BoldMT": StandardFonts.HelveticaBold,
  "Arial,Bold": StandardFonts.HelveticaBold,
};

let metricsDoc: Promise<PDFDocument> | null = null;
const metricsFonts = new Map<string, Promise<PDFFont>>();
function standardFont(name: StandardFonts): Promise<PDFFont> {
  metricsDoc ??= PDFDocument.create();
  let f = metricsFonts.get(name);
  if (!f) {
    f = metricsDoc.then((d) => d.embedFont(name));
    metricsFonts.set(name, f);
  }
  return f;
}

const num = (v: unknown): number | undefined => (v instanceof PDFNumber ? v.asNumber() : undefined);

async function fontWidths(doc: PDFDocument, fontDict: PDFDict): Promise<FontWidths | null> {
  const ctx = doc.context;
  const subtype = fontDict.lookup(PDFName.of("Subtype"));
  const st = subtype instanceof PDFName ? subtype.decodeText() : "";
  if (st === "Type0") {
    const enc = fontDict.lookup(PDFName.of("Encoding"));
    if (!(enc instanceof PDFName) || enc.decodeText() !== "Identity-H") return null;
    const desc = fontDict.lookup(PDFName.of("DescendantFonts"));
    const cid = desc instanceof PDFArray ? desc.lookup(0) : undefined;
    if (!(cid instanceof PDFDict)) return null;
    const dw = num(cid.lookup(PDFName.of("DW"))) ?? 1000;
    const map = new Map<number, number>();
    const w = cid.lookup(PDFName.of("W"));
    if (w instanceof PDFArray) {
      const items = w.asArray().map((x) => ctx.lookup(x));
      for (let i = 0; i < items.length; ) {
        const first = num(items[i]);
        const next = items[i + 1];
        if (first === undefined) break;
        if (next instanceof PDFArray) {
          next.asArray().forEach((x, k) => {
            const v = num(ctx.lookup(x));
            if (v !== undefined) map.set(first + k, v);
          });
          i += 2;
        } else {
          const last = num(next);
          const v = num(items[i + 2]);
          if (last === undefined || v === undefined) break;
          for (let c = first; c <= last && c - first < 65536; c++) map.set(c, v);
          i += 3;
        }
      }
    }
    return { bytes: 2, width: (code) => map.get(code) ?? dw };
  }
  if (st === "Type3") return null;
  const widths = fontDict.lookup(PDFName.of("Widths"));
  if (widths instanceof PDFArray) {
    const first = num(fontDict.lookup(PDFName.of("FirstChar"))) ?? 0;
    const values = widths.asArray().map((x) => num(ctx.lookup(x)));
    const descriptor = fontDict.lookup(PDFName.of("FontDescriptor"));
    const missing = descriptor instanceof PDFDict ? num(descriptor.lookup(PDFName.of("MissingWidth"))) ?? 0 : 0;
    return { bytes: 1, width: (code) => values[code - first] ?? missing };
  }
  // One of the 14 standard fonts, without widths in the file: use the standard metrics.
  const base = fontDict.lookup(PDFName.of("BaseFont"));
  const baseName = base instanceof PDFName ? base.decodeText().replace(/^[A-Z]{6}\+/, "") : "";
  const std = STANDARD[baseName];
  const enc = fontDict.lookup(PDFName.of("Encoding"));
  const simpleEnc = enc === undefined || (enc instanceof PDFName && ["WinAnsiEncoding", "StandardEncoding"].includes(enc.decodeText()));
  if (!std || !simpleEnc) return null;
  const font = await standardFont(std);
  const cache = new Map<number, number | undefined>();
  return {
    bytes: 1,
    width: (code) => {
      if (cache.has(code)) return cache.get(code);
      let w: number | undefined;
      if ((code >= 32 && code <= 126) || code >= 160) {
        try {
          w = font.widthOfTextAtSize(String.fromCharCode(code), 1000);
        } catch {
          w = undefined;
        }
      }
      cache.set(code, w);
      return w;
    },
  };
}

/* ---------------------------------------------------------------- the page's bytes */
export function contentBytes(doc: PDFDocument, page: PDFPage): Uint8Array | null {
  const contents = page.node.Contents();
  if (!contents) return new Uint8Array();
  const streams: PDFStream[] = [];
  if (contents instanceof PDFArray) {
    for (const x of contents.asArray()) {
      const s = doc.context.lookup(x);
      if (s instanceof PDFStream) streams.push(s);
    }
  } else if (contents instanceof PDFStream) streams.push(contents);
  const parts: Uint8Array[] = [];
  for (const s of streams) {
    if (s instanceof PDFRawStream) parts.push(decodePDFRawStream(s).decode());
    else {
      const anyS = s as unknown as { getUnencodedContents?: () => Uint8Array };
      if (!anyS.getUnencodedContents) return null;
      parts.push(anyS.getUnencodedContents());
    }
  }
  let size = 0;
  for (const p of parts) size += p.length + 1;
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
    out[at++] = 10;
  }
  return out;
}

/* ---------------------------------------------------------------- wiping */
/** A run to wipe: the text matrix of its first letter (page coordinates), and its width. */
export interface Run {
  id: string;
  m: Mat;
  width: number;
  ascent: number;
  descent: number;
}

interface Glyph {
  op: number;
  /** Which string in the instruction (0 for Tj, the array position for TJ). */
  part: number;
  /** Byte offset of the code inside that string. */
  at: number;
  len: number;
  /** Sideways movement this letter causes along the line, in text space units. */
  advance: number;
  /** Font size times horizontal scaling: a TJ gap of n moves -n/1000 times this. */
  scale: number;
  mid: Pt;
  invisible: boolean;
}

function inRun(run: Run, p: Pt): boolean {
  const [a, b, c, d, e, f] = run.m;
  const lx = Math.hypot(a, b) || 1;
  const ly = Math.hypot(c, d) || 1;
  const dx = p[0] - e;
  const dy = p[1] - f;
  const u = (dx * a + dy * b) / lx;
  const v = (dx * c + dy * d) / ly;
  const tolU = Math.min(1.2, ly * 0.12);
  return u >= -tolU && u <= run.width + tolU && v >= Math.min(run.descent, -0.3) * ly - 1 && v <= Math.max(run.ascent, 0.75) * ly + 1;
}

const fmtNum = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : r.toString();
};
const hexOf = (b: Uint8Array) => `<${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}>`;

export interface WipeResult {
  /** Runs whose letters were all found and taken out. */
  wiped: Set<string>;
  /** Runs that should also be covered (for example invisible text over a scan). */
  cover: Set<string>;
}

/**
 * Take the letters of `runs` out of the page. Returns which runs were wiped; any run not in
 * `wiped` should be covered by the caller.
 */
export async function wipeRuns(doc: PDFDocument, page: PDFPage, runs: Run[]): Promise<WipeResult> {
  const result: WipeResult = { wiped: new Set(), cover: new Set() };
  if (!runs.length) return result;
  const bytes = contentBytes(doc, page);
  if (!bytes) return result;
  const ops = parseContent(bytes);

  const resources = page.node.Resources();
  const fontRes = resources?.lookup(PDFName.of("Font"));
  const fontCache = new Map<string, FontWidths | null>();
  async function font(name: string | null): Promise<FontWidths | null> {
    if (!name) return null;
    if (fontCache.has(name)) return fontCache.get(name)!;
    let fw: FontWidths | null = null;
    if (fontRes instanceof PDFDict) {
      const fd = fontRes.lookup(PDFName.of(name));
      if (fd instanceof PDFDict) fw = await fontWidths(doc, fd);
    }
    fontCache.set(name, fw);
    return fw;
  }

  // Follow the drawing state through every instruction.
  type GS = { ctm: Mat; font: string | null; size: number; tc: number; tw: number; th: number; tl: number; rise: number; tr: number };
  let gs: GS = { ctm: IDENTITY, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, tr: 0 };
  const stack: GS[] = [];
  let tm: Mat = IDENTITY;
  let tlm: Mat = IDENTITY;
  let known = true; // false after text in an unknown font, until the next line or text position
  const glyphs: Glyph[] = [];

  const moveLine = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
    known = true;
  };

  async function show(opIndex: number, part: number, str: Uint8Array) {
    const fw = await font(gs.font);
    if (!fw || !gs.size || !gs.th) {
      known = false;
      return;
    }
    const step = fw.bytes;
    for (let i = 0; i + step <= str.length; i += step) {
      const code = step === 2 ? (str[i] << 8) | str[i + 1] : str[i];
      const w = fw.width(code);
      if (w === undefined) {
        known = false;
        return;
      }
      const tx = (w / 1000) * gs.size + gs.tc + (step === 1 && code === 32 ? gs.tw : 0);
      const trm = mul([gs.size * gs.th, 0, 0, gs.size, 0, gs.rise], mul(tm, gs.ctm));
      const start: Pt = [trm[4], trm[5]];
      tm = mul([1, 0, 0, 1, tx * gs.th, 0], tm);
      const trm2 = mul([gs.size * gs.th, 0, 0, gs.size, 0, gs.rise], mul(tm, gs.ctm));
      if (known) {
        glyphs.push({
          op: opIndex,
          part,
          at: i,
          len: step,
          advance: tx * gs.th,
          scale: gs.size * gs.th,
          mid: [(start[0] + trm2[4]) / 2, (start[1] + trm2[5]) / 2],
          invisible: gs.tr === 3 || gs.tr === 7,
        });
      }
    }
  }

  const n = (v: Val | undefined) => (typeof v === "number" ? v : 0);
  for (let k = 0; k < ops.length; k++) {
    const { op, args } = ops[k];
    switch (op) {
      case "q":
        stack.push({ ...gs });
        break;
      case "Q":
        if (stack.length) gs = stack.pop()!;
        break;
      case "cm":
        gs.ctm = mul(args.map(n) as Mat, gs.ctm);
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        known = true;
        break;
      case "Tf": {
        const f = args[0];
        gs.font = f && typeof f === "object" && "name" in f ? f.name : null;
        gs.size = n(args[1]);
        break;
      }
      case "Tc":
        gs.tc = n(args[0]);
        break;
      case "Tw":
        gs.tw = n(args[0]);
        break;
      case "Tz":
        gs.th = n(args[0]) / 100;
        break;
      case "TL":
        gs.tl = n(args[0]);
        break;
      case "Ts":
        gs.rise = n(args[0]);
        break;
      case "Tr":
        gs.tr = n(args[0]);
        break;
      case "Td":
        moveLine(n(args[0]), n(args[1]));
        break;
      case "TD":
        gs.tl = -n(args[1]);
        moveLine(n(args[0]), n(args[1]));
        break;
      case "Tm":
        tlm = args.map(n) as Mat;
        tm = tlm;
        known = true;
        break;
      case "T*":
        moveLine(0, -gs.tl);
        break;
      case "Tj":
      case "'":
      case '"': {
        if (op === '"') {
          gs.tw = n(args[0]);
          gs.tc = n(args[1]);
        }
        if (op !== "Tj") moveLine(0, -gs.tl);
        const s = args[args.length - 1];
        if (s && typeof s === "object" && "bytes" in s) await show(k, 0, s.bytes);
        break;
      }
      case "TJ": {
        const arr = args[0];
        if (!Array.isArray(arr)) break;
        for (let p = 0; p < arr.length; p++) {
          const el = arr[p];
          if (typeof el === "number") tm = mul([1, 0, 0, 1, (-el / 1000) * gs.size * gs.th, 0], tm);
          else if (el && typeof el === "object" && "bytes" in el) await show(k, p, el.bytes);
        }
        break;
      }
    }
  }

  // Which letters go.
  const remove = new Set<Glyph>();
  const found = new Map<string, number>();
  for (const g of glyphs) {
    for (const r of runs) {
      if (inRun(r, g.mid)) {
        remove.add(g);
        found.set(r.id, (found.get(r.id) ?? 0) + 1);
        if (g.invisible) result.cover.add(r.id);
        break;
      }
    }
  }
  if (!remove.size) return result;

  // Rewrite each touched instruction as a TJ that keeps the other letters exactly where they were.
  const byOp = new Map<number, Glyph[]>();
  for (const g of remove) byOp.set(g.op, [...(byOp.get(g.op) ?? []), g]);
  const edits: { s: number; e: number; text: string }[] = [];
  for (const [k, gone] of byOp) {
    const o = ops[k];
    const parts: (Uint8Array | number)[] =
      o.op === "TJ" && Array.isArray(o.args[0])
        ? (o.args[0] as Val[]).map((el) => (typeof el === "number" ? el : el && typeof el === "object" && "bytes" in el ? el.bytes : 0))
        : [((o.args[o.args.length - 1] as { bytes: Uint8Array }) ?? { bytes: new Uint8Array() }).bytes];
    const all = glyphs.filter((g) => g.op === k);
    const scale = all[0]?.scale;
    if (!scale) continue;
    const out: string[] = [];
    let gap = 0;
    const flushGap = () => {
      if (Math.abs(gap) > 1e-9) out.push(fmtNum((-gap / scale) * 1000));
      gap = 0;
    };
    parts.forEach((part, p) => {
      if (typeof part === "number") {
        flushGap();
        out.push(fmtNum(part));
        return;
      }
      const letters = all.filter((g) => g.part === p);
      let keep: number[] = [];
      const flushKeep = () => {
        if (keep.length) out.push(hexOf(new Uint8Array(keep)));
        keep = [];
      };
      let at = 0;
      for (const g of letters) {
        if (g.at > at) {
          // Bytes we couldn't place (shouldn't happen): keep them.
          flushGap();
          keep.push(...part.slice(at, g.at));
        }
        if (gone.includes(g)) {
          flushKeep();
          gap += g.advance;
        } else {
          flushGap();
          keep.push(...part.slice(g.at, g.at + g.len));
        }
        at = g.at + g.len;
      }
      if (at < part.length) {
        flushGap();
        keep.push(...part.slice(at));
      }
      flushKeep();
    });
    flushGap();
    let prefix = "";
    if (o.op === "'") prefix = "T* ";
    if (o.op === '"') prefix = `${fmtNum(n(o.args[0]))} Tw ${fmtNum(n(o.args[1]))} Tc T* `;
    edits.push({ s: o.s, e: o.e, text: ` ${prefix}[${out.join(" ")}] TJ\n` });
  }

  // Splice the new instructions into the original bytes.
  edits.sort((x, y) => x.s - y.s);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let at = 0;
  for (const e of edits) {
    chunks.push(bytes.subarray(at, e.s), enc.encode(e.text));
    at = e.e;
  }
  chunks.push(bytes.subarray(at));
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    merged.set(c, pos);
    pos += c.length;
  }
  const stream = doc.context.flateStream(merged);
  const ref: PDFRef = doc.context.register(stream);
  page.node.set(PDFName.of("Contents"), ref);

  for (const r of runs) if (found.get(r.id)) result.wiped.add(r.id);
  return result;
}

export const _test = { inRun, apply };
