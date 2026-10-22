import { Link } from "react-router-dom";
import clsx from "clsx";
import { ListChecks, RotateCcw } from "lucide-react";
import { usePeople, useProjectMap } from "@/lib/api";
import type { Task } from "@/lib/types";
import { Avatar, DueLabel, Pill, PriorityFlag, ProjectTag, StatusRing } from "./ui";

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
  const changesRequested = !!task.changes_note && (task.status === "in_progress" || task.status === "todo");
  return (
    <Link to={`/tasks/${task.id}`} className={clsx("task-row", task.status === "done" && "done")}>
      <StatusRing status={task.status} />
      <div className="body">
        <div className="t">{task.title}</div>
        <div className="m">
          {showProject && <ProjectTag project={projects.get(task.project_id)} />}
          <DueLabel date={task.due_date} done={task.status === "done"} />
          <PriorityFlag priority={task.priority} />
          {checklist && checklist[1] > 0 && (
            <span className="row" style={{ gap: 3 }}>
              <ListChecks size={13} />
              {checklist[0]}/{checklist[1]}
            </span>
          )}
          {task.status === "in_review" && <Pill tone="purple">In review</Pill>}
          {changesRequested && (
            <Pill tone="orange">
              <RotateCcw />
              Changes requested
            </Pill>
          )}
        </div>
      </div>
      {showAssignee && <Avatar person={people.get(task.assignee_id)} size={30} />}
    </Link>
  );
}
