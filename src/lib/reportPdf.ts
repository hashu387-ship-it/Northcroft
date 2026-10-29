// The weekly update report as a PDF: an exact copy of the report page in the app, the same fonts,
// colours and layout, laid out like the printout (the team on the first page, then each person on
// their own page; a long part carries on to the next page between lines, never through one). Job
// titles are only shown in the app, so they're left out here. Each page is a sharp picture of the
// page, with "Prepared by Northcroft QS team" and the page number underneath.
import { REPORT_BRAND, REPORT_FONTS } from "./reportBrand";
import { dayLabel, type ReportKind } from "./weeklyUpdates";

// A4 in points, and the margins the printout uses (about 12 mm at the sides).
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const SIDE = 34;
const TOP = 34;
const BOTTOM = 46;
const CONTENT_W = PAGE_W - SIDE * 2;
const CONTENT_H = PAGE_H - TOP - BOTTOM;
/** The width the page copy is laid out at, in CSS pixels (as a printed A4 page). */
const LAYOUT_W = 720;
const PT_PER_PX = CONTENT_W / LAYOUT_W;
/** How tall a page is, in CSS pixels. */
const PAGE_PX = Math.floor(CONTENT_H / PT_PER_PX);

/** The report's fonts, put inside the copy so it draws with them (fetched once). */
let fontCss: Promise<string> | null = null;
function reportFontCss(): Promise<string> {
  if (!fontCss) {
    const faces: [string, string, number][] = [
      ["RP Heading", REPORT_FONTS.heading, 400],
      ["RP Body", REPORT_FONTS.regular, 400],
      ["RP Body", REPORT_FONTS.semibold, 600],
      ["RP Body", REPORT_FONTS.bold, 700],
    ];
    fontCss = Promise.all(
      faces.map(async ([family, url, weight]) => {
        const buf = await (await fetch(url)).arrayBuffer();
        let bin = "";
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${btoa(bin)}) format("truetype");font-weight:${weight};font-style:normal;}`;
      }),
    )
      .then((parts) => parts.join("\n"))
      .catch((e) => {
        fontCss = null;
        throw e;
      });
  }
  return fontCss;
}

/** Where a page can end: under a heading, a paragraph, a row of a table, a list item... */
const BREAKS =
  ".rp-head, .rp-rule, .rp-section-head, .rp-counts, .rp-lead, .rp-state, .rp-stats, .rp-label, .rp-projects > li, .rp-list > li, .rp-project > h3, .rp-project > p, .rp-tasks thead, .rp-tasks tbody tr, .rp-blockers > li, .rp-block > p, .rp-section > p, .rp-note";

const isSafari = () => typeof navigator !== "undefined" && /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

/** The report element split the way it prints: the first page, then one per person. */
function pageGroups(doc: HTMLElement): HTMLElement[][] {
  const head = [doc.querySelector(".rp-head"), doc.querySelector(".rp-rule")].filter(Boolean) as HTMLElement[];
  const body = [...doc.querySelectorAll<HTMLElement>(".rp-body > *")];
  const team = body.find((el) => el.classList.contains("rp-team"));
  if (!team) return [[...head, ...body]];
  const people = body.filter((el) => el.classList.contains("rp-person"));
  const rest = body.filter((el) => el !== team && !people.includes(el));
  return [[...head, team, ...rest], ...people.map((p) => [p])];
}

/** A page of the copy: the same report styles, laid out at A4 width, without job titles. */
function paperFor(doc: HTMLElement, parts: HTMLElement[]): HTMLElement {
  const paper = document.createElement("article");
  paper.className = `${doc.className} rp-paper`;
  paper.setAttribute("style", doc.getAttribute("style") ?? "");
  const body = document.createElement("div");
  body.className = "rp-body";
  for (const el of parts) {
    const copy = el.cloneNode(true) as HTMLElement;
    if (el.classList.contains("rp-head") || el.classList.contains("rp-rule")) paper.appendChild(copy);
    else body.appendChild(copy);
  }
  if (body.childNodes.length) paper.appendChild(body);
  return paper;
}

/** Where to cut a tall page: the lowest place between lines that still fits. */
function cutPoints(paper: HTMLElement, height: number): number[] {
  const top = paper.getBoundingClientRect().top;
  const ends = [...paper.querySelectorAll<HTMLElement>(BREAKS)].map((el) => Math.ceil(el.getBoundingClientRect().bottom - top) + 4).sort((a, b) => a - b);
  const cuts: number[] = [];
  let start = 0;
  while (height - start > PAGE_PX) {
    const limit = start + PAGE_PX;
    const fit = ends.filter((y) => y > start + 120 && y <= limit);
    const end = fit.length ? fit[fit.length - 1] : limit;
    cuts.push(end);
    start = end;
  }
  return cuts;
}

export async function buildReportPdf(doc: HTMLElement, title: string): Promise<Blob> {
  const [{ toCanvas }, { PDFDocument, rgb }, fontkitMod, css] = await Promise.all([
    import("html-to-image"),
    import("pdf-lib"),
    import("@pdf-lib/fontkit"),
    reportFontCss(),
  ]);
  await document.fonts?.ready;

  // The copy is laid out off screen, at A4 width.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${LAYOUT_W}px;pointer-events:none;z-index:-1;`;
  document.body.appendChild(host);

  const slices: { canvas: HTMLCanvasElement; y: number; h: number; scale: number }[] = [];
  try {
    let warmed = false;
    for (const parts of pageGroups(doc)) {
      const paper = paperFor(doc, parts);
      host.replaceChildren(paper);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const height = Math.ceil(paper.getBoundingClientRect().height);
      const cuts = cutPoints(paper, height);
      // Sharp enough to print (about 250 dpi), but within what a phone can draw in one go.
      const scale = Math.max(1.5, Math.min(2.6, Math.sqrt(15e6 / (LAYOUT_W * Math.max(height, 1)))));
      const opts = { pixelRatio: scale, backgroundColor: "#ffffff", fontEmbedCSS: css, width: LAYOUT_W, height, cacheBust: false };
      // Safari sometimes leaves out fonts and pictures the first time; the second time is right.
      if (isSafari() && !warmed) {
        await toCanvas(paper, opts).catch(() => null);
        warmed = true;
      }
      const canvas = await toCanvas(paper, opts);
      let y = 0;
      for (const end of [...cuts, height]) {
        slices.push({ canvas, y, h: end - y, scale });
        y = end;
      }
    }
  } finally {
    host.remove();
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(((fontkitMod as unknown as { default: unknown }).default ?? fontkitMod) as Parameters<typeof pdf.registerFontkit>[0]);
  pdf.setTitle(title);
  pdf.setAuthor("");
  pdf.setCreator("");
  pdf.setProducer("");
  const font = await pdf.embedFont(new Uint8Array(await (await fetch(REPORT_FONTS.regular)).arrayBuffer()), { subset: true });
  const muted = (() => {
    const n = parseInt(REPORT_BRAND.muted.replace("#", ""), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  })();

  for (const [i, s] of slices.entries()) {
    // Cut this page out of the drawing.
    const part = document.createElement("canvas");
    part.width = Math.round(LAYOUT_W * s.scale);
    part.height = Math.max(1, Math.round(s.h * s.scale));
    const ctx = part.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, part.width, part.height);
    ctx.drawImage(s.canvas, 0, Math.round(s.y * s.scale), part.width, part.height, 0, 0, part.width, part.height);
    const blob = await new Promise<Blob | null>((res) => part.toBlob(res, "image/png"));
    if (!blob) continue;
    const img = await pdf.embedPng(new Uint8Array(await blob.arrayBuffer()));
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    const h = s.h * PT_PER_PX;
    page.drawImage(img, { x: SIDE, y: PAGE_H - TOP - h, width: CONTENT_W, height: h });
    const label = `Page ${i + 1} of ${slices.length}`;
    page.drawText(REPORT_BRAND.preparedBy, { x: SIDE, y: 22, size: 8.5, font, color: muted });
    page.drawText(label, { x: PAGE_W - SIDE - font.widthOfTextAtSize(label, 8.5), y: 22, size: 8.5, font, color: muted });
  }
  const out = await pdf.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}

/** "Salam Weekly update 25 Oct to 29 Oct 2026.pdf", with the person's name for one person. */
export function reportFileName(kind: ReportKind, start: string, end: string, who?: string) {
  const noun = kind === "week" ? "Weekly update" : kind === "rolling" ? "Last 7 days" : "Update";
  const range = start === end ? dayLabel(start, true) : `${dayLabel(start).slice(4)} to ${dayLabel(end, true).slice(4)}`;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${safe(`${REPORT_BRAND.name} ${noun}${who ? ` ${who}` : ""} ${range}`)}.pdf`;
}
