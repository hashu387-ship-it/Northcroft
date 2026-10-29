// Submissions: deadlines for what the team has to send (a VO revision, a BOQ, a payment
// application, a letter). Each has a days-left timer, its own files and a conversation, and the
// project's team hears about it (the database sends the notifications and reminders, 0044).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "./api";
import { useAuth, useMe } from "./auth";
import { useProjectTeams } from "./projectTeam";
import { supabase } from "./supabase";
import { diffDays, fmtDate, todayISO } from "./time";
import type { Submission, SubmissionKind, SubmissionStatus, Variation } from "./types";

export const SUBMISSION_KIND: Record<SubmissionKind, { label: string; short: string }> = {
  vo: { label: "VO revision", short: "VO" },
  boq: { label: "BOQ", short: "BOQ" },
  payment: { label: "Payment application", short: "Payment" },
  letter: { label: "Letter", short: "Letter" },
  other: { label: "Something else", short: "Other" },
};
export const SUBMISSION_KINDS: SubmissionKind[] = ["vo", "boq", "payment", "letter", "other"];

/** The colour used for submissions in the menu, calendar and notifications. */
export const SUBMISSION_COLOR = "#DC6B19";

export function useSubmissions(filter: { projectId?: string | null; variationId?: string | null } = {}) {
  const { projectId, variationId } = filter;
  return useQuery({
    queryKey: ["submissions", projectId ?? "", variationId ?? ""],
    queryFn: () => {
      let q = supabase.from("submissions").select("*");
      if (variationId) q = q.eq("variation_id", variationId);
      else if (projectId) q = q.eq("project_id", projectId);
      return unwrap<Submission[]>(q.order("due_on").order("created_at").limit(1000));
    },
  });
}

/** Whether a submission is one of mine to look after: on a project I'm on, or one I added. Managers and seniors look after all of them. */
export function isMySubmission(s: Pick<Submission, "project_id" | "created_by">, meId: string, canAssign: boolean, myProjects: string[]) {
  return canAssign || s.created_by === meId || myProjects.includes(s.project_id);
}

/** How many of mine are late or due today, for the badge on the menu. */
export function useSubmissionsDue(): number {
  const me = useMe();
  const { canAssign } = useAuth();
  const teams = useProjectTeams();
  const subs = useSubmissions();
  const today = todayISO();
  const mine = teams.projectsOf(me.id);
  return (subs.data ?? []).filter((s) => s.status === "open" && s.due_on <= today && isMySubmission(s, me.id, canAssign, mine)).length;
}

/** Open ones first, by deadline; then sent ones, latest first; then the ones no longer needed. */
export function sortSubmissions(list: Submission[]): Submission[] {
  const rank: Record<SubmissionStatus, number> = { open: 0, sent: 1, cancelled: 2 };
  return [...list].sort((a, b) => {
    if (a.status !== b.status) return rank[a.status] - rank[b.status];
    if (a.status === "open") return a.due_on.localeCompare(b.due_on) || a.created_at.localeCompare(b.created_at);
    return (b.sent_on ?? b.updated_at).localeCompare(a.sent_on ?? a.updated_at);
  });
}

export type DueTone = "red" | "orange" | "blue" | "green" | "gray";

/**
 * The timer on a submission: days left, orange at 3 days or less, red when it's due today or late.
 * `big` is the number shown large ("5", "!"), `unit` what it counts, `short` the same in one word
 * for the small tiles ("late", "left").
 */
export function submissionDue(s: Pick<Submission, "due_on" | "status" | "sent_on">, today = todayISO()) {
  if (s.status === "sent") {
    return { tone: "green" as DueTone, text: s.sent_on ? `Sent ${fmtDate(s.sent_on)}` : "Sent", big: "✓", unit: "sent", short: "sent", days: null as number | null };
  }
  if (s.status === "cancelled") return { tone: "gray" as DueTone, text: "No longer needed", big: "–", unit: "off", short: "off", days: null };
  const d = diffDays(s.due_on, today);
  if (d < 0) return { tone: "red" as DueTone, text: d === -1 ? "1 day overdue" : `${-d} days overdue`, big: String(-d), unit: d === -1 ? "day late" : "days late", short: "late", days: d };
  if (d === 0) return { tone: "red" as DueTone, text: "Due today", big: "0", unit: "today", short: "today", days: 0 };
  if (d === 1) return { tone: "orange" as DueTone, text: "Due tomorrow", big: "1", unit: "day left", short: "left", days: 1 };
  return { tone: (d <= 3 ? "orange" : "blue") as DueTone, text: `${d} days left`, big: String(d), unit: "days left", short: "left", days: d };
}

/** "Due Sun 2 Nov". */
export const dueDateText = (iso: string) => `Due ${fmtDate(iso, { weekday: "short", day: "numeric", month: "short" })}`;

/** "EI-263 · Revised quotation". */
export function submissionLabel(s: Pick<Submission, "title" | "variation_id">, vos?: Map<string, Pick<Variation, "vo_number">>): string {
  const vo = s.variation_id ? vos?.get(s.variation_id)?.vo_number : null;
  return vo ? `${vo} · ${s.title}` : s.title;
}

/** Managers and seniors can change any submission; everyone else the ones on their projects. */
export function canEditSubmissions(projectId: string | null | undefined, meId: string, canAssign: boolean, team: (id: string) => string[]) {
  return canAssign || (!!projectId && team(projectId).includes(meId));
}

/** Variations by id, for labels. */
export function useVoById(vos: Variation[] | undefined) {
  return useMemo(() => new Map((vos ?? []).map((v) => [v.id, v])), [vos]);
}

/** Mark sent (on a date, today by default), no longer needed, or open again. */
export async function setSubmissionStatus(id: string, status: SubmissionStatus, sentOn?: string | null) {
  const patch = status === "sent" ? { status, sent_on: sentOn ?? todayISO() } : { status, sent_on: null };
  const { error } = await supabase.from("submissions").update(patch).eq("id", id);
  if (error) throw error;
}
