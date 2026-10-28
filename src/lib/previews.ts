// Big preview pictures for files in file lists and chats, like photos have: PDFs (the first page),
// drawings (DWG, DXF, as a black-on-white sheet), spreadsheets (the top of the first sheet), Word
// and PowerPoint files (Google Drive's own picture of the first page or slide) and videos (a frame
// a second in, or Drive's picture).
//
// A preview is made once, on the device of whoever uploads the file (from the file they just
// picked), or for files already in the app, on the device of the first person who sees it in a
// list. It's kept in the private "previews" bucket as <file id>.jpg; the file's `preview` says
// 'ready', or 'failed' when the file couldn't be pictured (then nobody tries again and the list
// shows the plain line). The tools that make previews load only when one is being made.
import { supabase } from "./supabase";
import type { Attachment } from "./types";
import { driveCall } from "./drive";
import { fetchAttachmentData, fileKind, fileUrl, isOnDrive } from "./files";

const BUCKET = "previews";
export type PreviewKind = "pdf" | "drawing" | "sheet" | "word" | "slides" | "video";
// Bigger files aren't downloaded just for a preview (one being uploaded always gets one). Word,
// PowerPoint and videos are never downloaded whole: Drive sends its picture, a video only the start.
const MAX_FETCH: Partial<Record<PreviewKind, number>> = { pdf: 60 * 1024 * 1024, drawing: 40 * 1024 * 1024, sheet: 20 * 1024 * 1024 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORD = /\.(docx?|docm|dotx|odt|rtf)$/i;
const SLIDES = /\.(pptx?|pptm|ppsx?|potx|odp)$/i;
const VIDEO = /\.(mp4|m4v|mov|webm|3gp|avi|mkv|mpe?g|wmv)$/i;
// Drive makes its picture of a new file within a few minutes. Still none after this long, it won't.
const STALE_MINUTES = 360;
// While Drive is still making its picture, ask again after these waits (then on the next visit).
const RETRY_MS = [20_000, 60_000, 180_000, 600_000];

const pictureName = (id: string) => `${id}.jpg`;

export const isVideo = (a: Pick<Attachment, "name" | "mime">) => VIDEO.test(a.name) || /^video\//i.test(a.mime ?? "");

/** What kind of preview a file in the app can have; null when it can't have one. */
export function previewKind(a: Pick<Attachment, "id" | "name" | "mime"> & { drive_file_id?: string | null }): PreviewKind | null {
  // Files listed from a linked Drive folder ("gd." ids) aren't in the app, so they have no record.
  if (!UUID.test(a.id)) return null;
  const k = fileKind(a);
  if (k === "pdf" || k === "drawing" || k === "sheet") return k;
  if (k === "image") return null;
  if (isVideo(a)) return "video";
  // Word and PowerPoint get Drive's picture, so only files kept in Drive have one.
  if (!a.drive_file_id) return null;
  if (WORD.test(a.name)) return "word";
  if (SLIDES.test(a.name)) return "slides";
  return null;
}

/** Still needs its preview made (none yet, and it hasn't failed). */
export const needsPreview = (a: Attachment) => !!previewKind(a) && !a.preview;

/** Signed links to the preview pictures that are ready, keyed by the file's path. */
export async function previewImageUrls(rows: Attachment[]): Promise<Record<string, string>> {
  const ready = rows.filter((r) => r.preview === "ready" && previewKind(r));
  if (!ready.length) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(ready.map((r) => pictureName(r.id)), 3600);
  if (error) throw error;
  const out: Record<string, string> = {};
  ready.forEach((r, i) => {
    const url = data?.[i]?.signedUrl;
    if (url) out[r.path] = url;
  });
  return out;
}

/** Take a file's preview picture away (when the file is deleted). Best effort. */
export async function removePreview(a: Pick<Attachment, "id">) {
  await supabase.storage.from(BUCKET).remove([pictureName(a.id)]).then(
    () => undefined,
    () => undefined,
  );
}

/* ---------------------------------------------------------------- making previews, one at a time */

const asked = new Set<string>();
let chain: Promise<void> = Promise.resolve();
// Waiting their turn or being made on this device right now (the list shows "Making a preview").
const pending = new Set<string>();
const busy = new Set<string>();
const tries = new Map<string, number>();
const listeners = new Set<() => void>();

export const previewPending = (id: string) => pending.has(id);
const savedListeners = new Set<() => void>();
/** Tell `fn` when this device has saved a preview (or found a file can't be pictured). */
export function onPreviewSaved(fn: () => void): () => void {
  savedListeners.add(fn);
  return () => savedListeners.delete(fn);
}
const saved = () => savedListeners.forEach((fn) => fn());
export function onPreviewChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/**
 * Make a file's preview if it still needs one. `local` is the file itself when it has just been
 * picked on this device; otherwise it's downloaded (not over a data saver, and not when very big).
 * Each file is tried once per visit, one at a time, in the background.
 */
export function requestPreview(a: Attachment, local?: Blob) {
  const kind = previewKind(a);
  if (!kind || a.preview || asked.has(a.id)) return;
  if (!local) {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const max = MAX_FETCH[kind];
    if (conn?.saveData || (max != null && a.size != null && a.size > max) || !navigator.onLine) return;
  }
  asked.add(a.id);
  pending.add(a.id);
  changed();
  chain = chain.then(() => make(a, kind, local)).catch(() => undefined);
}

/** Keep a preview picture for a file and mark it ready (every open list then shows it). */
export async function savePreview(a: Pick<Attachment, "id">, picture: Blob) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(pictureName(a.id), picture, { contentType: "image/jpeg", upsert: true, cacheControl: "86400" });
  if (error) throw error;
  const { error: e2 } = await supabase.rpc("set_attachment_preview", { p_id: a.id, p_state: "ready" });
  if (e2) throw e2;
  saved();
}

