// The VO log as an Excel file, laid out like the team's own log: a sheet per project with its title
// rows, the same headings (reference, subject, scope, instruction date, the 35-day contractual date,
// each submission with ECJV's response, amount, expected completion, status, QS remarks), and a
// total. When more than one project is shown there's an "All projects" sheet first.
import type { Workbook, Worksheet } from "exceljs";
import { VO_STATUS } from "./constants";
import { fmtDate, todayISO } from "./time";
import type { Project, Variation } from "./types";
import { voRef } from "./volog";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ORDINAL = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
const nth = (i: number) => ORDINAL[i] ?? `Submission ${i + 1}`;

type Kind = "text" | "long" | "date" | "money" | "number";
interface Col {
  header: string;
  kind: Kind;
  width: number;
  value: (v: Variation, i: number) => string | number | Date | null;
}

/** A plain date ("2026-10-20") as an Excel date. */
const asDate = (iso: string | null | undefined): Date | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

function columns(maxRounds: number, withProject: boolean, projects: Map<string, Project>, files: Map<string, number>): Col[] {
  const cols: Col[] = [{ header: "Sr No.", kind: "number", width: 7, value: (_v, i) => i + 1 }];
  if (withProject) cols.push({ header: "Project", kind: "text", width: 22, value: (v) => projects.get(v.project_id)?.name ?? "" });
  cols.push(
    { header: "Reference No.", kind: "text", width: 18, value: (v) => voRef(v) },
    { header: "VO No. in the app", kind: "text", width: 14, value: (v) => v.vo_number },
    { header: "Subject", kind: "long", width: 46, value: (v) => v.title },
    { header: "Scope", kind: "long", width: 22, value: (v) => v.scope ?? null },
    { header: "EI/Instruction Date", kind: "date", width: 14, value: (v) => asDate(v.instruction_date) },
    { header: "Contractual Submission Date (35 Days)", kind: "date", width: 16, value: (v) => asDate(v.contract_due) },
  );
  for (let r = 0; r < maxRounds; r++) {
    const at = (v: Variation) => (v.submissions ?? [])[r];
    const n = r + 1;
    cols.push(
      { header: `${nth(r)} Submission – Revision`, kind: "text", width: 12, value: (v) => at(v)?.rev ?? null },
      { header: `${nth(r)} Submission Date`, kind: "date", width: 15, value: (v) => (at(v)?.sent ? asDate(at(v)!.sent) : at(v)?.sent_note ?? null) },
      { header: `Our Amount – ${n}`, kind: "money", width: 15, value: (v) => at(v)?.submitted_value ?? null },
      { header: `ECJV Assessed – ${n}`, kind: "money", width: 15, value: (v) => at(v)?.assessed_value ?? null },
      { header: `ECJV Response – ${n}`, kind: "long", width: 44, value: (v) => at(v)?.response ?? null },
      { header: `ECJV Response Date – ${n}`, kind: "date", width: 14, value: (v) => asDate(at(v)?.response_on) },
    );
  }
  cols.push(
    { header: "Amount", kind: "money", width: 16, value: (v) => v.submitted_value },
    { header: "Approved Amount", kind: "money", width: 16, value: (v) => v.approved_value },
    { header: "Expected Date of Completion", kind: "date", width: 15, value: (v) => asDate(v.expected_completion) },
    { header: "Status", kind: "text", width: 16, value: (v) => v.log_status ?? null },
    { header: "Status in the App", kind: "text", width: 18, value: (v) => VO_STATUS[v.status]?.label ?? v.status },
    { header: "QS Remarks", kind: "long", width: 44, value: (v) => v.qs_remarks ?? null },
    { header: "Files and Links", kind: "number", width: 10, value: (v) => files.get(v.id) ?? 0 },
  );
  return cols;
}

const NAVY = "FF0B1D46";
const HEAD_FILL = "FFDCE4F2";
const BORDER = { style: "thin" as const, color: { argb: "FFB8C2D6" } };

