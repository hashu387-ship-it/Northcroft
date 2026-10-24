// Task sign-off in two steps: the first checker (Hassan) checks handed-in work, then the final
// checker (Fawaz) gives the final OK. The database enforces the order (guard_task); these helpers
// only work out whose turn it is so each screen can show the right buttons and words.
import { useMemo } from "react";
import { usePeople, useSettings } from "./api";
import type { Profile, Task } from "./types";

export interface Signoff {
  /** True when a final checker is set: tasks need two OKs. */
  on: boolean;
  first?: Profile;
  final?: Profile;
}

export function useSignoff(): Signoff {
  const settings = useSettings().data;
  const people = usePeople();
  return useMemo(() => {
    const active = (id: string | null | undefined) => {
      const p = people.get(id);
      return p?.active ? p : undefined;
    };
    const first = active(settings?.first_checker_id);
    const final = active(settings?.final_checker_id);
    return { on: !!final, first, final };
  }, [settings?.first_checker_id, settings?.final_checker_id, people]);
}

/** Whose turn it is on a task waiting for review. */
export function waitingOn(t: Pick<Task, "status" | "review_stage" | "reviewer_id" | "created_by">, s: Signoff): string | null {
  if (t.status !== "in_review") return null;
  if (t.review_stage === "first") return s.first?.id ?? null;
  if (t.review_stage === "final") return s.final?.id ?? null;
  return t.reviewer_id ?? t.created_by;
}

/** Whose turn it will be when a task with these people on it is handed in (mirrors review_stage_for). */
export function stageFor(people: string[], s: Signoff): Task["review_stage"] {
  if (!s.final) return null;
  if (s.first && s.first.id !== s.final.id && !people.includes(s.first.id)) return "first";
  if (!people.includes(s.final.id)) return "final";
  return null;
}

/** Approving or marking this done now would pass it on to the final checker rather than finish it. */
export function passesOn(t: Pick<Task, "status" | "review_stage" | "assignees">, meId: string, s: Signoff): boolean {
  if (!s.final || meId === s.final.id || t.assignees.includes(s.final.id)) return false;
  // Waiting for the first check (or handed in before the two steps began): the OK passes it on.
  if (t.status === "in_review") return t.review_stage !== "final";
  return t.status === "todo" || t.status === "in_progress";
}

/** Short label for a task in review: "With Hassan", "Final OK with Fawaz" ("Your check" and
 *  "Your final OK" for that person), or "In review". */
export function reviewLabel(t: Pick<Task, "status" | "review_stage">, s: Signoff, meId?: string): string {
  if (t.review_stage === "first" && s.first) return s.first.id === meId ? "Your check" : `With ${s.first.short_name}`;
  if (t.review_stage === "final" && s.final) return s.final.id === meId ? "Your final OK" : `Final OK with ${s.final.short_name}`;
  return "In review";
}
