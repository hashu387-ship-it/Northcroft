import { useMemo, useState } from "react";
import { BarChart3, Lock, Repeat } from "lucide-react";
import clsx from "clsx";
import { usePeople, useSettings, useTasks } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { addDays, fmtDate, todayISO, weekStart } from "@/lib/time";
import type { Task } from "@/lib/types";
import { PageHead } from "@/components/PageHead";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, Empty, Loading, Sheet } from "@/components/ui";
import { RecurringList } from "./project/Recurring";
import "@/styles/tasks.css";
import { peopleOn } from "@/lib/people";

interface Col {
  key: string;
  label: string;
  sub?: string;
  match: (t: Task) => boolean;
  kind: "late" | "week" | "none";
}

export default function Workload() {
  const { canAssign } = useAuth();
  const people = usePeople();
  const settings = useSettings().data;
  const { data: tasks = [], isLoading } = useTasks({ openOnly: true });
  const [cell, setCell] = useState<{ title: string; tasks: Task[] } | null>(null);
  const capacity = settings?.weekly_task_capacity ?? 8;
  const today = todayISO();

  const cols = useMemo<Col[]>(() => {
    const ws = weekStart(today);
    const weeks: Col[] = [0, 1, 2, 3].map((i) => {
      const start = addDays(ws, i * 7);
      const end = addDays(start, 6);
      const from = i === 0 ? today : start;
      return {
        key: `w${i}`,
        label: i === 0 ? "This week" : i === 1 ? "Next week" : `w/c ${fmtDate(start)}`,
        sub: `${fmtDate(start)} – ${fmtDate(addDays(start, 4))}`,
        match: (t) => !!t.due_date && t.due_date >= from && t.due_date <= end,
        kind: "week",
      };
    });
    return [
      { key: "late", label: "Overdue", match: (t) => !!t.due_date && t.due_date < today, kind: "late" },
      ...weeks,
      { key: "none", label: "No date", match: (t) => !t.due_date, kind: "none" },
    ];
  }, [today]);

  // Work still with the person: to do and in progress. Tasks in review are waiting on the reviewer.
  const active = tasks.filter((t) => t.status === "todo" || t.status === "in_progress");

  if (!canAssign) {
    return (
      <div className="page">
        <PageHead title="Workload" />
        <div className="glass">
          <Empty icon={<Lock />} title="This page is for managers and seniors">
            It shows how busy everyone is so work can be shared out fairly.
          </Empty>
        </div>
      </div>
    );
  }

  // People who take tasks, plus anyone else who happens to have one (e.g. a reminder they set themselves).
  // A shared task counts for each person on it.
  const rows = people.active.filter((p) => p.assignable !== false || active.some((t) => peopleOn(t).includes(p.id))).map((p) => {
    const mine = active.filter((t) => peopleOn(t).includes(p.id));
    return { person: p, total: mine.length, cells: cols.map((c) => mine.filter(c.match)) };
  });
  const unassigned = active.filter((t) => peopleOn(t).length === 0);

  return (
    <div className="page">
      <PageHead
        title="Workload"
        sub={`Open tasks per person by due week. A week turns red above ${capacity} tasks (change this in Settings).`}
      />

      {isLoading || people.loading ? (
        <Loading />
      ) : (
        <div className="solid" style={{ padding: 0, overflow: "hidden", marginBottom: 16 }}>
          <div className="table-wrap" style={{ borderRadius: 0 }}>
            <table className="table wl-table">
              <thead>
                <tr>
                  <th>Person</th>
                  {cols.map((c) => (
                    <th key={c.key}>
                      {c.label}
                      {c.sub && <div className="faint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{c.sub}</div>}
                    </th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.person.id}>
                    <td>
                      <span className="row" style={{ gap: 10 }}>
                        <Avatar person={r.person} size={30} />
                        <span style={{ minWidth: 0 }}>
                          <span className="bold" style={{ display: "block" }}>{r.person.short_name}</span>
                          <span className="faint tiny">{r.person.title}</span>
                        </span>
                      </span>
                    </td>
                    {cols.map((c, i) => {
                      const list = r.cells[i];
                      const n = list.length;
                      const hours = list.reduce((s, t) => s + (t.estimate_hours ?? 0), 0);
                      const over = c.kind === "week" && n > capacity;
                      const ratio = Math.min(1, n / capacity);
                      return (
                        <td key={c.key} style={{ padding: 6 }}>
                          <button
                            className={clsx("wl-cell", n === 0 && "zero", over && "over", c.kind === "late" && n > 0 && "late")}
                            style={n > 0 && !over && c.kind === "week" ? { background: `color-mix(in srgb, var(--accent) ${Math.round(12 + ratio * 38)}%, transparent)` } : undefined}
                            onClick={() => n && setCell({ title: `${r.person.short_name} · ${c.label}`, tasks: list })}
                            disabled={!n}
                            aria-label={`${r.person.short_name}, ${c.label}: ${n} tasks`}
                          >
                            {n || "–"}
                            {n > 0 && hours > 0 && <small>{hours} h</small>}
                          </button>
                        </td>
                      );
                    })}
                    <td className="bold num">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="glass card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h3>
              <BarChart3 /> Not assigned to anyone
            </h3>
            <span className="muted small">{unassigned.length}</span>
          </div>
          {unassigned.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </div>
      )}

      <div className="glass card">
        <div className="card-head">
          <h3>
            <Repeat /> All repeating tasks
          </h3>
        </div>
        <RecurringList showProject />
      </div>

      <Sheet open={!!cell} onClose={() => setCell(null)} title={cell?.title}>
        {cell?.tasks.map((t) => (
          <TaskRow key={t.id} task={t} showAssignee={false} />
        ))}
      </Sheet>
    </div>
  );
}
