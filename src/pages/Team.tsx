// Team (/team, under More): everyone on Northcroft with their photo, title, today's status and
// how much work they have open. Tap anyone for their profile. Today's status follows the same
// rules as the profile: times for those who see times, in or not for those who see presence,
// and "On leave" for everyone.
import "@/styles/people.css";
import "@/styles/person.css";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Users } from "lucide-react";
import { usePeople, useSettings, useTasks } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { leaveKindLabel, useTeamLeave } from "@/lib/leave";
import { useOnlineIds } from "@/lib/online";
import { peopleOn, showsManagerLabel } from "@/lib/people";
import { fmtTime12, isWorkday, todayISO } from "@/lib/time";
import type { Profile } from "@/lib/types";
import { PageHead } from "@/components/PageHead";
import { Avatar, Empty, Loading, Pill, SearchField, matchesSearch } from "@/components/ui";
import { useAttendanceRange, usePresenceRange } from "./attendance/shared";

export default function Team() {
  const people = usePeople();
  const me = useMe();
  const { isManager, canAssign } = useAuth();
  const { data: settings } = useSettings();
  const [q, setQ] = useState("");
  const today = todayISO();
  const working = isWorkday(today, settings?.work_days);

  const seesTimes = me.attendance_times !== false && (isManager || (canAssign && !me.attendance_exempt));
  const seesPresence = !seesTimes && (isManager || canAssign);
  const att = useAttendanceRange(today, today, seesTimes);
  const presence = usePresenceRange(today, today, seesPresence);
  const away = useTeamLeave(today, today);
  const open = useTasks({ openOnly: true });
  const online = useOnlineIds();

  const counts = useMemo(() => {
    const m = new Map<string, { open: number; late: number }>();
    for (const t of open.data ?? []) {
      for (const id of peopleOn(t)) {
        const c = m.get(id) ?? { open: 0, late: 0 };
        c.open++;
        if (t.due_date && t.due_date < today && t.status !== "in_review") c.late++;
        m.set(id, c);
      }
    }
    return m;
  }, [open.data, today]);

  const attBy = useMemo(() => new Map((att.data ?? []).map((r) => [r.user_id, r])), [att.data]);
  const presentIds = useMemo(() => new Set((presence.data ?? []).filter((p) => p.present).map((p) => p.user_id)), [presence.data]);
  const leaveBy = useMemo(() => new Map((away.data ?? []).filter((r) => r.start_date <= today && r.end_date >= today).map((r) => [r.user_id, r])), [away.data, today]);

  function status(p: Profile) {
    if (p.attendance_exempt) return null;
    const l = leaveBy.get(p.id);
    if (l) return <Pill tone="purple">{l.kind ? leaveKindLabel(l.kind) : "On leave"}</Pill>;
    if (seesTimes || p.id === me.id) {
      const r = attBy.get(p.id);
      if (r) return <Pill tone={r.check_out_at ? "gray" : r.late_minutes > 0 ? "orange" : "green"}>{r.check_out_at ? `Out ${fmtTime12(r.check_out_at)}` : `In ${fmtTime12(r.check_in_at)}`}</Pill>;
      return working && seesTimes ? <Pill tone="gray">Not in yet</Pill> : null;
    }
    if (seesPresence) return presentIds.has(p.id) ? <Pill tone="green">In</Pill> : working ? <Pill tone="gray">Not in yet</Pill> : null;
    return null;
  }

  const list = people.active.filter((p) => matchesSearch(q, p.full_name, p.short_name, p.title, p.email));
  const inToday = seesTimes ? (att.data ?? []).length : seesPresence ? presentIds.size : null;

  return (
    <div className="page">
      <PageHead
        title="Team"
        sub={`${people.active.length} people${inToday != null && working ? ` · ${inToday} in today` : ""}${leaveBy.size ? ` · ${leaveBy.size} on leave` : ""}`}
      />
      <div style={{ marginBottom: 14 }}>
        <SearchField value={q} onChange={setQ} placeholder="Search by name or title" />
      </div>
      {people.loading ? (
        <Loading rows={5} />
      ) : !list.length ? (
        <div className="glass">
          <Empty icon={<Users />} title="Nobody matches">
            Try part of a name or a job title.
          </Empty>
        </div>
      ) : (
        <div className="group team-list">
          {list.map((p) => {
            const c = counts.get(p.id);
            return (
              <Link key={p.id} to={`/people/${p.id}`} className="group-row team-row">
                <span className={online.has(p.id) ? "avatar-on" : undefined}>
                  <Avatar person={p} size={44} />
                </span>
                <span className="label">
                  <span className="team-name ellipsis">{p.full_name}</span>
                  <small className="team-title">
                    <span className="ellipsis">{p.id === me.id ? `You · ${p.title}` : p.title}</span>
                    {showsManagerLabel(p) && <Pill tone="blue">Manager</Pill>}
                  </small>
                </span>
                <span className="team-side">
                  {status(p)}
                  <span className="team-work num">
                    {c?.late ? <b className="late">{c.late} late · </b> : null}
                    {c?.open ?? 0} open
                  </span>
                </span>
                <ChevronRight className="chev" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
