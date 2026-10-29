// The weekly update as an Excel file in the Northcroft house style: a Team Summary sheet first (for
// managers and seniors: the week, each project, each person, and what to look at), then one sheet
// per person (the week, each project with every task's % at the start and end of the week, other
// work and blockers). Navy title band, tan second line with the red rule under it, navy column
// headers, gray section rows, black text, navy lines; Page Break Preview, one page wide, the header
// rows repeated on every page, and the sheet name and page number in the footer.
//
// Columns and rows are sized here from the text itself (with the same character widths the house
// style's checker uses), so nothing is cut off and nothing is shrunk.
import type { Borders, Cell, Font, Workbook, Worksheet } from "exceljs";
import { dateOf, fmtDate } from "./time";
import { dayLabel, hasFacts, weekEnd, weekLabel, type PersonFacts, type PersonWeek, type TeamWeek } from "./weeklyUpdates";
import { XLSX_MIME } from "./vologExcel";

/* ---------------------------------------------------------------- palette and type */
const NAVY = "0B1F35";
const RED = "EA1C2D";
const TAN = "EDE6D3";
const CYAN = "02A9DA";
const BLACK = "000000";
const WHITE = "FFFFFF";
const LEVEL_FILL: Record<number, string> = { 1: "D9D9D9", 2: "F2F2F2" };
const HEADING = "Aptos Display";
const BODY = "Open Sans";
const SIZE = 10;
const INT = '#,##0;(#,##0);"-"';
const PCT = '0%;(0%);"-"';

const argb = (hex: string) => ({ argb: `FF${hex}` });
const font = (o: { bold?: boolean; colour?: string; size?: number; heading?: boolean; underline?: boolean } = {}): Partial<Font> => ({
  name: o.heading ? HEADING : BODY,
  size: o.size ?? SIZE,
  bold: !!o.bold,
  italic: false,
  color: argb(o.colour ?? BLACK),
  ...(o.underline ? { underline: "single" as const } : {}),
});
const side = (colour = NAVY, style: "thin" | "medium" = "thin") => ({ style, color: argb(colour) });
const GRID: Partial<Borders> = { top: side(), left: side(), bottom: side(), right: side() };
const solid = (hex: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: argb(hex) });

/* ---------------------------------------------------------------- measuring text */
// Advance widths as a multiple of the Open Sans digit 0 (one Excel column unit at 10 pt). Aptos
// Display is measured with these too; it runs a little narrower, so this errs on the safe side.
const CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~×÷–—‘’“”°²³½¼¾•";
const REGULAR = [0.454,0.467,0.701,1.13,1.0,1.44,1.277,0.387,0.518,0.518,0.965,1.0,0.429,0.563,0.465,0.642,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,0.465,0.465,1.0,1.0,1.0,0.751,1.572,1.107,1.133,1.103,1.275,0.973,0.903,1.273,1.29,0.488,0.467,1.073,0.908,1.579,1.319,1.362,1.053,1.362,1.081,0.96,0.968,1.273,1.041,1.619,1.009,0.98,0.998,0.576,0.642,0.576,0.948,0.784,1.009,0.973,1.072,0.833,1.072,0.981,0.593,0.958,1.073,0.442,0.442,0.918,0.442,1.627,1.073,1.056,1.072,1.072,0.714,0.834,0.617,1.073,0.876,1.36,0.916,0.881,0.818,0.663,0.963,0.663,1.0,1.0,1.0,0.874,1.749,0.297,0.297,0.612,0.612,0.749,0.607,0.607,1.364,1.364,1.364,0.658]; // prettier-ignore
const BOLDW = [0.454,0.5,0.826,1.13,0.998,1.576,1.312,0.465,0.593,0.593,0.953,0.998,0.507,0.563,0.499,0.722,0.998,0.998,0.998,0.998,0.998,0.998,0.998,0.998,0.998,0.998,0.499,0.507,0.998,0.998,0.998,0.834,1.569,1.207,1.175,1.114,1.295,0.98,0.96,1.266,1.338,0.579,0.579,1.161,0.988,1.649,1.422,1.392,1.098,1.392,1.155,0.963,1.013,1.322,1.137,1.691,1.167,1.091,1.013,0.579,0.722,0.579,0.931,0.719,1.061,1.056,1.107,0.899,1.107,1.033,0.677,0.988,1.149,0.534,0.534,1.085,0.534,1.717,1.149,1.083,1.107,1.107,0.794,0.869,0.759,1.149,0.995,1.497,1.011,0.995,0.853,0.689,0.963,0.689,0.998,0.998,0.998,0.874,1.749,0.379,0.379,0.778,0.778,0.749,0.663,0.663,1.541,1.541,1.541,0.658]; // prettier-ignore
const TABLE_R = new Map([...CHARS].map((c, i) => [c, REGULAR[i]]));
const TABLE_B = new Map([...CHARS].map((c, i) => [c, BOLDW[i]]));
// Room for Excel on a Mac, which draws text about 16% wider; and the few pixels Excel keeps clear.
const ALLOWANCE = 1.22;
const PADDING = 0.8;
const PAD = 0.6;
const LINE = 1.362;

