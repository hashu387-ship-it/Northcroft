// The Weekly tab. The daily updates written up for a stretch of days, three ways:
//   Generate update: pick the days (From and To) and Claude writes them up. Managers and seniors get
//     the team's and each person's (or one person's); members get their own.
//   Last 7 days: written every evening at 9:35 pm (also at the top of Home).
//   Weekly update: Sunday to Thursday, written Thursday at 5:45 pm; everyone is told.
// Each opens as a report (Northcroft's colours, Northcroft and Salam logos) to print, download as a PDF or send.
import "@/styles/updates.css";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarRange, ChevronLeft, ChevronRight, FileText, RotateCcw, Sparkles } from "lucide-react";
import { usePeople } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { sendsDailyUpdate, useMyDailyUpdates } from "@/lib/dailyUpdates";
import { addDays, addMonths, dateOf, diffDays, dow, fmtDate, monthStart, todayISO } from "@/lib/time";
import {
  dayLabel,
  generateUpdate,
  hasFacts,
  lastFinishedWeek,
  makeWeeklyUpdate,
  rangeLabel,
  reportLink,
  thisWeek,
  useGenerated,
  useLastSevenDays,
  useMyWeeklyUpdates,
  useWeek,
  weekEnd,
  weekFromParam,
  weekIsOver,
  weekLabel,
  type PersonFacts,
  type PersonWeek,
  type TeamWeek,
  type WeeklyStatus,
} from "@/lib/weeklyUpdates";
import { Empty, Field, Loading, Pill, PersonSelect, Sheet, Spinner, useConfirm, useToast } from "@/components/ui";

export function Weekly() {
  const { canAssign } = useAuth();
  const me = useMe();
  const [generating, setGenerating] = useState(false);
  return (
    <div className="du-page stack" style={{ gap: 16 }}>
      <div className="glass card wk-generate">
        <Sparkles />
        <div className="grow">
          <b>Generate an update</b>
          <p className="small du-none">
            Pick the days, from and to, and the daily updates in them are written up as one update
            {canAssign ? ": the team's, and each person's." : "."}
          </p>
        </div>
        <button className="btn primary" type="button" onClick={() => setGenerating(true)}>
          Generate update
        </button>
      </div>
      <GenerateSheet open={generating} onClose={() => setGenerating(false)} manager={canAssign} />

      <LastSevenRow userId={me.id} team={canAssign} />
      {canAssign ? <TeamWeekSection /> : <MyWeeksSection />}
      <GeneratedList manager={canAssign} />
    </div>
  );
}

/* ---------------------------------------------------------------- shared bits */

function StatusPill({ status, over = true }: { status: WeeklyStatus; over?: boolean }) {
  if (status === "pending") return <Pill tone="blue">Being written</Pill>;
  if (status === "failed") return <Pill tone="red">Couldn't be written</Pill>;
  if (status === "empty") return <Pill tone="gray">No daily updates</Pill>;
  return over ? <Pill tone="green">Ready</Pill> : <Pill tone="blue">So far</Pill>;
}

const writtenOn = (ts: string | null) => (ts ? dayLabel(dateOf(ts)) : "");

/* ---------------------------------------------------------------- Generate update */

type QuickPick = { label: string; start: string; end: string };

function quickPicks(today: string): QuickPick[] {
  const sunday = addDays(today, -dow(today));
  const lastSunday = addDays(sunday, -7);
  const m0 = monthStart(today);
  const prevM = addMonths(m0, -1);
  return [
    { label: "Last 7 days", start: addDays(today, -6), end: today },
    { label: "This week", start: sunday, end: today < addDays(sunday, 4) ? today : addDays(sunday, 4) },
    { label: "Last week", start: lastSunday, end: addDays(lastSunday, 4) },
    { label: "This month", start: m0, end: today },
    { label: "Last month", start: prevM, end: addDays(m0, -1) },
  ];
}

