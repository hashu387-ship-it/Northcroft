// The Time report: how long each person spent on which task, from the stopwatch on tasks. By person
// or by task, for today, this week, last week or this month, with the hours per day and an Excel
// download. Managers and seniors see everyone; a team member sees their own time.
import "@/styles/timereport.css";
import { useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { ChevronDown, Download, Timer } from "lucide-react";
import { usePeople, useProjectMap } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { buildReport, buildTimeWorkbook, PERIODS, periodDays, useTimeReport, type Period } from "@/lib/timeReport";
import { fmtSpent, useNow } from "@/lib/tracked";
import { saveBlob } from "@/lib/vologExcel";
import { DOW_SHORT, dow, fmtDate } from "@/lib/time";
import { errorMessage } from "@/lib/supabase";
import { PageHead } from "@/components/PageHead";
import { Avatar, AvatarStack, CountUp, Empty, Loading, ProjectTag, Segmented, useToast } from "@/components/ui";

type By = "person" | "task";

const hoursText = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)}h` : fmtSpent(secs));

export default function TimeReport() {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const projects = useProjectMap();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const period = (PERIODS.some((p) => p.value === params.get("period")) ? params.get("period") : "week") as Period;
  const by = (params.get("by") === "task" ? "task" : "person") as By;
  const set = (k: string, v: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (v === fallback) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };
  const { from, to } = periodDays(period);
  const q = useTimeReport(from, to, canAssign ? undefined : me.id);
  const now = useNow(30_000);
  const r = useMemo(() => buildReport(q.data ?? [], from, to, now), [q.data, from, to, now]);
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const label = `${PERIODS.find((p) => p.value === period)?.label}: ${fmtDate(from, { day: "numeric", month: "short" })}${from === to ? "" : ` to ${fmtDate(to, { day: "numeric", month: "short", year: "numeric" })}`}`;
  const running = r.people.filter((p) => p.running).length;
  const maxDay = Math.max(1, ...r.perDay);
  const maxRow = Math.max(1, ...(by === "person" ? r.people : r.tasks).map((x) => x.secs));

  async function download() {
    setSaving(true);
    try {
      const blob = await buildTimeWorkbook(r, label, (id) => people.get(id), projects.byId);
      saveBlob(blob, `Northcroft time ${from}${from === to ? "" : ` to ${to}`}.xlsx`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page tr-page">
      <PageHead
        title="Time report"
        sub={canAssign ? "Time the team spent on tasks, from the stopwatch on each task" : "Your time on tasks, from the stopwatch on each task"}
        actions={
          <button className="btn" type="button" onClick={() => void download()} disabled={saving || !r.total}>
            <Download /> {saving ? "Making the file..." : "Excel"}
          </button>
        }
      />

      <div className="tr-controls">
        <Segmented<Period> value={period} onChange={(v) => set("period", v, "week")} options={PERIODS} />
        {canAssign && (
          <Segmented<By>
            value={by}
            onChange={(v) => set("by", v, "person")}
            options={[
              { value: "person", label: "By person" },
              { value: "task", label: "By task" },
            ]}
          />
        )}
      </div>

      {q.isLoading ? (
        <Loading rows={4} />
      ) : !r.total && !running ? (
        <div className="glass">
          <Empty icon={<Timer />} title="No time yet">
            {period === "today" ? "Nobody has timed a task today yet." : "Nothing was timed in this period."} Start the stopwatch on any task you're on, and the
            time shows up here.
          </Empty>
        </div>
      ) : (
        <>
          <div className="tr-stats">
            <div className="glass stat tone-teal">
              <span className="label">Total</span>
              <span className="value">
                <CountUp value={Math.floor(r.total / 3600)} />
                <small>h</small> <CountUp value={Math.floor((r.total % 3600) / 60)} />
                <small>m</small>
              </span>
              <span className="hint">{label}</span>
            </div>
            {canAssign && (
              <div className="glass stat tone-indigo">
                <span className="label">People</span>
                <span className="value">
                  <CountUp value={r.people.length} />
                </span>
                <span className="hint">{running ? `${running} timing a task now` : "timed something"}</span>
              </div>
            )}
            <div className="glass stat tone-amber">
              <span className="label">Tasks</span>
              <span className="value">
                <CountUp value={r.tasks.length} />
              </span>
              <span className="hint">with time on them</span>
            </div>
          </div>

          {r.days.length > 1 && (
            <div className="glass card tr-days">
              <div className="card-head">
                <h3 className="tone-teal">Hours per day</h3>
              </div>
              <div className="tr-bars" role="list">
                {r.days.map((d, i) => {
                  const secs = r.perDay[i];
                  return (
                    <div key={d} className={clsx("tr-bar", !secs && "zero")} role="listitem" aria-label={`${DOW_SHORT[dow(d)]} ${fmtDate(d)}: ${hoursText(secs)}`}>
                      <span className="tr-bar-val">{secs ? hoursText(secs) : ""}</span>
                      <span className="tr-bar-col">
                        <i style={{ ["--h" as string]: `${(secs / maxDay) * 100}%`, animationDelay: `${i * 40}ms` } as CSSProperties} />
                      </span>
                      <span className="tr-bar-day">{r.days.length > 7 ? fmtDate(d, { day: "numeric" }) : DOW_SHORT[dow(d)]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {by === "person" || !canAssign ? (
            <div className="glass tr-list">
              {r.people.map((p) => {
                const who = people.get(p.userId);
                const isOpen = open === p.userId || !canAssign;
                return (
                  <div key={p.userId} className={clsx("tr-person", isOpen && "open")} style={who?.color ? ({ ["--person" as string]: who.color } as CSSProperties) : undefined}>
                    <button type="button" className="tr-row" onClick={() => setOpen(isOpen && canAssign ? null : p.userId)} aria-expanded={isOpen}>
                      <Avatar person={who} size={36} />
                      <span className="tr-main">
                        <b>
                          {who?.short_name ?? "Former team member"}
                          {p.userId === me.id && <span className="faint"> (you)</span>}
                          {p.running && <i className="trk-live" aria-label="Timing a task now" />}
                        </b>
                        <span className="tr-meter">
                          <i style={{ width: `${(p.secs / maxRow) * 100}%` }} />
                        </span>
                        <span className="faint tiny">
                          {p.tasks.length} {p.tasks.length === 1 ? "task" : "tasks"}
                        </span>
                      </span>
                      <span className="tr-total">{hoursText(p.secs)}</span>
                      {canAssign && <ChevronDown className="tr-chev" aria-hidden />}
                    </button>
                    {isOpen && (
                      <ul className="tr-sub">
                        {p.tasks.map((t) => (
                          <li key={t.taskId}>
                            <Link to={`/tasks/${t.taskId}`} className="tr-subrow">
                              <span className="grow">
                                <span className="tr-title">{t.title}</span>
                                {t.projectId && <ProjectTag project={projects.get(t.projectId)} />}
                              </span>
                              {t.running && <i className="trk-live" aria-label="Running now" />}
                              <span className="tr-total small">{hoursText(t.secs)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="glass tr-list">
              {r.tasks.map((t) => (
                <Link key={t.taskId} to={`/tasks/${t.taskId}`} className="tr-row tr-taskrow">
                  <span className="tr-main">
                    <b className="tr-title">
                      {t.title}
                      {t.running && <i className="trk-live" aria-label="Someone is timing it now" />}
                    </b>
                    <span className="tr-meter">
                      <i style={{ width: `${(t.secs / maxRow) * 100}%` }} />
                    </span>
                    <span className="row" style={{ gap: 8 }}>
                      {t.projectId && <ProjectTag project={projects.get(t.projectId)} />}
                      <span className="faint tiny">{t.people.map((x) => `${people.get(x.userId)?.short_name ?? "Someone"} ${hoursText(x.secs)}`).join(" · ")}</span>
                    </span>
                  </span>
                  <AvatarStack people={t.people.map((x) => people.get(x.userId))} size={26} max={3} />
                  <span className="tr-total">{hoursText(t.secs)}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