function units(text: string, size = SIZE, bold = false): number {
  const t = bold ? TABLE_B : TABLE_R;
  let w = 0;
  for (const ch of text) w += t.get(ch) ?? 1.0;
  return w * (size / 10) * ALLOWANCE;
}
/** Column width that shows the text on one line (its longest line). */
const widthOf = (text: string, size = SIZE, bold = false) => Math.max(0, ...text.split("\n").map((p) => units(p, size, bold))) + PADDING;

/** How many lines the text takes when it wraps word by word in a column this wide. */
function linesIn(text: string, width: number, size = SIZE, bold = false): number {
  const avail = Math.max(1, width - PADDING);
  const space = units(" ", size, bold);
  let total = 0;
  for (const para of text.split("\n")) {
    let n = 1;
    let line = 0;
    for (const word of para.split(" ")) {
      const ww = units(word, size, bold);
      if (ww > avail) {
        if (line > 0) n += 1;
        const extra = Math.ceil(ww / avail) - 1;
        n += extra;
        line = ww - extra * avail;
      } else if (line === 0) line = ww;
      else if (line + space + ww <= avail) line += space + ww;
      else {
        n += 1;
        line = ww;
      }
    }
    total += n;
  }
  return total;
}
/** Row height (points) that shows this many lines in full, with a little air. */
const heightFor = (lines: number, size = SIZE) => Math.ceil((lines * size * LINE * 1.05 + 5) * 10) / 10;

/** Keep text printable: no control characters, no runaway length. */
const clean = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 30000);

/* ---------------------------------------------------------------- one sheet */
type Kind = "code" | "desc" | "text" | "int" | "pct";
interface Col {
  header: string;
  kind: Kind;
}
type Value = string | number | null | { bold: string; rest: string };
type RowKind = "heading" | "text" | "item" | "spacer";

class Sheet {
  ws: Worksheet;
  cols: Col[];
  last: number;
  r: number;
  headerRow = 0;
  kinds = new Map<number, RowKind>();
  private infoTexts: { row: number; text: string }[] = [];
  private title = "";
  private subtitle = "";

  constructor(wb: Workbook, name: string, tab: string, cols: Col[]) {
    this.ws = wb.addWorksheet(name, { properties: { tabColor: argb(tab) } });
    this.cols = cols;
    this.last = cols.length;
    this.r = 1;
  }

  private style(row: number, kind: RowKind, level = 0) {
    for (let c = 1; c <= this.last; c++) {
      const cell = this.ws.getCell(row, c);
      const col = this.cols[c - 1];
      const numeric = typeof cell.value === "number";
      if (kind === "spacer") {
        cell.font = font();
        cell.border = { left: side(), right: side() };
        continue;
      }
      if (kind === "heading") {
        const text = typeof cell.value === "string" && cell.value.trim() !== "";
        cell.font = font({ bold: true, colour: NAVY, heading: !numeric, underline: text && c > 1 });
        cell.border = { left: side(), right: side(), top: side(), bottom: side(NAVY, "medium") };
        const band = LEVEL_FILL[level];
        if (band) cell.fill = solid(band);
      } else {
        cell.font = font();
        cell.border = GRID;
      }
      const left = col.kind === "desc" && !numeric;
      cell.alignment = { horizontal: left ? "left" : "center", vertical: "middle", wrapText: !numeric };
      if (numeric) cell.numFmt = col.kind === "pct" ? PCT : INT;
    }
    this.kinds.set(row, kind);
  }

