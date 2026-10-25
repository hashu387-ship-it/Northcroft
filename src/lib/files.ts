import { supabase } from "./supabase";
import { DriveError, deleteDriveAttachment, driveLink, driveLinks, uploadToDrive } from "./drive";
import type { Attachment } from "./types";
import { driveItemUrl, driveLinkFileParts, isDriveLinkFile } from "./drivelinks";

const BUCKET = "files";
/** The app's own storage takes files up to this size; it's only used until Google Drive is connected. */
export const STORAGE_MAX_BYTES = 50 * 1024 * 1024;

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-120) || "file";
}

export const isOnDrive = (a: Pick<Attachment, "drive_file_id">) => !!a.drive_file_id;

/** Preview links for the photos in a list of attachments, from Drive or the app's storage, keyed by path. */
export async function previewUrls(rows: Attachment[]): Promise<Record<string, string>> {
  const photos = rows.filter(isImage);
  const [fromStorage, fromDrive] = await Promise.all([
    signedUrls(photos.filter((r) => !isOnDrive(r)).map((r) => r.path)),
    driveLinks(photos.filter(isOnDrive)).catch(() => ({}) as Record<string, string>),
  ]);
  return { ...fromStorage, ...fromDrive };
}

export interface UploadTarget {
  taskId?: string | null;
  projectId?: string | null;
  commentId?: string | null;
  /** A private one-to-one or group chat: the file is only for the people in it. */
  conversationId?: string | null;
  /** This file is an edited copy (new version) of that attachment. */
  versionOf?: string | null;
  /** A file set up with a repeating task: it comes with every copy of the task. */
  recurringId?: string | null;
  /** A file on a variation: a submission round's (sent or assessment side), or supporting (no round). */
  variationId?: string | null;
  voRound?: string | null;
  voSide?: "sent" | "assessment" | null;
  /** A file on an announcement. */
  announcementId?: string | null;
  userId: string;
  onProgress?: (fraction: number) => void;
}

/**
 * Attach a file to a task, project or chat message. Every file, whoever uploads it, goes straight
 * to the team's Google Drive (the project's folder, or General); `onProgress` gets 0 to 1.
 * Until a manager connects Drive, files up to 50 MB are kept in the app's own storage instead.
 */
