import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { Building2, CalendarRange, ChevronLeft, FileClock, FileDiff, FolderOpen, History, Layers, LayoutDashboard, MapPin, MessagesSquare, Pencil, SearchX, SquareCheckBig, Wallet } from "lucide-react";
import { useProjectMap, useTasks } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { sar } from "@/lib/format";
import { fmtDate } from "@/lib/time";
import { CommentThread } from "@/components/CommentThread";
import { Empty, Loading, Pill } from "@/components/ui";
import { ProjectCover } from "@/components/ProjectCover";
import { ActivityFeed } from "./project/ActivityFeed";
import { Boq } from "./project/Boq";
import { Overview } from "./project/Overview";
import { ProjectFiles } from "./project/ProjectFiles";
import { ProjectForm } from "./project/ProjectForm";
import { ProjectTasks } from "./project/ProjectTasks";
import { Variations } from "./project/Variations";
import { ProjectSubmissions } from "./Submissions";
import { useActivity } from "./project/api";
import "@/styles/tasks.css";

const TABS = [
  { key: "", label: "Overview", icon: LayoutDashboard },
  { key: "tasks", label: "Tasks", icon: SquareCheckBig },
  { key: "variations", label: "Variations", icon: FileDiff },
  { key: "submissions", label: "Submissions", icon: FileClock },
  { key: "boq", label: "BOQ", icon: Layers },
  { key: "chat", label: "Chat", icon: MessagesSquare },
  { key: "files", label: "Files", icon: FolderOpen },
  { key: "activity", label: "Activity", icon: History },
];

const STATUS_LABEL = { active: "Active", on_hold: "On hold", completed: "Completed" } as const;
const STATUS_TONE = { active: "green", on_hold: "orange", completed: "gray" } as const;

function ProjectActivity({ projectId }: { projectId: string }) {
  const { data = [], isLoading } = useActivity({ projectId, limit: 200 });
  const tasks = useTasks({ projectId }).data ?? [];
  const titles = useMemo(() => new Map(tasks.map((t) => [t.id, t.title])), [tasks]);
  return <div className="glass card">{isLoading ? <Loading /> : <ActivityFeed items={data} taskTitles={titles} linkTasks />}</div>;
}

export default function ProjectDetail() {
  const { id, tab = "" } = useParams();
  const { canAssign } = useAuth();
  const projects = useProjectMap();
  const [editOpen, setEditOpen] = useState(false);
  const tabsRef = useRef<HTMLElement>(null);
  const project = projects.get(id);

  // Keep the active tab visible when the tab bar scrolls sideways on phones.
  useEffect(() => {
    const el = tabsRef.current?.querySelector<HTMLElement>("a.active");
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab, project?.id]);

  if (projects.loading) return <div className="page"><Loading /></div>;
  if (!project) {
    return (
      <div className="page">
        <div className="glass" style={{ marginTop: 24 }}>
          <Empty icon={<SearchX />} title="Project not found" action={<Link className="btn primary" to="/projects">All projects</Link>}>
            It may have been deleted, or the link is wrong.
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/projects" className="td-crumb hide-mobile">
        <ChevronLeft size={16} /> Projects
      </Link>

      <div className="project-hero glass">
        <ProjectCover project={project} size="hero" editable={canAssign} />
        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
              {project.code && <span className="pill gray">{project.code}</span>}
              <Pill tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Pill>
            </div>
            <h1>{project.name}</h1>
          </div>
          {canAssign && (
            <button className="btn small" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </button>
          )}
        </div>
        <div className="facts">
          {project.client && (
            <span>
              <Building2 /> {project.client}
            </span>
          )}
          {project.city && (
            <span>
              <MapPin /> {project.city}
            </span>
          )}
          {project.contract_value != null && (
            <span>
              <Wallet /> {sar(project.contract_value)}
            </span>
          )}
          {(project.start_date || project.end_date) && (
            <span>
              <CalendarRange /> {project.start_date ? fmtDate(project.start_date, { day: "numeric", month: "short", year: "numeric" }) : "?"} to{" "}
              {project.end_date ? fmtDate(project.end_date, { day: "numeric", month: "short", year: "numeric" }) : "?"}
            </span>
          )}
        </div>
        {project.description && tab === "" && <p className="muted small" style={{ whiteSpace: "pre-wrap" }}>{project.description}</p>}
      </div>

      <nav className="tabs glass" aria-label="Project sections" ref={tabsRef}>
        {TABS.map((t) => (
          <NavLink key={t.key} to={`/projects/${project.id}${t.key ? `/${t.key}` : ""}`} end className={() => (tab === t.key ? "active" : "")}>
            <t.icon /> {t.label}
          </NavLink>
        ))}
      </nav>

      {tab === "" && <Overview project={project} />}
      {tab === "tasks" && <ProjectTasks project={project} />}
      {tab === "variations" && <Variations project={project} />}
      {tab === "submissions" && <ProjectSubmissions project={project} />}
      {tab === "boq" && <Boq project={project} />}
      {tab === "chat" && (
        <div className="glass card">
          <CommentThread scope={{ kind: "project", projectId: project.id }} placeholder={`Message about ${project.code ?? project.name}`} height="60vh" />
        </div>
      )}
      {tab === "files" && <ProjectFiles project={project} />}
      {tab === "activity" && <ProjectActivity projectId={project.id} />}
      {!TABS.some((t) => t.key === tab) && <Empty title="That section doesn't exist" />}

      <ProjectForm open={editOpen} onClose={() => setEditOpen(false)} project={project} />
    </div>
  );
}
