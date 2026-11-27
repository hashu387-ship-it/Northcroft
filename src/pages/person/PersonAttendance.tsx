// A person's attendance, a month at a time: a calendar of the days they were in (on time or late),
// absent or on leave, the month's totals, and each day's check-in and out underneath.
// Managers and seniors who see presence only get the calendar and totals without times.
import "@/styles/admin.css";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight, EyeOff } from "lucide-react";
import { leaveByDay, leaveKindLabel, useTeamLeave } from "@/lib/leave";
import { unwrap, useSettings } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { addDays, addMonths, dateOf, DOW_SHORT, dow, fmtMonth, fmtTime12, isWorkday, monthStart, todayISO } from "@/lib/time";
import type { Attendance, Profile } from "@/lib/types";
import { Loading } from "@/components/ui";
import { MyHistory } from "../attendance/MyHistory";
import { hhmm, hoursWorked, isOffsite, usePresenceRange } from "../attendance/shared";
import type { PersonAccess } from "./access";

type DayState = "in" | "late" | "absent" | "leave" | "off" | "pending" | "future" | "none";

interface Day {
  date: string;
  state: DayState;
  row?: Attendance;
  leave?: string;
}

/** One person's check-ins between two dates, newest first. */
export function usePersonAttendance(userId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["attendance", "person", userId, from, to],
    enabled,
    queryFn: () =>
      unwrap<Attendance[]>(
        supabase.from("attendance").select("*").eq("user_id", userId).gte("work_date", from).lte("work_date", to).order("work_date", { ascending: false }),
      ),
  });
}

const LABEL: Record<DayState, string> = {
  in: "In",
  late: "Late",
  absent: "Absent",
  leave: "On leave",
  off: "Day off",
  pending: "Not in yet",
  future: "",
  none: "",
};

