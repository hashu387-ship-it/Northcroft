import { Link } from "react-router-dom";
import { History } from "lucide-react";
import { usePeople } from "@/lib/api";
import { fmtDateTime, timeAgo } from "@/lib/time";
import type { Activity } from "@/lib/types";
import { Avatar, Empty } from "@/components/ui";
import { activitySentence } from "./api";

/** Readable history. In a project feed, pass task titles so each line names its task. */
export function ActivityFeed({
  items,
  taskTitles,
  linkTasks = false,
  emptyText = "Nothing has happened here yet.",
}: {
  items: Activity[];
  taskTitles?: Map<string, string>;
  linkTasks?: boolean;
  emptyText?: string;
}) {
  const people = usePeople();
  if (!items.length) return <Empty icon={<History />} title="No history yet">{emptyText}</Empty>;
  return (
    <div className="feed">
      {items.map((a) => {
        const actor = people.get(a.actor_id);
        const title = taskTitles && a.task_id ? taskTitles.get(a.task_id) ?? ((a.details as { title?: string }).title || "a task") : undefined;
        const sentence = activitySentence(a, people.get, title);
        return (
          <div className="feed-item" key={a.id}>
            <Avatar person={actor} size={28} title={actor?.full_name ?? "Northcroft"} />
            <div className="text">
              <b>{actor?.short_name ?? "Northcroft"}</b> {sentence}
              {linkTasks && a.task_id && (
                <>
                  {" "}
                  <Link to={`/tasks/${a.task_id}`} className="small">
                    Open
                  </Link>
                </>
              )}
            </div>
            <span className="when" title={fmtDateTime(a.created_at)}>
              {timeAgo(a.created_at)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
