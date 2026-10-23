// Builds the edited PDF with pdf-lib. The original file is never changed: this makes a new copy.
//
// 1. Page order, rotation, blank pages and pages joined from other PDFs.
// 2. Retyped text: the old words are wiped out of the page (see wipe.ts), then the copy is read
//    back to make sure they're really gone. Anything that couldn't be wiped is covered instead.
// 3. Mark-ups, measurements, stamps, signatures, pictures and the new words are drawn in.
// 4. Form fields are filled in and stay fillable.
import {
  LineCapStyle,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import {
  apply,
  arrowHead,
  arrowShaftEnd,
  boxPoint,
  centroid,
  cloud,
  ellipse,
  hexToRgb,
  makeView,
  measureLabel,
  pathD,
  polyline,
  rect,
  screenRightAngle,
  smooth,
  type Seg,
} from "./geom";
import type { DocState, MeasureObj, Obj, Pt, Slot, TextEdit } from "./model";
import { closePdf, openPdf } from "./pdfjs";
import { LINE, STAMP, safeText, standardFontName, textPad, wrap } from "./text";
import { wipeRuns, type Run } from "./wipe";

export interface BuildInput {
  main: ArrayBuffer;
  /** PDFs joined in, by key. */
  extra: Record<string, ArrayBuffer>;
  state: DocState;
}

export interface BuildResult {
  bytes: Uint8Array;
  /** Retyped runs wiped from the file. */
  wiped: number;
  /** Retyped runs that could only be covered. */
  covered: number;
  /** Characters the standard fonts can't write were replaced. */
  replacedChars: boolean;
}

export class LockedPdfError extends Error {}

const col = (hex: string) => rgb(...hexToRgb(hex));

function runOf(e: TextEdit): Run {
  return { id: e.id, m: e.run.m, width: e.run.width, ascent: e.run.ascent, descent: e.run.descent };
}

/** The run's outline on the page, a little larger than the letters. */
function runBox(e: TextEdit, grow = 0.8): Pt[] {
  const [a, b, c, d, x, y] = e.run.m;
  const lx = Math.hypot(a, b) || 1;
  const ly = Math.hypot(c, d) || 1;
  const ux: Pt = [a / lx, b / lx];
  const uy: Pt = [c / ly, d / ly];
  const at = (u: number, v: number): Pt => [x + ux[0] * u + uy[0] * v, y + ux[1] * u + uy[1] * v];
  const v0 = Math.min(e.run.descent, -0.22) * ly - grow;
  const v1 = Math.max(e.run.ascent, 0.78) * ly + grow;
  return [at(-grow, v0), at(e.run.width + grow, v0), at(e.run.width + grow, v1), at(-grow, v1)];
}

/** Text items still sitting inside each run, read back with pdf.js. */
async function stillThere(bytes: Uint8Array, checks: { page: number; edit: TextEdit }[]): Promise<Set<string>> {
  const left = new Set<string>();
  if (!checks.length) return left;
  const doc = await openPdf(bytes);
  try {
    const byPage = new Map<number, TextEdit[]>();
    for (const c of checks) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c.edit]);
    for (const [index, edits] of byPage) {
      const page = await doc.getPage(index + 1);
      const tc = await page.getTextContent();
      for (const item of tc.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [a, b, , , x, y] = item.transform as number[];
        const lx = Math.hypot(a, b) || 1;
        const n = Math.max(2, Math.min(12, item.str.length));
        for (const e of edits) {
          if (left.has(e.id)) continue;
          for (let k = 0; k < n; k++) {
            const u = ((k + 0.5) / n) * item.width;
            const p: Pt = [x + (a / lx) * u, y + (b / lx) * u];
            if (inside(e, p)) {
              left.add(e.id);
              break;
            }
          }
        }
      }
    }
  } finally {
    closePdf(doc);
  }
  return left;
}

