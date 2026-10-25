import { Link } from "react-router-dom";
import clsx from "clsx";
import { ListChecks, RotateCcw, Users } from "lucide-react";
import { usePeople, useProjectMap } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { peopleOn } from "@/lib/people";
import { reviewLabel, useSignoff } from "@/lib/signoff";
import type { Task } from "@/lib/types";
import { Avatar, AvatarStack, DueLabel, EarlyBadge, Pill, PriorityFlag, ProjectTag, StatusRing } from "./ui";
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
          <DueLabel date={task.due_date} done={task.status === "done" || task.status === "in_review"} />
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