  titleBand(title: string, subtitle: string) {
    this.title = clean(title);
    this.subtitle = clean(subtitle);
    const ws = this.ws;
    ws.mergeCells(1, 1, 1, this.last);
    ws.mergeCells(2, 1, 2, this.last);
    ws.getCell(1, 1).value = this.title;
    ws.getCell(2, 1).value = this.subtitle;
    for (let c = 1; c <= this.last; c++) {
      const t = ws.getCell(1, c);
      t.fill = solid(NAVY);
      t.font = font({ heading: true, bold: true, colour: WHITE, size: 16 });
      t.alignment = { horizontal: "center", vertical: "middle" };
      const s = ws.getCell(2, c);
      s.fill = solid(TAN);
      s.font = font({ bold: true, colour: NAVY });
      s.alignment = { horizontal: "center", vertical: "middle" };
      s.border = { bottom: side(RED, "medium") };
    }
    ws.getRow(1).height = 32;
    ws.getRow(2).height = 22;
    ws.getRow(3).height = 8;
    this.r = 4;
  }

  info(items: [string, string][]) {
    for (const [label, value] of items) {
      const row = this.r++;
      this.ws.mergeCells(row, 1, row, this.last);
      const cell = this.ws.getCell(row, 1);
      cell.value = {
        richText: [
          { text: `${label}   `, font: font({ bold: true, colour: NAVY }) },
          { text: clean(value), font: font() },
        ],
      };
      cell.font = font();
      cell.alignment = { horizontal: "center", vertical: "middle" };
      this.ws.getRow(row).height = 18;
      this.infoTexts.push({ row, text: `${label}   ${clean(value)}` });
    }
    this.ws.getRow(this.r).height = 12;
    this.r += 1;
  }

  header() {
    const row = this.r++;
    this.headerRow = row;
    this.cols.forEach((col, i) => {
      const cell = this.ws.getCell(row, i + 1);
      cell.value = col.header;
      cell.font = font({ bold: true, colour: WHITE });
      cell.fill = solid(NAVY);
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = { left: side(WHITE), right: side(WHITE), top: side(NAVY), bottom: side(NAVY) };
    });
    this.ws.getRow(row).height = 34;
  }

  /** A section heading: "A", "THE WEEK" (level 1, gray) or "B.1", "Capella" (level 2, light gray). */
  heading(code: string, text: string) {
    if (this.r > this.headerRow + 1 && this.kinds.get(this.r - 1) !== "heading" && this.kinds.get(this.r - 1) !== "spacer") this.spacer();
    const row = this.r++;
    this.ws.getCell(row, 1).value = code;
    this.ws.getCell(row, this.descCol()).value = clean(text);
    this.style(row, "heading", code.split(".").length);
  }

  /** Running text under a heading, in the description column. */
  text(body: string) {
    const t = clean(body);
    if (!t) return;
    const row = this.r++;
    this.ws.getCell(row, this.descCol()).value = t;
    this.style(row, "text");
  }

  /** A line of the table, one value per column. */
  item(values: Value[]) {
    const row = this.r++;
    values.forEach((v, i) => {
      if (v === null || v === "") return;
      const cell = this.ws.getCell(row, i + 1);
      if (typeof v === "object") {
        cell.value = {
          richText: [
            { text: clean(v.bold), font: font({ bold: true }) },
            ...(clean(v.rest) ? [{ text: `\n${clean(v.rest)}`, font: font() }] : []),
          ],
        };
      } else cell.value = typeof v === "string" ? clean(v) : v;
    });
    this.style(row, "item");
  }

  spacer() {
    const row = this.r++;
    this.style(row, "spacer");
  }

  private descCol() {
    return this.cols.findIndex((c) => c.kind === "desc") + 1;
  }

