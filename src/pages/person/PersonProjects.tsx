// The projects a person is on (their project teams), plus any other project they have tasks in,
// with how many of their tasks are open, late and done there.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, FolderKanban } from "lucide-react";
import { useProjectMap, useTasks } from "@/lib/api";
import { useProjectTeams } from "@/lib/projectTeam";
import { todayISO } from "@/lib/time";
import type { Profile } from "@/lib/types";
import { Empty, Loading, Pill } from "@/components/ui";

interface Row {
  id: string;
  onTeam: boolean;
  open: number;
  late: number;
  done: number;
}

export function PersonProjects({ person, self }: { person: Profile; self: boolean }) {
  const projects = useProjectMap();
  const teams = useProjectTeams();
  const tasks = useTasks({ assigneeId: person.id });

  const rows = useMemo(() => {
    const today = todayISO();
    const byId = new Map<string, Row>();
    const row = (id: string) => {
      let r = byId.get(id);
      if (!r) byId.set(id, (r = { id, onTeam: false, open: 0, late: 0, done: 0 }));
      return r;
    };
    for (const id of teams.projectsOf(person.id)) row(id).onTeam = true;
    for (const t of tasks.data ?? []) {
      if (!t.project_id) continue;
      const r = row(t.project_id);
      if (t.status === "done") r.done++;
      else {
        r.open++;
        if (t.due_date && t.due_date < today && t.status !== "in_review") r.late++;
      }
    }
    return [...byId.values()]
      .filter((r) => projects.get(r.id))
      .sort((a, b) => b.open - a.open || Number(b.onTeam) - Number(a.onTeam) || (projects.get(a.id)?.name ?? "").localeCompare(projects.get(b.id)?.name ?? ""));
  }, [teams, tasks.data, projects, person.id]);

  if (projects.loading || teams.loading || tasks.isLoading) return <Loading rows={3} />;
  if (!rows.length) {
    return (
      <div className="glass">
        <Empty icon={<FolderKanban />} title={self ? "You're not on any project yet" : `${person.short_name} isn't on any project yet`}>
          Projects show up here once {self ? "you're" : "they're"} added to a project team or given a task in one.
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="group">
        {rows.map((r) => {
          const p = projects.get(r.id)!;
          return (
            <Link key={r.id} to={`/projects/${p.id}`} className="group-row pp-project">
              <span className="pp-dot" style={{ background: p.color || "var(--accent)" }} />
              <span className="label">
                <span className="ellipsis">{p.name}</span>
                <small>
                  {[p.code, p.client, p.status === "active" ? null : p.status === "on_hold" ? "On hold" : "Completed"].filter(Boolean).join(" · ")}
                </small>
              </span>
              <span className="pp-project-counts">
                {r.late > 0 && <Pill tone="red">{r.late} late</Pill>}
                <span className="num">
                  <b>{r.open}</b> open
                </span>
                <span className="num faint">{r.done} done</span>
              </span>
              <ChevronRight className="chev" />
            </Link>
          );
        })}
      </div>
      <div className="group-foot">
        {rows.filter((r) => r.onTeam).length} on {self ? "your" : "their"} project teams
        {rows.some((r) => !r.onTeam) ? `, and ${rows.filter((r) => !r.onTeam).length} more where ${self ? "you have" : "they have"} tasks` : ""}.
      </div>
    </>
  );
}