function inside(e: TextEdit, p: Pt): boolean {
  const [a, b, c, d, x, y] = e.run.m;
  const lx = Math.hypot(a, b) || 1;
  const ly = Math.hypot(c, d) || 1;
  const u = ((p[0] - x) * a + (p[1] - y) * b) / lx;
  const v = ((p[0] - x) * c + (p[1] - y) * d) / ly;
  return u >= 0.5 && u <= e.run.width - 0.5 && v >= -0.4 * ly && v <= 0.9 * ly;
}

export async function buildPdf({ main, extra, state }: BuildInput): Promise<BuildResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(main, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String((e as Error)?.message ?? e))) {
      throw new LockedPdfError("This PDF is locked by whoever made it, so it can't be changed here. You can still view and download it.");
    }
    throw new Error("This PDF couldn't be read for saving. It may be damaged.");
  }
  const original = doc.getPages();

  // ---- 1. pages
  const extraDocs = new Map<string, PDFDocument>();
  for (const s of state.slots) {
    if (s.doc !== "main" && s.index >= 0 && !extraDocs.has(s.doc)) {
      const bytes = extra[s.doc];
      if (!bytes) throw new Error("A joined PDF is missing. Remove its pages and add it again.");
      extraDocs.set(s.doc, await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }));
    }
  }
  const copied = new Map<string, PDFPage>();
  for (const [key, src] of extraDocs) {
    const wanted = [...new Set(state.slots.filter((s) => s.doc === key).map((s) => s.index))];
    const pages = await doc.copyPages(src, wanted);
    wanted.forEach((idx, i) => copied.set(`${key}:${idx}`, pages[i]));
  }
  const pageFor = new Map<string, PDFPage>();
  for (const s of state.slots) {
    if (s.index < 0) {
      const size = s.size ?? [595.28, 841.89];
      const p = doc.addPage(size);
      pageFor.set(s.id, p);
    } else if (s.doc === "main") pageFor.set(s.id, original[s.index]);
    else pageFor.set(s.id, copied.get(`${s.doc}:${s.index}`)!);
  }
  const baseRotation = new Map<string, number>();
  for (const s of state.slots) baseRotation.set(s.id, s.index < 0 ? 0 : pageFor.get(s.id)!.getRotation().angle);

  // ---- 2. wipe retyped text
  const editsBySlot = new Map<string, TextEdit[]>();
  for (const e of state.edits) {
    if (!pageFor.has(e.slot) || e.text === e.run.str) continue;
    editsBySlot.set(e.slot, [...(editsBySlot.get(e.slot) ?? []), e]);
  }
  const cover = new Set<string>();
  for (const [slotId, edits] of editsBySlot) {
    try {
      const r = await wipeRuns(doc, pageFor.get(slotId)!, edits.map(runOf));
      for (const e of edits) if (!r.wiped.has(e.id) || r.cover.has(e.id)) cover.add(e.id);
    } catch {
      for (const e of edits) cover.add(e.id);
    }
  }

  // Final page order and rotation.
  for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
  state.slots.forEach((s, i) => {
    const p = pageFor.get(s.id)!;
    doc.insertPage(i, p);
    p.setRotation(degrees((((baseRotation.get(s.id) ?? 0) + s.rotate) % 360 + 360) % 360));
  });

  // Read the copy back: any retyped words still there get covered.
  if (editsBySlot.size) {
    const checks: { page: number; edit: TextEdit }[] = [];
    state.slots.forEach((s, i) => {
      for (const e of editsBySlot.get(s.id) ?? []) if (!cover.has(e.id)) checks.push({ page: i, edit: e });
    });
    if (checks.length) {
      const interim = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
      const left = await stillThere(interim, checks);
      for (const id of left) cover.add(id);
    }
  }

  // ---- 3. draw
  const fontCache = new Map<string, PDFFont>();
  const font = async (name: StandardFonts) => {
    let f = fontCache.get(name);
    if (!f) {
      f = await doc.embedFont(name);
      fontCache.set(name, f);
    }
    return f;
  };
  const imageCache = new Map<string, PDFImage>();
  const image = async (src: string) => {
    let img = imageCache.get(src);
    if (!img) {
      const bytes = Uint8Array.from(atob(src.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
      img = /^data:image\/jpe?g/i.test(src) ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      imageCache.set(src, img);
    }
    return img;
  };
  let replacedChars = false;
  const write = async (page: PDFPage, text: string, at: Pt, size: number, color: string | [number, number, number], angle: number, fname: StandardFonts) => {
    const f = await font(fname);
    const safe = safeText(f, text);
    if (safe.replaced) replacedChars = true;
    page.drawText(safe.text, {
      x: at[0],
      y: at[1],
      size,
      font: f,
      color: typeof color === "string" ? col(color) : rgb(...color),
      rotate: degrees((angle * 180) / Math.PI),
    });
  };

  for (const s of state.slots) {
    const page = pageFor.get(s.id)!;
    const totalRotation = (((baseRotation.get(s.id) ?? 0) + s.rotate) % 360 + 360) % 360;
    const upright = screenRightAngle(makeView([0, 0, 1, 1], 1, totalRotation));

    // Retyped text: cover where needed, then the new words.
    for (const e of editsBySlot.get(s.id) ?? []) {
      if (cover.has(e.id)) {
        page.drawSvgPath(pathD(polyline(runBox(e), true), true), { x: 0, y: 0, color: rgb(...e.bg), borderWidth: 0 });
      }
      if (e.text.trim()) {
        const [a, b, c, d, x, y] = e.run.m;
        const size = Math.hypot(c, d) || 10;
        await write(page, e.text, [x, y], size, e.color, Math.atan2(b, a), standardFontName(e.family, e.bold, e.italic));
      }
    }

    // Measurement labels go on top of every mark, so no line runs through them.
    const labels: (() => Promise<void>)[] = [];
    const kit: DrawKit = { write, image, font, upright, mpp: state.scales[s.id], later: (f) => labels.push(f) };
    for (const o of state.objects[s.id] ?? []) await drawObj(page, o, kit);
    for (const f of labels) await f();
  }

  // ---- 4. forms
  const names = Object.keys(state.forms);
  if (names.length) {
    let form;
    try {
      form = doc.getForm();
    } catch {
      form = null;
    }
    for (const name of names) {
      if (!form) break;
      const v = state.forms[name];
      try {
        const field = form.getField(name);
        if (field instanceof PDFTextField) field.setText(typeof v === "string" ? v : "");
        else if (field instanceof PDFCheckBox) (v === true ? field.check() : field.uncheck());
        else if (field instanceof PDFRadioGroup) {
          if (typeof v === "string" && v && field.getOptions().includes(v)) field.select(v);
          else if (!v) field.clear();
        } else if (field instanceof PDFDropdown) {
          if (typeof v === "string" && v) field.select(v);
          else field.clear();
        } else if (field instanceof PDFOptionList) {
          const list = Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
          if (list.length) field.select(list);
          else field.clear();
        }
      } catch {
        /* a field pdf-lib can't change is left as it was */
      }
    }
  }

  const bytes = await doc.save({ updateFieldAppearances: true });
  const editsCount = [...editsBySlot.values()].reduce((n, l) => n + l.length, 0);
  return { bytes, wiped: editsCount - cover.size, covered: cover.size, replacedChars };
}

/* ---------------------------------------------------------------- drawing one object */
interface DrawKit {
  write: (page: PDFPage, text: string, at: Pt, size: number, color: string, angle: number, f: StandardFonts) => Promise<void>;
  image: (src: string) => Promise<PDFImage>;
  font: (name: StandardFonts) => Promise<PDFFont>;
  /** The direction that reads left to right on screen for this page. */
  upright: number;
  mpp?: number;
  /** Draw this after every mark on the page. */
  later: (f: () => Promise<void>) => void;
}

function path(page: PDFPage, segs: Seg[], opts: { stroke?: string; width?: number; fill?: string; opacity?: number; fillOpacity?: number }) {
  page.drawSvgPath(pathD(segs, true), {
    x: 0,
    y: 0,
    borderColor: opts.stroke ? col(opts.stroke) : undefined,
    borderWidth: opts.stroke ? opts.width ?? 1 : 0,
    borderOpacity: opts.opacity,
    borderLineCap: LineCapStyle.Round,
    color: opts.fill ? col(opts.fill) : undefined,
    opacity: opts.fillOpacity ?? opts.opacity,
  });
}

async function drawObj(page: PDFPage, o: Obj, kit: DrawKit) {
  switch (o.type) {
    case "ink":
      path(page, smooth(o.points), { stroke: o.color, width: o.width, opacity: o.tool === "highlighter" ? 0.38 : 1 });
      return;
    case "line": {
      const end = o.arrow ? arrowShaftEnd(o.a, o.b, o.width) : o.b;
      path(page, polyline([o.a, end]), { stroke: o.color, width: o.width });
      if (o.arrow) path(page, polyline(arrowHead(o.a, o.b, o.width), true), { fill: o.color });
      return;
    }
    case "shape": {
      const segs = o.shape === "rect" ? rect(o.a, o.b) : o.shape === "ellipse" ? ellipse(o.a, o.b) : cloud(o.a, o.b);
      path(page, segs, { stroke: o.color, width: o.width });
      return;
    }
    case "text": {
      const pad = textPad(o.note);
      if (o.note) {
        const corners = [boxPoint(o, 0, 0), boxPoint(o, o.w, 0), boxPoint(o, o.w, o.h), boxPoint(o, 0, o.h)];
        path(page, polyline(corners, true), { fill: "#fff1a8", stroke: "#e2b714", width: 0.8 });
      }
      const fname = o.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
      const f = await kit.font(fname);
      const lines = wrap(o.text, o.size, o.bold, Math.max(4, o.w - pad * 2), (t, s) => f.widthOfTextAtSize(safeText(f, t).text, s));
      const ascent = f.heightAtSize(o.size, { descender: false });
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i]) continue;
        const at = boxPoint(o, pad, pad + ascent + i * o.size * LINE);
        await kit.write(page, lines[i], at, o.size, o.color, o.angle, fname);
      }
      return;
    }
    case "image": {
      const img = await kit.image(o.src);
      const at = boxPoint(o, 0, o.h);
      page.drawImage(img, { x: at[0], y: at[1], width: o.w, height: o.h, rotate: degrees((o.angle * 180) / Math.PI) });
      return;
    }
    case "stamp": {
      const r = 5;
      const local: Pt[] = [];
      // Rounded rectangle outline in the stamp's own frame.
      const corner = (cx: number, cy: number, start: number) => {
        for (let k = 0; k <= 6; k++) {
          const t = start + (k / 6) * (Math.PI / 2);
          local.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
        }
      };
      corner(o.w - r, r, -Math.PI / 2);
      corner(o.w - r, o.h - r, 0);
      corner(r, o.h - r, Math.PI / 2);
      corner(r, r, Math.PI);
      const pts = local.map(([x, y]) => boxPoint(o, x, y));
      path(page, polyline(pts, true), { stroke: o.color, width: 1.6, fill: "#ffffff", fillOpacity: 0.55 });
      const bold = await kit.font(StandardFonts.HelveticaBold);
      const reg = await kit.font(StandardFonts.Helvetica);
      const lw = bold.widthOfTextAtSize(safeText(bold, o.label).text, STAMP.label);
      const sw = reg.widthOfTextAtSize(safeText(reg, o.sub).text, STAMP.sub);
      const top = STAMP.padY + STAMP.label * 0.78;
      await kit.write(page, o.label, boxPoint(o, (o.w - lw) / 2, top), STAMP.label, o.color, o.angle, StandardFonts.HelveticaBold);
      await kit.write(page, o.sub, boxPoint(o, (o.w - sw) / 2, top + STAMP.gap + STAMP.sub + 1.5), STAMP.sub, o.color, o.angle, StandardFonts.Helvetica);
      return;
    }
    case "measure":
      await drawMeasure(page, o, kit);
      return;
  }
}

