import { supabase } from "./supabase";

/**
 * The sample data added while the app was being set up. Fixed on purpose so removing it can never
 * touch real work: only these 3 projects, and only general items made before the first real project
 * (Capella, HOAS, Babawa) was created on 22 Oct 2026.
 */
export const SAMPLE_PROJECT_IDS = [
  "2d616604-ab94-4387-934e-d9ad18e0c7ab", // Olaya Business Tower Fit-out
  "4e3080f8-ba01-430e-acf5-125d6fba05e1", // Corniche Retail Mall
  "33209afb-648e-4652-a1b6-0acd5549b83d", // Al Rawdah Villa Compound
];
const BEFORE_REAL_PROJECTS = "2026-10-22T21:16:35.09662Z";

/**
 * Remove the sample data with the signed-in manager's own permissions. Deleting a sample project also
 * removes its tasks, VOs, BOQs, chat, files and history. Returns how many projects went.
 */
export async function removeSampleData(meId: string): Promise<number> {
  const run = async (q: PromiseLike<{ error: unknown; count: number | null }>) => {
    const { error, count } = await q;
    if (error) throw error;
    return count ?? 0;
  };
  const projects = await run(supabase.from("projects").delete({ count: "exact" }).in("id", SAMPLE_PROJECT_IDS));
  // Test items from before the real projects existed.
  await run(supabase.from("tasks").delete({ count: "exact" }).is("project_id", null).lt("created_at", BEFORE_REAL_PROJECTS));
  await run(supabase.from("recurring_tasks").delete({ count: "exact" }).lt("created_at", BEFORE_REAL_PROJECTS));
  await run(supabase.from("announcements").delete({ count: "exact" }).lt("created_at", BEFORE_REAL_PROJECTS));
  await run(supabase.from("events").delete({ count: "exact" }).is("project_id", null).lt("created_at", BEFORE_REAL_PROJECTS));
  await run(supabase.from("comments").delete({ count: "exact" }).is("task_id", null).is("project_id", null).lt("created_at", BEFORE_REAL_PROJECTS));
  await run(supabase.from("attendance").delete({ count: "exact" }).lt("created_at", BEFORE_REAL_PROJECTS));
  await run(supabase.from("notifications").delete({ count: "exact" }).eq("user_id", meId).lt("created_at", BEFORE_REAL_PROJECTS));
  return projects;
}