export function PersonAttendance({ person, access }: { person: Profile; access: PersonAccess }) {
  const today = todayISO();
  const thisMonth = monthStart(today);
  const [month, setMonth] = useState(thisMonth);
  const from = month;
  const to = addDays(addMonths(month, 1), -1);
  const { data: settings } = useSettings();
  const workDays = settings?.work_days;
  const times = access.attendanceTimes;

  const rows = usePersonAttendance(person.id, from, to, times);
  const presence = usePresenceRange(from, to, access.attendancePresence);
  const away = useTeamLeave(from, to);

  const days = useMemo<Day[]>(() => {
    const byDate = new Map((rows.data ?? []).map((r) => [r.work_date, r]));
    const present = new Set((presence.data ?? []).filter((p) => p.user_id === person.id && p.present).map((p) => p.work_date));
    const leave = leaveByDay((away.data ?? []).filter((r) => r.user_id === person.id), from, to, workDays);
    const started = dateOf(person.created_at);
    const out: Day[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const row = byDate.get(d);
      const onLeave = leave.get(`${person.id}|${d}`);
      let state: DayState;
      if (row) state = row.late_minutes > 0 ? "late" : "in";
      else if (present.has(d)) state = "in";
      else if (onLeave) state = "leave";
      else if (d > today) state = "future";
      else if (d < started) state = "none";
      else if (!isWorkday(d, workDays)) state = "off";
      else if (d === today) state = "pending";
      else state = "absent";
      out.push({ date: d, state, row, leave: onLeave ? leaveKindLabel(onLeave.kind) || "Leave" : undefined });
    }
    return out;
  }, [rows.data, presence.data, away.data, from, to, today, workDays, person.id, person.created_at]);

  const totals = useMemo(() => {
    const att = rows.data ?? [];
    const inDays = days.filter((d) => d.state === "in" || d.state === "late").length;
    const ins = att.map((r) => {
      const [h, m] = hhmm(r.check_in_at).split(":").map(Number);
      return h * 60 + m;
    });
    const avg = ins.length ? Math.round(ins.reduce((a, b) => a + b, 0) / ins.length) : null;
    const hours = att.reduce((s, r) => s + (hoursWorked(r) ?? 0), 0);
    return {
      inDays,
      late: days.filter((d) => d.state === "late").length,
      absent: days.filter((d) => d.state === "absent").length,
      leave: days.filter((d) => d.state === "leave" && isWorkday(d.date, workDays)).length,
      away: att.filter(isOffsite).length,
      avg: avg == null ? null : `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`,
      hours,
    };
  }, [days, rows.data, workDays]);

  const loading = (times && rows.isLoading) || (access.attendancePresence && presence.isLoading);
  const blanks = dow(from);
  const name = access.self ? "you" : person.short_name;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="glass card stack pp-att" style={{ gap: 14 }}>
        <div className="card-head">
          <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
            <ChevronLeft />
          </button>
          <h2 className="pp-month">{fmtMonth(month)}</h2>
          <button type="button" className="icon-btn" aria-label="Next month" disabled={month >= thisMonth} onClick={() => setMonth(addMonths(month, 1))}>
            <ChevronRight />
          </button>
        </div>

        <div className="pp-att-stats">
          <div>
            <b className="num">{totals.inDays}</b>
            <span>days in</span>
          </div>
          <div className={clsx(totals.late && "tone-orange")}>
            <b className="num">{totals.late}</b>
            <span>late</span>
          </div>
          <div className={clsx(totals.absent && "tone-red")}>
            <b className="num">{totals.absent}</b>
            <span>absent</span>
          </div>
          <div className={clsx(totals.leave && "tone-purple")}>
            <b className="num">{totals.leave}</b>
            <span>on leave</span>
          </div>
          {times && (
            <>
              <div>
                <b className="num">{totals.avg ?? "–"}</b>
                <span>average in</span>
              </div>
              <div>
                <b className="num">{totals.hours ? `${Math.round(totals.hours)}h` : "–"}</b>
                <span>at work</span>
              </div>
            </>
          )}
        </div>

        {loading ? (
          <Loading rows={2} />
        ) : (
          <div className="pp-cal" role="grid" aria-label={`${person.short_name}'s attendance in ${fmtMonth(month)}`}>
            {DOW_SHORT.map((d) => (
              <div key={d} className="pp-cal-dow" role="columnheader">
                {d.slice(0, 1)}
              </div>
            ))}
            {Array.from({ length: blanks }, (_, i) => (
              <div key={`b${i}`} />
            ))}
            {days.map((d) => (
              <div
                key={d.date}
                role="gridcell"
                className={clsx("pp-day", `s-${d.state}`, d.date === today && "today")}
                title={[fmtTime12(d.row?.check_in_at ?? null), LABEL[d.state], d.leave].filter(Boolean).join(" · ")}
                aria-label={`${d.date}: ${d.leave ?? LABEL[d.state] ?? ""}${d.row ? ` at ${fmtTime12(d.row.check_in_at)}` : ""}`}
              >
                <span className="n">{Number(d.date.slice(8))}</span>
                {times && d.row ? <span className="t">{hhmm(d.row.check_in_at)}</span> : <span className="t">{d.state === "leave" ? "Leave" : " "}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="pp-legend">
          <span className="s-in">In</span>
          <span className="s-late">Late</span>
          <span className="s-absent">Absent</span>
          <span className="s-leave">Leave</span>
          <span className="s-off">Day off</span>
        </div>
        {access.attendancePresence && (
          <p className="small muted row" style={{ gap: 6 }}>
            <EyeOff size={14} /> You see whether {name} was in, absent or on leave, without check-in times or places.
          </p>
        )}
        {times && totals.away > 0 && (
          <p className="small muted">
            {totals.away} {totals.away === 1 ? "day" : "days"} checked in away from the office or a site.
          </p>
        )}
      </div>

      {times && (
        <MyHistory
          rows={rows.data ?? []}
          loading={rows.isLoading}
          userId={person.id}
          from={from}
          title="Day by day"
          emptyText={month === thisMonth ? `No check-ins yet this month.` : `No check-ins in ${fmtMonth(month)}.`}
        />
      )}
    </div>
  );
}
