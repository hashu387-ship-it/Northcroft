// Attendance for managers who see who is present, absent or on leave, but never check-in or
// check-out times or places (the database only gives them presence, through team_presence).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Download, Users } from "lucide-react";
import { usePeople, useSettings } from "@/lib/api";
import { DOW_SHORT, addDays, addMonths, dow, fmtLongDate, fmtMonth, isWorkday, monthStart, todayISO } from "@/lib/time";
import type { Profile } from "@/lib/types";
import { PersonAvatar, WhatsAppButton } from "@/components/People";
import { Avatar, Empty, Loading, Pill, useToast } from "@/components/ui";
import { usePresenceRange, type PresenceRow } from "./shared";
import "@/styles/comms.css";

export type PresenceStatus = "present" | "absent" | "not_in" | "leave" | "no_record";

const LABEL: Record<PresenceStatus, string> = {
  present: "Present",
  absent: "Absent",
  not_in: "Not in yet",
  leave: "On leave",
  no_record: "No record",
};
const TONE: Record<PresenceStatus, string> = {
  present: "green",
  absent: "red",
  not_in: "orange",
  leave: "blue",
  no_record: "gray",
};
const DOT: Record<PresenceStatus, string> = {
  present: "var(--green)",
  absent: "var(--red)",
  not_in: "var(--orange)",
  leave: "var(--accent)",
  no_record: "var(--text-3)",
};

/**
 * One person's day. Weekends show nothing unless they came in or were on leave. A finished working
 * day nobody in the team came in counts as "No record" (a holiday, or before check-ins started),
 * not as everyone absent.
 */
export function presenceStatus(row: PresenceRow | undefined, date: string, working: boolean, anyoneIn: boolean): PresenceStatus | null {
  if (row?.present) return "present";
  if (row?.on_leave) return "leave";
  if (!working) return null;
  const today = todayISO();
  if (date > today) return null;
  if (date === today) return "not_in";
  return anyoneIn ? "absent" : "no_record";
}

