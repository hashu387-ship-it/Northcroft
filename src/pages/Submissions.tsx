// Submissions: what the team has to send, and by when (VO revisions, BOQs, payment applications,
// letters), with a days-left timer on each. Grouped by how soon they're due; open one to see its
// details, files and conversation. On a phone, swipe a row right to mark it sent.
import "@/styles/volog.css";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileClock, Plus, Search, Send, X } from "lucide-react";
import clsx from "clsx";
import { useInvalidate, useProjectMap } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useProjectTeams } from "@/lib/projectTeam";
import { SUBMISSION_KIND, canEditSubmissions, setSubmissionStatus, sortSubmissions, submissionDue, submissionLabel, useSubmissions } from "@/lib/submissions";
import { errorMessage } from "@/lib/supabase";
import { diffDays, todayISO } from "@/lib/time";
import type { Project, Submission, Variation } from "@/lib/types";
import { PageHead } from "@/components/PageHead";
import { SubmissionRow, SubmissionSheet } from "@/components/Submission";
import { SwipeRow } from "@/components/Swipe";
import { Empty, Loading, Segmented, useToast } from "@/components/ui";
import { useVariations } from "./project/api";

type View = "open" | "sent" | "all";
const MINE = "__mine";

/** Opening, closing and adding submissions through the address (?id=, ?new=1&vo=), so links and Back work. */
export function useSubmissionParam(list: Submission[] | undefined, loading: boolean) {
  const [params, setParams] = useSearchParams();
  const id = params.get("id");
  const isNew = params.get("new") === "1";
  // One just added shows straight away, before the list has reloaded with it.
  const [made, setMade] = useState<Submission | null>(null);
  const open = id ? list?.find((s) => s.id === id) ?? (made?.id === id ? made : null) : null;
  const show = (s: Submission) => {
    const next = new URLSearchParams(params);
    next.delete("new");
    next.delete("vo");
    next.set("id", s.id);
    setParams(next);
  };
  const add = (vo?: string | null) => {
    const next = new URLSearchParams(params);
    next.delete("id");
    next.set("new", "1");
    if (vo) next.set("vo", vo);
    setParams(next);
  };
  const close = () => {
    const next = new URLSearchParams(params);
    ["id", "new", "vo", "m"].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  };
  // A link to a submission that has gone (deleted) just shows the list.
  useEffect(() => {
    if (id && !loading && list && !open) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, loading, list, open]);
  const created = (s: Submission) => {
    setMade(s);
    const next = new URLSearchParams(params);
    ["new", "vo"].forEach((k) => next.delete(k));
    next.set("id", s.id);
    setParams(next, { replace: true });
  };
  return { open, isNew, newVo: params.get("vo"), show, add, close, created };
}

