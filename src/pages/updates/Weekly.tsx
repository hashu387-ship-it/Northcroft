// The Weekly tab. Each person's daily updates from Sunday to Thursday, written up as their week on
// Thursday at 5:45 pm: a few lines on the week, each project with every task's % at the start and end of
// the week, other work and what blocked them. Members see their own weeks; managers and seniors see
// the team's week (with each person's), can write it again, and download it all as Excel.
import "@/styles/updates.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Download, Hourglass, RotateCcw, TriangleAlert } from "lucide-react";
import { usePeople } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { progressTone, sendsDailyUpdate, useMyDailyUpdates } from "@/lib/dailyUpdates";
import { addDays, dateOf, fmtDate, todayISO } from "@/lib/time";
import { saveBlob } from "@/lib/vologExcel";
import { buildWeeklyWorkbook, weeklyFileName } from "@/lib/weeklyExcel";
import {
  byName,
  dayLabel,
  hasFacts,
  lastFinishedWeek,
  makeWeeklyUpdate,
  thisWeek,
  useMyWeeklyUpdates,
  useWeek,
  weekEnd,
  weekFromParam,
  weekIsOver,
  weekLabel,
  type PersonFacts,
  type PersonWeek,
  type TeamWeek,
} from "@/lib/weeklyUpdates";
import { Avatar, Empty, Loading, Pill, Spinner, useConfirm, useToast } from "@/components/ui";

export function Weekly() {
  const { canAssign } = useAuth();
  return canAssign ? <TeamWeeks /> : <MyWeeks />;
}

/* ---------------------------------------------------------------- shared bits */

