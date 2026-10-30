// Checking your weekly update. Once the Thursday week is written, each person is asked to check
// theirs (it shows in My tasks until Sunday 12 pm). They can change the words: the summary, each
// project's line, other work and blockers, and add anything the daily updates missed. The figures
// (days sent, each task's %, handed in) come from the daily updates and stay as they are. Sending it
// back puts their version straight into the report; if they changed it, the team report is written
// again with it, and managers and seniors are told either way.
import "@/styles/updates.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, CircleCheck, ClipboardCheck, FileText, Lock, PencilLine, RotateCcw, Send } from "lucide-react";
import { useInvalidate } from "@/lib/api";
import { useMe } from "@/lib/auth";
import {
  checkState,
  cleanWords,
  dueLabel,
  hasFacts,
  reportLink,
  sameWords,
  sendBack,
  useWeek,
  weekFromParam,
  weekLabel,
  whenLabel,
  type PersonFacts,
  type PersonSummary,
  type PersonWeek,
} from "@/lib/weeklyUpdates";
import { PageHead } from "@/components/PageHead";
import { Empty, Loading, Spinner, useToast } from "@/components/ui";
import { tasksByProject } from "./updates/ReportDocument";

// The longest each part may be (the database keeps the same limits).
const MAX = { summary: 2000, project: 1500, other_work: 2000, blockers: 2000, added: 3000 };

export default function WeeklyCheck() {
  const [params] = useSearchParams();
  const week = weekFromParam(params.get("week"));
  if (!week) return <Navigate to="/updates?tab=week" replace />;
  return <Check week={week} />;
}

