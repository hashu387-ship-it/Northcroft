// The weekly update as a document in Northcroft's colours and fonts, with the Northcroft logo at
// the top: the same on screen, on paper and in the PDF (a copy of this page). The team's
// part first when there is one, then each person: what they did, each project with every task's %
// at the start and end, other work and blockers.
import { Fragment, type CSSProperties } from "react";
import { LogoMark, Wordmark } from "@/components/Brand";
import { REPORT_BRAND } from "@/lib/reportBrand";
import { dateOf } from "@/lib/time";
import {
  checkState,
  dayLabel,
  dueLabel,
  hasFacts,
  isSections,
  isTeamSections,
  SECTIONS,
  rangeLabel,
  type OldTeam,
  type OldWords,
  type PersonFacts,
  type PersonWeek,
  type SectionWords,
  type TeamFacts,
  type TeamSections,
  type ReportKind,
  type TeamWeek,
} from "@/lib/weeklyUpdates";
import reportCss from "@/styles/report.css?inline";

/** The report's styles are put on the page once (the same text goes into the page that prints). */
let styled = false;
export function useReportStyles() {
  if (styled || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.dataset.report = "1";
  el.textContent = reportCss;
  document.head.appendChild(el);
  styled = true;
}
export const REPORT_CSS = reportCss;

export const reportVars = (): CSSProperties =>
  ({
    "--rp-primary": REPORT_BRAND.primary,
    "--rp-accent": REPORT_BRAND.accent,
    "--rp-tint": REPORT_BRAND.tint,
    "--rp-ink": REPORT_BRAND.ink,
    "--rp-muted": REPORT_BRAND.muted,
  }) as CSSProperties;

/** "Weekly update", "Last 7 days", "Update". */
export function reportNoun(kind: ReportKind) {
  return kind === "week" ? "Weekly update" : kind === "rolling" ? "Last 7 days" : "Update";
}

/** The report's title: the team's, or the one person's name. */
export function reportTitle(kind: ReportKind, team: boolean, person?: PersonFacts | null) {
  if (!team && person) return person.name;
  return kind === "week" ? "Team weekly update" : kind === "rolling" ? "Team: last 7 days" : "Team update";
}

const writtenOn = (ts: string | null | undefined) => (ts ? dayLabel(dateOf(ts), true) : "");

export function ReportDocument({
  kind,
  start,
  end,
  team,
  people,
  over,
}: {
  kind: ReportKind;
  start: string;
  end: string;
  team: TeamWeek | null;
  people: PersonWeek[];
  /** The Thursday week has closed (otherwise it's the week so far). */
  over: boolean;
}) {
  useReportStyles();
  const single = !team && people.length === 1 ? (hasFacts(people[0].facts) ? (people[0].facts as PersonFacts) : null) : null;
  const written = team?.generated_at ?? people.find((p) => p.generated_at)?.generated_at ?? null;
  const subtitle = !team && single ? `${reportNoun(kind)} · ${rangeLabel(start, end, true)}` : rangeLabel(start, end, true);
  return (
    <article className={`rp-doc${team ? " rp-with-team" : ""}`} style={reportVars()}>
      <header className="rp-head">
        <div className="rp-logos">
          <span className="rp-nc">
            <LogoMark variant="color" size={38} />
            <Wordmark height={17} className="rp-nc-word" />
          </span>
        </div>
        <div className="rp-head-text">
          <h1>{reportTitle(kind, !!team, single)}</h1>
          <p className="rp-period">
            {subtitle}
            {kind === "week" && !over ? " (so far)" : ""}
          </p>
          <p className="rp-by">
            {REPORT_BRAND.preparedBy}
            {written && (
              <>
                {" · "}
                <span className="rp-keep">Written {writtenOn(written)}</span>
              </>
            )}
          </p>
        </div>
      </header>
      <div className="rp-rule" />
      <div className="rp-body">
        {team && <TeamPart row={team} kind={kind} />}
        {people.map((p) => (
          <PersonPart key={p.id} row={p} showName={!!team || people.length > 1} kind={kind} />
        ))}
        {!team && people.length === 0 && <p className="rp-state">Nothing has been written for these days yet.</p>}
      </div>
      <footer className="rp-foot">
        <span>{REPORT_BRAND.preparedBy}</span>
        <span>
          {REPORT_BRAND.name} · {reportNoun(kind)} · {rangeLabel(start, end, true)}
        </span>
      </footer>
    </article>
  );
}

function StateNote({ status, error, empty }: { status: string; error: string | null; empty: string }) {
  if (status === "pending") return <p className="rp-state">Being written. It shows here in a minute or two.</p>;
  if (status === "failed") return <p className="rp-state">{error || "This couldn't be written. Try again."}</p>;
  if (status === "empty") return <p className="rp-state">{empty}</p>;
  return null;
}

function TeamPart({ row, kind }: { row: TeamWeek; kind: ReportKind }) {
  const f = hasFacts(row.facts) ? row.facts : null;
  const s = row.status === "ready" || (row.status !== "empty" && row.summary) ? row.summary : null;
  return (
    <section className="rp-section rp-team">
      <div className="rp-section-head">
        <h2>The team</h2>
      </div>
      <StateNote status={row.status} error={row.error} empty="No daily updates in these days." />
      {f && (
        <div className="rp-stats">
          <div className="rp-stat">
            <b>
              {f.sent_all} <small>of {f.people}</small>
            </b>
            <span>sent every day</span>
          </div>
          <div className="rp-stat">
            <b>{f.moved}</b>
            <span>tasks moved on</span>
          </div>
          <div className="rp-stat">
            <b>{f.handed_in}</b>
            <span>handed in</span>
          </div>
          <div className="rp-stat">
            <b>{f.open_blockers.length}</b>
            <span>blockers open</span>
          </div>
        </div>
      )}
      {s?.headline && <p className="rp-lead">{s.headline}</p>}
      {s && isTeamSections(s) ? <TeamProjects s={s} f={f} kind={kind} /> : <OldTeamBody s={s as OldTeam | null} f={f} />}
      {f && (f.no_updates.length > 0 || f.missing.length > 0) && (
        <p className="rp-note">
          {f.no_updates.length > 0 && `No daily updates: ${f.no_updates.join(", ")}. `}
          {f.missing.map((m) => `${m.name} missed ${m.days.map((d) => dayLabel(d)).join(", ")}.`).join(" ")}
        </p>
      )}
    </section>
  );
}

/** The team's report as it was written before the sections (older weeks). */
function OldTeamBody({ s, f }: { s: OldTeam | null; f: TeamFacts | null }) {
  return (
    <>
      {f && f.projects.length > 0 && (
        <div className="rp-block">
          <span className="rp-label">Projects</span>
          <ul className="rp-projects">
            {f.projects.map((p) => {
              const words = s?.projects.find((x) => x.project.toLowerCase() === p.project.toLowerCase())?.summary;
              return (
                <li key={p.project}>
                  <span className="rp-project-name">{p.project}</span>
                  <span className="rp-project-meta">
                    {p.people.join(", ")} · {p.moved} of {p.tasks} {p.tasks === 1 ? "task" : "tasks"} moved on
                    {p.handed_in ? `, ${p.handed_in} handed in` : ""}
                  </span>
                  {words && <p>{words}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {s && s.attention.length > 0 && (
        <div className="rp-block">
          <span className="rp-label">To look at</span>
          <ul className="rp-list">
            {s.attention.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** "Next week" for the Thursday week, "Next" for other days. */
const sectionLabel = (key: string, label: string, kind: ReportKind) => (key === "next" && kind !== "week" ? "Next" : label);

/** The team's report by project: who worked on it, then finished, in progress, waiting and next. */
function TeamProjects({ s, f, kind }: { s: TeamSections; f: TeamFacts | null; kind: ReportKind }) {
  const counted = new Map((f?.projects ?? []).map((p) => [(p.project === "Other" ? "General" : p.project).toLowerCase(), p]));
  return (
    <div className="rp-pblocks">
      {s.projects.map((p) => {
        const c = counted.get(p.project.toLowerCase());
        return (
          <div className="rp-pblock" key={p.project}>
            <h3>{p.project}</h3>
            <span className="rp-project-meta">
              {p.people.join(", ")}
              {c ? ` · ${c.moved} of ${c.tasks} ${c.tasks === 1 ? "task" : "tasks"} moved on${c.handed_in ? `, ${c.handed_in} handed in` : ""}` : ""}
            </span>
            {SECTIONS.map(({ key, label }) =>
              p[key].length ? (
                <div className={`rp-sec rp-sec-${key}`} key={key}>
                  <span className="rp-sec-label">{sectionLabel(key, label, kind)}</span>
                  <ul className="rp-lines">
                    {p[key].map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Whether the person checked it. Sent back shows on paper too; waiting and not checked only in the
 * app (they're about the app, not the week).
 */
function CheckLine({ row, name }: { row: PersonWeek; name?: string }) {
  const state = checkState(row);
  if (state === "none") return null;
  if (state === "sent")
    return (
      <p className="rp-checked">
        {row.check_edited ? `Changed and sent back by ${name ?? "them"}` : `Checked by ${name ?? "them"}`} · {dayLabel(dateOf(row.checked_at!))}
      </p>
    );
  return (
    <p className="rp-checked rp-app-only wait">
      {state === "open" ? `Waiting for ${name ?? "them"} to check it, until ${dueLabel(row.check_due)}` : `Not checked by ${name ?? "them"}: it stays as it was written`}
    </p>
  );
}

/** Tasks grouped by project, "Other" last. */
export function tasksByProject(f: PersonFacts) {
  const map = new Map<string, PersonFacts["tasks"]>();
  for (const t of f.tasks) map.set(t.project ?? "Other", [...(map.get(t.project ?? "Other") ?? []), t]);
  return [...map.entries()].sort((a, b) => (a[0] === "Other" ? 1 : b[0] === "Other" ? -1 : a[0].localeCompare(b[0])));
}

function PersonPart({ row, showName, kind }: { row: PersonWeek; showName: boolean; kind: ReportKind }) {
  const f = hasFacts(row.facts) ? (row.facts as PersonFacts) : null;
  const sectioned = isSections(row.summary);
  return (
    <section className="rp-section rp-person">
      {showName && (
        <div className="rp-section-head">
          <h2>{f?.name ?? "Someone"}</h2>
          {f?.title && <span className="rp-role">{f.title}</span>}
        </div>
      )}
      {f && (
        <div className="rp-counts">
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
          {f.missed_days.length > 0 && f.days_sent > 0 && <span>No update {f.missed_days.map((d) => dayLabel(d)).join(", ")}</span>}
        </div>
      )}
      <StateNote status={row.status} error={row.error} empty="No daily updates in these days." />
      {row.kind === "week" && row.status === "ready" && <CheckLine row={row} name={f?.short_name} />}
      {sectioned ? <PersonSections s={row.summary as SectionWords} f={f} kind={kind} /> : <OldPersonBody s={row.summary as OldWords | null} f={f} />}
    </section>
  );
}

/** A person's week in sections, each line with its project, then the tasks and their figures. */
function PersonSections({ s, f, kind }: { s: SectionWords; f: PersonFacts | null; kind: ReportKind }) {
  return (
    <>
      {s.headline && <p className="rp-lead">{s.headline}</p>}
      {SECTIONS.map(({ key, label }) =>
        s[key]?.length ? (
          <div className={`rp-sec rp-sec-${key}`} key={key}>
            <span className="rp-sec-label">{sectionLabel(key, label, kind)}</span>
            <ul className="rp-lines">
              {s[key].map((l, i) => (
                <li key={i}>
                  <span className="rp-proj">{l.project}</span> {l.text}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {s.added && (
        <div className="rp-block">
          <span className="rp-label">Added by {f?.short_name ?? "them"}</span>
          <p>{s.added}</p>
        </div>
      )}
      {f && f.tasks.length > 0 && (
        <div className="rp-block rp-taskfig">
          <span className="rp-label">Tasks and progress</span>
          {tasksByProject(f).map(([project, tasks]) => (
            <div className="rp-project" key={project}>
              <h3>{project}</h3>
              <TaskTable tasks={tasks} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TaskTable({ tasks }: { tasks: PersonFacts["tasks"] }) {
  return (
    <table className="rp-tasks">
      <thead>
        <tr>
          <th>Task</th>
          <th className="num">Start</th>
          <th className="num">End</th>
          <th className="num rp-col-days">Days</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t.task_id}>
            <td>
              <span className="rp-task-title">{t.title}</span>
              {t.handed_in && <span className="rp-done"> · Handed in</span>}
              {t.notes.length > 0 && (
                <ul className="rp-task-notes">
                  {t.notes.map((n) => (
                    <li key={n.date + n.note}>
                      {dayLabel(n.date)}: {n.note}
                    </li>
                  ))}
                </ul>
              )}
            </td>
            <td className="num">{t.start}%</td>
            <td className="num">
              <span className="rp-bar" aria-hidden>
                <i style={{ width: `${Math.min(t.start, t.end)}%` }} />
                <i className="gain" style={{ left: `${Math.min(t.start, t.end)}%`, width: `${Math.max(0, t.end - t.start)}%` }} />
              </span>{" "}
              <b>{t.end}%</b>
            </td>
            <td className="num rp-col-days">{t.days}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A person's week as it was written before the sections (older weeks). */
function OldPersonBody({ s, f }: { s: OldWords | null; f: PersonFacts | null }) {
  const written = new Map((s?.projects ?? []).map((p) => [p.project.toLowerCase(), p.summary]));
  return (
    <>
      {s?.summary && <p className="rp-lead">{s.summary}</p>}
      {f &&
        tasksByProject(f).map(([project, tasks]) => (
          <div className="rp-project" key={project}>
            <h3>{project}</h3>
            {written.get(project.toLowerCase()) && <p>{written.get(project.toLowerCase())}</p>}
            <TaskTable tasks={tasks} />
          </div>
        ))}
      {(s?.other_work || (f && f.other_work.length > 0)) && (
        <div className="rp-block">
          <span className="rp-label">Other work</span>
          {s?.other_work ? (
            <p>{s.other_work}</p>
          ) : (
            <ul className="rp-list">
              {f!.other_work.map((o) => (
                <li key={o.date}>
                  {dayLabel(o.date)}: {o.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {s?.added && (
        <div className="rp-block">
          <span className="rp-label">Added by {f?.short_name ?? "them"}</span>
          <p>{s.added}</p>
        </div>
      )}
      {s?.blockers && !(f && f.blockers.length > 0) && (
        <div className="rp-block">
          <span className="rp-label">Blockers</span>
          <p>{s.blockers}</p>
        </div>
      )}
      {f && f.blockers.length > 0 && (
        <div className="rp-block">
          <span className="rp-label">Blockers</span>
          {s?.blockers && <p>{s.blockers}</p>}
          <ul className="rp-blockers">
            {f.blockers.map((b) => (
              <li key={b.date}>
                <span className="rp-when">{dayLabel(b.date)}:</span> {b.text} <b>{b.cleared ? "Cleared" : "Still open"}</b>
                {b.replies.map((r, i) => (
                  <Fragment key={i}>
                    <div className="rp-reply">
                      {r.by}: {r.body}
                    </div>
                  </Fragment>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