function useDownload() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (week: string, team: TeamWeek | null, people: PersonWeek[], who?: string) => {
    setBusy(true);
    try {
      const blob = await buildWeeklyWorkbook(week, team, people, todayISO());
      saveBlob(blob, weeklyFileName(week, who));
    } catch {
      toast("The Excel file couldn't be made. Try again.", "error");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

const writtenOn = (ts: string | null) => (ts ? dayLabel(dateOf(ts)) : "");

/** What the week's write-up is doing, as a pill. */
function StatusPill({ row, over }: { row: PersonWeek | TeamWeek; over: boolean }) {
  if (row.status === "pending") return <Pill tone="blue">Being written</Pill>;
  if (row.status === "failed") return <Pill tone="red">Couldn't be written</Pill>;
  if (row.status === "empty") return <Pill tone="gray">No daily updates</Pill>;
  return over ? <Pill tone="green">Ready</Pill> : <Pill tone="blue">Week so far</Pill>;
}

/** One person's week: the write-up, each project and its tasks, other work and blockers. */
function PersonWeekCard({
  row,
  over,
  open,
  onToggle,
  showWho,
  actions,
}: {
  row: PersonWeek;
  over: boolean;
  open: boolean;
  onToggle: () => void;
  showWho: boolean;
  actions?: ReactNode;
}) {
  const people = usePeople();
  const f = hasFacts(row.facts) ? (row.facts as PersonFacts) : null;
  const person = people.get(row.user_id);
  const s = row.status === "ready" ? row.summary : null;
  const groups = useMemo(() => {
    const map = new Map<string, PersonFacts["tasks"]>();
    for (const t of f?.tasks ?? []) map.set(t.project ?? "Other", [...(map.get(t.project ?? "Other") ?? []), t]);
    return [...map.entries()].sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : a[0].localeCompare(b[0])));
  }, [f]);
  const written = new Map((s?.projects ?? []).map((p) => [p.project.toLowerCase(), p.summary]));
  const openBlocker = f?.open_blockers ? f.blockers[f.blockers.length - 1] : null;

  return (
    <div className="glass card wk-card">
      <div className="du-card-head">
        {showWho ? (
          <span className="row" style={{ gap: 10, minWidth: 0 }}>
            <Avatar person={person} size={38} />
            <span style={{ minWidth: 0 }}>
              <b>{f?.name ?? person?.full_name ?? "Someone"}</b>
              <span className="faint tiny ellipsis" style={{ display: "block" }}>
                {f?.title ?? person?.title}
              </span>
            </span>
          </span>
        ) : (
          <span style={{ minWidth: 0 }}>
            <b>{weekLabel(row.week_start)}</b>
            <span className="faint tiny" style={{ display: "block" }}>
              {row.generated_at ? `Written ${writtenOn(row.generated_at)}` : " "}
            </span>
          </span>
        )}
        <span className="spacer" />
        <span className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
          {openBlocker && <Pill tone="orange">Blocked</Pill>}
          <StatusPill row={row} over={over} />
        </span>
      </div>

      {f && (
        <div className="du-counts">
          <span>
            <b>
              {f.days_sent} of {f.days_expected}
            </b>{" "}
            daily updates
          </span>
          <span>
            <b>{f.moved}</b> {f.moved === 1 ? "task" : "tasks"} moved on
          </span>
          <span>
            <b>{f.handed_in}</b> handed in
          </span>
          {f.leave_days.length > 0 && <span>On leave {f.leave_days.map((d) => dayLabel(d)).join(", ")}</span>}
        </div>
      )}

      {row.status === "failed" && <p className="wk-error">{row.error || "This one couldn't be written. Try again."}</p>}
      {s?.summary ? <p className="wk-text">{s.summary}</p> : f && !f.days_sent ? <p className="faint small du-none">No daily updates that week.</p> : null}
      {f && f.missed_days.length > 0 && f.days_sent > 0 && (
        <p className="faint small du-none">No daily update on {f.missed_days.map((d) => dayLabel(d)).join(", ")}.</p>
      )}

      {open && f && (
        <div className="stack" style={{ gap: 14 }}>
          {groups.map(([project, tasks]) => (
            <div className="du-sect" key={project}>
              <span className="field-label">{project}</span>
              {written.get(project.toLowerCase()) && <p className="wk-text">{written.get(project.toLowerCase())}</p>}
              <div className="du-bts">
                {tasks.map((t) => (
                  <div className="du-bt" key={t.task_id}>
                    <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                      <div className="grow" style={{ minWidth: 0 }}>
                        <Link to={`/tasks/${t.task_id}`} className="du-task-title">
                          {t.title}
                        </Link>
                        <div className="du-task-meta">
                          <span>
                            {t.days} {t.days === 1 ? "day" : "days"}
                          </span>
                          {t.handed_in && (
                            <span className="wk-handed">
                              <CircleCheck size={13} /> Handed in
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="du-item-pct">
                        {t.start}% <span className="faint">to</span> <b style={{ color: progressTone(t.end) }}>{t.end}%</b>
                      </span>
                    </div>
                    <div className="du-bar" aria-hidden>
                      <i className="before" style={{ width: `${Math.min(t.start, t.end)}%` }} />
                      <i className="gain" style={{ left: `${Math.min(t.start, t.end)}%`, width: `${Math.max(0, t.end - t.start)}%`, background: progressTone(t.end) }} />
                    </div>
                    {t.notes.length > 0 && (
                      <ul className="wk-notes">
                        {t.notes.map((n) => (
                          <li key={n.date}>
                            <span className="faint">{dayLabel(n.date)}:</span> {n.note}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {(s?.other_work || f.other_work.length > 0) && (
            <div className="du-sect">
              <span className="field-label">Other work</span>
              {s?.other_work ? (
                <p className="wk-text">{s.other_work}</p>
              ) : (
                <ul className="wk-notes">
                  {f.other_work.map((o) => (
                    <li key={o.date}>
                      <span className="faint">{dayLabel(o.date)}:</span> {o.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {f.blockers.length > 0 && (
            <div className="du-sect">
              <span className="field-label">Blockers</span>
              {s?.blockers && <p className="wk-text">{s.blockers}</p>}
              <ul className="wk-notes">
                {f.blockers.map((b) => (
                  <li key={b.date}>
                    <span className="faint">{dayLabel(b.date)}:</span> {b.text}{" "}
                    {b.cleared ? <Pill tone="green">Cleared</Pill> : <Pill tone="orange">Still open</Pill>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {actions}
        </div>
      )}

      {f && (f.tasks.length > 0 || f.blockers.length > 0 || f.other_work.length > 0) && (
        <button type="button" className="btn small ghost du-toggle" onClick={onToggle} aria-expanded={open}>
          <ChevronDown style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
          {open ? "Show less" : f.tasks.length ? `Show the tasks (${f.tasks.length})` : "Show more"}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- a member's own weeks */

function MyWeeks() {
  const me = useMe();
  const [params] = useSearchParams();
  const today = todayISO();
  const weeks = useMyWeeklyUpdates(me.id);
  const dailies = useMyDailyUpdates(me.id, sendsDailyUpdate(me));
  const download = useDownload();
  const asked = weekFromParam(params.get("week"), today);
  const rows = weeks.data ?? [];
  // null until the weeks load (then the one asked for, or the newest, opens); "" when all are closed.
  const [open, setOpen] = useState<string | null>(asked ?? rows[0]?.week_start ?? null);
  useEffect(() => {
    if (open === null && rows[0]) setOpen(asked ?? rows[0].week_start);
  }, [rows, open, asked]);

  const current = thisWeek(today);
  const currentWritten = rows.some((r) => r.week_start === current);
  const sentThisWeek = (dailies.data ?? []).filter((u) => u.work_date >= current && u.work_date <= weekEnd(current)).length;

  if (weeks.isLoading) return <Loading rows={3} />;

  return (
    <div className="du-page stack" style={{ gap: 14 }}>
      {!currentWritten && !weekIsOver(current) && (
        <div className="glass card wk-coming">
          <CalendarRange />
          <div style={{ minWidth: 0 }}>
            <b>This week, {weekLabel(current)}</b>
            <p className="small du-none">
              Your daily updates from Sunday to Thursday are written up as your week on Thursday at 5:45 pm, and you'll get a notification when
              it's ready. {sendsDailyUpdate(me) ? `So far you've sent ${sentThisWeek} this week.` : ""}
            </p>
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <Empty icon={<CalendarRange />} title="No weekly updates yet">
          Your first one is written on Thursday at 5:45 pm from the week's daily updates.
        </Empty>
      ) : (
        rows.map((r) => (
          <PersonWeekCard
            key={r.id}
            row={r}
            over={weekIsOver(r.week_start)}
            open={open === r.week_start}
            onToggle={() => setOpen(open === r.week_start ? "" : r.week_start)}
            showWho={false}
            actions={
              hasFacts(r.facts) && (r.facts as PersonFacts).days_sent > 0 ? (
                <button className="btn small" type="button" disabled={download.busy} onClick={() => download.run(r.week_start, null, [r])} style={{ alignSelf: "flex-start" }}>
                  {download.busy ? <Spinner size={14} /> : <Download />} Download as Excel
                </button>
              ) : null
            }
          />
        ))
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the team's week (managers and seniors) */

function TeamWeeks() {
  const me = useMe();
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const current = thisWeek(today);
  const week = weekFromParam(params.get("week"), today) ?? lastFinishedWeek(today);
  const over = weekIsOver(week);
  const q = useWeek(week);
  const download = useDownload();
  const [starting, setStarting] = useState<string | null>(null);
  // After asking for it, it counts as being written until the team report comes back new (the
  // function always writes it), or three minutes pass.
  const [waiting, setWaiting] = useState<{ week: string; stamp: string | null; at: number } | null>(null);
  const [open, setOpen] = useState<string | null>(params.get("team") ? null : me.id);

  const team = q.data?.team ?? null;
  const people = useMemo(() => [...(q.data?.people ?? [])].sort(byName), [q.data]);
  const rows = [...(team ? [team] : []), ...people];
  const arrived = !!waiting && !!team && team.status !== "pending" && team.updated_at !== waiting.stamp;
  const stillWaiting = !!waiting && waiting.week === week && !arrived && Date.now() - waiting.at < 180_000;
  const writing = rows.some((r) => r.status === "pending") || stillWaiting;
  useEffect(() => {
    if (!waiting) return;
    if (arrived || waiting.week !== week) return setWaiting(null);
    const t = window.setTimeout(() => setWaiting(null), Math.max(0, 180_000 - (Date.now() - waiting.at)));
    return () => window.clearTimeout(t);
  }, [waiting, arrived, week]);
  // While it's being written, look again every few seconds too (live changes do the rest).
  const { refetch } = q;
  useEffect(() => {
    if (!writing) return;
    const t = window.setInterval(() => refetch(), 8000);
    return () => window.clearInterval(t);
  }, [writing, refetch]);

  const setWeek = (w: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", "week");
    next.set("week", w);
    next.delete("team");
    setParams(next, { replace: true });
  };

  const write = async (userId?: string) => {
    const name = userId ? people.find((p) => p.user_id === userId) : null;
    const redo = userId ? !!name && name.status !== "failed" : rows.length > 0 && rows.some((r) => r.status === "ready");
    if (
      redo &&
      !(await confirm({
        title: userId ? "Write this week again?" : "Write the week again?",
        message: userId
          ? "It's written again from their daily updates as they are now, and the team report with it. Nobody is told again."
          : "Everyone's week and the team report are written again from the daily updates as they are now. Nobody is told again.",
        confirmLabel: "Write it again",
      }))
    )
      return;
    setStarting(userId ?? "all");
    try {
      await makeWeeklyUpdate({ week_start: week, user_id: userId });
      setWaiting({ week, stamp: team?.updated_at ?? null, at: Date.now() });
      toast(over ? "Writing it now. It shows here in a minute or two." : "Writing the week so far. It shows here in a minute or two.", "info");
      window.setTimeout(() => refetch(), 2000);
    } catch (e) {
      toast(e instanceof Error ? e.message : "The weekly update didn't start. Try again.", "error");
    } finally {
      setStarting(null);
    }
  };

  const f = team && hasFacts(team.facts) ? team.facts : null;
  const ts = team?.status === "ready" ? team.summary : null;
  const canDownload = people.some((p) => hasFacts(p.facts));

  return (
    <div className="du-page stack" style={{ gap: 14 }}>
      <div className="glass card du-day">
        <button className="icon-btn small" type="button" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
          <ChevronLeft />
        </button>
        <div className="grow" style={{ textAlign: "center" }}>
          <b>{weekLabel(week)}</b>
          <div className="faint tiny">{week === current ? (over ? "This week" : "This week, so far") : week === addDays(current, -7) ? "Last week" : fmtDate(week, { year: "numeric", month: "long" })}</div>
        </div>
        <button className="icon-btn small" type="button" onClick={() => setWeek(addDays(week, 7))} disabled={week >= current} aria-label="Next week">
          <ChevronRight />
        </button>
      </div>

      <div className="wk-actions">
        <button className="btn small" type="button" disabled={!canDownload || download.busy} onClick={() => download.run(week, team, people)}>
          {download.busy ? <Spinner size={14} /> : <Download />} Download Excel
        </button>
        <button className="btn small" type="button" disabled={writing || !!starting} onClick={() => write()}>
          {starting === "all" || writing ? <Spinner size={14} /> : <RotateCcw />}
          {writing ? "Being written" : rows.length ? "Write it again" : over ? "Write it now" : "Write the week so far"}
        </button>
        {team?.generated_at && !writing && <span className="faint small">Written {writtenOn(team.generated_at)}</span>}
      </div>

      {q.isLoading ? (
        <Loading rows={3} />
      ) : rows.length === 0 && writing ? (
        <Empty icon={<Hourglass />} title="Being written">
          It shows here in a minute or two.
        </Empty>
      ) : rows.length === 0 ? (
        <Empty icon={<CalendarRange />} title={over ? "Not written yet" : "This week isn't over yet"}>
          {over
            ? "Each week is written on Thursday at 5:45 pm from the daily updates. You can write this one now."
            : "It's written on Thursday at 5:45 pm from the daily updates. You can write the week so far now, to see how it's going; nobody is told until then."}
        </Empty>
      ) : (
        <>
          {team && (
            <div className="glass card wk-card">
              <div className="du-card-head">
                <b>The team's week</b>
                <span className="spacer" />
                <StatusPill row={team} over={over} />
              </div>
              {team.status === "failed" && <p className="wk-error">{team.error || "The team's week couldn't be written. Try again."}</p>}
              {f && (
                <div className="du-stats wk-stats">
                  <div className="glass du-stat">
                    <b>
                      {f.sent_all}
                      <span className="faint"> of {f.people}</span>
                    </b>
                    <span>sent every day</span>
                  </div>
                  <div className="glass du-stat">
                    <b>{f.moved}</b>
                    <span>moved on</span>
                  </div>
                  <div className="glass du-stat">
                    <b>{f.handed_in}</b>
                    <span>handed in</span>
                  </div>
                  <div className={`glass du-stat${f.open_blockers.length ? " warn" : ""}`}>
                    <b>{f.open_blockers.length}</b>
                    <span>blocked</span>
                  </div>
                </div>
              )}
              {ts?.headline && <p className="wk-text">{ts.headline}</p>}
              {f && f.projects.length > 0 && (
                <div className="du-sect">
                  <span className="field-label">Projects</span>
                  <ul className="wk-projects">
                    {f.projects.map((p) => {
                      const words = ts?.projects.find((x) => x.project.toLowerCase() === p.project.toLowerCase())?.summary;
                      return (
                        <li key={p.project}>
                          <div className="row wrap" style={{ gap: 8 }}>
                            <b>{p.project}</b>
                            <span className="faint small">
                              {p.people.join(", ")} · {p.moved} of {p.tasks} moved on{p.handed_in ? `, ${p.handed_in} handed in` : ""}
                            </span>
                          </div>
                          {words && <p className="wk-text">{words}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {ts && ts.attention.length > 0 && (
                <div className="du-sect wk-attention">
                  <span className="field-label">
                    <TriangleAlert size={13} /> To look at
                  </span>
                  <ul className="wk-notes">
                    {ts.attention.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
              {f && (f.no_updates.length > 0 || f.missing.length > 0) && (
                <p className="faint small du-none">
                  {f.no_updates.length > 0 && `No daily updates: ${f.no_updates.join(", ")}. `}
                  {f.missing.map((m) => `${m.name} missed ${m.days.map((d) => dayLabel(d)).join(", ")}.`).join(" ")}
                </p>
              )}
            </div>
          )}

          <div className="du-section-head">
            <h2>Each person</h2>
            {writing && (
              <span className="faint small row" style={{ gap: 6 }}>
                <Hourglass size={13} /> Being written
              </span>
            )}
          </div>
          {people.map((p) => (
            <PersonWeekCard
              key={p.id}
              row={p}
              over={over}
              open={open === p.user_id}
              onToggle={() => setOpen(open === p.user_id ? null : p.user_id)}
              showWho
              actions={
                <div className="row wrap" style={{ gap: 8 }}>
                  {hasFacts(p.facts) && (p.facts as PersonFacts).days_sent > 0 && (
                    <button
                      className="btn small"
                      type="button"
                      disabled={download.busy}
                      onClick={() => download.run(week, null, [p], (p.facts as PersonFacts).short_name)}
                    >
                      <Download /> Just this person
                    </button>
                  )}
                  <button className="btn small ghost" type="button" disabled={writing || !!starting} onClick={() => write(p.user_id)}>
                    {starting === p.user_id ? <Spinner size={14} /> : <RotateCcw />} Write it again
                  </button>
                </div>
              }
            />
          ))}
        </>
      )}
    </div>
  );
}