export async function uploadFile(file: File, opts: UploadTarget): Promise<Attachment> {
  try {
    return await uploadToDrive(file, opts, opts.onProgress);
  } catch (e) {
    const notConnected = e instanceof DriveError && (e.code === "drive_off" || e.code === "drive_expired");
    if (!notConnected) throw e;
    if (file.size > STORAGE_MAX_BYTES) {
      throw new Error(`${file.name} is over 50 MB. It needs Google Drive, which a manager connects in Settings > Google Drive.`);
    }
    // Drive isn't connected yet: keep the file in the app's storage for now.
  }
  // Private chat files live under c/<chat id>/, which only the people in that chat can read.
  const path = opts.conversationId
    ? `c/${opts.conversationId}/${crypto.randomUUID()}-${safeName(file.name)}`
    : `${opts.projectId ?? "general"}/${opts.taskId ?? (opts.recurringId ? `repeat-${opts.recurringId}` : opts.variationId ? `vo-${opts.variationId}` : opts.announcementId ? `ann-${opts.announcementId}` : "project")}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from("attachments")
    .insert({
      path,
      name: file.name,
      mime: file.type || null,
      size: file.size,
      task_id: opts.taskId ?? null,
      project_id: opts.projectId ?? null,
      comment_id: opts.commentId ?? null,
      conversation_id: opts.conversationId ?? null,
      version_of: opts.versionOf ?? null,
      recurring_id: opts.taskId ? null : opts.recurringId ?? null,
      variation_id: opts.taskId ? null : opts.variationId ?? null,
      vo_round: opts.taskId || !opts.variationId ? null : opts.voRound ?? null,
      vo_side: opts.taskId || !opts.variationId || !opts.voRound ? null : opts.voSide ?? null,
      announcement_id: opts.taskId || opts.variationId ? null : opts.announcementId ?? null,
      uploaded_by: opts.userId,
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return data as Attachment;
}

/**
 * Copy a file kept in the app's storage onto another message (forwarding). The copy is made inside
 * storage, so nothing is uploaded again, and it goes in the new chat's own folder: a private chat's
 * files stay readable only by the people in it, and deleting the original never breaks the copy.
 */
export async function copyStoredFile(
  a: Attachment,
  to: { commentId: string; projectId: string | null; conversationId: string | null; userId: string },
): Promise<Attachment> {
  const path = to.conversationId
    ? `c/${to.conversationId}/${crypto.randomUUID()}-${safeName(a.name)}`
    : `${to.projectId ?? "general"}/project/${crypto.randomUUID()}-${safeName(a.name)}`;
  const { error: cpErr } = await supabase.storage.from(BUCKET).copy(a.path, path);
  if (cpErr) throw cpErr;
  const { data, error } = await supabase
    .from("attachments")
    .insert({
      path,
      name: a.name,
      mime: a.mime,
      size: a.size,
      project_id: to.projectId,
      comment_id: to.commentId,
      conversation_id: to.conversationId,
      uploaded_by: to.userId,
    })
    .select()
    .single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return data as Attachment;
}

/** Copy a voice note into another chat's voice folder (forwarding). Returns the new path. */
export async function copyVoiceNote(path: string, to: { conversationId: string | null; userId: string }): Promise<string> {
  const ext = (path.split(".").pop() ?? "webm").toLowerCase().replace(/[^a-z0-9]/g, "") || "webm";
  const name = `${crypto.randomUUID()}.${ext}`;
  const dest = to.conversationId ? `c/${to.conversationId}/voice/${to.userId}-${name}` : `voice/${to.userId}/${name}`;
  const { error } = await supabase.storage.from(BUCKET).copy(path, dest);
  if (error) throw error;
  return dest;
}

/** Remove stored files (best effort, for tidying up after something fails part way). */
export async function removeStored(paths: string[]) {
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
}

export async function signedUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

/**
 * Open a file in a new tab. The tab is opened straight away (so phones don't block it as a pop-up)
 * and pointed at the file once its private link is ready.
 */
export async function openAttachment(a: Attachment) {
  const tab = window.open("", "_blank");
  try {
    if (tab) {
      tab.opener = null;
      tab.document.title = a.name;
      tab.document.body.style.font = "15px -apple-system, system-ui, sans-serif";
      tab.document.body.textContent = isOnDrive(a) ? "Opening from Google Drive..." : "Opening...";
    }
    const url = await fileUrl(a);
    if (tab) tab.location.href = url;
    else window.open(url, "_blank", "noopener");
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** A Google Drive file forwarded onto another message: the same file in Drive as the original. */
export const isForwardedDriveCopy = (a: Pick<Attachment, "drive_file_id" | "path">) => isOnDrive(a) && a.path.includes("/fwd/");

export async function deleteAttachment(a: Attachment) {
  if (isForwardedDriveCopy(a)) {
    // Only this message's link to it goes; the file stays in Drive for the original.
    const { error } = await supabase.from("attachments").delete().eq("id", a.id);
    if (error) throw error;
    return;
  }
  if (isOnDrive(a)) {
    // The Drive function removes the record and moves the file to the Drive bin.
    await deleteDriveAttachment(a);
    return;
  }
  await supabase.storage.from(BUCKET).remove([a.path]);
  const { error } = await supabase.from("attachments").delete().eq("id", a.id);
  if (error) throw error;
}

export const isImage = (a: Pick<Attachment, "mime" | "name">) =>
  (a.mime ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name);

/* ---------------------------------------------------------------- viewing and editing in the app */

/** Which in-app tool opens a file: the PDF, spreadsheet or photo tool, or none (opens in a new tab). */
export type FileKind = "pdf" | "sheet" | "image" | "other";

export function fileKind(a: Pick<Attachment, "mime" | "name">): FileKind {
  const mime = (a.mime ?? "").toLowerCase();
  if (mime === "application/pdf" || /\.pdf$/i.test(a.name)) return "pdf";
  if (
    /\.(xlsx|xlsm|xls|csv)$/i.test(a.name) ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "application/vnd.ms-excel.sheet.macroenabled.12" ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv"
  ) {
    return "sheet";
  }
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(a.name)) return "image";
  return "other";
}

/** "BOQ rev 3.xlsx" + 2 -> "BOQ rev 3 (v2).xlsx"; an existing "(v4)" is replaced. `extension` swaps the type. */
export function versionName(name: string, version: number, extension?: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/\s*\(v\d+\)$/i, "");
  const ext = extension ? (extension.startsWith(".") ? extension : `.${extension}`) : dot > 0 ? name.slice(dot) : "";
  return `${base} (v${version})${ext}`;
}

/** "Plan L5.pdf" -> "Plan L5 (edited).pdf". */
function editedName(name: string, extension?: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/\s*\(edited\)$/i, "");
  const ext = extension ? (extension.startsWith(".") ? extension : `.${extension}`) : dot > 0 ? name.slice(dot) : "";
  return `${base} (edited)${ext}`;
}

async function readWithProgress(res: Response, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out.buffer;
}

/** A private link to the file: the team's Drive, a linked shared Drive folder, or the app's storage. */
async function fileUrl(a: Attachment, download = false): Promise<string> {
  if (isDriveLinkFile(a)) {
    const p = driveLinkFileParts(a);
    return driveItemUrl(p.linkId, p.fileId, p.rk, download);
  }
  return isOnDrive(a) ? driveLink(a, download) : signedUrl(a.path, download ? a.name : undefined);
}

/** The file's contents, from Google Drive or the app's storage. `onProgress` gets 0 to 1. */
export async function fetchAttachmentData(a: Attachment, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const url = await fileUrl(a);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(res.status === 404 || res.status === 410 ? "This file is no longer there." : `The file didn't download (${res.status}). Try again.`);
  }
  return readWithProgress(res, onProgress);
}

