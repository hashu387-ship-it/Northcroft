import { supabase } from "./supabase";
import { DriveError, deleteDriveAttachment, driveLink, driveLinks, uploadToDrive } from "./drive";
import type { Attachment } from "./types";

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
    : `${opts.projectId ?? "general"}/${opts.taskId ?? "project"}/${crypto.randomUUID()}-${safeName(file.name)}`;
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
    const url = isOnDrive(a) ? await driveLink(a) : await signedUrl(a.path);
    if (tab) tab.location.href = url;
    else window.open(url, "_blank", "noopener");
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export async function deleteAttachment(a: Attachment) {
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

/** Which in-app tool opens a file: the PDF tool, the spreadsheet tool, or neither (opens in a new tab). */
export type FileKind = "pdf" | "sheet" | "other";

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
  return "other";
}

/** "BOQ rev 3.xlsx" + 2 -> "BOQ rev 3 (v2).xlsx"; an existing "(v4)" is replaced. `extension` swaps the type. */
export function versionName(name: string, version: number, extension?: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/\s*\(v\d+\)$/i, "");
  const ext = extension ? (extension.startsWith(".") ? extension : `.${extension}`) : dot > 0 ? name.slice(dot) : "";
  return `${base} (v${version})${ext}`;
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

/** The file's contents, from Google Drive or the app's storage. `onProgress` gets 0 to 1. */
export async function fetchAttachmentData(a: Attachment, onProgress?: (fraction: number) => void): Promise<ArrayBuffer> {
  const url = isOnDrive(a) ? await driveLink(a) : await signedUrl(a.path);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(res.status === 404 || res.status === 410 ? "This file is no longer there." : `The file didn't download (${res.status}). Try again.`);
  }
  return readWithProgress(res, onProgress);
}

/** Every version of a file (the original and its edited copies), newest first. */
export async function fileVersions(a: Pick<Attachment, "id" | "version_of">): Promise<Attachment[]> {
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
  const name = versionName(original.name, opts.nextVersion, opts.extension);
  const file = new File([data], name, { type: data.type || original.mime || "application/octet-stream" });
  let where = { taskId: original.task_id, projectId: original.project_id, conversationId: original.conversation_id };
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
