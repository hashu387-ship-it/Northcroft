// Daily update cards for Home: your own (from 2:00 pm, or once sent) and, for managers and
// seniors, how many of the team have sent theirs today.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CircleCheck, ClipboardList, Users } from "lucide-react";
import { usePeople, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { sendsDailyUpdate, useMyDailyUpdate, useTeamDailyUpdates } from "@/lib/dailyUpdates";
import { leaveByDay, useTeamLeave } from "@/lib/leave";
import { nameList } from "@/lib/people";
import { fmtTime, fmtTime12, isWorkday, todayISO } from "@/lib/time";

/** From this time on, Home reminds people about their update. */
const SHOW_FROM = "14:00";

function Card({ tone, icon, headline, sub, to, label, primary }: { tone: string; icon: JSX.Element; headline: string; sub: string; to: string; label: string; primary?: boolean }) {
  return (
    <div className="glass checkin-card">
      <span className="ic" style={{ background: `linear-gradient(145deg, ${tone}, color-mix(in srgb, ${tone} 70%, #000))` }}>{icon}</span>
      <div className="grow">
        <div className="headline">{headline}</div>
        <div className="muted small">{sub}</div>
      </div>
      <Link to={to} className={primary ? "btn primary" : "btn"}>
        {label}
      </Link>
    </div>
  );
}

export function MyUpdateHomeCard() {
  const me = useMe();
  const today = todayISO();
  const settings = useSettings().data;
  const on = sendsDailyUpdate(me);
  const q = useMyDailyUpdate(me.id, today, on);
  if (!on || q.isLoading || q.isError) return null;
  const sent = q.data;
  if (sent) {
    const n = sent.items.length;
    return (
      <Card
        tone="#30D158"
        icon={<CircleCheck />}
        headline={`Today's update sent at ${fmtTime12(sent.submitted_at)}`}
        sub={n ? `${n === 1 ? "1 task" : `${n} tasks`} updated. You can still change it today.` : "You can still change it today."}
        to="/updates"
        label="View"
      />
    );
  }
  if (!isWorkday(today, settings?.work_days) || fmtTime(new Date().toISOString()) < SHOW_FROM) return null;
  return (
    <Card
      tone="#FF6B2C"
      icon={<ClipboardList />}
      headline="Your daily update isn't sent yet"
      sub="Say how far your tasks got today. Check-out asks for it too."
      to="/updates"
      label="Send update"
      primary
    />
  );
}

export function TeamUpdatesHomeCard() {
  const { canAssign } = useAuth();
  const people = usePeople();
  const today = todayISO();
  const settings = useSettings().data;
  const q = useTeamDailyUpdates(today, canAssign);
  const away = useTeamLeave(today, today, canAssign);
  const view = useMemo(() => {
    const leave = leaveByDay(away.data ?? [], today, today, settings?.work_days);
    const due = people.active.filter((p) => sendsDailyUpdate(p) && !leave.has(`${p.id}|${today}`));
    const sentIds = new Set((q.data ?? []).map((u) => u.user_id));
    return { due, sent: due.filter((p) => sentIds.has(p.id)).length, missing: due.filter((p) => !sentIds.has(p.id)) };
  }, [people.active, q.data, away.data, today, settings?.work_days]);

  if (!canAssign || q.isLoading || q.isError || !view.due.length) return null;
  if (!view.sent && fmtTime(new Date().toISOString()) < SHOW_FROM) return null;
  const all = view.sent === view.due.length;
  return (
    <Card
      tone={all ? "#30D158" : "#1B3570"}
      icon={all ? <CircleCheck /> : <Users />}
      headline={`Daily updates: ${view.sent} of ${view.due.length} sent`}
      sub={all ? "Everyone has sent theirs today." : `Not sent yet: ${nameList(view.missing.map((p) => p.short_name))}`}
      to="/updates?tab=team"
      label="See updates"
    />
  );
}
