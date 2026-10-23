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

/**
 * Attach a file to a task, project or chat message. Every file, whoever uploads it, goes straight
 * to the team's Google Drive (the project's folder, or General); `onProgress` gets 0 to 1.
 * Until a manager connects Drive, files up to 50 MB are kept in the app's own storage instead.
 */
export async function uploadFile(
  file: File,
  opts: { taskId?: string | null; projectId?: string | null; commentId?: string | null; userId: string; onProgress?: (fraction: number) => void },
): Promise<Attachment> {
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
  const folder = opts.projectId ?? "general";
  const path = `${folder}/${opts.taskId ?? "project"}/${crypto.randomUUID()}-${safeName(file.name)}`;
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