/** Every version of a file (the original and its edited copies), newest first. */
export async function fileVersions(a: Attachment): Promise<Attachment[]> {
  // A file in a linked Drive folder has no versions in the app.
  if (isDriveLinkFile(a)) return [a];
  const root = a.version_of ?? a.id;
  const { data, error } = await supabase.from("attachments").select("*").or(`id.eq.${root},version_of.eq.${root}`).order("version", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Attachment[];
}

/**
 * Save an edited copy next to the original, as its next version. A file that was shared in a chat
 * or a task comment is shared again in the same place ("Edited plan.pdf, version 2"), so the people
 * there see it; a file on a task or project is added to the same task or project.
 */
export async function saveNewVersion(
  original: Attachment,
  data: Blob,
  opts: { userId: string; nextVersion: number; extension?: string; onProgress?: (fraction: number) => void },
): Promise<Attachment> {
  // An edited file from a linked Drive folder is saved as a copy in the task's (or project's) own
  // files, or posted in the same chat when the link was shared in a message; the Drive file stays
  // as it was.
  const fromDrive = isDriveLinkFile(original);
  const name = fromDrive ? editedName(original.name, opts.extension) : versionName(original.name, opts.nextVersion, opts.extension);
  const file = new File([data], name, { type: data.type || original.mime || "application/octet-stream" });
  if (fromDrive && original.comment_id) {
    // driveFileAttachment already holds the message's chat, task thread or project chat.
    const { data: posted, error } = await supabase
      .from("comments")
      .insert({
        body: `Edited ${original.name}, saved a copy`,
        mentions: [],
        author_id: opts.userId,
        task_id: original.task_id,
        project_id: original.project_id,
        conversation_id: original.conversation_id,
      })
      .select("id")
      .single();
    if (error) throw error;
    return uploadFile(file, {
      taskId: original.task_id,
      projectId: original.project_id,
      conversationId: original.conversation_id,
      commentId: posted.id,
      userId: opts.userId,
      onProgress: opts.onProgress,
    });
  }
  if (fromDrive) {
    return uploadFile(file, {
      taskId: original.task_id,
      projectId: original.project_id,
      recurringId: original.task_id ? null : original.recurring_id ?? null,
      userId: opts.userId,
      onProgress: opts.onProgress,
    });
  }
  // An edited copy of a file that comes with a repeating task comes with every copy too.
  let where: { taskId: string | null; projectId: string | null; conversationId: string | null; recurringId?: string | null } = {
    taskId: original.task_id,
    projectId: original.project_id,
    conversationId: original.conversation_id,
    recurringId: original.recurring_id ?? null,
  };
  let commentId: string | null = null;

  if (original.comment_id) {
    const { data: msg } = await supabase.from("comments").select("task_id, project_id, conversation_id").eq("id", original.comment_id).maybeSingle();
    if (msg) {
      where = { taskId: msg.task_id, projectId: msg.project_id, conversationId: msg.conversation_id };
      const { data: posted, error } = await supabase
        .from("comments")
        .insert({
          body: `Edited ${original.name}, saved as version ${opts.nextVersion}`,
          mentions: [],
          author_id: opts.userId,
          task_id: msg.task_id,
          project_id: msg.project_id,
          conversation_id: msg.conversation_id,
        })
        .select("id")
        .single();
      if (error) throw error;
      commentId = posted.id;
    }
  }

  return uploadFile(file, {
    ...where,
    commentId,
    versionOf: original.id,
    userId: opts.userId,
    onProgress: opts.onProgress,
  });
}