async function drawMeasure(page: PDFPage, o: MeasureObj, kit: DrawKit) {
  const pts = o.points;
  if (!pts.length) return;
  if (o.kind === "count") {
    const f = await kit.font(StandardFonts.HelveticaBold);
    for (let i = 0; i < pts.length; i++) {
      path(page, ellipse([pts[i][0] - 6, pts[i][1] - 6], [pts[i][0] + 6, pts[i][1] + 6]), { fill: o.color, stroke: "#ffffff", width: 0.8 });
      const label = String(i + 1);
      const w = f.widthOfTextAtSize(label, 7);
      const c = Math.cos(kit.upright);
      const s = Math.sin(kit.upright);
      // Centre the number in the dot, upright on screen.
      const at: Pt = [pts[i][0] - (w / 2) * c + 2.5 * s, pts[i][1] - (w / 2) * s - 2.5 * c];
      await kit.write(page, label, at, 7, "#ffffff", kit.upright, StandardFonts.HelveticaBold);
    }
    kit.later(() => label(page, `Count: ${pts.length}`, offsetUp(pts[0], kit.upright, 22, 14), o.color, kit));
    return;
  }
  const closed = o.kind === "area";
  path(page, polyline(pts, closed), { stroke: o.color, width: 1.4, fill: closed ? o.color : undefined, fillOpacity: closed ? 0.14 : undefined, opacity: 1 });
  for (const p of pts) path(page, ellipse([p[0] - 1.8, p[1] - 1.8], [p[0] + 1.8, p[1] + 1.8]), { fill: o.color });
  const text = measureLabel(o.kind, pts, kit.mpp);
  if (!text) return;
  const at = closed ? centroid(pts) : midOfLongest(pts);
  kit.later(() => label(page, text, at, o.color, kit));
}

