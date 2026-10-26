// Project teams: who works on each project (project_members). Shown on the project and its card,
// listed first in "Assign to" for that project's tasks, and each person's own projects come first
// in Projects. Managers and seniors change them.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface ProjectMember {
  project_id: string;
  user_id: string;
  added_by: string | null;
  added_at: string;
}

export function useProjectTeams() {
  const q = useQuery({
    queryKey: ["project_members"],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_members").select("*").order("added_at");
      if (error) throw error;
      return (data ?? []) as ProjectMember[];
    },
    staleTime: 60_000,
  });
  return useMemo(() => {
    const byProject = new Map<string, string[]>();
    const byPerson = new Map<string, string[]>();
    for (const m of q.data ?? []) {
      byProject.set(m.project_id, [...(byProject.get(m.project_id) ?? []), m.user_id]);
      byPerson.set(m.user_id, [...(byPerson.get(m.user_id) ?? []), m.project_id]);
    }
    return {
      loading: q.isLoading,
      /** Everyone on a project's team, in the order they were added. */
      team: (projectId: string | null | undefined) => (projectId ? byProject.get(projectId) ?? [] : []),
      /** The projects someone is on. */
      projectsOf: (userId: string | null | undefined) => (userId ? byPerson.get(userId) ?? [] : []),
    };
  }, [q.data, q.isLoading]);
}

/** Sets a project's team to exactly these people (adds the new ones, takes off the rest). */
export async function saveProjectTeam(projectId: string, current: string[], next: string[]) {
  const add = next.filter((id) => !current.includes(id));
  const remove = current.filter((id) => !next.includes(id));
  if (add.length) {
    const { error } = await supabase.from("project_members").insert(add.map((user_id) => ({ project_id: projectId, user_id })));
    if (error) throw error;
  }
  if (remove.length) {
    const { error } = await supabase.from("project_members").delete().eq("project_id", projectId).in("user_id", remove);
    if (error) throw error;
  }
}