function GenerateSheet({ open, onClose, manager }: { open: boolean; onClose: () => void; manager: boolean }) {
  const today = todayISO();
  const people = usePeople();
  const toast = useToast();
  const navigate = useNavigate();
  const picks = useMemo(() => quickPicks(today), [today]);
  const [start, setStart] = useState(picks[0].start);
  const [end, setEnd] = useState(picks[0].end);
  const [who, setWho] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const team = useMemo(() => people.active.filter((p) => sendsDailyUpdate(p)), [people.active]);

  const span = start && end ? diffDays(end, start) : 0;
  const problem = !start || !end ? "Pick both days." : end > today ? "Pick days up to today." : start > end ? "From comes before To." : span > 61 ? "Pick up to 62 days at a time." : null;

  const go = async () => {
    if (problem) return;
    setSending(true);
    try {
      const r = await generateUpdate({ start, end, user_id: manager ? who : null });
      onClose();
      navigate(reportLink("custom", r?.start ?? start, r?.end ?? end, manager ? who : null));
    } catch (e) {
      toast(e instanceof Error ? e.message : "The update didn't start. Try again.", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Generate update"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={go} disabled={!!problem || sending}>
            {sending ? <Spinner size={14} /> : <Sparkles />} Generate
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="wk-picks" role="group" aria-label="Quick picks">
          {picks.map((p) => (
            <button
              key={p.label}
              type="button"
              className={p.start === start && p.end === end ? "on" : undefined}
              onClick={() => {
                setStart(p.start);
                setEnd(p.end);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="wk-dates">
          <Field label="From">
            <input className="input" type="date" value={start} max={today} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="To">
            <input className="input" type="date" value={end} max={today} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {manager && (
          <Field label="For">
            <PersonSelect value={who} onChange={setWho} people={team} placeholder="The whole team, and each person" />
          </Field>
        )}
        <p className="small du-none" style={{ color: problem ? "var(--red)" : undefined }}>
          {problem ??
            `${rangeLabel(start, end, true)}: ${span + 1} ${span === 0 ? "day" : "days"}. It's written in a minute or two, and kept on this tab to open again.`}
        </p>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- Last 7 days */

function LastSevenRow({ userId, team }: { userId: string; team: boolean }) {
  const q = useLastSevenDays(userId, team);
  const row = q.data;
  if (q.isLoading) return null;
  const line = row && hasFacts(row.facts) ? ((row.facts as { line?: string }).line ?? "") : "";
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="du-section-head">
        <h2>Last 7 days</h2>
        <span className="faint small">Every evening at 9:35 pm</span>
      </div>
      {row ? (
        <Link to={reportLink("rolling", row.period_start, row.period_end, team ? null : userId)} className="glass card wk-row">
          <FileText />
          <span className="grow">
            <b>{rangeLabel(row.period_start, row.period_end)}</b>
            <span className="faint tiny" style={{ display: "block" }}>
              {line}
            </span>
          </span>
          <StatusPill status={row.status} />
        </Link>
      ) : (
        <p className="faint small du-none">The first one is written this evening at 9:35 pm.</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the Thursday week: managers and seniors */

function TeamWeekSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const current = thisWeek(today);
  const week = weekFromParam(params.get("week"), today) ?? lastFinishedWeek(today);
  const over = weekIsOver(week);
  const q = useWeek(week);
  const [starting, setStarting] = useState(false);
  const team: TeamWeek | null = q.data?.team ?? null;
  const people: PersonWeek[] = q.data?.people ?? [];
  const writing = [team, ...people].some((r) => r?.status === "pending");
  const f = team && hasFacts(team.facts) ? team.facts : null;

  const setWeek = (w: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", "week");
    next.set("week", w);
    next.delete("team");
    setParams(next, { replace: true });
  };
  const write = async () => {
    if (
      team?.status === "ready" &&
      !(await confirm({
        title: "Write the week again?",
        message: "Everyone's week and the team's are written again from the daily updates as they are now. Nobody is told again.",
        confirmLabel: "Write it again",
      }))
    )
      return;
    setStarting(true);
    try {
      await makeWeeklyUpdate({ week_start: week });
      toast("Writing it now. It shows here in a minute or two.", "info");
      window.setTimeout(() => q.refetch(), 2000);
    } catch (e) {
      toast(e instanceof Error ? e.message : "The weekly update didn't start. Try again.", "error");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="du-section-head">
        <h2>Weekly update</h2>
        <span className="faint small">Thursday at 5:45 pm</span>
      </div>
      <div className="glass card du-day">
        <button className="icon-btn small" type="button" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
          <ChevronLeft />
        </button>
        <div className="grow" style={{ textAlign: "center" }}>
          <b>{weekLabel(week)}</b>
          <div className="faint tiny">
            {week === current ? (over ? "This week" : "This week, so far") : week === addDays(current, -7) ? "Last week" : fmtDate(week, { year: "numeric", month: "long" })}
          </div>
        </div>
        <button className="icon-btn small" type="button" onClick={() => setWeek(addDays(week, 7))} disabled={week >= current} aria-label="Next week">
          <ChevronRight />
        </button>
      </div>
      {q.isLoading ? (
        <Loading rows={2} />
      ) : !team && !people.length ? (
        <Empty icon={<CalendarRange />} title={over ? "Not written yet" : "This week isn't over yet"}>
          {over ? "It's written on Thursday at 5:45 pm. You can write it now." : "It's written on Thursday at 5:45 pm. You can write the week so far now; nobody is told until then."}
          <div style={{ marginTop: 12 }}>
            <button className="btn small" type="button" onClick={write} disabled={starting}>
              {starting ? <Spinner size={14} /> : <RotateCcw />} {over ? "Write it now" : "Write the week so far"}
            </button>
          </div>
        </Empty>
      ) : (
        <div className="glass card wk-card">
          <div className="du-card-head">
            <b>The team's week</b>
            <span className="spacer" />
            {team && <StatusPill status={team.status} over={over} />}
          </div>
          {f && (
            <div className="du-counts">
              <span>
                <b>
                  {f.sent_all} of {f.people}
                </b>{" "}
                sent every day
              </span>
              <span>
                <b>{f.moved}</b> moved on
              </span>
              <span>
                <b>{f.handed_in}</b> handed in
              </span>
              <span>
                <b>{f.open_blockers.length}</b> blocked
              </span>
            </div>
          )}
          {team?.summary?.headline && <p className="wk-text wk-clamp">{team.summary.headline}</p>}
          <div className="row wrap" style={{ gap: 8 }}>
            <Link className="btn small primary" to={reportLink("week", week, weekEnd(week))}>
              <FileText /> Open the report
            </Link>
            <button className="btn small ghost" type="button" onClick={write} disabled={writing || starting}>
              {writing || starting ? <Spinner size={14} /> : <RotateCcw />} {writing ? "Being written" : "Write it again"}
            </button>
            {team?.generated_at && !writing && <span className="faint small">Written {writtenOn(team.generated_at)}</span>}
          </div>
          {people.length > 0 && (
            <ul className="wk-people">
              {people.map((p) => {
                const pf = hasFacts(p.facts) ? (p.facts as PersonFacts) : null;
                return (
                  <li key={p.id}>
                    <Link to={reportLink("week", week, weekEnd(week), p.user_id)}>
                      <b>{pf?.name ?? "Someone"}</b>
                      <span className="faint small">{pf ? `${pf.days_sent} of ${pf.days_expected} · ${pf.line}` : ""}</span>
                    </Link>
                    <StatusPill status={p.status} over={over} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- a member's own weeks */

function MyWeeksSection() {
  const me = useMe();
  const today = todayISO();
  const weeks = useMyWeeklyUpdates(me.id);
  const dailies = useMyDailyUpdates(me.id, sendsDailyUpdate(me));
  const current = thisWeek(today);
  const rows = weeks.data ?? [];
  const sentThisWeek = (dailies.data ?? []).filter((u) => u.work_date >= current && u.work_date <= weekEnd(current)).length;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="du-section-head">
        <h2>Your weekly updates</h2>
        <span className="faint small">Thursday at 5:45 pm</span>
      </div>
      {!rows.some((r) => r.period_start === current) && !weekIsOver(current) && (
        <div className="glass card wk-coming">
          <CalendarRange />
          <div style={{ minWidth: 0 }}>
            <b>This week, {weekLabel(current)}</b>
            <p className="small du-none">
              Written on Thursday at 5:45 pm from your daily updates, and you'll get a notification when it's ready.
              {sendsDailyUpdate(me) ? ` So far you've sent ${sentThisWeek} this week.` : ""}
            </p>
          </div>
        </div>
      )}
      {weeks.isLoading ? (
        <Loading rows={2} />
      ) : rows.length === 0 ? (
        <p className="faint small du-none">Your first one is written on Thursday at 5:45 pm.</p>
      ) : (
        rows.map((r) => {
          const pf = hasFacts(r.facts) ? (r.facts as PersonFacts) : null;
          return (
            <Link key={r.id} to={reportLink("week", r.period_start, r.period_end)} className="glass card wk-row">
              <FileText />
              <span className="grow">
                <b>{weekLabel(r.period_start)}</b>
                <span className="faint tiny" style={{ display: "block" }}>
                  {pf ? `${pf.days_sent} of ${pf.days_expected} daily updates · ${pf.line}` : ""}
                </span>
              </span>
              <StatusPill status={r.status} over={weekIsOver(r.period_start)} />
            </Link>
          );
        })
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- updates people generated */

function GeneratedList({ manager }: { manager: boolean }) {
  const me = useMe();
  const people = usePeople();
  const q = useGenerated(me.id, manager);
  const list = q.data ?? [];
  if (q.isLoading || !list.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="du-section-head">
        <h2>Generated updates</h2>
      </div>
      {list.map((g) => (
        <Link key={`${g.start}|${g.end}|${g.userId}`} to={reportLink("custom", g.start, g.end, manager ? g.userId : null)} className="glass card wk-row">
          <FileText />
          <span className="grow">
            <b>{rangeLabel(g.start, g.end)}</b>
            <span className="faint tiny" style={{ display: "block" }}>
              {manager ? (g.userId ? (people.get(g.userId)?.short_name ?? "One person") : "The team") : g.line}
              {g.generatedBy && manager ? ` · by ${people.get(g.generatedBy)?.short_name ?? "someone"}` : ""}
              {g.generatedAt ? ` · ${writtenOn(g.generatedAt)}` : ""}
            </span>
          </span>
          <StatusPill status={g.status} />
        </Link>
      ))}
    </div>
  );
}