/** A point moved right and up on screen by (dx, dy) points. */
function offsetUp(p: Pt, upright: number, dx: number, dy: number): Pt {
  const c = Math.cos(upright);
  const s = Math.sin(upright);
  return [p[0] + dx * c - dy * s, p[1] + dx * s + dy * c];
}

function midOfLongest(pts: Pt[]): Pt {
  let best = 0;
  let at: Pt = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d >= best) {
      best = d;
      at = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2];
    }
  }
  return at;
}

/** A measurement label: a white tag with coloured text, centred on `at`, upright on screen. */
async function label(page: PDFPage, text: string, at: Pt, color: string, kit: DrawKit) {
  const size = 9;
  const f = await kit.font(StandardFonts.HelveticaBold);
  const w = f.widthOfTextAtSize(safeText(f, text).text, size) + 8;
  const h = size + 6;
  const box = { id: "", o: [0, 0] as Pt, angle: kit.upright, w, h };
  const c = Math.cos(kit.upright);
  const s = Math.sin(kit.upright);
  // Top-left so that the tag is centred on `at` (local y goes down the screen).
  box.o = [at[0] - (w / 2) * c - (h / 2) * s, at[1] - (w / 2) * s + (h / 2) * c];
  const corners = [boxPoint(box, 0, 0), boxPoint(box, w, 0), boxPoint(box, w, h), boxPoint(box, 0, h)];
  path(page, polyline(corners, true), { fill: "#ffffff", stroke: color, width: 0.8, fillOpacity: 1, opacity: 1 });
  await kit.write(page, text, boxPoint(box, 4, 3 + size * 0.78), size, color, kit.upright, StandardFonts.HelveticaBold);
}

export const _internal = { runBox, apply };
export type { Slot };
