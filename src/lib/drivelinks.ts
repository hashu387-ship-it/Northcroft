// Google Drive links on tasks and projects: paste a shared folder (or file) link and its files
// show in the app, ready to open in the app's viewers or download. They're read through the
// `drive` function with a Google key a manager adds once (Settings > Google Drive), so the link
// has to be shared as "Anyone with the link".
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { driveCall } from "./drive";
import { supabase } from "./supabase";
import type { Attachment } from "./types";

export interface DriveLink {
  id: string;
  task_id: string | null;
  project_id: string | null;
  recurring_id: string | null;
  /** Set for a link posted in a message: it shows in that message, to whoever can see the message. */
  comment_id?: string | null;
  url: string;
  drive_id: string;
  resource_key: string | null;
  kind: "folder" | "file";
  title: string;
  mime: string | null;
  added_by: string;
  created_at: string;
  removed_at: string | null;
  /** google: its files show in the app. onedrive and web: a card that opens the link. */
  provider?: LinkProvider;
  /** The name on the card for other links: OneDrive, SharePoint, Dropbox, or the website. */
  site?: string | null;
  /** Set for a link on a variation; with vo_round, it belongs to that submission (sent or assessment side). */
  variation_id?: string | null;
  vo_round?: string | null;
  vo_side?: "sent" | "assessment" | null;
  /** Set for a link on an announcement. */
  announcement_id?: string | null;
  /** For a link added to the project itself: the folder it's in (null: the top of the Project folder). */
  project_folder_id?: string | null;
}

export type LinkProvider = "google" | "onedrive" | "web";

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
  /** Missing means a Google Drive link. */
  provider?: LinkProvider;
  site?: string | null;
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

/** Links on a task (and its repeating task), on a variation, or every link in a project. */
export function useDriveLinks(where: { taskId?: string | null; projectId?: string | null; repeatOf?: string | null; variationId?: string | null; announcementId?: string | null }) {
  const { taskId, projectId, repeatOf, variationId, announcementId } = where;
  return useQuery({
    queryKey: ["drive_links", taskId ? "task" : variationId ? "vo" : announcementId ? "announcement" : "project", taskId ?? variationId ?? announcementId ?? projectId, repeatOf ?? null],
    enabled: !!(taskId || projectId || variationId || announcementId),
    queryFn: async () => {
      let q = supabase.from("drive_links").select("*").is("removed_at", null);
      if (taskId && repeatOf) q = q.or(`task_id.eq.${taskId},recurring_id.eq.${repeatOf}`);
      else if (variationId) q = q.eq("variation_id", variationId);
      else if (announcementId) q = q.eq("announcement_id", announcementId);
      else q = taskId ? q.eq("task_id", taskId) : q.eq("project_id", projectId!);
      const { data, error } = await q.order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DriveLink[];
    },
  });
}

export interface LinkWhere {
  taskId?: string | null;
  projectId: string | null;
  recurringId?: string | null;
  commentId?: string | null;
  /** A link on a variation: a submission round's (sent or assessment side), or supporting (no round). */
  variationId?: string | null;
  voRound?: string | null;
  voSide?: "sent" | "assessment" | null;
  /** A link on an announcement. */
  announcementId?: string | null;
  /** A link added to the project itself, into this folder of its Project folder. */
  projectFolderId?: string | null;
}

/** Save checked links on a task, a repeating task, a project, a variation, or a message. */
export async function addDriveLinks(links: (LinkInfo & { url: string })[], where: LinkWhere) {
  if (!links.length) return;
  // A link in a message belongs to the message only, so it doesn't also show in a task's or
  // project's Files list. Whoever can see the message can see the link.
  const inMessage = !!where.commentId;
  const onVo = !inMessage && !where.taskId && !!where.variationId;
  const onProject = !inMessage && !where.taskId && !where.recurringId && !onVo && !where.announcementId && !!where.projectId;
  const { error } = await supabase.from("drive_links").insert(
    links.map((l) => ({
      task_id: inMessage ? null : where.taskId ?? null,
      project_id: inMessage ? null : where.projectId,
      recurring_id: inMessage || where.taskId ? null : where.recurringId ?? null,
      comment_id: where.commentId ?? null,
      variation_id: onVo ? where.variationId : null,
      vo_round: onVo ? where.voRound ?? null : null,
      vo_side: onVo && where.voRound ? where.voSide ?? null : null,
      announcement_id: !inMessage && !where.taskId && !onVo ? where.announcementId ?? null : null,
      project_folder_id: onProject ? where.projectFolderId ?? null : null,
      url: l.url.trim(),
      drive_id: l.drive_id,
      resource_key: l.resource_key,
      kind: l.kind,
      title: l.title,
      mime: l.mime,
      provider: l.provider ?? "google",
      site: l.provider && l.provider !== "google" ? l.site ?? null : null,
    })),
  );
  if (error) throw error;
}

/** Drive links posted in these messages (the ones still on). */
export function useMessageDriveLinks(commentIds: string[]) {
  const ids = [...commentIds].sort();
  return useQuery({
    queryKey: ["drive_links", "comments", ids.join(",")],
    enabled: ids.length > 0,
    // A new message changes the list of ids; keep the cards (and any open folder) in place meanwhile.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drive_links")
        .select("*")
        .in("comment_id", ids)
        .is("removed_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const byComment = new Map<string, DriveLink[]>();
      for (const l of (data ?? []) as DriveLink[]) {
        if (!l.comment_id) continue;
        byComment.set(l.comment_id, [...(byComment.get(l.comment_id) ?? []), l]);
      }
      return byComment;
    },
  });
}

/* ---------------------------------------------------------------- the file screen */
// Files from a linked folder open in the same file screen as attachments. Their screen id is
// "gd.<link>.<file>[.<resource key>]" and they behave like a read-only attachment: editing saves
// a copy to the task's (or project's) own files, or posts it in the same chat for a link in a
// message, and leaves the Drive file as it was.
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
  const { data: link } = await supabase
    .from("drive_links")
    .select("id, task_id, project_id, recurring_id, comment_id, added_by, created_at, removed_at, project_folder_id")
    .eq("id", p.linkId)
    .maybeSingle();
  if (!link || link.removed_at) return null;
  // A link in a message: the file belongs to that chat (or task thread).
  let where = { task_id: link.task_id as string | null, project_id: link.project_id as string | null, conversation_id: null as string | null, submission_id: null as string | null };
  if (link.comment_id) {
    const { data: msg } = await supabase.from("comments").select("task_id, project_id, conversation_id, submission_id").eq("id", link.comment_id).maybeSingle();
    if (!msg) return null;
    where = { task_id: msg.task_id, project_id: msg.project_id, conversation_id: msg.conversation_id, submission_id: msg.submission_id ?? null };
  }
  const f = await driveCall<DriveItem>("link_file", { link_id: p.linkId, file_id: p.fileId, file_rk: p.rk ?? "" });
  return {
    id: screenId,
    task_id: where.task_id,
    project_id: where.project_id,
    comment_id: link.comment_id ?? null,
    path: `gdrive/${p.linkId}/${p.fileId}/${p.rk ?? ""}`,
    name: f.name,
    mime: f.mime,
    size: f.size,
    uploaded_by: link.added_by,
    drive_file_id: null,
    conversation_id: where.conversation_id,
    submission_id: where.submission_id,
    version_of: null,
    version: 1,
    recurring_id: link.comment_id ? null : link.recurring_id,
    project_folder_id: link.comment_id ? null : link.project_folder_id ?? null,
    created_at: f.modified ?? link.created_at,
  };
}
