// Project folder: a project's own files and links, in folders anyone on the team makes (folders can
// be inside folders). Whoever made a folder, or a manager or senior, renames or removes it; removing
// moves what's in it up a level. Files and links added on tasks, VOs, announcements and chats aren't
// in folders: they show under "From tasks and VOs".
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Attachment, ProjectFolder } from "./types";
import type { DriveLink } from "./drivelinks";

export function useProjectFolders(projectId: string) {
  const q = useQuery({
    queryKey: ["project_folders", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from("project_folders").select("*").eq("project_id", projectId).is("removed_at", null).order("name");
      if (error) throw error;
      return (data ?? []) as ProjectFolder[];
    },
  });
  return useMemo(() => {
    const list = q.data ?? [];
    const byId = new Map(list.map((f) => [f.id, f]));
    const children = (parentId: string | null) =>
      list.filter((f) => (f.parent_id ?? null) === parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    /** The folders from the top down to this one (empty at the top). */
    const path = (id: string | null) => {
      const out: ProjectFolder[] = [];
      let f = id ? byId.get(id) : undefined;
      while (f && out.length < 50) {
        out.unshift(f);
        f = f.parent_id ? byId.get(f.parent_id) : undefined;
      }
      return out;
    };
    return { loading: q.isLoading, list, byId, children, path };
  }, [q.data, q.isLoading]);
}

/** A file added to the project itself (it can go in a folder), not on a task, VO, announcement or message. */
export const isProjectLevelFile = (a: Attachment) =>
  !!a.project_id && !a.task_id && !a.comment_id && !a.conversation_id && !a.recurring_id && !a.variation_id && !a.announcement_id && !a.leave_id;

/** A link added to the project itself. */
export const isProjectLevelLink = (l: DriveLink) => !!l.project_id && !l.task_id && !l.recurring_id && !l.comment_id && !l.variation_id && !l.announcement_id;

/** The same folder name is already used here (ignoring case and spaces at the ends). */
export function nameTaken(siblings: ProjectFolder[], name: string, exceptId?: string) {
  const n = name.trim().toLowerCase();
  return siblings.some((f) => f.id !== exceptId && f.name.trim().toLowerCase() === n);
}

export async function createFolder(projectId: string, parentId: string | null, name: string, userId: string) {
  const { data, error } = await supabase
    .from("project_folders")
    .insert({ project_id: projectId, parent_id: parentId, name: name.trim(), created_by: userId })
    .select()
    .single();
  if (error) throw error;
  return data as ProjectFolder;
}

export async function renameFolder(id: string, name: string) {
  const { data, error } = await supabase.from("project_folders").update({ name: name.trim() }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Only whoever made this folder, Hassan or a senior can rename it.");
}

export async function removeFolder(id: string) {
  const { error } = await supabase.rpc("remove_project_folder", { p_folder: id });
  if (error) throw error;
}

export async function moveFileToFolder(attachmentId: string, folderId: string | null) {
  const { error } = await supabase.rpc("move_project_file", { p_attachment: attachmentId, p_folder: folderId });
  if (error) throw error;
}

export async function moveLinkToFolder(linkId: string, folderId: string | null) {
  const { error } = await supabase.rpc("move_project_link", { p_link: linkId, p_folder: folderId });
  if (error) throw error;
}