function Check({ week }: { week: string }) {
  const me = useMe();
  const q = useWeek(week);
  const row = q.data?.people.find((p) => p.user_id === me.id) ?? null;
  const [editing, setEditing] = useState(false);
  // Looked at again each minute, so the page closes at 12 pm on Sunday without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const state = checkState(row, now);

  const back = (
    <Link to="/updates?tab=week" className="btn small ghost">
      <ArrowLeft /> Weekly
    </Link>
  );

  if (q.isLoading) return <div className="page"><Loading rows={4} /></div>;

  if (!row || row.status !== "ready") {
    return (
      <div className="page wc-page">
        <div className="wc-top">{back}</div>
        <div className="glass">
          <Empty icon={<ClipboardCheck />} title="Nothing to check yet">
            {row?.status === "pending"
              ? "Your weekly update is being written. It shows here in a minute or two."
              : row?.status === "empty"
                ? `There were no daily updates from you in ${weekLabel(week)}, so there's nothing to check.`
                : `Your weekly update for ${weekLabel(week)} isn't written yet. It's written on Thursday at 5:45 pm, and you're asked to check it then.`}
          </Empty>
        </div>
      </div>
    );
  }

  if (state === "open" || (state === "sent" && editing && row.check_due && now < Date.parse(row.check_due))) {
    return <Editor key={`${row.id}:${row.checked_at ?? ""}`} row={row} week={week} back={back} again={state === "sent"} onDone={() => setEditing(false)} />;
  }

  // Sent back, missed, or never asked: how it stands, and the report.
  const f = hasFacts(row.facts) ? (row.facts as PersonFacts) : null;
  const canChange = state === "sent" && !!row.check_due && now < Date.parse(row.check_due);
  return (
    <div className="page wc-page">
      <div className="wc-top">{back}</div>
      <PageHead title="Your weekly update" sub={weekLabel(week)} />
      <div className={`glass card wc-done ${state}`}>
        {state === "sent" ? <CircleCheck /> : <ClipboardCheck />}
        <div className="grow">
          {state === "sent" ? (
            <>
              <b>{row.check_edited ? "Sent back with your changes" : "Sent back as it was"}</b>
              <p className="small du-none">
                {whenLabel(row.checked_at)}.{" "}
                {row.check_edited ? "Your version is in the report, and the team report is updated with it." : "It's in the report as it was written."}
                {canChange ? ` You can still change it until ${dueLabel(row.check_due)}.` : ""}
              </p>
            </>
          ) : state === "missed" ? (
            <>
              <b>Not checked</b>
              <p className="small du-none">{dueLabel(row.check_due)} passed, so it stays as it was written.</p>
            </>
          ) : (
            <>
              <b>This one wasn't sent to you to check</b>
              <p className="small du-none">It's in the report as it was written{f ? ` from your ${f.days_sent} daily updates` : ""}.</p>
            </>
          )}
        </div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Link className="btn primary" to={reportLink("week", row.period_start, row.period_end)}>
          <FileText /> Open the report
        </Link>
        {canChange && (
          <button className="btn" type="button" onClick={() => setEditing(true)}>
            <PencilLine /> Change it again
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- changing it */

const draftKey = (id: string) => `nc.weekly-check.${id}`;
function readDraft(id: string): PersonSummary | null {
  try {
    const v = localStorage.getItem(draftKey(id));
    return v ? (JSON.parse(v) as PersonSummary) : null;
  } catch {
    return null;
  }
}
function writeDraft(id: string, w: PersonSummary | null) {
  try {
    if (w) localStorage.setItem(draftKey(id), JSON.stringify(w));
    else localStorage.removeItem(draftKey(id));
  } catch {
    /* a private window: it just isn't kept */
  }
}

/** The words as they stand, with an empty line for any project that has tasks but no words yet. */
function startWords(row: PersonWeek): PersonSummary {
  const s = row.summary;
  const f = hasFacts(row.facts) ? (row.facts as PersonFacts) : null;
  const projects = (s?.projects ?? []).map((p) => ({ project: p.project, summary: p.summary ?? "" }));
  const have = new Set(projects.map((p) => p.project.toLowerCase()));
  for (const [project] of f ? tasksByProject(f) : []) if (!have.has(project.toLowerCase())) projects.push({ project, summary: "" });
  return { summary: s?.summary ?? "", projects, other_work: s?.other_work ?? "", blockers: s?.blockers ?? "", added: s?.added ?? "" };
}

/** What goes back: a project line added here only if something was written in it. */
function toSend(row: PersonWeek, w: PersonSummary): PersonSummary {
  const had = new Set((row.summary?.projects ?? []).map((p) => p.project.toLowerCase()));
  return cleanWords({ ...w, projects: w.projects.filter((p) => had.has(p.project.toLowerCase()) || p.summary.trim()) });
}

function Editor({ row, week, back, again, onDone }: { row: PersonWeek; week: string; back: ReactNode; again: boolean; onDone: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const f = hasFacts(row.facts) ? (row.facts as PersonFacts) : null;
  const start = useMemo(() => startWords(row), [row]);
  const [words, setWords] = useState<PersonSummary>(() => readDraft(row.id) ?? start);
  const [sending, setSending] = useState(false);
  const changed = !sameWords(toSend(row, words), row.summary);

  // Kept on this phone while it's being changed, so nothing is lost if the app closes.
  useEffect(() => {
    writeDraft(row.id, changed ? words : null);
  }, [row.id, words, changed]);

  const set = (patch: Partial<PersonSummary>) => setWords((w) => ({ ...w, ...patch }));
  const setProject = (i: number, summary: string) => setWords((w) => ({ ...w, projects: w.projects.map((p, j) => (j === i ? { ...p, summary } : p)) }));
  const tasksFor = useMemo(() => {
    const m = new Map<string, PersonFacts["tasks"]>();
    for (const [project, tasks] of f ? tasksByProject(f) : []) m.set(project.toLowerCase(), tasks);
    return m;
  }, [f]);
  const shown = new Set(words.projects.map((p) => p.project.toLowerCase()));

  const go = async () => {
    setSending(true);
    try {
      const r = await sendBack(row.id, toSend(row, words));
      writeDraft(row.id, null);
      await invalidate("weekly_updates");
      toast(r.edited ? "Sent back with your changes. Thanks." : "Sent back. Thanks.", "success");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "It didn't send. Try again in a moment.", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page wc-page">
      <div className="wc-top">{back}</div>
      <PageHead
        title="Check your weekly update"
        sub={
          <>
            <span className="wc-keep">{weekLabel(week)}</span> · <span className="wc-keep">Send it back by {dueLabel(row.check_due)}</span>
          </>
        }
      />

      <div className="glass card wc-intro">
        <ClipboardCheck />
        <p className="small du-none">
          {again
            ? "You've sent this back already. Change it again and send it, and the report takes the new version."
            : "This is your week as it was written from your daily updates. Change anything that isn't right, add anything that's missing, then send it back. If you don't send it back by Sunday 12 pm, it stays as it is."}
        </p>
      </div>

      <section className="glass card wc-part">
        <label className="wc-label" htmlFor="wc-summary">
          Your week
        </label>
        <Grow id="wc-summary" value={words.summary} max={MAX.summary} onChange={(v) => set({ summary: v })} placeholder="A few lines on your week" />
        {f && (
          <div className="du-counts wc-locked" title="From your daily updates">
            <Lock />
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
          </div>
        )}
      </section>

      {words.projects.map((p, i) => {
        const tasks = tasksFor.get(p.project.toLowerCase()) ?? [];
        return (
          <section className="glass card wc-part" key={p.project}>
            <h3 className="wc-project">{p.project}</h3>
            {tasks.length > 0 && <TaskLines tasks={tasks} />}
            <Grow value={p.summary} max={MAX.project} onChange={(v) => setProject(i, v)} placeholder={`What you did on ${p.project}`} aria-label={`What you did on ${p.project}`} />
          </section>
        );
      })}
      {f &&
        tasksByProject(f)
          .filter(([project]) => !shown.has(project.toLowerCase()))
          .map(([project, tasks]) => (
            <section className="glass card wc-part" key={project}>
              <h3 className="wc-project">{project}</h3>
              <TaskLines tasks={tasks} />
            </section>
          ))}

      <section className="glass card wc-part">
        <label className="wc-label" htmlFor="wc-other">
          Other work
        </label>
        <Grow id="wc-other" value={words.other_work} max={MAX.other_work} onChange={(v) => set({ other_work: v })} placeholder="Work that wasn't on a task" />
        <label className="wc-label" htmlFor="wc-blockers">
          Blockers
        </label>
        {f && f.blockers.length > 0 && (
          <ul className="wc-tasks wc-locked-list">
            {f.blockers.map((b) => (
              <li key={b.date}>
                <span className="grow">{b.text}</span>
                <b>{b.cleared ? "Cleared" : "Still open"}</b>
              </li>
            ))}
          </ul>
        )}
        <Grow id="wc-blockers" value={words.blockers} max={MAX.blockers} onChange={(v) => set({ blockers: v })} placeholder="Leave it empty if nothing held you up" />
      </section>

      <section className="glass card wc-part">
        <label className="wc-label" htmlFor="wc-added">
          Anything to add
        </label>
        <p className="tiny faint du-none">Work your daily updates missed, like a site visit, a meeting or a call. It goes into the report under your name.</p>
        <Grow id="wc-added" value={words.added ?? ""} max={MAX.added} onChange={(v) => set({ added: v })} placeholder="Add anything that's missing" />
      </section>

      <div className="glass wc-actions">
        {changed && (
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setWords(start);
              writeDraft(row.id, null);
            }}
            disabled={sending}
          >
            <RotateCcw /> Undo changes
          </button>
        )}
        <span className="spacer" />
        <button className="btn primary" type="button" onClick={go} disabled={sending}>
          {sending ? <Spinner size={14} /> : <Send />} {changed ? "Send it back" : "Looks right, send it back"}
        </button>
      </div>
    </div>
  );
}

function TaskLines({ tasks }: { tasks: PersonFacts["tasks"] }) {
  return (
    <ul className="wc-tasks" title="From your daily updates">
      {tasks.map((t) => (
        <li key={t.task_id}>
          <span className="grow">{t.title}</span>
          <span className="wc-pct">
            {t.start}% to <b>{t.end}%</b>
            {t.handed_in ? ", handed in" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A text box that grows with what's written in it. */
function Grow({ value, onChange, max, ...rest }: { value: string; onChange: (v: string) => void; max: number; id?: string; placeholder?: string; "aria-label"?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} className="textarea wc-text" rows={2} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