  /** Column widths from the content, then row heights for wrapped text, then print and view. */
  finish(opts: { landscape: boolean; selected: boolean }) {
    const ws = this.ws;
    const lastRow = this.r - 1;
    const widths = this.cols.map(() => 0);
    const desc = this.cols.map(() => 0);
    const textOf = (cell: Cell): { text: string; bold: boolean } | null => {
      const v = cell.value;
      if (v === null || v === undefined) return null;
      if (typeof v === "object" && "richText" in v) {
        // Measure the name line in bold, the rest as body text.
        return { text: v.richText.map((p) => p.text).join(""), bold: !!v.richText[0]?.font?.bold };
      }
      return { text: String(v), bold: !!cell.font?.bold };
    };
    for (let r = this.headerRow; r <= lastRow; r++) {
      for (let c = 1; c <= this.last; c++) {
        const cell = ws.getCell(r, c);
        const t = textOf(cell);
        if (!t) continue;
        const col = this.cols[c - 1];
        let w: number;
        if (r === this.headerRow) {
          const words = Math.max(0, ...t.text.split(/\s+/).map((x) => widthOf(x, SIZE, true)));
          w = Math.max(words, widthOf(t.text, SIZE, true) / 2 + PADDING / 2);
        } else if (typeof cell.value === "number") {
          w = widthOf(shown(cell.value, col.kind));
        } else if (col.kind === "desc") {
          desc[c - 1] = Math.max(desc[c - 1], widthOf(t.text, SIZE, t.bold));
          continue;
        } else {
          w = widthOf(t.text, SIZE, t.bold);
        }
        widths[c - 1] = Math.max(widths[c - 1], w);
      }
    }
    this.cols.forEach((col, i) => {
      const w =
        col.kind === "desc"
          ? Math.min(50, Math.max(20, desc[i] + PAD, widths[i] + PAD))
          : Math.min(40, Math.max(5, widths[i] + PAD));
      ws.getColumn(i + 1).width = Math.round(w * 10) / 10;
    });
    const colWidth = (c: number) => ws.getColumn(c).width ?? 8.43;
    const total = this.cols.reduce((n, _c, i) => n + colWidth(i + 1), 0);

    // The title steps down to 12 pt if it has to, then wraps; the other lines above the table wrap.
    const t1 = ws.getCell(1, 1);
    let size = 16;
    while (size > 12 && widthOf(this.title, size, true) > total) size -= 1;
    t1.font = font({ heading: true, bold: true, colour: WHITE, size });
    if (widthOf(this.title, size, true) > total) {
      t1.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      ws.getRow(1).height = Math.max(32, heightFor(linesIn(this.title, total, size, true), size));
    }
    const lineAbove = (row: number, text: string, bold: boolean, base: number) => {
      if (widthOf(text, SIZE, bold) <= total) return;
      ws.getCell(row, 1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      ws.getRow(row).height = Math.max(base, heightFor(linesIn(text, total, SIZE, bold)));
    };
    lineAbove(2, this.subtitle, true, 22);
    // Info lines are measured in bold throughout: the label is bold, so this errs on the safe side.
    for (const i of this.infoTexts) lineAbove(i.row, i.text, true, 18);

    // Rows grow to fit every wrapped line.
    for (let r = this.headerRow; r <= lastRow; r++) {
      const kind = r === this.headerRow ? "header" : this.kinds.get(r);
      const base = kind === "header" ? 34 : kind === "heading" ? 24 : kind === "spacer" ? 12 : 20;
      let need = 0;
      for (let c = 1; c <= this.last; c++) {
        const cell = ws.getCell(r, c);
        const t = textOf(cell);
        if (!t || typeof cell.value === "number") continue;
        const w = colWidth(c);
        let lines: number;
        const v = cell.value;
        if (typeof v === "object" && v && "richText" in v) {
          const [first, ...rest] = v.richText;
          lines = linesIn(first.text, w, SIZE, !!first.font?.bold) + (rest.length ? linesIn(rest.map((p) => p.text).join("").replace(/^\n/, ""), w) : 0);
          lines = Math.max(lines, linesIn(t.text, w));
        } else {
          lines = linesIn(t.text, w, SIZE, t.bold || kind === "header" || kind === "heading");
        }
        need = Math.max(need, heightFor(lines));
      }
      ws.getRow(r).height = Math.max(base, need);
    }

    // Print: one page wide, header rows on every page, the sheet name and page number at the foot.
    const lastCol = String.fromCharCode(64 + this.last);
    ws.pageSetup = {
      paperSize: 9,
      orientation: opts.landscape ? "landscape" : "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      showGridLines: false,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.25 },
      printArea: `A1:${lastCol}${lastRow}`,
      printTitlesRow: `1:${this.headerRow}`,
    };
    ws.headerFooter = {
      oddFooter: `&L&"${BODY},Regular"&9&K${BLACK}&A&R&"${BODY},Regular"&9&K${BLACK}Page &P of &N`,
    };
    // tabSelected isn't in exceljs's types, but it writes it: the first sheet opens selected.
    ws.views = [
      {
        state: "frozen",
        ySplit: this.headerRow,
        xSplit: 0,
        topLeftCell: `A${this.headerRow + 1}`,
        activeCell: `A${this.headerRow + 1}`,
        style: "pageBreakPreview",
        showGridLines: true,
        zoomScale: 85,
        zoomScaleNormal: 100,
        ...({ tabSelected: opts.selected } as object),
      },
    ];
  }
}

/** How a number prints, to size its column. */
function shown(v: number, kind: Kind): string {
  if (kind === "pct") return `${(Math.abs(v) * 100).toFixed(1)}%`;
  return Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Sheet names: 31 characters at most, none of \ / ? * [ ] :, each one different. */
function sheetName(name: string, used: Set<string>) {
  const base = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Person";
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 28)} ${i}`;
  used.add(out.toLowerCase());
  return out;
}

const projectOrder = (a: string, b: string) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));
const writtenOn = (ts: string | null) => (ts ? fmtDate(dateOf(ts), { day: "numeric", month: "short", year: "numeric" }) : "");
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* ---------------------------------------------------------------- the team's sheet */
const TEAM_COLS: Col[] = [
  { header: "Item", kind: "code" },
  { header: "Description", kind: "desc" },
  { header: "Daily Updates", kind: "text" },
  { header: "Tasks", kind: "int" },
  { header: "Moved On", kind: "int" },
  { header: "Handed In", kind: "int" },
  { header: "Blockers Open", kind: "int" },
];

function teamSheet(wb: Workbook, used: Set<string>, week: string, team: TeamWeek, people: PersonWeek[], over: boolean) {
  const s = new Sheet(wb, sheetName("Team Summary", used), CYAN, TEAM_COLS);
  s.titleBand("Team Weekly Update", weekLabel(week, true));
  const f = hasFacts(team.facts) ? team.facts : null;
  const info: [string, string][] = [];
  if (f) {
    info.push(["Daily updates", `${f.sent_all} of ${f.people} sent one every day`]);
    info.push(["Tasks", f.line]);
  }
  info.push(["Written", `${writtenOn(team.generated_at ?? team.updated_at)}${over ? "" : ", before the week was over"}`]);
  s.info(info);
  s.header();

  let section = 0;
  const next = () => LETTERS[section++];

  const a = next();
  s.heading(a, "THE WEEK");
  s.text(team.summary?.headline || f?.line || "");

  if (f && f.projects.length) {
    const b = next();
    s.heading(b, "PROJECTS");
    const written = new Map((team.summary?.projects ?? []).map((p) => [p.project.toLowerCase(), p.summary]));
    [...f.projects]
      .sort((x, y) => projectOrder(x.project, y.project))
      .forEach((p, i) => {
        s.item([
          `${b}.${i + 1}`,
          { bold: `${p.project} (${p.people.join(", ")})`, rest: written.get(p.project.toLowerCase()) ?? "" },
          null,
          p.tasks,
          p.moved,
          p.handed_in,
          null,
        ]);
      });
  }

  const listed = people.filter((p) => hasFacts(p.facts));
  if (listed.length) {
    const c = next();
    s.heading(c, "PEOPLE");
    listed.forEach((p, i) => {
      const pf = p.facts as PersonFacts;
      const words = p.status === "ready" ? p.summary?.summary ?? "" : pf.days_sent ? pf.line : "No daily updates this week.";
      s.item([
        `${c}.${i + 1}`,
        { bold: pf.name, rest: words },
        `${pf.days_sent} of ${pf.days_expected}`,
        pf.tasks.length,
        pf.moved,
        pf.handed_in,
        pf.open_blockers,
      ]);
    });
  }

  const attention = team.summary?.attention ?? [];
  if (attention.length) {
    const d = next();
    s.heading(d, "TO LOOK AT");
    for (const point of attention) s.text(point);
  }
  s.finish({ landscape: false, selected: true });
}

/* ---------------------------------------------------------------- one person's sheet */
const PERSON_COLS: Col[] = [
  { header: "Item", kind: "code" },
  { header: "Description", kind: "desc" },
  { header: "Start %", kind: "pct" },
  { header: "End %", kind: "pct" },
  { header: "Days Updated", kind: "int" },
  { header: "Handed In", kind: "text" },
  { header: "Details", kind: "desc" },
];

function personSheet(wb: Workbook, used: Set<string>, week: string, p: PersonWeek, over: boolean, selected: boolean) {
  const f = p.facts as PersonFacts;
  const s = new Sheet(wb, sheetName(f.short_name || f.name, used), NAVY, PERSON_COLS);
  s.titleBand(f.name, `Weekly Update  |  ${weekLabel(week, true)}`);
  const info: [string, string][] = [];
  if (f.title) info.push(["Role", f.title]);
  info.push([
    "Daily updates",
    `${f.days_sent} of ${f.days_expected} sent${f.missed_days.length ? `, none on ${f.missed_days.map((d) => dayLabel(d)).join(", ")}` : ""}`,
  ]);
  if (f.leave_days.length) info.push(["On leave", f.leave_days.map((d) => dayLabel(d)).join(", ")]);
  info.push(["This week", `${f.line}${over ? "" : " (week not over yet)"}`]);
  s.info(info);
  s.header();

  let section = 0;
  const next = () => LETTERS[section++];
  const summary = p.status === "ready" ? p.summary : null;

  s.heading(next(), "THE WEEK");
  s.text(summary?.summary || (f.days_sent ? f.line : "No daily updates this week."));

  if (f.tasks.length) {
    const b = next();
    s.heading(b, "PROJECTS");
    const written = new Map((summary?.projects ?? []).map((x) => [x.project.toLowerCase(), x.summary]));
    const groups = new Map<string, typeof f.tasks>();
    for (const t of f.tasks) {
      const key = t.project ?? "Other";
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }
    [...groups.entries()]
      .sort((x, y) => projectOrder(x[0], y[0]))
      .forEach(([project, tasks], i) => {
        const code = `${b}.${i + 1}`;
        s.heading(code, project);
        s.text(written.get(project.toLowerCase()) ?? "");
        tasks.forEach((t, j) => {
          s.item([
            `${code}.${j + 1}`,
            t.title,
            t.start / 100,
            t.end / 100,
            t.days,
            t.handed_in ? "Yes" : null,
            t.notes.map((n) => `${dayLabel(n.date)}: ${n.note}`).join("\n") || null,
          ]);
        });
      });
  }

  const other = summary?.other_work || f.other_work.map((o) => `${dayLabel(o.date)}: ${o.text}`).join("\n");
  if (other) {
    s.heading(next(), "OTHER WORK");
    s.text(other);
  }

  if (f.blockers.length) {
    const d = next();
    s.heading(d, "BLOCKERS");
    f.blockers.forEach((bl, i) => {
      const replies = bl.replies.map((r) => `${r.by}: ${r.body}`).join("\n");
      s.item([
        `${d}.${i + 1}`,
        `${dayLabel(bl.date)}: ${bl.text}`,
        null,
        null,
        null,
        null,
        `${bl.cleared ? "Cleared" : "Still open"}${replies ? `\n${replies}` : ""}`,
      ]);
    });
  }
  s.finish({ landscape: true, selected });
}

/* ---------------------------------------------------------------- the workbook */

/**
 * The week as a workbook. With the team report (managers and seniors), the Team Summary comes
 * first; then a sheet for each person who sent daily updates that week, by name.
 */
export async function buildWeeklyWorkbook(week: string, team: TeamWeek | null, people: PersonWeek[], today: string): Promise<Blob> {
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "";
  wb.lastModifiedBy = "";
  wb.created = new Date();
  const used = new Set<string>();
  const over = today > weekEnd(week);
  const sorted = [...people].filter((p) => hasFacts(p.facts)).sort((a, b) => (a.facts as PersonFacts).name.localeCompare((b.facts as PersonFacts).name));
  if (team) teamSheet(wb, used, week, team, sorted, over);
  const withUpdates = sorted.filter((p) => (p.facts as PersonFacts).days_sent > 0);
  withUpdates.forEach((p, i) => personSheet(wb, used, week, p, over, !team && i === 0));
  if (!team && !withUpdates.length && sorted[0]) personSheet(wb, used, week, sorted[0], over, true);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}

/** "Weekly update 25 Oct to 29 Oct 2026.xlsx", or with the person's name. */
export function weeklyFileName(week: string, who?: string) {
  const range = `${fmtDate(week)} to ${fmtDate(weekEnd(week), { day: "numeric", month: "short", year: "numeric" })}`;
  return `Weekly update ${who ? `${who.replace(/[\\/:*?"<>|]/g, " ").trim()} ` : ""}${range}.xlsx`;
}