/** The file couldn't be pictured (damaged, a password, a drawing the reader can't handle). */
export async function markPreviewFailed(a: Pick<Attachment, "id">) {
  await supabase.rpc("set_attachment_preview", { p_id: a.id, p_state: "failed" });
  saved();
}

/**
 * The drawing viewer has the drawing open already: it makes the preview itself if the file has
 * none (or couldn't be drawn before), and nothing else on this device tries at the same time.
 * Returns false when there's nothing to do.
 */
export function claimPreview(a: Attachment): boolean {
  if (!previewKind(a) || a.preview === "ready" || busy.has(a.id)) return false;
  asked.add(a.id);
  return true;
}

type Outcome = Blob | "failed" | "later";

async function make(a: Attachment, kind: PreviewKind, local?: Blob) {
  busy.add(a.id);
  changed();
  try {
    const out = await picture(a, kind, local);
    // The file's record changes, so every open list (here and on other phones) shows the picture.
    if (out instanceof Blob) await savePreview(a, out);
    else if (out === "failed") await markPreviewFailed(a);
    else later(a);
  } catch (e) {
    // No signal or a hiccup: it's tried again a minute later, when the list is looked at again.
    setTimeout(() => asked.delete(a.id), 60_000);
    console.warn("Preview not made", a.name, e);
  } finally {
    busy.delete(a.id);
    pending.delete(a.id);
    changed();
  }
}

async function picture(a: Attachment, kind: PreviewKind, local?: Blob): Promise<Outcome> {
  const maker = await import("@/features/previews/make");
  if (kind === "pdf" || kind === "drawing" || kind === "sheet") {
    const data = local ? await local.arrayBuffer() : await fetchAttachmentData(a);
    return (await maker.makePreview(kind, data, a.name)) ?? "failed";
  }
  // A video just picked on this phone: a frame from it straight away.
  if (kind === "video" && local) {
    const frame = await maker.videoFrame(local);
    if (frame) return frame;
    return isOnDrive(a) ? "later" : "failed";
  }
  if (isOnDrive(a)) {
    const thumb = await driveThumbnail(a);
    if (thumb === "gone") return "failed";
    if (thumb instanceof Blob) return (await maker.asJpeg(thumb)) ?? "failed";
    // Drive hasn't made its picture (yet). A video can still give a frame of its own.
    if (kind === "video") {
      const frame = await maker.videoFrame(await fileUrl(a));
      if (frame) return frame;
    }
    return thumb.minutes > STALE_MINUTES ? "failed" : "later";
  }
  if (kind === "video") return (await maker.videoFrame(await fileUrl(a))) ?? "failed";
  return "failed";
}

/** Google Drive's own picture of a file in the team's Drive (first page, slide or video frame). */
async function driveThumbnail(a: Attachment): Promise<Blob | "gone" | { minutes: number }> {
  const out = await driveCall<unknown>("thumbnail", { attachment_id: a.id });
  if (out instanceof Blob) return out;
  const j = (out ?? {}) as { state?: string; age_minutes?: number };
  if (j.state === "gone") return "gone";
  return { minutes: Number(j.age_minutes ?? 0) };
}

/** Drive is still making its picture: ask again in a while (a few times, then on the next visit). */
function later(a: Attachment) {
  const n = tries.get(a.id) ?? 0;
  if (n >= RETRY_MS.length) return;
  tries.set(a.id, n + 1);
  setTimeout(() => {
    asked.delete(a.id);
    requestPreview(a);
  }, RETRY_MS[n]);
}
