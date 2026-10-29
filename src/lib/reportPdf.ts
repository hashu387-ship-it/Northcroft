// The weekly update report as a PDF file, drawn to match the report on screen: Salam's heading band
// and logo, the team on the first page, then each person on their own page, with page numbers.
// Fonts are embedded (only the letters used), so it looks the same on any phone or computer.
import type { PDFDocument, PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";
import { REPORT_BRAND, REPORT_FONTS } from "./reportBrand";
import { dateOf } from "./time";
import { dayLabel, hasFacts, rangeLabel, type PersonFacts, type PersonWeek, type ReportKind, type TeamWeek } from "./weeklyUpdates";

const W = 595.28;
const H = 841.89;
const M = 42; // side margin
const TOP = 46;
const BOTTOM = 54;
const CW = W - M * 2;

export interface ReportInput {
  kind: ReportKind;
  start: string;
  end: string;
  team: TeamWeek | null;
  people: PersonWeek[];
  over: boolean;
}

const noun = (k: ReportKind) => (k === "week" ? "Weekly update" : k === "rolling" ? "Last 7 days" : "Update");

async function bytes(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Couldn't load ${url}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** The logo as PNG bytes: PNG and JPG as they are, SVG drawn onto a canvas first. */
async function logoImage(doc: PDFDocument): Promise<PDFImage | null> {
  const src = REPORT_BRAND.logo;
  if (!src) return null;
  try {
    if (/\.png($|\?)/i.test(src)) return await doc.embedPng(await bytes(src));
    if (/\.jpe?g($|\?)/i.test(src)) return await doc.embedJpg(await bytes(src));
    // SVG (or anything the browser can draw): put it on a canvas at a good size.
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = 600 / Math.max(img.naturalWidth || 300, 1);
    const c = document.createElement("canvas");
    c.width = Math.round((img.naturalWidth || 300) * scale);
    c.height = Math.round((img.naturalHeight || 100) * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    return blob ? await doc.embedPng(new Uint8Array(await blob.arrayBuffer())) : null;
  } catch {
    return null;
  }
}

export async function buildReportPdf(input: ReportInput): Promise<Blob> {
  const { PDFDocument, rgb } = await import("pdf-lib");
  const fontkit = ((await import("@pdf-lib/fontkit")) as unknown as { default: unknown }).default;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as Parameters<PDFDocument["registerFontkit"]>[0]);
  doc.setTitle(`${REPORT_BRAND.name} ${noun(input.kind)} ${rangeLabel(input.start, input.end, true)}`);
  doc.setAuthor("");
  doc.setCreator("");
  doc.setProducer("");

  const [heading, regular, semibold, bold] = await Promise.all(
    [REPORT_FONTS.heading, REPORT_FONTS.regular, REPORT_FONTS.semibold, REPORT_FONTS.bold].map(async (u) =>
      doc.embedFont(await bytes(u), { subset: true }),
    ),
  );
  const logo = await logoImage(doc);

  const hex = (h: string): RGB => {
    const n = parseInt(h.replace("#", ""), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };
  const C = {
    primary: hex(REPORT_BRAND.primary),
    accent: hex(REPORT_BRAND.accent),
    tint: hex(REPORT_BRAND.tint),
    ink: hex(REPORT_BRAND.ink),
    muted: hex(REPORT_BRAND.muted),
    white: rgb(1, 1, 1),
    line: rgb(0.86, 0.87, 0.9),
  };

  // Only letters the fonts have (anything else would print as a box).
  const sets = new Map<PDFFont, Set<number>>();
  const clean = (font: PDFFont, text: string) => {
    let set = sets.get(font);
    if (!set) {
      set = new Set(font.getCharacterSet());
      sets.set(font, set);
    }
    return [...text.replace(/\r/g, "").replace(/\t/g, " ")].filter((ch) => ch === "\n" || set!.has(ch.codePointAt(0)!)).join("");
  };
  const width = (font: PDFFont, size: number, text: string) => font.widthOfTextAtSize(clean(font, text), size);
  const wrap = (font: PDFFont, size: number, text: string, max: number): string[] => {
    const out: string[] = [];
    for (const para of clean(font, text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (width(font, size, next) <= max) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        // A word longer than the line breaks across lines.
        let w = word;
        while (width(font, size, w) > max) {
          let cut = w.length - 1;
          while (cut > 1 && width(font, size, w.slice(0, cut)) > max) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  };

  const title = (() => {
    const single = !input.team && input.people.length === 1 && hasFacts(input.people[0].facts) ? (input.people[0].facts as PersonFacts) : null;
    if (single) return { main: single.name, sub: `${noun(input.kind)} · ${rangeLabel(input.start, input.end, true)}` };
    return {
      main: input.kind === "week" ? "Team weekly update" : input.kind === "rolling" ? "Team: last 7 days" : "Team update",
      sub: rangeLabel(input.start, input.end, true),
    };
  })();
  const written = input.team?.generated_at ?? input.people.find((p) => p.generated_at)?.generated_at ?? null;
  const subLine = `${title.sub}${input.kind === "week" && !input.over ? " (so far)" : ""}`;
  const byLine = `${REPORT_BRAND.preparedBy}${written ? ` · Written ${dayLabel(dateOf(written), true)}` : ""}`;

  let page: PDFPage = doc.addPage([W, H]);
  let y = 0;

  const text = (t: string, x: number, yy: number, font: PDFFont, size: number, color: RGB) => page.drawText(clean(font, t), { x, y: yy, font, size, color });

  function bandHeader() {
    const bandH = 92;
    page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: C.primary });
    page.drawRectangle({ x: 0, y: H - bandH - 4, width: W, height: 4, color: C.accent });
    // Logo (or the name) on a white tile.
    const tileH = 56;
    let tileW = 86;
    if (logo) {
      const s = Math.min(44 / logo.height, 150 / logo.width);
      tileW = Math.max(64, logo.width * s + 20);
      page.drawRectangle({ x: M, y: H - bandH / 2 - tileH / 2, width: tileW, height: tileH, color: C.white });
      page.drawImage(logo, { x: M + (tileW - logo.width * s) / 2, y: H - bandH / 2 - (logo.height * s) / 2, width: logo.width * s, height: logo.height * s });
    } else {
      const name = REPORT_BRAND.name.toUpperCase().split("").join(" ");
      tileW = Math.max(86, width(heading, 15, name) + 24);
      page.drawRectangle({ x: M, y: H - bandH / 2 - tileH / 2, width: tileW, height: tileH, color: C.white });
      text(name, M + (tileW - width(heading, 15, name)) / 2, H - bandH / 2 - 5, heading, 15, C.primary);
    }
    const tx = M + tileW + 18;
    const tw = W - M - tx;
    let size = 21;
    while (size > 14 && width(heading, size, title.main) > tw) size -= 1;
    text(title.main, tx, H - 38, heading, size, C.white);
    text(subLine, tx, H - 56, semibold, 10.5, C.white);
    text(byLine, tx, H - 71, regular, 9, rgb(0.85, 0.87, 0.9));
    y = H - bandH - 4 - 24;
  }

  function slimHeader() {
    text(`${REPORT_BRAND.name} · ${title.main}`, M, H - 30, heading, 11, C.primary);
    const right = subLine;
    text(right, W - M - width(regular, 9, right), H - 29, regular, 9, C.muted);
    page.drawRectangle({ x: M, y: H - 38, width: CW, height: 1.5, color: C.accent });
    y = H - TOP - 8;
  }

  function newPage() {
    page = doc.addPage([W, H]);
    slimHeader();
  }
  const room = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };

  function para(t: string, opts: { font?: PDFFont; size?: number; color?: RGB; x?: number; w?: number; gap?: number } = {}) {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const lh = size * 1.45;
    const lines = wrap(font, size, t, opts.w ?? CW);
    for (const l of lines) {
      room(lh);
      text(l, opts.x ?? M, y - size, font, size, opts.color ?? C.ink);
      y -= lh;
    }
    y -= opts.gap ?? 6;
  }

  function label(t: string) {
    room(26);
    const s = t.toUpperCase();
    text(s, M, y - 9, bold, 8.5, C.primary);
    page.drawRectangle({ x: M, y: y - 14, width: width(bold, 8.5, s), height: 1.6, color: C.accent });
    y -= 22;
  }

  function sectionHeading(name: string, role?: string | null) {
    room(34);
    text(name, M, y - 17, heading, 17, C.primary);
    if (role) text(role, M + width(heading, 17, name) + 10, y - 16, regular, 9.5, C.muted);
    y -= 26;
  }

  function stateNote(status: string, error: string | null, empty: string) {
    const msg =
      status === "pending" ? "Being written. It shows here in a minute or two." : status === "failed" ? error || "This couldn't be written. Try again." : status === "empty" ? empty : null;
    if (!msg) return;
    const lines = wrap(regular, 9.5, msg, CW - 20);
    const h = lines.length * 14 + 12;
    room(h);
    page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: C.tint });
    lines.forEach((l, i) => text(l, M + 10, y - 16 - i * 14, regular, 9.5, C.ink));
    y -= h + 8;
  }

  function counts(parts: [string, string][]) {
    room(16);
    let x = M;
    for (const [b, rest] of parts) {
      const wb = width(bold, 9.5, b);
      const wr = width(regular, 9.5, ` ${rest}`);
      if (x + wb + wr > M + CW) {
        y -= 14;
        room(14);
        x = M;
      }
      text(b, x, y - 10, bold, 9.5, C.ink);
      text(` ${rest}`, x + wb, y - 10, regular, 9.5, C.muted);
      x += wb + wr + 14;
    }
    y -= 20;
  }

  function team(row: TeamWeek) {
    const f = hasFacts(row.facts) ? row.facts : null;
    const s = row.summary;
    sectionHeading("The team");
    stateNote(row.status, row.error, "No daily updates in these days.");
    if (f) {
      const boxes: [string, string, string][] = [
        [String(f.sent_all), ` of ${f.people}`, "sent every day"],
        [String(f.moved), "", "tasks moved on"],
        [String(f.handed_in), "", "handed in"],
        [String(f.open_blockers.length), "", "blockers open"],
      ];
      const gap = 8;
      const bw = (CW - gap * 3) / 4;
      room(56);
      boxes.forEach(([big, small, lab], i) => {
        const x = M + i * (bw + gap);
        page.drawRectangle({ x, y: y - 50, width: bw, height: 50, color: C.tint });
        text(big, x + 10, y - 26, heading, 20, C.primary);
        if (small) text(small, x + 10 + width(heading, 20, big), y - 25, semibold, 9, C.muted);
        text(lab, x + 10, y - 41, semibold, 8.5, C.muted);
      });
      y -= 62;
    }
    if (s?.headline) para(s.headline, { size: 10.5, gap: 10 });
    if (f && f.projects.length) {
      label("Projects");
      for (const p of f.projects) {
        const words = s?.projects.find((x) => x.project.toLowerCase() === p.project.toLowerCase())?.summary;
        room(30);
        para(p.project, { font: bold, size: 10.5, color: C.primary, gap: 0 });
        para(`${p.people.join(", ")} · ${p.moved} of ${p.tasks} ${p.tasks === 1 ? "task" : "tasks"} moved on${p.handed_in ? `, ${p.handed_in} handed in` : ""}`, {
          size: 9,
          color: C.muted,
          gap: 2,
        });
        if (words) para(words, { size: 10, gap: 8 });
        else y -= 4;
      }
    }
    if (s && s.attention.length) {
      label("To look at");
      for (const a of s.attention) {
        const lines = wrap(regular, 10, a, CW - 14);
        room(lines.length * 14.5);
        page.drawCircle({ x: M + 3, y: y - 6.5, size: 1.8, color: C.accent });
        lines.forEach((l, i) => text(l, M + 12, y - 10 - i * 14.5, regular, 10, C.ink));
        y -= lines.length * 14.5 + 3;
      }
      y -= 6;
    }
    if (f && (f.no_updates.length || f.missing.length)) {
      const note = [
        f.no_updates.length ? `No daily updates: ${f.no_updates.join(", ")}.` : "",
        ...f.missing.map((m) => `${m.name} missed ${m.days.map((d) => dayLabel(d)).join(", ")}.`),
      ]
        .filter(Boolean)
        .join(" ");
      para(note, { size: 9, color: C.muted });
    }
  }

  function person(row: PersonWeek, showName: boolean) {
    const f = hasFacts(row.facts) ? (row.facts as PersonFacts) : null;
    const s = row.summary;
    if (showName) sectionHeading(f?.name ?? "Someone", f?.title);
    if (f) {
      const parts: [string, string][] = [
        [`${f.days_sent} of ${f.days_expected}`, "daily updates"],
        [String(f.moved), f.moved === 1 ? "task moved on" : "tasks moved on"],
        [String(f.handed_in), "handed in"],
      ];
      if (f.leave_days.length) parts.push(["On leave", f.leave_days.map((d) => dayLabel(d)).join(", ")]);
      if (f.missed_days.length && f.days_sent) parts.push(["No update", f.missed_days.map((d) => dayLabel(d)).join(", ")]);
      counts(parts);
    }
    stateNote(row.status, row.error, "No daily updates in these days.");
    if (s?.summary) para(s.summary, { size: 10.5, gap: 10 });
    if (f) {
      const written = new Map((s?.projects ?? []).map((p) => [p.project.toLowerCase(), p.summary]));
      const groups = new Map<string, PersonFacts["tasks"]>();
      for (const t of f.tasks) groups.set(t.project ?? "Other", [...(groups.get(t.project ?? "Other") ?? []), t]);
      const ordered = [...groups.entries()].sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : a[0].localeCompare(b[0])));
      for (const [project, tasks] of ordered) {
        room(60);
        text(project, M, y - 13, heading, 13.5, C.primary);
        y -= 21;
        const words = written.get(project.toLowerCase());
        if (words) para(words, { size: 10, gap: 6 });
        // Table: Task | Start | End (with a bar) | Days
        const cStart = M + CW - 190;
        const cEnd = M + CW - 140;
        const cDays = M + CW - 26;
        const taskW = cStart - M - 10;
        room(18);
        text("TASK", M, y - 9, bold, 7.5, C.muted);
        text("START", cStart, y - 9, bold, 7.5, C.muted);
        text("END", cEnd, y - 9, bold, 7.5, C.muted);
        text("DAYS", cDays - width(bold, 7.5, "DAYS") + 18, y - 9, bold, 7.5, C.muted);
        y -= 13;
        page.drawRectangle({ x: M, y, width: CW, height: 0.8, color: C.line });
        for (const t of tasks) {
          const titleLines = wrap(semibold, 9.5, t.title, taskW);
          // "Handed in" sits after the title when it fits, else on a line of its own.
          const tag = "Handed in";
          const lastW = width(semibold, 9.5, titleLines[titleLines.length - 1] ?? "");
          const tagInline = t.handed_in && lastW + width(bold, 9.5, `  · ${tag}`) <= taskW;
          const tagLines = t.handed_in && !tagInline ? 1 : 0;
          const noteLines = t.notes.flatMap((n) => wrap(regular, 8.5, `${dayLabel(n.date)}: ${n.note}`, taskW));
          const h = (titleLines.length + tagLines) * 13 + noteLines.length * 11.5 + 10;
          room(h);
          titleLines.forEach((l, i) => text(l, M, y - 12 - i * 13, semibold, 9.5, C.ink));
          if (tagInline) text(`  · ${tag}`, M + lastW, y - 12 - (titleLines.length - 1) * 13, bold, 9.5, C.primary);
          else if (tagLines) text(tag, M, y - 12 - titleLines.length * 13, bold, 9.5, C.primary);
          noteLines.forEach((l, i) => text(l, M, y - 12 - (titleLines.length + tagLines) * 13 - i * 11.5, regular, 8.5, C.muted));
          text(`${t.start}%`, cStart, y - 12, regular, 9.5, C.ink);
          // the bar: where it started, and what it gained
          const bw = 70;
          page.drawRectangle({ x: cEnd, y: y - 12, width: bw, height: 5, color: C.tint });
          const a = Math.min(t.start, t.end) / 100;
          const g = Math.max(0, t.end - t.start) / 100;
          if (a > 0) page.drawRectangle({ x: cEnd, y: y - 12, width: bw * a, height: 5, color: rgb(0.78, 0.81, 0.86) });
          if (g > 0) page.drawRectangle({ x: cEnd + bw * a, y: y - 12, width: bw * g, height: 5, color: C.primary });
          text(`${t.end}%`, cEnd + bw + 6, y - 12, bold, 9.5, C.ink);
          text(String(t.days), cDays + 18 - width(regular, 9.5, String(t.days)), y - 12, regular, 9.5, C.ink);
          y -= h;
          page.drawRectangle({ x: M, y: y + 2, width: CW, height: 0.6, color: C.line });
        }
        y -= 10;
      }
      if (s?.other_work || f.other_work.length) {
        label("Other work");
        if (s?.other_work) para(s.other_work, { size: 10 });
        else for (const o of f.other_work) para(`${dayLabel(o.date)}: ${o.text}`, { size: 10, gap: 2 });
        y -= 4;
      }
      if (f.blockers.length) {
        label("Blockers");
        if (s?.blockers) para(s.blockers, { size: 10 });
        for (const b of f.blockers) {
          const main = wrap(regular, 9.5, `${dayLabel(b.date)}: ${b.text}  ${b.cleared ? "Cleared" : "Still open"}`, CW - 22);
          const replies = b.replies.flatMap((r) => wrap(regular, 8.5, `${r.by}: ${r.body}`, CW - 22));
          const h = main.length * 13 + replies.length * 11.5 + 12;
          room(h);
          page.drawRectangle({ x: M, y: y - h, width: CW, height: h, color: C.tint });
          page.drawRectangle({ x: M, y: y - h, width: 3, height: h, color: C.accent });
          main.forEach((l, i) => text(l, M + 12, y - 14 - i * 13, regular, 9.5, C.ink));
          replies.forEach((l, i) => text(l, M + 12, y - 14 - main.length * 13 - i * 11.5, regular, 8.5, C.muted));
          y -= h + 6;
        }
      }
    }
  }

  // ---- the pages
  bandHeader();
  if (input.team) team(input.team);
  input.people.forEach((p, i) => {
    if (input.team || i > 0) {
      // The team on the first page, then each person on their own page.
      newPage();
    }
    person(p, !!input.team || input.people.length > 1);
  });
  if (!input.team && !input.people.length) para("Nothing has been written for these days yet.");

  // ---- footers: who prepared it, and page numbers
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const t = `Page ${i + 1} of ${pages.length}`;
    p.drawRectangle({ x: M, y: 36, width: CW, height: 0.6, color: C.line });
    p.drawText(clean(regular, REPORT_BRAND.preparedBy), { x: M, y: 24, size: 8.5, font: regular, color: C.muted });
    p.drawText(t, { x: W - M - width(regular, 8.5, t), y: 24, size: 8.5, font: regular, color: C.muted });
  });

  const out = await doc.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}

/** "Salam Weekly update 25 Oct to 29 Oct 2026.pdf", with the person's name for one person. */
export function reportFileName(kind: ReportKind, start: string, end: string, who?: string) {
  const range = start === end ? dayLabel(start, true) : `${dayLabel(start).slice(4)} to ${dayLabel(end, true).slice(4)}`;
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${safe(`${REPORT_BRAND.name} ${noun(kind)}${who ? ` ${who}` : ""} ${range}`)}.pdf`;
}