function addSheet(wb: Workbook, name: string, title: string, rows: Variation[], withProject: boolean, projects: Map<string, Project>, files: Map<string, number>) {
  const maxRounds = Math.max(1, ...rows.map((v) => (v.submissions ?? []).length));
  const cols = columns(maxRounds, withProject, projects, files);
  const ws: Worksheet = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 5 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = cols.map((c) => ({ width: c.width }));
  const last = cols.length;

  ws.mergeCells(1, 1, 1, last);
  ws.getCell(1, 1).value = title.toUpperCase();
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.mergeCells(2, 1, 2, last);
  ws.getCell(2, 1).value = "Engineering Instructions (EIs & VOs) – QS Status";
  ws.getCell(2, 1).font = { bold: true, size: 12, color: { argb: NAVY } };
  ws.getCell(3, last - 1).value = "Date:";
  ws.getCell(3, last - 1).font = { bold: true };
  ws.getCell(3, last - 1).alignment = { horizontal: "right" };
  ws.getCell(3, last).value = asDate(todayISO());
  ws.getCell(3, last).numFmt = "dd mmm yyyy";

  const head = ws.getRow(5);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: NAVY } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
  });
  head.height = 42;

  rows.forEach((v, r) => {
    const row = ws.getRow(6 + r);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const val = c.value(v, r);
      cell.value = val === "" ? null : val;
      cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
      cell.alignment = { vertical: "top", wrapText: c.kind === "long" || c.kind === "text", horizontal: c.kind === "money" || c.kind === "number" ? "right" : "left" };
      if (c.kind === "date" && val instanceof Date) cell.numFmt = "dd mmm yyyy";
      if (c.kind === "money") cell.numFmt = "#,##0.00";
    });
  });

  // Total amount, like the log's own total row.
  const totalRow = ws.getRow(6 + rows.length);
  const amountCol = cols.findIndex((c) => c.header === "Amount") + 1;
  totalRow.getCell(1).value = "TOTAL AMOUNT:";
  totalRow.getCell(1).font = { bold: true };
  if (amountCol > 1) ws.mergeCells(6 + rows.length, 1, 6 + rows.length, amountCol - 1);
  const total = rows.reduce((n, v) => n + (v.submitted_value ?? 0), 0);
  totalRow.getCell(amountCol).value = Math.round(total * 100) / 100;
  totalRow.getCell(amountCol).numFmt = "#,##0.00";
  totalRow.getCell(amountCol).font = { bold: true };
  totalRow.getCell(1).alignment = { horizontal: "right" };
  return ws;
}

/** Sheet names: 31 characters at most, no \ / ? * [ ] :, and each one different. */
function sheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Project";
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 28)} ${i}`;
  used.add(out.toLowerCase());
  return out;
}

/** Builds the workbook for these VOs (already filtered and in order). */
export async function buildVoLogWorkbook(rows: Variation[], projects: Map<string, Project>, files: Map<string, number>): Promise<Blob> {
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Northcroft";
  wb.created = new Date();
  const used = new Set<string>();
  const byProject = new Map<string, Variation[]>();
  for (const v of rows) byProject.set(v.project_id, [...(byProject.get(v.project_id) ?? []), v]);
  if (byProject.size > 1) addSheet(wb, sheetName("All projects", used), "All projects", rows, true, projects, files);
  const ordered = [...byProject.entries()].sort((a, b) => (projects.get(a[0])?.name ?? "").localeCompare(projects.get(b[0])?.name ?? ""));
  for (const [pid, list] of ordered) {
    const p = projects.get(pid);
    addSheet(wb, sheetName(p?.name ?? "Project", used), p?.name ?? "Project", list, false, projects, files);
  }
  if (!rows.length) addSheet(wb, "VO log", "VO log", [], true, projects, files);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}

/** "Northcroft VO log 25 Oct 2026.xlsx" */
export const voLogFileName = () => `Northcroft VO log ${fmtDate(todayISO(), { day: "numeric", month: "short", year: "numeric" })}.xlsx`;

/** Saves the file on this device. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
