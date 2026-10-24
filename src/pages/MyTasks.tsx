import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, ClipboardList, Inbox, Plus, SquareCheckBig } from "lucide-react";
import { useChecklistCounts, usePeople, useTasks } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useSignoff, waitingOn } from "@/lib/signoff";
import { supabase } from "@/lib/supabase";
import { PageHead } from "@/components/PageHead";
import { TaskForm } from "@/components/TaskForm";
import { TaskRow } from "@/components/TaskRow";
import { TeamTaskList } from "@/components/TeamTasks";
import { Avatar, Empty, Loading, Segmented } from "@/components/ui";
import { todayISO } from "@/lib/time";
import type { Task } from "@/lib/types";
import { DUE_GROUP_LABEL, dueGroup, type DueGroup } from "./project/api";
import "@/styles/tasks.css";
import { peopleOn } from "@/lib/people";

type View = "mine" | "review" | "team" | "byme" | "done";

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

/** The team's most recently finished tasks (for someone who doesn't take tasks themselves). */
function useRecentDone(enabled: boolean) {
  return useQuery({
    queryKey: ["tasks", "recent-done"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("status", "done")
        .order("completed_at", { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });
}

export default function MyTasks() {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const signoff = useSignoff();
  const [params, setParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  // Someone who only gives out tasks (the Commercial Head) has no list of their own: they see
  // every assigned task instead.
  const givesOnly = me.assignable === false;
  const allowed: View[] = givesOnly
    ? ["review", "team", "done"]
    : canAssign
      ? ["mine", "review", "team", "byme", "done"]
      : ["mine", "review", "done"];
  const fallback: View = givesOnly ? "team" : "mine";
  const asked = params.get("view") as View | null;
  const view: View = asked && allowed.includes(asked) ? asked : fallback;
  const setView = (v: View) => setParams(v === fallback ? {} : { view: v }, { replace: true });

  const mine = useTasks({ assigneeId: me.id });
  const openQ = useTasks({ openOnly: true });
  const recentDone = useRecentDone(givesOnly && view === "done");

  const today = todayISO();
  const myTasks = givesOnly ? [] : mine.data ?? [];
  const allOpen = openQ.data ?? [];
  const open = myTasks.filter((t) => t.status === "todo" || t.status === "in_progress");
  const waiting = myTasks.filter((t) => t.status === "in_review");
  const done = givesOnly
    ? recentDone.data ?? []
    : myTasks
        .filter((t) => t.status === "done")
        .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""))
        .slice(0, 50);
  // Waiting on me: my check, my final OK, or (with one reviewer) my review.
  const toReview = allOpen
    .filter((t) => waitingOn(t, signoff) === me.id)
    .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
  const finalOk = toReview.filter((t) => t.review_stage === "final");
  const firstCheck = toReview.filter((t) => t.review_stage !== "final");
  // Handed out by me to others (tasks I'm also on show under Mine).
  const byMe = allOpen.filter((t) => t.created_by === me.id && !peopleOn(t).includes(me.id));

  const grouped = useMemo(() => {
    const g: Record<DueGroup, Task[]> = { overdue: [], today: [], week: [], later: [], none: [] };
    for (const t of open) g[dueGroup(t, today)].push(t);
    return g;
  }, [open, today]);

  const visibleIds = useMemo(() => {
    const list =
      view === "mine" ? [...open, ...waiting] : view === "review" ? toReview : view === "team" ? allOpen : view === "byme" ? byMe : done;
    return list.map((t) => t.id);
  }, [view, open, waiting, toReview, allOpen, byMe, done]);
  const counts = useChecklistCounts(visibleIds).data;

  const byPerson = useMemo(() => {
    const m = new Map<string, Task[]>();
    // A shared task shows under each person on it.
    for (const t of byMe) {
      const ids = peopleOn(t);
      for (const k of ids.length ? ids : ["none"]) m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()].sort((a, b) => (people.get(a[0])?.short_name ?? "~").localeCompare(people.get(b[0])?.short_name ?? "~"));
  }, [byMe, people]);

  const loading =
    (view === "mine" && mine.isLoading) ||
    ((view === "review" || view === "team" || view === "byme") && openQ.isLoading) ||
    (view === "done" && (givesOnly ? recentDone.isLoading : mine.isLoading));
  const overdueCount = grouped.overdue.length;
  const teamOverdue = allOpen.filter((t) => t.due_date && t.due_date < today && t.status !== "in_review").length;

  const reviewLabel = signoff.on && signoff.final?.id === me.id ? "Final OK" : "To review";
  const options: { value: View; label: string; count?: number }[] = [
    ...(allowed.includes("mine") ? [{ value: "mine" as View, label: "Mine", count: open.length }] : []),
    ...(canAssign || toReview.length ? [{ value: "review" as View, label: reviewLabel, count: toReview.length }] : []),
    ...(allowed.includes("team") ? [{ value: "team" as View, label: givesOnly ? "Assigned" : "Everyone", count: allOpen.length }] : []),
    ...(allowed.includes("byme") ? [{ value: "byme" as View, label: "By me", count: byMe.length }] : []),
    { value: "done", label: "Done" },
  ];

  const sub =
    view === "mine"
      ? open.length
        ? `${open.length} open${overdueCount ? `, ${overdueCount} overdue` : ""}${waiting.length ? `, ${waiting.length} waiting for review` : ""}`
        : "Nothing on your plate right now"
      : view === "review"
        ? toReview.length
          ? finalOk.length && !firstCheck.length
            ? `${finalOk.length} waiting for your final OK`
            : `${toReview.length} waiting for you to check`
          : "Nothing waiting for you"
        : view === "team"
          ? `${allOpen.length} open across the team${teamOverdue ? `, ${teamOverdue} overdue` : ""}`
          : view === "byme"
            ? `${byMe.length} open tasks you've handed out`
            : givesOnly
              ? "The team's recently finished work"
              : "Your recently finished work";

  return (
    <div className="page">
      <PageHead
        title={givesOnly ? "Assigned tasks" : "My tasks"}
        sub={sub}
        actions={
          canAssign && (
            <button className="btn brand hide-mobile" onClick={() => setFormOpen(true)}>
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
                ? "Nothing is assigned to you. Tasks you hand out are under By me, and everyone's open work is under Everyone."
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
            <Empty icon={<Inbox />} title="Nothing waiting for you">
              {signoff.on && signoff.final?.id === me.id
                ? `When ${signoff.first?.short_name ?? "the first checker"} approves a task, it comes here for your final OK.`
                : "When someone submits a task for your review, it lands here."}
            </Empty>
          </div>
        ) : (
          <>
            <Group title="Waiting for your final OK" tasks={finalOk} counts={counts} showAssignee />
            <Group title={signoff.on ? "Waiting for your check" : "Submitted for your review"} tasks={firstCheck} counts={counts} showAssignee />
          </>
        )
      ) : view === "team" ? (
        <TeamTaskList tasks={allOpen} counts={counts} />
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
        <Group title="Recently done" tasks={done} counts={counts} showAssignee={givesOnly} />
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
