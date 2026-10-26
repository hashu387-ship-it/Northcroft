import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, History, UserPen, Users } from "lucide-react";
import clsx from "clsx";
import { useInvalidate, usePeople, useTasks } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { saveProjectTeam, useProjectTeams } from "@/lib/projectTeam";
import { errorMessage } from "@/lib/supabase";
import { PersonAvatar } from "@/components/People";
import { BOQ_STATUS, VO_STATUS } from "@/lib/constants";
import { pct, sar } from "@/lib/format";
import { addDays, dueState, fmtDue, todayISO } from "@/lib/time";
import type { Priority, Project } from "@/lib/types";
import { Avatar, Empty, Loading, Pill, PriorityFlag, Sheet, StatusRing, useToast } from "@/components/ui";
import { ActivityFeed } from "./ActivityFeed";
import { VoMeter } from "./Variations";
import { VO_PENDING, useActivity, useBoq, useVariations, voTotals } from "./api";
import { nameList, peopleOn } from "@/lib/people";

interface Deadline {
  key: string;
  date: string;
  title: string;
  kind: string;
  to: string;
  person?: string | null;
  tone: string;
  priority: Priority;
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
        list.push({ key: `t${t.id}`, date: t.due_date, title: t.title, kind: "Task", to: `/tasks/${t.id}`, person: t.assignee_id, tone: "blue", priority: t.priority });
    }
    for (const x of vos) {
      if (x.response_due && x.response_due <= horizon && VO_PENDING.includes(x.status))
        list.push({ key: `v${x.id}`, date: x.response_due, title: `${x.vo_number} ${x.title}`, kind: VO_STATUS[x.status].label, to: `/projects/${project.id}/variations?vo=${x.id}`, person: x.owner_id, tone: "orange", priority: x.priority ?? "normal" });
    }
    for (const b of boq) {
      if (b.due_date && b.due_date <= horizon && b.status !== "issued")
        list.push({ key: `b${b.id}`, date: b.due_date, title: `${b.name} BOQ`, kind: BOQ_STATUS[b.status].label, to: `/projects/${project.id}/boq`, person: b.owner_id, tone: "purple", priority: b.priority ?? "normal" });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10);
  }, [open, vos, boq, today, project.id]);

  const team = useMemo(() => {
    const m = new Map<string, { open: number; overdue: number }>();
    // A shared task counts for each person on it.
    for (const t of open) {
      for (const who of peopleOn(t)) {
        const c = m.get(who) ?? { open: 0, overdue: 0 };
        c.open++;
        if (t.due_date && t.due_date < today && t.status !== "in_review") c.overdue++;
        m.set(who, c);
      }
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
            <span className="faint" style={{ fontSize: 15 }}> / {boq.length}</span>
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
                        <PriorityFlag priority={d.priority} size="small" />
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
          <ProjectTeamCard project={project} workload={team} />
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
                  <div className="meta">From {nameList(peopleOn(t).map((id) => people.get(id)?.short_name ?? "someone")) || "someone"}</div>
                </div>
                <PriorityFlag priority={t.priority} size="small" />
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

/**
 * The project's team (set by managers and seniors), with each person's open and late tasks here.
 * Anyone else with open tasks on the project shows under "Also has tasks here".
 */
function ProjectTeamCard({ project, workload }: { project: Project; workload: [string, { open: number; overdue: number }][] }) {
  const people = usePeople();
  const { canAssign } = useAuth();
  const teams = useProjectTeams();
  const members = teams.team(project.id);
  const counts = new Map(workload);
  const others = workload.filter(([id]) => !members.includes(id)).map(([id]) => id);
  const [editing, setEditing] = useState(false);

  const row = (id: string) => {
    const p = people.get(id);
    const c = counts.get(id);
    return (
      <div key={id} className="list-item">
        <PersonAvatar person={p} size={30} />
        <div className="grow">
          <div className="title">{p?.short_name ?? "Former team member"}</div>
          <div className="meta">{p?.title}</div>
        </div>
        {c ? <span className="small muted">{c.open} open</span> : <span className="small muted">No open tasks</span>}
        {c && c.overdue > 0 && <Pill tone="red">{c.overdue} late</Pill>}
      </div>
    );
  };

  return (
    <div className="glass card project-team">
      <div className="card-head">
        <h3>
          <Users /> Project team
        </h3>
        {canAssign && (
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            <UserPen /> Edit team
          </button>
        )}
      </div>
      {members.length === 0 ? (
        <Empty title="No team yet">{canAssign ? "Tap Edit team to add who works on this project." : "Hassan or a senior adds the team."}</Empty>
      ) : (
        <div className="list">{members.map(row)}</div>
      )}
      {others.length > 0 && (
        <>
          <div className="small bold project-team-also">Also has tasks here</div>
          <div className="list">{others.map(row)}</div>
        </>
      )}
      {canAssign && <TeamEditor open={editing} onClose={() => setEditing(false)} project={project} current={members} />}
    </div>
  );
}

function TeamEditor({ open, onClose, project, current }: { open: boolean; onClose: () => void; project: Project; current: string[] }) {
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [picked, setPicked] = useState<string[]>(current);
  const [saving, setSaving] = useState(false);
  // Start from the current team each time the sheet opens. Done while rendering, not in an effect,
  // so the right people are ticked from the first frame.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setPicked(current);
  }

  async function save() {
    setSaving(true);
    try {
      await saveProjectTeam(project.id, current, picked);
      await invalidate("project_members");
      toast(`${project.name} team saved`);
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${project.name} team`}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save team"}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ marginTop: 0 }}>
        The team shows on the project and its card, and comes first in Assign to for this project's tasks.
      </p>
      <div className="list team-pick">
        {people.active.map((p) => {
          const on = picked.includes(p.id);
          return (
            <label key={p.id} className={clsx("list-item team-pick-row", on && "on")}>
              <input type="checkbox" checked={on} onChange={() => setPicked((xs) => (on ? xs.filter((x) => x !== p.id) : [...xs, p.id]))} />
              <Avatar person={p} size={30} />
              <div className="grow">
                <div className="title">{p.short_name}</div>
                <div className="meta">{p.title}</div>
              </div>
            </label>
          );
        })}
      </div>
    </Sheet>
  );
}
