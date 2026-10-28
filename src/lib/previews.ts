// Big preview pictures for PDFs and drawings (DWG, DXF) in file lists and chats, like photos have.
//
// A preview is a picture of a PDF's first page, or of the drawing as a black-on-white sheet. It's
// made once, on the device of whoever uploads the file (from the file they just picked), or for
// files already in the app, on the device of the first person who sees it in a list. It's kept in
// the private "previews" bucket as <file id>.jpg; the file's `preview` says 'ready', or 'failed'
// when the file couldn't be drawn (then nobody tries again and the list shows the plain line).
// The PDF and drawing tools that make it load only when one is being made.
import { supabase } from "./supabase";
import type { Attachment } from "./types";
import { fetchAttachmentData, fileKind } from "./files";

const BUCKET = "previews";
// Bigger files aren't downloaded just for a preview (one being uploaded always gets one).
const MAX_FETCH = { pdf: 60 * 1024 * 1024, drawing: 40 * 1024 * 1024 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pictureName = (id: string) => `${id}.jpg`;

/** "pdf" or "drawing" for a file in the app that can have a preview; null otherwise. */
export function previewKind(a: Pick<Attachment, "id" | "name" | "mime">): "pdf" | "drawing" | null {
  // Files listed from a linked Drive folder ("gd." ids) aren't in the app, so they have no record.
  if (!UUID.test(a.id)) return null;
  const k = fileKind(a);
  return k === "pdf" || k === "drawing" ? k : null;
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
const listeners = new Set<() => void>();

export const previewPending = (id: string) => pending.has(id);
const savedListeners = new Set<() => void>();
/** Tell `fn` when this device has saved a preview (or found a file can't be drawn). */
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
    if (conn?.saveData || (a.size != null && a.size > MAX_FETCH[kind]) || !navigator.onLine) return;
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

/** The file couldn't be drawn (damaged, a password, a drawing the reader can't handle). */
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

async function make(a: Attachment, kind: "pdf" | "drawing", local?: Blob) {
  busy.add(a.id);
  changed();
  try {
    const data = local ? await local.arrayBuffer() : await fetchAttachmentData(a);
    const { makePreview } = await import("@/features/previews/make");
    const picture = await makePreview(kind, data, a.name);
    if (picture) await savePreview(a, picture);
    else await markPreviewFailed(a);
    // The file's record changes, so every open list (here and on other phones) shows the picture.
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
