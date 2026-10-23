// Tasks, variations and BOQ packages can have several people on them.
import type { BoqPackage, RecurringTask, Task, Variation } from "./types";

/** Everyone on a task (the full list, or the single person on older rows). */
export function peopleOn(t: Pick<Task, "assignees" | "assignee_id"> | Pick<RecurringTask, "assignees" | "assignee_id">): string[] {
  return t.assignees?.length ? t.assignees : t.assignee_id ? [t.assignee_id] : [];
}

/** Every owner of a variation or a BOQ package. */
export function ownersOf(x: Pick<Variation, "owners" | "owner_id"> | Pick<BoqPackage, "owners" | "owner_id">): string[] {
  return x.owners?.length ? x.owners : x.owner_id ? [x.owner_id] : [];
}

/** "Imthath", "Imthath and Najeefar", "Imthath, Najeefar and Saheeb" */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
