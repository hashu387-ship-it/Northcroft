// Daily updates. The team sends one each day (how far each task got and what they did on it);
// managers and seniors see everyone's, day by day, with who hasn't sent theirs yet.
import "@/styles/updates.css";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, ClipboardList, Pencil } from "lucide-react";
import { usePeople, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { sendsDailyUpdate, useMyDailyUpdate, useMyDailyUpdates, useTeamDailyUpdates } from "@/lib/dailyUpdates";
import { leaveByDay, leaveKindLabel, useTeamLeave } from "@/lib/leave";
import { nameList } from "@/lib/people";
import { addDays, fmtLongDate, isWorkday, todayISO } from "@/lib/time";
import { PageHead } from "@/components/PageHead";
import { Avatar, Empty, Loading, Pill, Segmented } from "@/components/ui";
import { UpdateForm } from "./updates/UpdateForm";
import { UpdateCard } from "./updates/UpdateCard";

type Tab = "mine" | "team";

export default function DailyUpdates() {
  const me = useMe();
  const { canAssign } = useAuth();
  const mine = sendsDailyUpdate(me);
  const [params, setParams] = useSearchParams();
  const tab: Tab = mine && (!canAssign || params.get("tab") !== "team") ? "mine" : "team";

  if (!mine && !canAssign) {
    return (
      <div className="page">
        <PageHead title="Daily updates" />
        <Empty icon={<ClipboardList />} title="You don't send daily updates">
          Your manager can switch them on for you in Settings.
        </Empty>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        title="Daily updates"
        sub={
          mine && canAssign
            ? "Send yours before you check out, and see the team's day."
            : mine
              ? "Before you check out, say how far your tasks got and what you did on them."
              : "What the team did each day, how far each task got, and who hasn't sent theirs."
        }
      />
      {mine && canAssign && (
        <div style={{ marginBottom: 14 }}>
          <Segmented<Tab>
            value={tab}
            onChange={(v) => setParams(v === "team" ? { tab: "team" } : {}, { replace: true })}
            options={[
              { value: "mine", label: "My update" },
              { value: "team", label: "Team" },
            ]}
          />
        </div>
      )}
      {tab === "mine" ? <MyUpdates /> : <TeamDay />}
    </div>
  );
}

function MyUpdates() {
  const me = useMe();
  const today = todayISO();
  const todayQ = useMyDailyUpdate(me.id, today);
  const history = useMyDailyUpdates(me.id);
  const [editing, setEditing] = useState(false);
  const sent = todayQ.data;
  const earlier = (history.data ?? []).filter((u) => u.work_date !== today);

  return (
    <div className="du-page stack" style={{ gap: 16 }}>
      {todayQ.isLoading ? (
        <Loading rows={3} />
      ) : sent && !editing ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="du-section-head">
            <h2>Today</h2>
            <Pill tone="green">Sent</Pill>
          </div>
          <UpdateCard
            update={sent}
            actions={
              <button className="btn small" type="button" onClick={() => setEditing(true)} style={{ alignSelf: "flex-start" }}>
                <Pencil /> Change today's update
              </button>
            }
          />
        </div>
      ) : (
        <div className="glass card stack" style={{ gap: 12 }}>
          <div className="du-section-head">
            <h2>Today's update</h2>
            <span className="faint small">{fmtLongDate(today)}</span>
          </div>
          <UpdateForm existing={sent} onSent={() => setEditing(false)} />
          {editing && (
            <button className="btn ghost small" type="button" onClick={() => setEditing(false)} style={{ alignSelf: "center" }}>
              Keep it as it was
            </button>
          )}
        </div>
      )}

      {earlier.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="du-section-head">
            <h2>Earlier updates</h2>
          </div>
          {earlier.map((u) => (
            <UpdateCard key={u.id} update={u} />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamDay() {
  const people = usePeople();
  const { data: settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") && params.get("date")! <= today ? params.get("date")! : today;
  const updates = useTeamDailyUpdates(date, true);
  const away = useTeamLeave(date, date);
  const working = settings ? isWorkday(date, settings.work_days) : true;

  const setDate = (d: string) => {
    const next = new URLSearchParams(params);
    if (d === today) next.delete("date");
    else next.set("date", d);
    setParams(next, { replace: true });
  };
  // Step to the previous or next working day.
  const step = (dir: -1 | 1) => {
    let d = addDays(date, dir);
    for (let i = 0; i < 7 && settings && !isWorkday(d, settings.work_days); i++) d = addDays(d, dir);
    if (d <= today) setDate(d);
  };

  const view = useMemo(() => {
    const due = people.active.filter((p) => sendsDailyUpdate(p));
    const byUser = new Map((updates.data ?? []).map((u) => [u.user_id, u]));
    const leave = leaveByDay(away.data ?? [], date, date, settings?.work_days);
    const sent = due.filter((p) => byUser.has(p.id)).map((p) => byUser.get(p.id)!);
    // Anyone else who sent one (switched off since, say) still shows.
    for (const u of updates.data ?? []) if (!due.some((p) => p.id === u.user_id)) sent.push(u);
    sent.sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
    const onLeave = due.filter((p) => !byUser.has(p.id) && leave.has(`${p.id}|${date}`));
    const missing = due.filter((p) => !byUser.has(p.id) && !leave.has(`${p.id}|${date}`));
    const blocked = sent.filter((u) => u.blockers).length;
    const handed = sent.reduce((n, u) => n + u.items.filter((i) => i.handed_in).length, 0);
    return { due, sent, onLeave, missing, leave, blocked, handed, expected: due.length - onLeave.length };
  }, [people.active, updates.data, away.data, date, settings?.work_days]);

  return (
    <div className="du-page stack" style={{ gap: 14 }}>
      <div className="glass card du-day">
        <button className="icon-btn small" type="button" onClick={() => step(-1)} aria-label="Previous day">
          <ChevronLeft />
        </button>
        <div className="grow" style={{ textAlign: "center" }}>
          <b>{date === today ? "Today" : fmtLongDate(date)}</b>
          <div className="faint tiny">{date === today ? fmtLongDate(date) : !working ? "Day off" : " "}</div>
        </div>
        <button className="icon-btn small" type="button" onClick={() => step(1)} disabled={date >= today} aria-label="Next day">
          <ChevronRight />
        </button>
      </div>

      {updates.isLoading || people.loading ? (
        <Loading rows={3} />
      ) : (
        <>
          <div className="du-stats">
            <div className="glass du-stat">
              <b>
                {view.sent.length}
                <span className="faint"> of {view.expected}</span>
              </b>
              <span>sent</span>
            </div>
            <div className="glass du-stat">
              <b>{view.handed}</b>
              <span>handed in</span>
            </div>
            <div className={`glass du-stat${view.blocked ? " warn" : ""}`}>
              <b>{view.blocked}</b>
              <span>blocked</span>
            </div>
          </div>

          {(view.missing.length > 0 || view.onLeave.length > 0) && (
            <div className="glass card stack" style={{ gap: 10 }}>
              {view.missing.length > 0 && (
                <div className="du-missing">
                  <span className="field-label">{date === today ? "Not sent yet" : "Didn't send one"}</span>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {view.missing.map((p) => (
                      <span key={p.id} className="du-person">
                        <Avatar person={p} size={26} />
                        {p.short_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {view.onLeave.length > 0 && (
                <div className="du-missing">
                  <span className="field-label">On leave</span>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {view.onLeave.map((p) => (
                      <span key={p.id} className="du-person" title={leaveKindLabel(view.leave.get(`${p.id}|${date}`)?.kind)}>
                        <Avatar person={p} size={26} />
                        {p.short_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {view.sent.length === 0 ? (
            <Empty icon={<ClipboardList />} title={date === today ? "No updates yet today" : "No updates that day"}>
              {date === today
                ? view.due.length
                  ? `${nameList(view.due.map((p) => p.short_name))} get a reminder at 5:00 pm, and check-out asks for it first.`
                  : "Nobody is set to send daily updates. Switch them on in Settings, Team."
                : null}
            </Empty>
          ) : (
            view.sent.map((u) => <UpdateCard key={u.id} update={u} who />)
          )}
        </>
      )}
    </div>
  );
}
