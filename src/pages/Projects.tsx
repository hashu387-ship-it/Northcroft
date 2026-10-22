import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, FolderKanban, MapPin, Plus } from "lucide-react";
import { useProjects, useTasks } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sar } from "@/lib/format";
import { todayISO } from "@/lib/time";
import type { Project } from "@/lib/types";
import { PageHead } from "@/components/PageHead";
import { Empty, Loading, Pill, Progress, Segmented } from "@/components/ui";
import { ProjectForm } from "./project/ProjectForm";
import { useVariations, voTotals } from "./project/api";
import "@/styles/tasks.css";

type Filter = Project["status"];

export default function Projects() {
  const { canAssign } = useAuth();
  const { data: projects = [], isLoading } = useProjects();
  const tasks = useTasks().data ?? [];
  const vos = useVariations().data ?? [];
  const [filter, setFilter] = useState<Filter>("active");
  const [formOpen, setFormOpen] = useState(false);
  const today = todayISO();

  const stats = useMemo(() => {
    const m = new Map<string, { total: number; done: number; open: number; overdue: number }>();
    for (const t of tasks) {
      if (!t.project_id) continue;
      const s = m.get(t.project_id) ?? { total: 0, done: 0, open: 0, overdue: 0 };
      s.total++;
      if (t.status === "done") s.done++;
      else {
        s.open++;
        if (t.due_date && t.due_date < today && t.status !== "in_review") s.overdue++;
      }
      m.set(t.project_id, s);
    }
    return m;
  }, [tasks, today]);

  const counts = {
    active: projects.filter((p) => p.status === "active").length,
    on_hold: projects.filter((p) => p.status === "on_hold").length,
    completed: projects.filter((p) => p.status === "completed").length,
  };
  const shown = projects.filter((p) => p.status === filter);

  return (
    <div className="page">
      <PageHead
        title="Projects"
        sub={`${counts.active} active ${counts.active === 1 ? "project" : "projects"}`}
        actions={
          canAssign && (
            <button className="btn primary" onClick={() => setFormOpen(true)}>
              <Plus /> New project
            </button>
          )
        }
      />
      <div style={{ marginBottom: 16 }}>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "active", label: "Active", count: counts.active },
            { value: "on_hold", label: "On hold", count: counts.on_hold },
            { value: "completed", label: "Completed", count: counts.completed },
          ]}
        />
      </div>

      {isLoading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="glass">
          <Empty
            icon={<FolderKanban />}
            title={filter === "active" ? "No active projects" : filter === "on_hold" ? "Nothing on hold" : "No completed projects yet"}
            action={canAssign && filter === "active" ? <button className="btn primary" onClick={() => setFormOpen(true)}><Plus /> Add a project</button> : undefined}
          />
        </div>
      ) : (
        <div className="project-grid">
          {shown.map((p) => {
            const s = stats.get(p.id) ?? { total: 0, done: 0, open: 0, overdue: 0 };
            const v = voTotals(vos.filter((x) => x.project_id === p.id));
            const pct = s.total ? (s.done / s.total) * 100 : 0;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="project-card glass">
                <span className="accent" style={{ background: p.color }} />
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {p.code && <div className="code">{p.code}</div>}
                    <h3>{p.name}</h3>
                  </div>
                  {s.overdue > 0 && <Pill tone="red">{s.overdue} overdue</Pill>}
                </div>
                <div className="row wrap muted small" style={{ gap: "4px 14px" }}>
                  {p.city && (
                    <span className="row" style={{ gap: 5 }}>
                      <MapPin size={14} />
                      {p.city}
                    </span>
                  )}
                  {p.client && (
                    <span className="row" style={{ gap: 5 }}>
                      <Building2 size={14} />
                      {p.client}
                    </span>
                  )}
                </div>
                <div>
                  <div className="row small muted" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                    <span>
                      {s.done} of {s.total} tasks done
                    </span>
                    <span>{s.open} open</span>
                  </div>
                  <Progress value={pct} color={p.color} />
                </div>
                <div className="figures">
                  <div>
                    <b>{sar(p.contract_value, { compact: true })}</b>
                    <span>Contract</span>
                  </div>
                  <div>
                    <b>{sar(v.approved, { compact: true, blank: "SAR 0" })}</b>
                    <span>VOs approved</span>
                  </div>
                  <div>
                    <b>{sar(v.pending, { compact: true, blank: "SAR 0" })}</b>
                    <span>VOs pending</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <ProjectForm open={formOpen} onClose={() => setFormOpen(false)} />
    </div>
  );
}
