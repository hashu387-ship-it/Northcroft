import { Link, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { ArrowRight, Hourglass, ListChecks, Pause, Play, RotateCcw, Send, Users } from "lucide-react";
import { useInvalidate, usePeople, useProjectMap } from "@/lib/api";
import { errorMessage, supabase } from "@/lib/supabase";
import { SwipeRow } from "./Swipe";
import { useMe } from "@/lib/auth";
import { peopleOn } from "@/lib/people";
import { reviewLabel, useSignoff } from "@/lib/signoff";
import type { Task } from "@/lib/types";
import { Avatar, AvatarStack, DueLabel, EarlyBadge, Pill, PriorityFlag, ProjectTag, StatusRing, useToast } from "./ui";
import { ProgressChip } from "@/pages/updates/TaskProgress";

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
  const changesRequested = !!task.changes_note && (task.status === "in_progress" || task.status === "todo");
  const team = peopleOn(task);
  return (
    <Link to={`/tasks/${task.id}`} className={clsx("task-row", task.status === "done" && "done")}>
      <StatusRing status={task.status} />
      <div className="body">
        <div className="t">{task.title}</div>
        <div className="m">
          {showProject && <ProjectTag project={projects.get(task.project_id)} />}
          <DueLabel date={task.due_date} done={task.status === "done" || task.status === "in_review" || task.hold === "on" || !!task.approval} />
          <PriorityFlag priority={task.priority} />
          <EarlyBadge task={task} />
          <ProgressChip task={task} />
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
          {task.status === "done" && task.finished_by_first && <span className="small muted">Finished by {people.get(task.approved_by)?.short_name ?? "the first checker"}</span>}
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
    </Link>
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
