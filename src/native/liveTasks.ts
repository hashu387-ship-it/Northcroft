// Tasks on the iPhone's lock screen and Dynamic Island, like an order on its way (iPhone app
// only, used by NativeBridge). Each shows the stages a task goes through with the current one lit,
// a countdown to the deadline, and an Open task button.
//
// Which tasks, at most three at a time:
//   1. any task followed with "Follow on Lock Screen" on its page
//   2. tasks you're on that are late or due today or tomorrow (not on hold)
//   3. tasks you gave someone that are late, due today or tomorrow, or handed in for checking
// A followed or shown task that gets its final OK shows Approved for half an hour, then goes.
// They update whenever the app is open and a task changes; instant updates with the app closed
// come with Apple's push service (after the Apple Developer enrolment).
import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap, usePeople, useTasks } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { addDays } from "@/lib/time";
import type { AppSettings, Task } from "@/lib/types";
import { NorthcroftNative, type LiveTaskItem } from "./plugin";
import { riyadhMs, useOnChange } from "./sync";

const MAX = 3;
const FOLLOWED = "nc-live-follow";
const SHOWN = "nc-live-shown";
const EVENT = "nc-live-follow-change";

/* -------------------------------------------------------------- followed tasks (kept on the phone) */
function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* private mode */
  }
}

let followedCache = "";
function followedSnapshot() {
  try {
    followedCache = localStorage.getItem(FOLLOWED) ?? "[]";
  } catch {
    followedCache = "[]";
  }
  return followedCache;
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useFollowedTasks(): string[] {
  const raw = useSyncExternalStore(subscribe, followedSnapshot, () => "[]");
  return useMemo(() => {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as string[]) : [];
    } catch {
      return [];
    }
  }, [raw]);
}

export function setFollowed(id: string, on: boolean) {
  const list = readList(FOLLOWED).filter((x) => x !== id);
  writeList(FOLLOWED, on ? [id, ...list] : list);
  window.dispatchEvent(new Event(EVENT));
}

/* -------------------------------------------------------------- stages */
export function taskStages(t: Task, settings: AppSettings | undefined) {
  // Two-step sign-off (first check, then the final OK) when both checkers are set, unless the task
  // is with a single reviewer now (in review with no stage).
  const singleReview = t.status === "in_review" && !t.review_stage;
  const twoStep = t.review_stage === "final" || (!!settings?.first_checker_id && !!settings?.final_checker_id && !singleReview && !t.finished_by_first);
  const stages = twoStep ? ["Assigned", "In progress", "Submitted", "First OK", "Approved"] : ["Assigned", "In progress", "Submitted", "Approved"];
  let stage = 0;
  if (t.status === "in_progress") stage = 1;
  if (t.status === "in_review") stage = t.review_stage === "final" ? 3 : 2;
  if (t.status === "done") stage = stages.length - 1;
  return { stages, stage };
}

type Person = { short_name: string } | undefined;

function names(ids: string[], get: (id: string) => Person, meId: string) {
  const list = ids.filter((id) => id !== meId).map((id) => get(id)?.short_name ?? "Someone");
  if (list.length <= 2) return list.join(" and ");
  return `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
}

function statusLine(t: Task, role: "mine" | "given", settings: AppSettings | undefined, get: (id: string) => Person, meId: string) {
  if (t.status === "done") return "Approved";
  if (t.hold === "on") return "On hold";
  if (t.hold === "asked") return "Hold asked";
  if (t.status === "in_review") {
    const checker =
      t.review_stage === "final"
        ? get(settings?.final_checker_id ?? "")?.short_name
        : t.review_stage === "first"
          ? get(settings?.first_checker_id ?? "")?.short_name
          : get(t.reviewer_id ?? t.created_by ?? "")?.short_name;
    if (t.review_stage === "final") return checker ? `Waiting for ${checker}'s final OK` : "Waiting for the final OK";
    return checker ? `Waiting for ${checker} to check it` : "Handed in, waiting for a check";
  }
  if (t.status === "in_progress") {
    if (t.changes_note) return "Changes asked";
    if (typeof t.progress === "number" && t.progress > 0) return `${t.progress}% done`;
    return "Being worked on";
  }
  return role === "given" ? `${names(t.assignees, get, meId) || "They"} hasn't started yet` : "Not started yet";
}

