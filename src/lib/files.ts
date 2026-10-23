import { supabase } from "./supabase";
import { DriveError, deleteDriveAttachment, driveLink, uploadToDrive } from "./drive";
import type { Attachment } from "./types";

const BUCKET = "files";
/** Files up to this size go to the app's own storage; bigger ones go to Google Drive. */
export const STORAGE_MAX_BYTES = 50 * 1024 * 1024;

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-120) || "file";
}

export const isOnDrive = (a: Pick<Attachment, "drive_file_id">) => !!a.drive_file_id;

/**
 * Attach a file to a task, project or chat message. Up to 50 MB goes to the app's storage;
 * anything bigger goes straight to the team's Google Drive folder (`onProgress` gets 0 to 1).
 */
export async function uploadFile(
  file: File,
  opts: { taskId?: string | null; projectId?: string | null; commentId?: string | null; userId: string; onProgress?: (fraction: number) => void },
): Promise<Attachment> {
  if (file.size > STORAGE_MAX_BYTES) {
    try {
      return await uploadToDrive(file, opts, opts.onProgress);
    } catch (e) {
      if (e instanceof DriveError && e.code === "drive_off") {
        throw new Error(`${file.name} is over 50 MB. Files that big go to Google Drive, which a manager needs to connect in Settings > Google Drive.`);
      }
      throw e;
    }
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
