// A person's leave: this year's annual balance and their requests (tap one for the details,
// and to approve it when it's your turn).
import "@/styles/leave.css";
import { useState } from "react";
import { TreePalm } from "lucide-react";
import { fmtLeaveDates, daysText, leaveKindLabel, LEAVE_STATUS, useLeaveBalances, useMyLeave } from "@/lib/leave";
import { todayISO } from "@/lib/time";
import type { LeaveRequest, Profile } from "@/lib/types";
import { Empty, Loading, Pill } from "@/components/ui";
import { LeaveDetail } from "../attendance/Leave";

export function PersonLeave({ person, self }: { person: Profile; self: boolean }) {
  const year = Number(todayISO().slice(0, 4));
  const balances = useLeaveBalances(year);
  const requests = useMyLeave(person.id);
  const [open, setOpen] = useState<LeaveRequest | null>(null);
  const b = (balances.data ?? []).find((x) => x.user_id === person.id);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid-4 stat-row pp-leave-stats">
        <div className="glass stat">
          <span className="label">Annual leave {year}</span>
          <span className="value">{b ? b.allowance : "–"}</span>
          <span className="hint">days a year</span>
        </div>
        <div className="glass stat">
          <span className="label">Taken</span>
          <span className="value">{b ? b.used : "–"}</span>
          <span className="hint">days so far</span>
        </div>
        <div className="glass stat">
          <span className="label">Waiting</span>
          <span className="value">{b ? b.pending : "–"}</span>
          <span className="hint">days asked for</span>
        </div>
        <div className="glass stat tone-green">
          <span className="label">Left</span>
          <span className="value" style={{ color: b && b.remaining > 0 ? "var(--green)" : undefined }}>
            {b ? Math.max(b.remaining, 0) : "–"}
          </span>
          <span className="hint">days this year</span>
        </div>
      </div>

      <div>
        <div className="group-title">Requests</div>
        {requests.isLoading ? (
          <Loading rows={2} />
        ) : !requests.data?.length ? (
          <div className="glass">
            <Empty icon={<TreePalm />} title="No leave requests">
              {self ? "Your" : `${person.short_name}'s`} leave requests will show up here.
            </Empty>
          </div>
        ) : (
          <div className="group">
            {requests.data.map((r) => {
              const st = LEAVE_STATUS[r.status];
              return (
                <button key={r.id} type="button" className="group-row no-tile" onClick={() => setOpen(r)}>
                  <span className="label">
                    {leaveKindLabel(r.kind)}
                    <small>
                      {fmtLeaveDates(r.start_date, r.end_date)} · {daysText(r.days)}
                    </small>
                  </span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {open && <LeaveDetail id={open.id} initial={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
