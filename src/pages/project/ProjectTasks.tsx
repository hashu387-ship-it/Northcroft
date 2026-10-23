import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, LayoutGrid, List, Plus, Repeat, SquareCheckBig } from "lucide-react";
import { useChecklistCounts, usePeople, useTasks } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TASK_STATUS, TASK_STATUS_ORDER } from "@/lib/constants";
import type { Project, Task, TaskStatus } from "@/lib/types";
import { TaskForm } from "@/components/TaskForm";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, DueLabel, Empty, Loading, PriorityFlag, Segmented } from "@/components/ui";
import { RecurringList } from "./Recurring";

const COL_COLOR: Record<TaskStatus, string> = {
  todo: "var(--gray)",
  in_progress: "var(--accent)",
  in_review: "var(--purple)",
  done: "var(--green)",
};

export function ProjectTasks({ project }: { project: Project }) {
  const { canAssign } = useAuth();
  const people = usePeople();
  const { data: tasks = [], isLoading } = useTasks({ projectId: project.id });
  const [view, setView] = useState<"list" | "board">(() => {
    try {
      return (localStorage.getItem("nc-task-view") as "list" | "board") || "list";
    } catch {
      return "list";
    }
  });
  const [person, setPerson] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const filtered = useMemo(() => (person ? tasks.filter((t) => t.assignee_id === person) : tasks), [tasks, person]);
  const counts = useChecklistCounts(filtered.map((t) => t.id)).data;
  const byStatus = useMemo(() => {
    const m: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], in_review: [], done: [] };
    for (const t of filtered) m[t.status].push(t);
    m.done.sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
    return m;
  }, [filtered]);

  const changeView = (v: "list" | "board") => {
    setView(v);
    try {
      localStorage.setItem("nc-task-view", v);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="view-head">
        <select className="select inline-select" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Filter by person">
          <option value="">Everyone</option>
          {people.active.filter((p) => p.assignable !== false || tasks.some((t) => t.assignee_id === p.id)).map((p) => (
            <option key={p.id} value={p.id}>
              {p.short_name}
            </option>
          ))}
        </select>
        <div className="hide-mobile">
          <Segmented
            value={view}
            onChange={changeView}
            options={[
              { value: "list", label: <><List size={15} /> List</> },
              { value: "board", label: <><LayoutGrid size={15} /> Board</> },
            ]}
          />
        </div>
        <span className="spacer" />
        {canAssign && (
          <button className="btn brand small hide-mobile" onClick={() => setFormOpen(true)}>
            <Plus /> New task
          </button>
        )}
      </div>

      {isLoading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <div className="glass">
          <Empty icon={<SquareCheckBig />} title={person ? "No tasks for this person here" : "No tasks on this project yet"} action={canAssign ? <button className="btn primary" onClick={() => setFormOpen(true)}><Plus /> Add the first task</button> : undefined} />
        </div>
      ) : view === "board" ? (
        <>
          <div className="board hide-mobile">
            {TASK_STATUS_ORDER.map((s) => (
              <div key={s} className="board-col glass">
                <h3>
                  <span className="col-dot" style={{ background: COL_COLOR[s] }} />
                  {TASK_STATUS[s].label} <span className="count">{byStatus[s].length}</span>
                </h3>
                {(s === "done" ? byStatus[s].slice(0, 12) : byStatus[s]).map((t) => (
                  <Link key={t.id} to={`/tasks/${t.id}`} className="board-card">
                    <div className="t">{t.title}</div>
                    <div className="m">
                      <DueLabel date={t.due_date} done={t.status === "done"} />
                      <PriorityFlag priority={t.priority} />
                      {counts?.[t.id] && counts[t.id][1] > 0 && (
                        <span>
                          {counts[t.id][0]}/{counts[t.id][1]} steps
                        </span>
                      )}
                      <span className="spacer" />
                      <Avatar person={people.get(t.assignee_id)} size={24} />
                    </div>
                  </Link>
                ))}
                {byStatus[s].length === 0 && <div className="faint small" style={{ padding: "6px 4px" }}>Nothing here</div>}
              </div>
            ))}
          </div>
          <div className="hide-desktop">
            <ListView byStatus={byStatus} counts={counts} showDone={showDone} setShowDone={setShowDone} />
          </div>
        </>
      ) : (
        <ListView byStatus={byStatus} counts={counts} showDone={showDone} setShowDone={setShowDone} />
      )}

      <div className="glass card">
        <div className="card-head">
          <h3>
            <Repeat /> Repeating tasks
          </h3>
        </div>
        <RecurringList projectId={project.id} />
      </div>

      {canAssign && (
        <button className="fab" onClick={() => setFormOpen(true)} aria-label="New task">
          <Plus />
        </button>
      )}
      <TaskForm open={formOpen} onClose={() => setFormOpen(false)} defaults={{ projectId: project.id, assigneeId: person || null }} />
    </div>
  );
}

function ListView({
  byStatus,
  counts,
  showDone,
  setShowDone,
}: {
  byStatus: Record<TaskStatus, Task[]>;
  counts?: Record<string, [number, number]>;
  showDone: boolean;
  setShowDone: (v: boolean) => void;
}) {
  const order: TaskStatus[] = ["in_review", "in_progress", "todo"];
  return (
    <div>
      {order.map((s) =>
        byStatus[s].length ? (
          <section key={s}>
            <div className="section-title">
              {TASK_STATUS[s].label} <span className="n">{byStatus[s].length}</span>
            </div>
            <div className="glass group-card">
              {byStatus[s].map((t) => (
                <TaskRow key={t.id} task={t} showProject={false} checklist={counts?.[t.id]} />
              ))}
            </div>
          </section>
        ) : null,
      )}
      {byStatus.done.length > 0 && (
        <section>
          <button className="section-title" style={{ border: 0, background: "none", padding: 0, cursor: "pointer" }} onClick={() => setShowDone(!showDone)}>
            {showDone ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            Done <span className="n">{byStatus.done.length}</span>
          </button>
          {showDone && (
            <div className="glass group-card">
              {byStatus.done.map((t) => (
                <TaskRow key={t.id} task={t} showProject={false} checklist={counts?.[t.id]} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