/** The list: grouped by how soon each is due, with swipe-to-send on phones. */
export function SubmissionList({
  list,
  vos,
  projects,
  showProject = true,
  onOpen,
}: {
  list: Submission[];
  vos: Map<string, Variation>;
  projects: Map<string, Project>;
  showProject?: boolean;
  onOpen: (s: Submission) => void;
}) {
  const me = useMe();
  const { canAssign } = useAuth();
  const teams = useProjectTeams();
  const toast = useToast();
  const invalidate = useInvalidate();
  const today = todayISO();

  const groups = useMemo(() => {
    const out: { key: string; title: string; tone?: string; items: Submission[] }[] = [];
    const add = (key: string, title: string, items: Submission[], tone?: string) => items.length && out.push({ key, title, items, tone });
    const sorted = sortSubmissions(list);
    const open = sorted.filter((s) => s.status === "open");
    add("late", "Late or due today", open.filter((s) => s.due_on <= today), "red");
    add("week", "Next 7 days", open.filter((s) => s.due_on > today && diffDays(s.due_on, today) <= 7));
    add("later", "Later", open.filter((s) => diffDays(s.due_on, today) > 7));
    add("sent", "Sent", sorted.filter((s) => s.status === "sent"));
    add("off", "No longer needed", sorted.filter((s) => s.status === "cancelled"));
    return out;
  }, [list, today]);

  async function markSent(s: Submission) {
    try {
      await setSubmissionStatus(s.id, "sent", today);
      toast(s.variation_id ? `${submissionLabel(s, vos)} marked sent, and added to the VO log` : `${submissionLabel(s, vos)} marked sent`);
      await invalidate("submissions", "variations", "notifications");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <>
      {groups.map((g) => (
        <section key={g.key}>
          <h2 className={clsx("sub-group-title", g.tone)}>
            {g.title} <span className="n">{g.items.length}</span>
          </h2>
          <div className="glass sub-list">
            {g.items.map((s) => (
              <SwipeRow
                key={s.id}
                leading={
                  s.status === "open" && canEditSubmissions(s.project_id, me.id, canAssign, teams.team)
                    ? { label: "Sent", icon: <Send />, color: "#28a745", leave: true, run: () => markSent(s) }
                    : null
                }
              >
                <SubmissionRow s={s} vos={vos} project={projects.get(s.project_id)} showProject={showProject} onOpen={() => onOpen(s)} />
              </SwipeRow>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export default function Submissions() {
  const me = useMe();
  const { canAssign } = useAuth();
  const projects = useProjectMap();
  const teams = useProjectTeams();
  const subs = useSubmissions();
  const vosQ = useVariations();
  const vos = useMemo(() => new Map((vosQ.data ?? []).map((v) => [v.id, v])), [vosQ.data]);
  const [view, setView] = useState<View>("open");
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const nav = useSubmissionParam(subs.data, subs.isLoading);
  const list = subs.data ?? [];

  const myProjects = new Set(teams.projectsOf(me.id));
  const canAdd = canAssign || myProjects.size > 0;

  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter((s) => {
      if (projectId === MINE ? !myProjects.has(s.project_id) && s.created_by !== me.id : projectId && s.project_id !== projectId) return false;
      if (!words.length) return true;
      const hay = [s.title, s.rev, s.details, SUBMISSION_KIND[s.kind].label, s.variation_id ? vos.get(s.variation_id)?.vo_number : null, projects.get(s.project_id)?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, projectId, vos, projects, teams, me.id]);
  const inView = (s: Submission) => (view === "all" ? true : view === "open" ? s.status === "open" : s.status === "sent");
  const shown = filtered.filter(inView);
  const count = (v: View) => filtered.filter((s) => (v === "all" ? true : v === "open" ? s.status === "open" : s.status === "sent")).length;
  const lateCount = filtered.filter((s) => s.status === "open" && submissionDue(s).tone === "red").length;

  const projectList = useMemo(() => {
    const ids = new Set(list.map((s) => s.project_id));
    return projects.list.filter((p) => ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [list, projects.list]);

  return (
    <div className="page subs-page">
      <PageHead
        title="Submissions"
        sub={lateCount ? `${lateCount} late or due today. Deadlines for VO revisions, BOQs, payment applications and letters.` : "Deadlines for VO revisions, BOQs, payment applications and letters, with the days left on each."}
        actions={
          canAdd ? (
            <button className="btn primary" type="button" onClick={() => nav.add()}>
              <Plus /> New submission
            </button>
          ) : undefined
        }
      />

      <div className="sub-filters">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "open", label: "To send", count: count("open") },
            { value: "sent", label: "Sent", count: count("sent") },
            { value: "all", label: "All", count: count("all") },
          ]}
        />
        <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {myProjects.size > 0 && <option value={MINE}>My projects</option>}
          {projectList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="vlog-search">
          <Search aria-hidden />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search VO, title or details" aria-label="Search submissions" />
          {q && (
            <button type="button" className="icon-btn small plain" onClick={() => setQ("")} aria-label="Clear the search">
              <X />
            </button>
          )}
        </label>
      </div>

      {subs.isLoading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <div className="glass" style={{ marginTop: 12 }}>
          <Empty icon={<FileClock />} title={list.length === 0 ? "No submissions yet" : view === "open" ? "Nothing to send" : "No submissions match"}>
            {list.length === 0
              ? "Add the next thing the team has to send, with its deadline. The project's team gets reminders as it gets close."
              : view === "open"
                ? "Everything due has been sent."
                : "Try another project or search."}
          </Empty>
        </div>
      ) : (
        <SubmissionList list={shown} vos={vos} projects={projects.byId} onOpen={nav.show} />
      )}

      <SubmissionSheet
        open={!!nav.open || nav.isNew}
        onClose={nav.close}
        submission={nav.open}
        defaults={{ variationId: nav.newVo, projectId: projectId && projectId !== MINE ? projectId : null }}
        onCreated={nav.created}
      />
    </div>
  );
}

/** A project's Submissions tab: its deadlines, grouped by how soon they're due. */
export function ProjectSubmissions({ project }: { project: Project }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const teams = useProjectTeams();
  const projects = useProjectMap();
  const subs = useSubmissions({ projectId: project.id });
  const vosQ = useVariations();
  const vos = useMemo(() => new Map((vosQ.data ?? []).map((v) => [v.id, v])), [vosQ.data]);
  const nav = useSubmissionParam(subs.data, subs.isLoading);
  const list = subs.data ?? [];
  const canAdd = canEditSubmissions(project.id, me.id, canAssign, teams.team);
  const late = list.filter((s) => s.status === "open" && submissionDue(s).tone === "red").length;

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="view-head">
        <span className="muted small">
          {late ? `${late} late or due today. ` : ""}What this project has to send, and by when. The project's team gets reminders.
        </span>
        <span className="spacer" />
        {canAdd && (
          <button className="btn brand small" type="button" onClick={() => nav.add()}>
            <Plus /> Add submission
          </button>
        )}
      </div>
      {subs.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <div className="glass">
          <Empty icon={<FileClock />} title="No submissions yet">
            Add the next thing to send for {project.code ?? project.name}, with its deadline.
          </Empty>
        </div>
      ) : (
        <SubmissionList list={list} vos={vos} projects={projects.byId} showProject={false} onOpen={nav.show} />
      )}
      <SubmissionSheet open={!!nav.open || nav.isNew} onClose={nav.close} submission={nav.open} defaults={{ projectId: project.id, variationId: nav.newVo }} onCreated={nav.created} />
    </div>
  );
}
