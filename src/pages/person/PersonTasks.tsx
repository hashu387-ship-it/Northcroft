// A person's work: what's late, what they're on now, what's waiting for review, what they
// finished lately, the tasks they gave other people, and the hours they logged this week.
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CircleCheckBig, ClipboardList, ListTodo, Send, Timer, TriangleAlert, Zap } from "lucide-react";
import { useTasks } from "@/lib/api";
import { buildReport, useTimeReport } from "@/lib/timeReport";
import { fmtSpent } from "@/lib/tracked";
import { peopleOn } from "@/lib/people";
import { addDays, todayISO, weekStart } from "@/lib/time";
import type { Profile, Task } from "@/lib/types";
import { TaskRow } from "@/components/TaskRow";
import { Empty, Loading } from "@/components/ui";

const hoursText = (secs: number) => (secs >= 3600 ? `${(secs / 3600).toFixed(1)}h` : fmtSpent(secs));

export interface PersonTaskGroups {
  loading: boolean;
  overdue: Task[];
  doing: Task[];
  todo: Task[];
  review: Task[];
  done: Task[];
  given: Task[];
  open: number;
}

/** Their tasks, sorted into the groups the profile shows (also used for the counts at the top). */
export function usePersonTasks(person: Profile): PersonTaskGroups {
  const on = useTasks({ assigneeId: person.id });
  const gave = useTasks({ createdBy: person.id, openOnly: true });
  return useMemo(() => {
    const today = todayISO();
    const since = addDays(today, -30);
    const all = on.data ?? [];
    const open = all.filter((t) => t.status !== "done");
    const late = (t: Task) => !!t.due_date && t.due_date < today && t.status !== "in_review";
    const overdue = open.filter(late);
    const doing = open.filter((t) => !late(t) && t.status === "in_progress");
    const todo = open.filter((t) => !late(t) && t.status === "todo");
    const review = open.filter((t) => t.status === "in_review");
    const done = all
      .filter((t) => t.status === "done" && (t.completed_at ?? t.updated_at).slice(0, 10) >= since)
      .sort((a, b) => (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at));
    // Tasks they gave someone else (not ones they're on themselves).
    const given = (gave.data ?? []).filter((t) => !peopleOn(t).includes(person.id));
    return { loading: on.isLoading, overdue, doing, todo, review, done, given, open: open.length };
  }, [on.data, on.isLoading, gave.data, person.id]);
}

/** Hours they logged on tasks from Sunday to today, per task. */
export function usePersonHours(personId: string) {
  const today = todayISO();
  const from = weekStart(today);
  const logs = useTimeReport(from, today, personId);
  return useMemo(() => {
    const report = buildReport(logs.data ?? [], from, today);
    const row = report.people.find((p) => p.userId === personId);
    return { loading: logs.isLoading, total: row?.secs ?? 0, running: !!row?.running, tasks: row?.tasks ?? [] };
  }, [logs.data, logs.isLoading, from, today, personId]);
}

function Group({ icon, title, tone, tasks, showAssignee, limit, empty }: { icon: ReactNode; title: string; tone?: string; tasks: Task[]; showAssignee?: boolean; limit?: number; empty?: string }) {
  if (!tasks.length && !empty) return null;
  const shown = limit ? tasks.slice(0, limit) : tasks;
  return (
    <section className="pp-group">
      <div className="group-title pp-group-title" style={tone ? { color: `var(--${tone})` } : undefined}>
        {icon} {title} <span className="pp-count">{tasks.length}</span>
      </div>
      {tasks.length ? (
        <div className="group pp-tasks">
          {shown.map((t) => (
            <TaskRow key={t.id} task={t} showAssignee={!!showAssignee} />
          ))}
          {limit && tasks.length > limit && <div className="pp-more">and {tasks.length - limit} more</div>}
        </div>
      ) : (
        <div className="group-foot">{empty}</div>
      )}
    </section>
  );
}

export function PersonTasks({ person, groups, self }: { person: Profile; groups: PersonTaskGroups; self: boolean }) {
  const hours = usePersonHours(person.id);
  if (groups.loading) return <Loading rows={4} />;
  const name = self ? "You" : person.short_name;
  const nothingOpen = !groups.open;
  return (
    <div className="stack" style={{ gap: 4 }}>
      {nothingOpen && (
        <div className="glass">
          <Empty icon={<CircleCheckBig />} title={self ? "You have no open tasks" : `${person.short_name} has no open tasks`}>
            Anything assigned to {self ? "you" : "them"} shows up here.
          </Empty>
        </div>
      )}
      <Group icon={<TriangleAlert />} title="Overdue" tone="red" tasks={groups.overdue} />
      <Group icon={<Zap />} title="Working on" tasks={groups.doing} />
      <Group icon={<ListTodo />} title="To do" tasks={groups.todo} />
      <Group icon={<ClipboardList />} title="Waiting for review" tone="purple" tasks={groups.review} />

      <section className="pp-group">
        <div className="group-title pp-group-title">
          <Timer /> Hours this week <span className="pp-count">{hours.loading ? "–" : hoursText(hours.total)}</span>
        </div>
        {hours.tasks.length ? (
          <div className="group">
            {hours.tasks
              .slice()
              .sort((a, b) => b.secs - a.secs)
              .map((t) => (
                <Link key={t.taskId} className="group-row no-tile pp-hours" to={`/tasks/${t.taskId}`}>
                  <span className="label ellipsis">{t.title}</span>
                  <span className="num bold">{hoursText(t.secs)}</span>
                </Link>
              ))}
          </div>
        ) : (
          <div className="group-foot">{hours.loading ? "" : `${name} ${self ? "haven't" : "hasn't"} timed any task since Sunday.`}</div>
        )}
      </section>

      <Group icon={<CircleCheckBig />} title="Finished in the last 30 days" tone="green" tasks={groups.done} limit={10} empty={`Nothing finished in the last 30 days.`} />
      <Group icon={<Send />} title={self ? "You gave others" : `${person.short_name} gave others`} tasks={groups.given} showAssignee />
    </div>
  );
}
