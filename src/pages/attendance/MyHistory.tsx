import { CalendarClock } from "lucide-react";
import { fmtDate, fmtDuration, fmtTime12, todayISO } from "@/lib/time";
import type { Attendance } from "@/lib/types";
import { Empty, Loading, Pill } from "@/components/ui";
import { PlacePill } from "./shared";

export function MyHistory({ rows, loading }: { rows: Attendance[]; loading: boolean }) {
  const past = rows.filter((r) => r.work_date !== todayISO()).slice(0, 30);
  const late = past.filter((r) => r.late_minutes > 0).length;
  return (
    <div className="glass card">
      <div className="card-head">
        <h2>
          <CalendarClock /> My history
        </h2>
        {past.length > 0 && (
          <span className="muted small">
            {past.length} {past.length === 1 ? "day" : "days"}
            {late > 0 ? ` · late ${late}` : ""}
          </span>
        )}
      </div>
      {loading ? (
        <Loading />
      ) : past.length === 0 ? (
        <Empty icon={<CalendarClock />} title="No earlier days yet">
          Your check-ins from the last 30 days will show up here.
        </Empty>
      ) : (
        <div className="list">
          {past.map((r) => (
            <div key={r.id} className="list-item history-row">
              <div className="history-date">
                <b>{fmtDate(r.work_date, { day: "numeric" })}</b>
                <span>{fmtDate(r.work_date, { weekday: "short", month: "short" })}</span>
              </div>
              <div className="grow stack" style={{ gap: 6 }}>
                <div className="row wrap" style={{ gap: 6 }}>
                  <span className="num small bold">{fmtTime12(r.check_in_at)}</span>
                  <PlacePill kind={r.in_place_kind} name={r.in_place_name} />
                  {r.late_minutes > 0 && <Pill tone="orange">Late {r.late_minutes} min</Pill>}
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {r.check_out_at ? (
                    <>
                      <span className="num small bold">{fmtTime12(r.check_out_at)}</span>
                      <PlacePill kind={r.out_place_kind} name={r.out_place_name} />
                      {r.early_minutes > 0 && <Pill tone="orange">Left {r.early_minutes} min early</Pill>}
                    </>
                  ) : (
                    <span className="small faint">No check-out recorded</span>
                  )}
                </div>
              </div>
              <div className="num bold small nowrap" style={{ textAlign: "right" }}>
                {r.check_out_at ? fmtDuration(r.check_in_at, r.check_out_at) : "–"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