function itemFor(
  t: Task,
  role: "mine" | "given",
  settings: AppSettings | undefined,
  get: (id: string) => Person,
  meId: string,
  projectName: (id: string | null) => string | undefined,
): LiveTaskItem {
  const { stages, stage } = taskStages(t, settings);
  const person = role === "given" ? names(t.assignees, get, meId) : t.created_by && t.created_by !== meId ? `From ${get(t.created_by)?.short_name ?? "your manager"}` : undefined;
  return {
    id: t.id,
    title: t.title,
    project: projectName(t.project_id),
    role,
    person: person || undefined,
    stages,
    stage,
    status: statusLine(t, role, settings, get, meId),
    // The deadline: the due date at the end of office hours.
    dueAtMs: t.due_date ? riyadhMs(t.due_date, settings?.work_end ?? "17:00:00") : undefined,
    progress: t.status === "in_progress" && typeof t.progress === "number" ? t.progress : undefined,
    held: !!t.hold,
    done: t.status === "done",
  };
}

/* -------------------------------------------------------------- the hook */
export function useLiveTasks(
  meId: string,
  today: string,
  mine: Task[] | undefined,
  settings: AppSettings | undefined,
  projectName: (id: string | null) => string | undefined,
  on: boolean,
) {
  const people = usePeople();
  const given = useTasks({ createdBy: meId, openOnly: true });
  const followed = useFollowedTasks();

  // Followed or recently shown tasks that are done now (to show Approved), and followed tasks
  // that aren't in either list (someone else's task followed from its page).
  const shownBefore = useMemo(() => (on ? readList(SHOWN) : []), [on, mine, given.data]);
  const extraIds = useMemo(() => {
    const known = new Set([...(mine ?? []).map((t) => t.id), ...(given.data ?? []).map((t) => t.id)]);
    return [...new Set([...followed, ...shownBefore])].filter((id) => !known.has(id)).slice(0, 10).sort();
  }, [followed, shownBefore, mine, given.data]);
  const extra = useQuery({
    queryKey: ["tasks", "live", extraIds],
    enabled: on && extraIds.length > 0,
    queryFn: () => unwrap<Task[]>(supabase.from("tasks").select("*").in("id", extraIds)),
  });

  const items = useMemo<LiveTaskItem[] | null>(() => {
    if (!on) return [];
    if (!mine || !given.data || !people.all.length) return null;
    const get = (id: string) => people.get(id);
    const tomorrow = addDays(today, 1);
    const soon = (t: Task) => !!t.due_date && t.due_date <= tomorrow;
    const out: LiveTaskItem[] = [];
    const seen = new Set<string>();
    const add = (t: Task, role: "mine" | "given") => {
      if (seen.has(t.id) || out.length >= MAX) return;
      seen.add(t.id);
      out.push(itemFor(t, role, settings, get, meId, projectName));
    };
    const roleOf = (t: Task): "mine" | "given" => (t.assignees.includes(meId) ? "mine" : "given");
    const byDue = (a: Task, b: Task) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");

    const all = new Map<string, Task>();
    for (const t of [...(extra.data ?? []), ...given.data, ...mine]) all.set(t.id, t);

    // 1. Followed tasks.
    for (const id of followed) {
      const t = all.get(id);
      if (t) add(t, roleOf(t));
    }
    // 2. Shown before and approved since: show Approved once more.
    for (const id of shownBefore) {
      const t = all.get(id);
      if (t && t.status === "done") add(t, roleOf(t));
    }
    // 3. Mine, late or due soon. 4. Given, late, due soon or handed in.
    const myDue = mine.filter((t) => t.status !== "done" && t.hold !== "on" && soon(t)).sort(byDue);
    const theirs = given.data
      .filter((t) => !t.assignees.includes(meId) && t.status !== "done" && t.hold !== "on" && (soon(t) || t.status === "in_review"))
      .sort(byDue);
    for (const t of myDue) add(t, "mine");
    for (const t of theirs) add(t, "given");
    return out;
  }, [on, mine, given.data, extra.data, followed, shownBefore, people, settings, meId, today, projectName]);

  useOnChange(items, (list) => {
    writeList(SHOWN, list.filter((i) => !i.done).map((i) => i.id));
    void NorthcroftNative.liveTasks({ items: list }).catch(() => undefined);
  });
}
