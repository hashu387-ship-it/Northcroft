// One daily update, read-only: each task from where it was to where it is now, what was done,
// other work and anything blocking. Shown in someone's history and on the team's day.
import "@/styles/updates.css";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, CircleCheck } from "lucide-react";
import { usePeople, useProjectMap } from "@/lib/api";
import { progressTone, type UpdateWithItems } from "@/lib/dailyUpdates";
import { fmtLongDate, fmtTime12 } from "@/lib/time";
import { Avatar, Pill, ProjectTag } from "@/components/ui";
import { openPersonCard } from "@/components/People";

export function UpdateCard({ update, who, actions }: { update: UpdateWithItems; who?: boolean; actions?: ReactNode }) {
  const people = usePeople();
  const projects = useProjectMap();
  const person = people.get(update.user_id);
  const handed = update.items.filter((i) => i.handed_in).length;
  return (
    <div className="glass card du-card">
      <div className="du-card-head">
        {who ? (
          <button type="button" className="row du-who" onClick={() => person && openPersonCard(person.id)}>
            <Avatar person={person} size={34} />
            <span>
              <b>{person?.short_name ?? "Former team member"}</b>
              <span className="faint tiny" style={{ display: "block" }}>
                Sent {fmtTime12(update.submitted_at)}
              </span>
            </span>
          </button>
        ) : (
          <span>
            <b>{fmtLongDate(update.work_date)}</b>
            <span className="faint tiny" style={{ display: "block" }}>
              Sent {fmtTime12(update.submitted_at)}
            </span>
          </span>
        )}
        <span className="spacer" />
        <span className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
          {update.items.length > 0 && <Pill tone="blue">{update.items.length === 1 ? "1 task" : `${update.items.length} tasks`}</Pill>}
          {handed > 0 && <Pill tone="green">{handed} handed in</Pill>}
          {update.blockers && <Pill tone="orange">Blocked</Pill>}
        </span>
      </div>

      {update.items.length > 0 && (
        <div className="du-items">
          {update.items.map((i) => {
            const moved = i.progress - i.progress_before;
            return (
              <div className="du-item" key={i.id}>
                <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link to={`/tasks/${i.task_id}`} className="du-task-title">
                      {i.task_title}
                    </Link>
                    {i.project_id && (
                      <div className="du-task-meta">
                        <ProjectTag project={projects.get(i.project_id)} />
                      </div>
                    )}
                  </div>
                  <span className="du-item-pct">
                    {moved !== 0 && <span className="faint">{i.progress_before}% to </span>}
                    <b style={{ color: progressTone(i.progress) }}>{i.progress}%</b>
                  </span>
                </div>
                <div className="du-bar" aria-hidden>
                  <i className="before" style={{ width: `${Math.min(i.progress_before, i.progress)}%` }} />
                  {moved > 0 && <i className="gain" style={{ left: `${i.progress_before}%`, width: `${moved}%`, background: progressTone(i.progress) }} />}
                  {moved < 0 && <i className="before" style={{ width: `${i.progress}%` }} />}
                </div>
                {i.handed_in && (
                  <div className="du-hand-in small">
                    <CircleCheck size={15} /> Handed in for review
                  </div>
                )}
                {i.note && <p className="du-note">{i.note}</p>}
              </div>
            );
          })}
        </div>
      )}

      {update.other_work && (
        <div className="du-block">
          <span className="field-label">Other work</span>
          <p className="du-note">{update.other_work}</p>
        </div>
      )}
      {update.blockers && (
        <div className="du-block du-blocked">
          <span className="field-label">
            <CircleAlert size={14} /> Blocking
          </span>
          <p className="du-note">{update.blockers}</p>
        </div>
      )}
      {actions}
    </div>
  );
}
