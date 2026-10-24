// Google Drive links on tasks and projects: paste a shared folder (or file) link and its files
// show in the app, ready to open in the app's viewers or download. They're read through the
// `drive` function with a Google key a manager adds once (Settings > Google Drive), so the link
// has to be shared as "Anyone with the link".
import { useQuery } from "@tanstack/react-query";
import { driveCall } from "./drive";
import { supabase } from "./supabase";
import type { Attachment } from "./types";

export interface DriveLink {
  id: string;
  task_id: string | null;
  project_id: string | null;
  recurring_id: string | null;
  url: string;
  drive_id: string;
  resource_key: string | null;
  kind: "folder" | "file";
  title: string;
  mime: string | null;
  added_by: string;
  created_at: string;
  removed_at: string | null;
}

/** A file or folder inside a linked folder. */
export interface DriveItem {
  id: string;
  name: string;
  mime: string;
  size: number | null;
  modified: string | null;
  resource_key: string | null;
  folder: boolean;
  /** False for Google Forms and the like, which only open in Drive. */
  viewable: boolean;
}

/** What a pasted link turned out to be. */
export interface LinkInfo {
  drive_id: string;
  resource_key: string | null;
  kind: "folder" | "file";
  title: string;
  mime: string | null;
  size: number | null;
}

/** A quick check before asking Google. */
export const looksLikeDriveLink = (s: string) => /^https?:\/\/(drive|docs)\.google\.com\//i.test(s.trim());

export const checkDriveLink = (url: string) => driveCall<LinkInfo>("link_info", { url: url.trim() });

export async function listDriveLink(linkId: string, folder?: { id: string; resource_key: string | null }) {
  const { files } = await driveCall<{ files: DriveItem[] }>("link_list", {
    link_id: linkId,
    folder_id: folder?.id,
    folder_rk: folder?.resource_key ?? undefined,
  });
  return files;
}

/** A 1-hour link that opens (or downloads) one file through the app. */
export async function driveItemUrl(linkId: string, fileId: string, rk: string | null, download = false) {
  const { url } = await driveCall<{ url: string }>("link_open", { link_id: linkId, file_id: fileId, file_rk: rk ?? "", download });
  return url;
}

/** Where to see the folder or file in Google Drive itself. */
export function driveWebUrl(l: Pick<DriveLink, "kind" | "drive_id" | "resource_key" | "url">) {
  return l.url || (l.kind === "folder" ? `https://drive.google.com/drive/folders/${l.drive_id}` : `https://drive.google.com/file/d/${l.drive_id}/view`);
}

/** Links on a task (and its repeating task), or every link in a project. */
export function useDriveLinks(where: { taskId?: string | null; projectId?: string | null; repeatOf?: string | null }) {
  const { taskId, projectId, repeatOf } = where;
  return useQuery({
    queryKey: ["drive_links", taskId ? "task" : "project", taskId ?? projectId, repeatOf ?? null],
    enabled: !!(taskId || projectId),
    queryFn: async () => {
      let q = supabase.from("drive_links").select("*").is("removed_at", null);
      if (taskId && repeatOf) q = q.or(`task_id.eq.${taskId},recurring_id.eq.${repeatOf}`);
      else q = taskId ? q.eq("task_id", taskId) : q.eq("project_id", projectId!);
      const { data, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DriveLink[];
    },
  });
}

/** Save checked links on a task, a repeating task or a project. */
export async function addDriveLinks(
  links: (LinkInfo & { url: string })[],
  where: { taskId?: string | null; projectId: string | null; recurringId?: string | null },
) {
  if (!links.length) return;
  const { error } = await supabase.from("drive_links").insert(
    links.map((l) => ({
      task_id: where.taskId ?? null,
      project_id: where.projectId,
      recurring_id: where.taskId ? null : where.recurringId ?? null,
      url: l.url.trim(),
      drive_id: l.drive_id,
      resource_key: l.resource_key,
      kind: l.kind,
      title: l.title,
      mime: l.mime,
    })),
  );
  if (error) throw error;
}

/* ---------------------------------------------------------------- the file screen */
// Files from a linked folder open in the same file screen as attachments. Their screen id is
// "gd.<link>.<file>[.<resource key>]" and they behave like a read-only attachment: editing saves
// a copy to the task's (or project's) own files and leaves the Drive file as it was.
const PREFIX = "gd.";

export function driveFileScreenId(linkId: string, item: Pick<DriveItem, "id" | "resource_key">) {
  return `${PREFIX}${linkId}.${item.id}${item.resource_key ? `.${item.resource_key}` : ""}`;
}

export function parseDriveFileScreenId(id: string): { linkId: string; fileId: string; rk: string | null } | null {
  if (!id.startsWith(PREFIX)) return null;
  const [linkId, fileId, rk] = id.slice(PREFIX.length).split(".");
  return linkId && fileId ? { linkId, fileId, rk: rk || null } : null;
}

/** Attachments that are really files in a linked Drive folder. */
export const isDriveLinkFile = (a: Pick<Attachment, "path">) => a.path.startsWith("gdrive/");

export function driveLinkFileParts(a: Pick<Attachment, "path">) {
  const [, linkId, fileId, rk] = a.path.split("/");
  return { linkId, fileId, rk: rk || null };
}

/** A file from a linked folder, shaped like an attachment for the file screen. */
export async function driveFileAttachment(screenId: string): Promise<Attachment | null> {
  const p = parseDriveFileScreenId(screenId);
  if (!p) return null;
  const { data: link } = await supabase.from("drive_links").select("id, task_id, project_id, recurring_id, added_by, created_at, removed_at").eq("id", p.linkId).maybeSingle();
  if (!link || link.removed_at) return null;
  const f = await driveCall<DriveItem>("link_file", { link_id: p.linkId, file_id: p.fileId, file_rk: p.rk ?? "" });
  return {
    id: screenId,
    task_id: link.task_id,
    project_id: link.project_id,
    comment_id: null,
    path: `gdrive/${p.linkId}/${p.fileId}/${p.rk ?? ""}`,
    name: f.name,
    mime: f.mime,
    size: f.size,
    uploaded_by: link.added_by,
    drive_file_id: null,
    conversation_id: null,
    version_of: null,
    version: 1,
    recurring_id: link.recurring_id,
    created_at: f.modified ?? link.created_at,
  };
}
