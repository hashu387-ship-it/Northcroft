import { supabase } from "./supabase";
import type { Attachment } from "./types";

/** An error from the Drive function, with a code the screens can react to ("drive_off" = not connected). */
export class DriveError extends Error {
  constructor(message: string, public code = "error") {
    super(message);
  }
}

/** Call the `drive` Edge Function. */
export async function driveCall<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("drive", { body: { action, ...payload } });
  if (error) {
    let msg = "Google Drive didn't answer. Try again in a moment.";
    let code = "error";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
        if (j?.code) code = j.code;
      } else if (/Failed to fetch|NetworkError/i.test(error.message)) {
        msg = "No connection. Check your internet and try again.";
      }
    } catch {
      /* keep the friendly default */
    }
    throw new DriveError(msg, code);
  }
  return data as T;
}

// Pieces of 8 MB (Google needs multiples of 256 KB). Each piece is retried once if the connection drops.
const CHUNK = 8 * 1024 * 1024;

async function putChunk(url: string, blob: Blob, from: number, to: number, total: number): Promise<Response> {
  const send = () => fetch(url, { method: "PUT", headers: { "Content-Range": `bytes ${from}-${to}/${total}` }, body: blob });
  try {
    return await send();
  } catch {
    await new Promise((r) => setTimeout(r, 2000));
    return await send();
  }
}

export interface DriveTarget {
  taskId?: string | null;
  projectId?: string | null;
  commentId?: string | null;
}

/**
 * Upload a file straight from this device to the team's Google Drive folder (the project's
 * subfolder, or General), then attach it. `onProgress` gets 0 to 1.
 */
export async function uploadToDrive(file: File, target: DriveTarget, onProgress?: (fraction: number) => void): Promise<Attachment> {
  const ids = { project_id: target.projectId ?? null, task_id: target.taskId ?? null, comment_id: target.commentId ?? null };
  const { upload_url } = await driveCall<{ upload_url: string }>("start_upload", {
    ...ids,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  });

  let start = 0;
  let uploaded: { id?: string } | null = null;
  onProgress?.(0);
  while (start < file.size) {
    const end = Math.min(start + CHUNK, file.size);
    const res = await putChunk(upload_url, file.slice(start, end), start, end - 1, file.size);
    if (res.status === 308) {
      // Google says how much it has; carry on from there.
      const got = /-(\d+)$/.exec(res.headers.get("range") ?? "");
      start = got ? Number(got[1]) + 1 : end;
    } else if (res.ok) {
      uploaded = await res.json();
      start = file.size;
    } else {
      throw new DriveError(`The upload to Google Drive stopped (${res.status}). Try again.`);
    }
    onProgress?.(Math.min(1, start / file.size));
  }
  if (!uploaded?.id) throw new DriveError("Google Drive didn't confirm the upload. Try again.");
  return driveCall<Attachment>("finish_upload", { ...ids, file_id: uploaded.id });
}

/** A 1-hour link that opens (or downloads) a Drive file through the app, for signed-in team members only. */
export async function driveLink(a: Pick<Attachment, "id">, download = false): Promise<string> {
  const { url } = await driveCall<{ url: string }>("link", { attachment_id: a.id, download });
  return url;
}

/** Links for several Drive files at once, keyed by attachment path (for photo previews). */
export async function driveLinks(rows: Pick<Attachment, "id">[]): Promise<Record<string, string>> {
  if (!rows.length) return {};
  const { urls } = await driveCall<{ urls: Record<string, string> }>("links", { attachment_ids: rows.map((r) => r.id) });
  return urls;
}

export async function deleteDriveAttachment(a: Pick<Attachment, "id">) {
  await driveCall("delete", { attachment_id: a.id });
}

/** The Drive folder address, for managers who want to look at it in Google Drive. */
export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
