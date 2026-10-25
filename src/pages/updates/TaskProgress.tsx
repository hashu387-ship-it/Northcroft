// How far a task has got, from the daily updates: a small chip for task lists, and the day-by-day
// notes on the task page.
import "@/styles/updates.css";
import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { usePeople } from "@/lib/api";
import { progressTone, useTaskProgressHistory } from "@/lib/dailyUpdates";
import { fmtDate } from "@/lib/time";
import type { Task } from "@/lib/types";
import { Avatar, Progress } from "@/components/ui";

/** "60%" with a tiny bar, for task rows. Only for tasks someone has given a % to. */
export function ProgressChip({ task }: { task: Pick<Task, "progress" | "progress_at" | "status"> }) {
  const pct = task.progress ?? 0;
  if (!task.progress_at || task.status === "done" || task.status === "in_review" || pct <= 0) return null;
  return (
    <span className="pct-chip" title={`${pct}% done, from the latest daily update`}>
      <span className="pct-mini" aria-hidden>
        <i style={{ width: `${pct}%`, background: progressTone(pct) }} />
      </span>
      {pct}%
    </span>
  );
}

/** The Progress row on a task: the bar and when it was last updated. */
export function ProgressValue({ task }: { task: Pick<Task, "progress" | "progress_at"> }) {
  const pct = task.progress ?? 0;
  return (
    <span className="stack" style={{ gap: 4, minWidth: 0, width: "100%", maxWidth: 220 }}>
      <span className="row" style={{ gap: 8 }}>
        <b style={{ color: progressTone(pct) }}>{pct}%</b>
        {task.progress_at && <span className="faint tiny">updated {fmtDate(task.progress_at.slice(0, 10))}</span>}
      </span>
      <Progress value={pct} color={progressTone(pct)} />
    </span>
  );
}

/** Each daily update that mentioned this task: who, when, how far, and what they did. */
export function TaskProgressCard({ taskId }: { taskId: string }) {
  const people = usePeople();
  const q = useTaskProgressHistory(taskId);
  const [all, setAll] = useState(false);
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 4);
  return (
    <div className="glass card">
      <div className="card-head">
        <h3>
          <TrendingUp /> Daily progress
        </h3>
      </div>
      <div className="du-items">
        {shown.map((r) => {
          const person = people.get(r.update?.user_id);
          return (
            <div className="du-item" key={r.id}>
              <div className="row" style={{ gap: 8 }}>
                <Avatar person={person} size={24} />
                <span className="small grow">
                  <b>{person?.short_name ?? "Former team member"}</b>
                  <span className="faint"> · {r.update ? fmtDate(r.update.work_date) : ""}</span>
                </span>
                <span className="du-item-pct">
                  {r.progress !== r.progress_before && <span className="faint">{r.progress_before}% to </span>}
                  <b style={{ color: progressTone(r.progress) }}>{r.progress}%</b>
                </span>
              </div>
              {r.handed_in && <span className="faint tiny">Handed in for review</span>}
              {r.note && <p className="du-note">{r.note}</p>}
            </div>
          );
        })}
      </div>
      {rows.length > 4 && (
        <button className="btn small ghost" type="button" style={{ marginTop: 10 }} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
