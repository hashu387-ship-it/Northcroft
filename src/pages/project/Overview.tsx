import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, History, Users } from "lucide-react";
import clsx from "clsx";
import { usePeople, useTasks } from "@/lib/api";
import { BOQ_STATUS, VO_STATUS } from "@/lib/constants";
import { pct, sar } from "@/lib/format";
import { addDays, dueState, fmtDue, todayISO } from "@/lib/time";
import type { Project } from "@/lib/types";
import { Avatar, Empty, Loading, Pill, StatusRing } from "@/components/ui";
import { ActivityFeed } from "./ActivityFeed";
import { VoMeter } from "./Variations";
import { VO_PENDING, useActivity, useBoq, useVariations, voTotals } from "./api";

interface Deadline {
  key: string;
  date: string;
  title: string;
  kind: string;
  to: string;
  person?: string | null;
  tone: string;
}

export function Overview({ project }: { project: Project }) {
  const people = usePeople();
  const { data: tasks = [], isLoading } = useTasks({ projectId: project.id });
  const vos = useVariations(project.id).data ?? [];
  const boq = useBoq(project.id).data ?? [];
  const activity = useActivity({ projectId: project.id, limit: 8 });
  const today = todayISO();

  const open = tasks.filter((t) => t.status !== "done");
  const overdue = open.filter((t) => t.status !== "in_review" && t.due_date && t.due_date < today);
  const review = open.filter((t) => t.status === "in_review");
  const v = voTotals(vos);
  const issued = boq.filter((b) => b.status === "issued").length;
  const titles = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);

  const deadlines = useMemo(() => {
    const horizon = addDays(today, 14);
    const list: Deadline[] = [];
    for (const t of open) {
      if (t.due_date && t.due_date <= horizon && t.status !== "in_review")
        list.push({ key: `t${t.id}`, date: t.due_date, title: t.title, kind: "Task", to: `/tasks/${t.id}`, person: t.assignee_id, tone: "blue" });
    }
    for (const x of vos) {
      if (x.response_due && x.response_due <= horizon && VO_PENDING.includes(x.status))
        list.push({ key: `v${x.id}`, date: x.response_due, title: `${x.vo_number} ${x.title}`, kind: VO_STATUS[x.status].label, to: `/projects/${project.id}/variations?vo=${x.id}`, person: x.owner_id, tone: "orange" });
    }
    for (const b of boq) {
      if (b.due_date && b.due_date <= horizon && b.status !== "issued")
        list.push({ key: `b${b.id}`, date: b.due_date, title: `${b.name} BOQ`, kind: BOQ_STATUS[b.status].label, to: `/projects/${project.id}/boq`, person: b.owner_id, tone: "purple" });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  }, [open, vos, boq, today, project.id]);

  const team = useMemo(() => {
    const m = new Map<string, { open: number; overdue: number }>();
    for (const t of open) {
      if (!t.assignee_id) continue;
      const c = m.get(t.assignee_id) ?? { open: 0, overdue: 0 };
      c.open++;
      if (t.due_date && t.due_date < today && t.status !== "in_review") c.overdue++;
      m.set(t.assignee_id, c);
    }
    return [...m.entries()].sort((a, b) => b[1].open - a[1].open);
  }, [open, today]);

  if (isLoading) return <Loading />;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid-4">
        <Link to={`/projects/${project.id}/tasks`} className="glass stat" style={{ color: "inherit" }}>
          <span className="label">Open tasks</span>
          <span className="value">{open.length}</span>
          <span className="hint">{review.length ? `${review.length} waiting for review` : `${tasks.length - open.length} done`}</span>
        </Link>
        <Link to={`/projects/${project.id}/tasks`} className="glass stat" style={{ color: "inherit" }}>
          <span className="label">Overdue</span>
          <span className={clsx("value", overdue.length > 0 && "danger-text")}>{overdue.length}</span>
          <span className="hint">{overdue.length ? "Need attention" : "Nothing late"}</span>
        </Link>
        <Link to={`/projects/${project.id}/variations`} className="glass stat" style={{ color: "inherit" }}>
          <span className="label">VOs approved</span>
          <span className="value">{sar(v.approved, { compact: true, blank: "SAR 0" })}</span>
          <span className="hint">
            {project.contract_value ? `${pct((v.approved / project.contract_value) * 100)} of contract` : `${v.approvedCount} VOs`} · {sar(v.pending, { compact: true, blank: "SAR 0" })} pending
          </span>
        </Link>
        <Link to={`/projects/${project.id}/boq`} className="glass stat" style={{ color: "inherit" }}>
          <span className="label">BOQ packages issued</span>
          <span className="value">
            {issued}
            <span className="faint" style={{ fontSize: 18 }}> / {boq.length}</span>
          </span>
          <span className="hint">{boq.length - issued} still in progress</span>
        </Link>
      </div>

      <div className="grid-2">
        <div className="glass card">
          <div className="card-head">
            <h3>
              <CalendarClock /> Deadlines
            </h3>
          </div>
          {deadlines.length === 0 ? (
            <Empty title="No deadlines in the next two weeks" />
          ) : (
            <div className="list">
              {deadlines.map((d) => {
                const st = dueState(d.date);
                return (
                  <Link key={d.key} to={d.to} className="list-item">
                    <div className="grow">
                      <div className="title">{d.title}</div>
                      <div className="meta">
                        <Pill tone={d.tone}>{d.kind}</Pill>
                        <span className={clsx(st === "overdue" && "danger-text bold", st === "today" && "warn-text bold")}>{fmtDue(d.date)}</span>
                      </div>
                    </div>
                    <Avatar person={people.get(d.person)} size={26} />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="glass card">
            <VoMeter approved={v.approved} pending={v.pending} contract={project.contract_value} />
          </div>
          <div className="glass card">
            <div className="card-head">
              <h3>
                <Users /> Who's on it
              </h3>
            </div>
            {team.length === 0 ? (
              <Empty title="Nobody has open tasks here" />
            ) : (
              <div className="list">
                {team.map(([pid, c]) => {
                  const p = people.get(pid);
                  return (
                    <div key={pid} className="list-item">
                      <Avatar person={p} size={30} />
                      <div className="grow">
                        <div className="title">{p?.short_name ?? "Someone"}</div>
                        <div className="meta">{p?.title}</div>
                      </div>
                      <span className="small muted">{c.open} open</span>
                      {c.overdue > 0 && <Pill tone="red">{c.overdue} late</Pill>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {review.length > 0 && (
        <div className="glass card">
          <div className="card-head">
            <h3>Waiting for review</h3>
          </div>
          <div className="list">
            {review.map((t) => (
              <Link key={t.id} to={`/tasks/${t.id}`} className="list-item">
                <StatusRing status={t.status} />
                <div className="grow">
                  <div className="title">{t.title}</div>
                  <div className="meta">From {people.get(t.assignee_id)?.short_name ?? "someone"}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="glass card">
        <div className="card-head">
          <h3>
            <History /> Recent activity
          </h3>
          <Link to={`/projects/${project.id}/activity`}>See all</Link>
        </div>
        {activity.isLoading ? <Loading /> : <ActivityFeed items={activity.data ?? []} taskTitles={titles} />}
      </div>
    </div>
  );
}
