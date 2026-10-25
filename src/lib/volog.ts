// The all-projects VO log: helpers shared by the page and its Excel download. It reads the same
// variations as each project's Variations tab, so there's only ever one copy of a VO.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Project, Variation, VoSubmission } from "./types";

/** The reference the log uses (its own, or the app's VO number). */
export const voRef = (v: Pick<Variation, "log_ref" | "vo_number">) => (v.log_ref?.trim() || v.vo_number || "").trim();

/** The most recent revision, or null. */
export function latestRound(v: Pick<Variation, "submissions">): VoSubmission | null {
  const subs = v.submissions ?? [];
  return subs.length ? subs[subs.length - 1] : null;
}

/** Everything a search can match: references, subject, scope, remarks, each revision's words. */
export function voSearchText(v: Variation, project?: Pick<Project, "name" | "code"> | null): string {
  const rounds = (v.submissions ?? []).map((x) => [x.rev, x.sent_note, x.response].filter(Boolean).join(" ")).join(" ");
  return [v.vo_number, v.log_ref, v.title, v.scope, v.description, v.qs_remarks, v.log_status, v.notes, project?.name, project?.code, rounds]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** True when every word typed is found somewhere in the VO. */
export function voMatches(v: Variation, project: Pick<Project, "name" | "code"> | null | undefined, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = voSearchText(v, project);
  return words.every((w) => text.includes(w));
}

/** How many files and links each VO has (its revisions' and its supporting ones). */
export function useVoFileCounts() {
  return useQuery({
    // Starts with the table names so live changes and uploads refresh it.
    queryKey: ["attachments", "vo-counts"],
    queryFn: async () => {
      const [files, links] = await Promise.all([
        supabase.from("attachments").select("id, variation_id").not("variation_id", "is", null),
        supabase.from("drive_links").select("id, variation_id").not("variation_id", "is", null).is("removed_at", null),
      ]);
      if (files.error) throw files.error;
      if (links.error) throw links.error;
      const out = new Map<string, number>();
      for (const r of [...(files.data ?? []), ...(links.data ?? [])] as { variation_id: string | null }[]) {
        if (r.variation_id) out.set(r.variation_id, (out.get(r.variation_id) ?? 0) + 1);
      }
      return out;
    },
    staleTime: 30_000,
  });
}
