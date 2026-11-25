import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowRight, FolderKanban, Hourglass, Link2, ListChecks, Pause, Play, RotateCcw, Send, Share, SquareArrowOutUpRight, Users } from "lucide-react";
import { useInvalidate, usePeople, useProjectMap } from "@/lib/api";
import { errorMessage, supabase } from "@/lib/supabase";
import { SwipeRow } from "./Swipe";
import { useMe } from "@/lib/auth";
import { peopleOn } from "@/lib/people";
import { reviewLabel, useSignoff } from "@/lib/signoff";
import type { Task } from "@/lib/types";
import { todayISO } from "@/lib/time";
import { Avatar, AvatarStack, DueLabel, EarlyBadge, Pill, PriorityFlag, ProjectTag, StatusRing, useToast, PersonName } from "./ui";
import { ProgressChip } from "@/pages/updates/TaskProgress";
import { WorkingDots } from "./Tracked";
import { MorphLink } from "./Morph";
import { useContextMenu, type MenuItems } from "./ContextMenu";

/** Press and hold a task (or right-click it): open, start or hand in, open its project, copy or share its link. */
function useTaskMenu(task: Task) {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const projects = useProjectMap();
  return useContextMenu(
    (): MenuItems => {
      const mine = peopleOn(task).includes(me.id);
      const blocked = !!task.approval || task.hold === "on";
      const url = `${window.location.origin}/tasks/${task.id}`;
      const project = projects.get(task.project_id);
      return [
        { label: "Open", icon: <SquareArrowOutUpRight />, run: () => navigate(`/tasks/${task.id}`) },
        mine && !blocked && task.status === "todo" && {
          label: "Start",
          icon: <Play />,
          run: async () => {
            const { error } = await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id);
            if (error) toast(errorMessage(error), "error");
            else toast("Marked as in progress");
            await invalidate("tasks", "activity");
          },
        },
        mine && !blocked && task.status === "in_progress" && { label: "Submit for review", icon: <Send />, run: () => navigate(`/tasks/${task.id}?submit=1`) },
        project && { label: `Open ${project.name}`, icon: <FolderKanban />, run: () => navigate(`/projects/${project.id}`) },
        null,
        {
          label: "Copy link",
          icon: <Link2 />,
          run: async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast("Link copied");
            } catch {
              toast("Couldn't copy the link", "error");
            }
          },
        },
        typeof navigator.share === "function" && {
          label: "Share",
          icon: <Share />,
          run: () => navigator.share({ title: task.title, url }).catch(() => undefined),
        },
      ];
    },
    { title: () => task.title },
  );
}

export function TaskRow({
  task,
  showProject = true,
  showAssignee = true,
  checklist,
}: {
  task: Task;
  showProject?: boolean;
  showAssignee?: boolean;
  checklist?: [number, number];
}) {
  const people = usePeople();
  const projects = useProjectMap();
  const signoff = useSignoff();
  const me = useMe();
  const qc = useQueryClient();
  const changesRequested = !!task.changes_note && (task.status === "in_progress" || task.status === "todo");
  const team = peopleOn(task);
  const menu = useTaskMenu(task);
  // Its state, so a look can colour the row: done, on hold, waiting for review, or overdue.
  const state =
    task.status === "done" ? "done" : task.hold === "on" ? "hold" : task.status === "in_review" ? "review" : task.due_date && task.due_date < todayISO() ? "late" : null;
  return (
    <MorphLink
      {...menu}
      to={`/tasks/${task.id}`}
      morphKey={`task-${task.id}`}
      className={clsx("task-row", task.status === "done" && "done", state && `st-${state}`)}
      onClick={() => qc.setQueryData(["tasks", "one", task.id], (old: Task | null | undefined) => old ?? task)}
    >
      <StatusRing status={task.status} />
      <div className="body">
        <div className="t">{task.title}</div>
        <div className="m">
          {showProject && <ProjectTag project={projects.get(task.project_id)} />}
          <DueLabel date={task.due_date} done={task.status === "done" || task.status === "in_review" || task.hold === "on" || !!task.approval} />
          <PriorityFlag priority={task.priority} />
          <EarlyBadge task={task} />
          <ProgressChip task={task} />
          <WorkingDots taskId={task.id} />
          {checklist && checklist[1] > 0 && (
            <span className="row" style={{ gap: 3 }}>
              <ListChecks size={13} />
              {checklist[0]}/{checklist[1]}
            </span>
          )}
          {!showAssignee && team.length > 1 && (
            <span className="row" style={{ gap: 3 }} title="People on this task">
              <Users size={13} />
              {team.length} people
            </span>
          )}
          {task.status === "in_review" && <Pill tone="purple">{reviewLabel(task, signoff, me.id)}</Pill>}
          {task.approval === "pending" && (
            <Pill tone="purple">
              <Hourglass /> Waiting for OK
            </Pill>
          )}
          {task.approval === "declined" && <Pill tone="red">Turned down</Pill>}
          {task.hold === "on" && (
            <Pill tone="orange">
              <Pause /> On hold
            </Pill>
          )}
          {task.hold === "asked" && (
            <Pill tone="yellow">
              <Pause /> Hold asked
            </Pill>
          )}
          {task.status === "done" && task.finished_by_first && <span className="small muted">Finished by <PersonName person={people.get(task.approved_by)} size={16} fallback="the first checker" /></span>}
          {changesRequested && (
            <Pill tone="orange">
              <RotateCcw />
              Changes requested
            </Pill>
          )}
        </div>
      </div>
      {showAssignee &&
        (team.length > 1 ? (
          <AvatarStack people={team.map((id) => people.get(id))} size={26} max={3} />
        ) : (
          <Avatar person={people.get(team[0])} size={30} />
        ))}
    </MorphLink>
  );
}

/**
 * A task row that can be swiped on a phone: right to start it (or, once started, to open its
 * "Submit for review" form, so the usual sign-off steps apply), left to open it. Only the people on
 * a task can start or submit it; anyone can swipe to open.
 */
export function SwipeTaskRow(props: Parameters<typeof TaskRow>[0]) {
  const { task } = props;
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const mine = peopleOn(task).includes(me.id);
  const blocked = !!task.approval || task.hold === "on";
  let leading = null;
  if (mine && !blocked && task.status === "todo") {
    leading = {
      label: "Start",
      icon: <Play />,
      color: "#0a84ff",
      run: async () => {
        const { error } = await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id);
        if (error) toast(errorMessage(error), "error");
        else toast("Marked as in progress");
        await invalidate("tasks", "activity");
      },
    };
  } else if (mine && !blocked && task.status === "in_progress") {
    leading = { label: "Submit", icon: <Send />, color: "#28a745", run: () => navigate(`/tasks/${task.id}?submit=1`) };
  }
  return (
    <SwipeRow leading={leading} trailing={{ label: "Open", icon: <ArrowRight />, color: "#5b74a8", run: () => navigate(`/tasks/${task.id}`) }}>
      <TaskRow {...props} />
    </SwipeRow>
  );
}
