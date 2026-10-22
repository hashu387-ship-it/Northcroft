import { useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { usePeople, useSettings } from "@/lib/api";
import { addDays, addMonths, fmtMonth, isWorkday, monthStart, todayISO } from "@/lib/time";
import type { Attendance, Profile } from "@/lib/types";
import { Avatar, Loading, useToast } from "@/components/ui";
import { hhmm, hoursWorked, isOffsite, useAttendanceRange, useTrackingStart } from "./shared";

interface Summary {
  person: Profile;
  days: number;
  late: number;
  lateMinutes: number;
  early: number;
  offsite: number;
  avgHours: number | null;
  absent: number;
}

function csvCell(v: string | number | null | undefined) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function MonthlyReport() {
  const people = usePeople();
  const { data: settings } = useSettings();
  const toast = useToast();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const from = `${month}-01`;
  const lastDay = addDays(addMonths(from, 1), -1);
  const to = lastDay < todayISO() ? lastDay : todayISO();
  const { data: rows = [], isLoading } = useAttendanceRange(from, lastDay);
  const { data: trackingStart } = useTrackingStart();

  // Working days so far this month (shown in the subtitle).
  const workdays = useMemo(() => {
    const days: string[] = [];
    if (from > todayISO()) return days;
    for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, settings?.work_days)) days.push(d);
    return days;
  }, [from, to, settings?.work_days]);

  // Absences only count on finished working days since the team started checking in.
  const absenceDays = useMemo(() => {
    if (!trackingStart) return [];
    const yesterday = addDays(todayISO(), -1);
    return workdays.filter((d) => d >= trackingStart && d <= yesterday);
  }, [workdays, trackingStart]);

  const summaries = useMemo<Summary[]>(() => {
    return people.active.map((person) => {
      const mine = rows.filter((r) => r.user_id === person.id);
      const hrs = mine.map(hoursWorked).filter((h): h is number => h !== null);
      const presentDays = new Set(mine.map((r) => r.work_date));
      return {
        person,
        days: mine.length,
        late: mine.filter((r) => r.late_minutes > 0).length,
        lateMinutes: mine.reduce((a, r) => a + r.late_minutes, 0),
        early: mine.filter((r) => r.early_minutes > 0).length,
        offsite: mine.filter(isOffsite).length,
        avgHours: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null,
        absent: absenceDays.filter((d) => !presentDays.has(d)).length,
      };
    });
  }, [people.active, rows, absenceDays]);

  function download() {
    const header = ["Date", "Name", "Check in", "In place", "In address", "Check out", "Out place", "Out address", "Hours", "Late minutes", "Early minutes", "Note"];
    const lines = [header.join(",")];
    const byKey = new Map<string, Attendance>(rows.map((r) => [`${r.work_date}|${r.user_id}`, r]));
    const allDays = new Set<string>([...absenceDays, ...rows.map((r) => r.work_date)]);
    const days = [...allDays].sort();
    for (const d of days) {
      for (const p of people.active) {
        const r = byKey.get(`${d}|${p.id}`);
        if (!r) {
          if (absenceDays.includes(d)) lines.push([d, p.full_name, "", "", "", "", "", "", "", "", "", "Absent"].map(csvCell).join(","));
          continue;
        }
        const h = hoursWorked(r);
        lines.push(
          [
            d,
            p.full_name,
            hhmm(r.check_in_at),
            r.in_place_name,
            r.in_address,
            hhmm(r.check_out_at),
            r.out_place_name,
            r.out_address,
            h === null ? "" : h.toFixed(2),
            r.late_minutes,
            r.early_minutes,
            r.note,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `northcroft-attendance-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Report downloaded");
  }

  return (
    <div className="glass card stack" style={{ gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0, flexWrap: "wrap" }}>
        <h2>
          <FileSpreadsheet /> Monthly report
        </h2>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            type="month"
            value={month}
            max={todayISO().slice(0, 7)}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            style={{ minHeight: 36, padding: "6px 10px", width: 170 }}
            aria-label="Pick a month"
          />
          <button className="btn small primary" onClick={download} disabled={isLoading} type="button">
            <Download /> Download CSV
          </button>
        </div>
      </div>
      <div className="muted small" style={{ marginTop: -6 }}>
        {fmtMonth(from)} · {workdays.length} working {workdays.length === 1 ? "day" : "days"} so far
        {monthStart(todayISO()) === from ? " this month" : ""}. Absences count from the first day anyone checked in. The CSV has one row per person per day and opens in Excel.
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <div className="solid table-wrap">
          <table className="table" style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Person</th>
                <th className="r">Days in</th>
                <th className="r">Absent</th>
                <th className="r">Late</th>
                <th className="r">Late min</th>
                <th className="r">Early</th>
                <th className="r">Off-site</th>
                <th className="r">Avg</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.person.id}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <Avatar person={s.person} size={26} />
                      <span className="bold">{s.person.short_name}</span>
                    </span>
                  </td>
                  <td className="r num">{s.days}</td>
                  <td className="r num" style={{ color: s.absent ? "var(--red)" : undefined }}>
                    {s.absent}
                  </td>
                  <td className="r num" style={{ color: s.late ? "var(--orange)" : undefined }}>
                    {s.late}
                  </td>
                  <td className="r num">{s.lateMinutes}</td>
                  <td className="r num" style={{ color: s.early ? "var(--orange)" : undefined }}>
                    {s.early}
                  </td>
                  <td className="r num" style={{ color: s.offsite ? "var(--orange)" : undefined }}>
                    {s.offsite}
                  </td>
                  <td className="r num">{s.avgHours === null ? "–" : `${s.avgHours.toFixed(1)}h`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
