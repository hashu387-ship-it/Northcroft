// Every open task in the team, grouped under each person: the "Ongoing tasks" card on Home and
// the full list on the tasks screen. A task with several people on it shows under each of them.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ListTodo } from "lucide-react";
import clsx from "clsx";
import { usePeople } from "@/lib/api";
import { PRIORITY } from "@/lib/constants";
import { peopleOn } from "@/lib/people";
import { todayISO } from "@/lib/time";
import type { Profile, Task } from "@/lib/types";
import { TaskRow } from "./TaskRow";
import { Avatar, Empty, Loading } from "./ui";

export interface PersonTasks {
  id: string;
  person: Profile | undefined;
  tasks: Task[];
  overdue: number;
  review: number;
}

const isLate = (t: Task, today: string) => !!t.due_date && t.due_date < today && t.status !== "in_review" && t.hold !== "on";

/** Late first, then the most urgent, then the soonest due. */
export function sortOpen(list: Task[], today = todayISO()): Task[] {
  return [...list].sort((a, b) => {
    const la = isLate(a, today) ? 0 : 1;
    const lb = isLate(b, today) ? 0 : 1;
    if (la !== lb) return la - lb;
    const pa = PRIORITY[a.priority]?.rank ?? 2;
    const pb = PRIORITY[b.priority]?.rank ?? 2;
    if (pa !== pb) return pa - pb;
    return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
  });
}

export function useTasksByPerson(tasks: Task[]): PersonTasks[] {
  const people = usePeople();
  return useMemo(() => {
    const today = todayISO();
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.status === "done") continue;
      const ids = peopleOn(t);
      for (const k of ids.length ? ids : ["none"]) m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()]
      .map(([id, list]) => ({
        id,
        person: people.get(id),
        tasks: sortOpen(list, today),
        overdue: list.filter((t) => isLate(t, today)).length,
        review: list.filter((t) => t.status === "in_review").length,
      }))
      .sort((a, b) => b.overdue - a.overdue || (a.person?.short_name ?? "~").localeCompare(b.person?.short_name ?? "~"));
  }, [tasks, people]);
}

function PersonBlock({ g, limit, counts }: { g: PersonTasks; limit?: number; counts?: Record<string, [number, number]> }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? g.tasks.slice(0, limit) : g.tasks;
  const more = g.tasks.length - shown.length;
  return (
    <section className="tt-person">
      <div className="tt-head">
        <Avatar person={g.person} size={30} />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ellipsis">{g.person?.short_name ?? "Not assigned"}</b>
          <span className="tt-counts">
            <span>{g.tasks.length} open</span>
            {g.overdue > 0 && <span className="late">{g.overdue} overdue</span>}
            {g.review > 0 && <span className="review">{g.review} in review</span>}
          </span>
        </div>
      </div>
      <div className="tt-list">
        {shown.map((t) => (
          <TaskRow key={t.id} task={t} showAssignee={false} checklist={counts?.[t.id]} />
        ))}
      </div>
      {more > 0 && (
        <button type="button" className="tt-more" onClick={() => setAll(true)}>
          <ChevronDown size={15} /> Show {more} more
        </button>
      )}
      {limit && all && g.tasks.length > limit && (
        <button type="button" className="tt-more" onClick={() => setAll(false)}>
          Show fewer
        </button>
      )}
    </section>
  );
}

/** The full list, person by person (tasks screen). */
export function TeamTaskList({ tasks, counts }: { tasks: Task[]; counts?: Record<string, [number, number]> }) {
  const groups = useTasksByPerson(tasks);
  if (!groups.length) {
    return (
      <div className="glass" style={{ marginTop: 16 }}>
        <Empty icon={<ListTodo />} title="No open tasks">
          Everything given out has been finished.
        </Empty>
      </div>
    );
  }
  return (
    <div className="tt-grid">
      {groups.map((g) => (
        <div key={g.id} className="glass tt-card">
          <PersonBlock g={g} counts={counts} />
        </div>
      ))}
    </div>
  );
}

/** Home: everyone's open work at a glance, the first few tasks each. */
export function OngoingTasksCard({ tasks, loading, linkTo }: { tasks: Task[]; loading: boolean; linkTo: string }) {
  const groups = useTasksByPerson(tasks);
  const open = tasks.filter((t) => t.status !== "done");
  const today = todayISO();
  const overdue = open.filter((t) => isLate(t, today)).length;
  const review = open.filter((t) => t.status === "in_review").length;
  return (
    <div className="glass card">
      <div className="card-head">
        <h2 className="tone-blue">
          <ListTodo /> Ongoing tasks
        </h2>
        <Link to={linkTo}>See all</Link>
      </div>
      {loading ? (
        <Loading />
      ) : open.length === 0 ? (
        <Empty icon={<ListTodo />} title="No open tasks">
          Nothing is waiting on anyone right now.
        </Empty>
      ) : (
        <>
          <p className={clsx("muted small")} style={{ margin: "-4px 0 10px" }}>
            {open.length} open across the team
            {overdue ? `, ${overdue} overdue` : ""}
            {review ? `, ${review} in review` : ""}
          </p>
          <div className="tt-stack">
            {groups.map((g) => (
              <PersonBlock key={g.id} g={g} limit={3} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