/* ---------------------------------------------------------------- one day, for the Attendance page */
export function PresenceBoard() {
  const people = usePeople();
  const { data: settings } = useSettings();
  const [date, setDate] = useState(todayISO());
  const { data: rows = [], isLoading } = usePresenceRange(date, date);
  const isToday = date === todayISO();
  const working = settings ? isWorkday(date, settings.work_days) : true;
  const byUser = useMemo(() => new Map(rows.map((r) => [r.user_id, r])), [rows]);
  const anyoneIn = rows.some((r) => r.present);
  const list = people.attenders;
  const statuses = list.map((p) => presenceStatus(byUser.get(p.id), date, working, anyoneIn));
  const count = (s: PresenceStatus) => statuses.filter((x) => x === s).length;
  const notIn = isToday ? count("not_in") : count("absent");

  return (
    <div className="glass card stack" style={{ gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0, flexWrap: "wrap" }}>
        <h2>
          <Users /> {isToday ? "Team today" : "Team on this day"}
        </h2>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn small" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" type="button">
            <ChevronLeft />
          </button>
          <input
            className="input"
            type="date"
            value={date}
            max={todayISO()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ minHeight: 36, padding: "6px 10px", width: 160 }}
            aria-label="Pick a day"
          />
          <button className="icon-btn small" onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="Next day" type="button">
            <ChevronRight />
          </button>
          {!isToday && (
            <button className="btn small" onClick={() => setDate(todayISO())} type="button">
              Today
            </button>
          )}
        </div>
      </div>
      <div className="muted small" style={{ marginTop: -6 }}>
        {fmtLongDate(date)}
        {!working && " · weekend"}
      </div>

      <div className="presence-stats">
        <Stat label="Present" value={count("present")} tone="green" />
        <Stat label={isToday ? "Not in yet" : "Absent"} value={notIn} tone={notIn && working ? (isToday ? "orange" : "red") : "gray"} />
        <Stat label="On leave" value={count("leave")} tone={count("leave") ? "blue" : "gray"} />
      </div>

      {isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty icon={<Users />} title="Nobody checks in yet" />
      ) : (
        <div className="list">
          {list.map((p, i) => (
            <PresenceRowItem key={p.id} person={p} status={statuses[i]} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="solid stat" style={{ borderRadius: 10, padding: 12 }}>
      <span className="label">{label}</span>
      <span className="value" style={{ fontSize: 20, color: tone === "gray" ? undefined : `var(--${tone === "blue" ? "accent" : tone})` }}>
        {value}
      </span>
    </div>
  );
}

function PresenceRowItem({ person, status }: { person: Profile; status: PresenceStatus | null }) {
  return (
    <div className="list-item">
      <PersonAvatar person={person} size={36} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title">{person.short_name}</div>
        <div className="faint tiny ellipsis">{person.title}</div>
      </div>
      <div className="row" style={{ gap: 8, flexShrink: 0 }}>
        {status && <Pill tone={TONE[status]}>{LABEL[status]}</Pill>}
        <WhatsAppButton person={person} variant="small" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the month */
interface MonthSummary {
  person: Profile;
  present: number;
  absent: number;
  leave: number;
}

function csvCell(v: string | number | null | undefined) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function PresenceMonthly() {
  const people = usePeople();
  const { data: settings } = useSettings();
  const toast = useToast();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const from = `${month}-01`;
  const lastDay = addDays(addMonths(from, 1), -1);
  const today = todayISO();
  const to = lastDay < today ? lastDay : today;
  const { data: rows = [], isLoading } = usePresenceRange(from, lastDay);

  const workdays = useMemo(() => {
    const days: string[] = [];
    if (from > today) return days;
    for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, settings?.work_days)) days.push(d);
    return days;
  }, [from, to, today, settings?.work_days]);

  // Absences count on finished working days, from the first day anyone came in this month.
  const absenceDays = useMemo(() => {
    const firstIn = rows.filter((r) => r.present).reduce<string | null>((m, r) => (m === null || r.work_date < m ? r.work_date : m), null);
    if (!firstIn) return [];
    const yesterday = addDays(today, -1);
    return workdays.filter((d) => d >= firstIn && d <= yesterday);
  }, [rows, workdays, today]);

  const byKey = useMemo(() => new Map(rows.map((r) => [`${r.work_date}|${r.user_id}`, r])), [rows]);

  const summaries = useMemo<MonthSummary[]>(
    () =>
      people.attenders.map((person) => {
        let present = 0;
        let leave = 0;
        let absent = 0;
        for (let d = from; d <= to; d = addDays(d, 1)) {
          const r = byKey.get(`${d}|${person.id}`);
          if (r?.present) present++;
          else if (r?.on_leave && workdays.includes(d)) leave++;
        }
        for (const d of absenceDays) {
          const r = byKey.get(`${d}|${person.id}`);
          if (!r?.present && !r?.on_leave) absent++;
        }
        return { person, present, absent, leave };
      }),
    [people.attenders, byKey, from, to, workdays, absenceDays],
  );

  function download() {
    const lines = [["Date", "Name", "Status"].join(",")];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      for (const p of people.attenders) {
        const r = byKey.get(`${d}|${p.id}`);
        const status = r?.present ? "Present" : r?.on_leave && workdays.includes(d) ? "On leave" : absenceDays.includes(d) ? "Absent" : null;
        if (status) lines.push([d, p.full_name, status].map(csvCell).join(","));
      }
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `northcroft-presence-${month}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("Summary downloaded");
  }

  return (
    <div className="glass card stack" style={{ gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0, flexWrap: "wrap" }}>
        <h2>
          <CalendarDays /> Monthly summary
        </h2>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            type="month"
            value={month}
            max={today.slice(0, 7)}
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
        {monthStart(today) === from ? " this month" : ""}. Days present, absent and on leave for each person.
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <div className="solid table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th className="r">Present</th>
                <th className="r">Absent</th>
                <th className="r">On leave</th>
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
                  <td className="r num">{s.present}</td>
                  <td className="r num" style={{ color: s.absent ? "var(--red)" : undefined }}>
                    {s.absent}
                  </td>
                  <td className="r num" style={{ color: s.leave ? "var(--accent)" : undefined }}>
                    {s.leave}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the Home card */
export function TeamTodayPresence() {
  const today = todayISO();
  const people = usePeople();
  const settings = useSettings().data;
  const q = usePresenceRange(today, today);
  const byUser = new Map((q.data ?? []).map((r) => [r.user_id, r]));
  const working = isWorkday(today, settings?.work_days);
  const list = people.attenders;
  const statuses = list.map((p) => presenceStatus(byUser.get(p.id), today, working, true));
  const present = statuses.filter((s) => s === "present").length;
  const leave = statuses.filter((s) => s === "leave").length;

  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-green">
          <Users /> Team today
        </h2>
        <Link to="/attendance">Attendance</Link>
      </div>
      <p className="muted small" style={{ marginBottom: 10 }}>
        {working
          ? `${present} of ${list.length} in today${leave ? `, ${leave} on leave` : ""}`
          : `${DOW_SHORT[dow(today)]} is a weekend day`}
      </p>
      {q.isLoading ? (
        <Loading />
      ) : (
        <div className="team-snap">
          {list.map((p, i) => {
            const s = statuses[i];
            return (
              <div className="person" key={p.id}>
                <Avatar person={p} size={30} />
                <div className="who">
                  <b>{p.short_name}</b>
                  <span>{s ? LABEL[s] : "Weekend"}</span>
                </div>
                <i className="status-dot" style={s ? { background: DOT[s] } : undefined} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
