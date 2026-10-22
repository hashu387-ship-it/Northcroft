import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CircleCheck, ClipboardList, Inbox, Plus, SquareCheckBig } from "lucide-react";
import { useChecklistCounts, usePeople, useTasks } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { PageHead } from "@/components/PageHead";
import { TaskForm } from "@/components/TaskForm";
import { TaskRow } from "@/components/TaskRow";
import { Avatar, Empty, Loading, Segmented } from "@/components/ui";
import { todayISO } from "@/lib/time";
import type { Task } from "@/lib/types";
import { DUE_GROUP_LABEL, dueGroup, type DueGroup } from "./project/api";
import "@/styles/tasks.css";

type View = "mine" | "review" | "byme" | "done";

function Group({ title, tasks, counts, tone, showAssignee = false }: { title: string; tasks: Task[]; counts?: Record<string, [number, number]>; tone?: "red"; showAssignee?: boolean }) {
  if (!tasks.length) return null;
  return (
    <section>
      <div className={`section-title ${tone ?? ""}`}>
        {title} <span className="n">{tasks.length}</span>
      </div>
      <div className="glass group-card">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} showAssignee={showAssignee} checklist={counts?.[t.id]} />
        ))}
      </div>
    </section>
  );
}

export default function MyTasks() {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const view = (["mine", "review", "byme", "done"].includes(params.get("view") ?? "") ? params.get("view") : "mine") as View;
  const setView = (v: View) => setParams(v === "mine" ? {} : { view: v }, { replace: true });

  const mine = useTasks({ assigneeId: me.id });
  const reviewQ = useTasks({ reviewerId: me.id });
  const byMeQ = useTasks({ createdBy: me.id, openOnly: true });

  const today = todayISO();
  const myTasks = mine.data ?? [];
  const open = myTasks.filter((t) => t.status === "todo" || t.status === "in_progress");
  const waiting = myTasks.filter((t) => t.status === "in_review");
  const done = myTasks
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
    .slice(0, 50);
  const toReview = (reviewQ.data ?? [])
    .filter((t) => t.status === "in_review")
    .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
  const byMe = (byMeQ.data ?? []).filter((t) => t.assignee_id !== me.id);

  const grouped = useMemo(() => {
    const g: Record<DueGroup, Task[]> = { overdue: [], today: [], week: [], later: [], none: [] };
    for (const t of open) g[dueGroup(t, today)].push(t);
    return g;
  }, [open, today]);

  const visibleIds = useMemo(() => {
    const list = view === "mine" ? [...open, ...waiting] : view === "review" ? toReview : view === "byme" ? byMe : done;
    return list.map((t) => t.id);
  }, [view, open, waiting, toReview, byMe, done]);
  const counts = useChecklistCounts(visibleIds).data;

  const byPerson = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of byMe) {
      const k = t.assignee_id ?? "none";
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()].sort((a, b) => (people.get(a[0])?.short_name ?? "~").localeCompare(people.get(b[0])?.short_name ?? "~"));
  }, [byMe, people]);

  const loading = mine.isLoading || (view === "review" && reviewQ.isLoading) || (view === "byme" && byMeQ.isLoading);
  const overdueCount = grouped.overdue.length;

  const options: { value: View; label: string; count?: number }[] = [
    { value: "mine", label: "Mine", count: open.length },
    ...(canAssign || toReview.length ? [{ value: "review" as View, label: "To review", count: toReview.length }] : []),
    ...(canAssign ? [{ value: "byme" as View, label: "By me", count: byMe.length }] : []),
    { value: "done", label: "Done" },
  ];

  return (
    <div className="page">
      <PageHead
        title="My tasks"
        sub={
          view === "mine"
            ? open.length
              ? `${open.length} open${overdueCount ? `, ${overdueCount} overdue` : ""}${waiting.length ? `, ${waiting.length} waiting for review` : ""}`
              : "Nothing on your plate right now"
            : view === "review"
              ? toReview.length
                ? `${toReview.length} waiting for you to check`
                : "Nothing waiting for review"
              : view === "byme"
                ? `${byMe.length} open tasks you've handed out`
                : "Your recently finished work"
        }
        actions={
          canAssign && (
            <button className="btn primary hide-mobile" onClick={() => setFormOpen(true)}>
              <Plus /> New task
            </button>
          )
        }
      />

      <div style={{ marginBottom: 6 }}>
        <Segmented<View> value={view} onChange={setView} options={options} />
      </div>

      {loading ? (
        <Loading />
      ) : view === "mine" ? (
        open.length + waiting.length === 0 ? (
          <div className="glass" style={{ marginTop: 16 }}>
            <Empty
              icon={<CircleCheck />}
              title="All clear"
              action={
                canAssign && toReview.length > 0 ? (
                  <button className="btn primary" onClick={() => setView("review")}>
                    {toReview.length} waiting for your review
                  </button>
                ) : undefined
              }
            >
              {canAssign
                ? "Nothing is assigned to you. Tasks you hand out are under By me."
                : "When Hassan or a senior assigns you something, it shows up here and on your phone."}
            </Empty>
          </div>
        ) : (
          <>
            {(["overdue", "today", "week", "later", "none"] as DueGroup[]).map((g) => (
              <Group key={g} title={DUE_GROUP_LABEL[g]} tasks={grouped[g]} counts={counts} tone={g === "overdue" ? "red" : undefined} />
            ))}
            <Group title="Waiting for review" tasks={waiting} counts={counts} />
          </>
        )
      ) : view === "review" ? (
        toReview.length === 0 ? (
          <div className="glass" style={{ marginTop: 16 }}>
            <Empty icon={<Inbox />} title="Nothing to review">
              When someone submits a task for your review, it lands here.
            </Empty>
          </div>
        ) : (
          <Group title="Submitted for your review" tasks={toReview} counts={counts} showAssignee />
        )
      ) : view === "byme" ? (
        byMe.length === 0 ? (
          <div className="glass" style={{ marginTop: 16 }}>
            <Empty icon={<ClipboardList />} title="No open tasks handed out" action={canAssign ? <button className="btn primary" onClick={() => setFormOpen(true)}><Plus /> Assign a task</button> : undefined} />
          </div>
        ) : (
          byPerson.map(([pid, list]) => {
            const p = people.get(pid);
            return (
              <section key={pid}>
                <div className="section-title">
                  <Avatar person={p} size={20} />
                  {p?.short_name ?? "Unassigned"} <span className="n">{list.length}</span>
                </div>
                <div className="glass group-card">
                  {list.map((t) => (
                    <TaskRow key={t.id} task={t} showAssignee={false} checklist={counts?.[t.id]} />
                  ))}
                </div>
              </section>
            );
          })
        )
      ) : done.length === 0 ? (
        <div className="glass" style={{ marginTop: 16 }}>
          <Empty icon={<SquareCheckBig />} title="Nothing finished yet" />
        </div>
      ) : (
        <Group title="Recently done" tasks={done} counts={counts} />
      )}

      {canAssign && (
        <button className="fab" onClick={() => setFormOpen(true)} aria-label="New task">
          <Plus />
        </button>
      )}
      <TaskForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
