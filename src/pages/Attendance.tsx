import { Link } from "react-router-dom";
import { Building2, ChevronRight } from "lucide-react";
import { useAuth, useMe } from "@/lib/auth";
import { todayISO } from "@/lib/time";
import { PageHead } from "@/components/PageHead";
import { CheckInCard } from "./attendance/CheckInCard";
import { MyHistory } from "./attendance/MyHistory";
import { TeamBoard } from "./attendance/TeamBoard";
import { MonthlyReport } from "./attendance/MonthlyReport";
import { PresenceBoard, PresenceMonthly } from "./attendance/Presence";
import { useMyAttendance, usePlaces } from "./attendance/shared";
import "@/styles/admin.css";

export default function Attendance() {
  const me = useMe();
  const { canAssign, isManager } = useAuth();
  const mine = useMyAttendance(me.id);
  const places = usePlaces();
  const today = (mine.data ?? []).find((r) => r.work_date === todayISO());
  const noOffice = isManager && places.data && !places.data.some((p) => p.kind === "office" && p.active);
  // Some managers see who is present, absent or on leave, but not times or places.
  const presenceOnly = canAssign && me.attendance_times === false;
  const team = presenceOnly ? (
    <>
      <PresenceBoard />
      <PresenceMonthly />
    </>
  ) : (
    <>
      <TeamBoard />
      <MonthlyReport />
    </>
  );

  // Someone who doesn't check in (the Commercial Manager) only sees the team's attendance.
  if (me.attendance_exempt) {
    return (
      <div className="page">
        <PageHead
          title="Attendance"
          sub={
            !canAssign
              ? "You don't need to check in."
              : presenceOnly
                ? "Who's in, absent or on leave each day, and the monthly summary. You don't need to check in."
                : "The team's day and the monthly report. You don't need to check in."
          }
        />
        {canAssign && <div className="attendance-grid">{team}</div>}
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        title="Check in"
        sub={
          !canAssign
            ? "Record when and where you start and finish work."
            : presenceOnly
              ? "Your attendance, plus who's in, absent or on leave each day."
              : "Your attendance, plus the whole team's day and monthly report."
        }
      />

      {noOffice && (
        <Link to="/settings/places" className="banner glass" style={{ color: "inherit" }}>
          <Building2 />
          <div className="grow small">
            <b>Add the office location</b>
            <div className="muted">Check-ins near the office will then be labelled Office instead of Elsewhere.</div>
          </div>
          <ChevronRight size={18} className="muted" />
        </Link>
      )}

      <div className="attendance-grid">
        <div className="stack" style={{ gap: 16 }}>
          <CheckInCard today={today} />
          <MyHistory rows={mine.data ?? []} loading={mine.isLoading} />
        </div>
        {canAssign && (
          <div className="stack" style={{ gap: 16 }}>
            {team}
          </div>
        )}
      </div>
    </div>
  );
}
