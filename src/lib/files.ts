import { supabase } from "./supabase";
import type { Attachment } from "./types";

const BUCKET = "files";
const MAX_BYTES = 50 * 1024 * 1024;

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-120) || "file";
}

export async function uploadFile(
  file: File,
  opts: { taskId?: string | null; projectId?: string | null; commentId?: string | null; userId: string },
): Promise<Attachment> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 50 MB.`);
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

export async function deleteAttachment(a: Attachment) {
  await supabase.storage.from(BUCKET).remove([a.path]);
  const { error } = await supabase.from("attachments").delete().eq("id", a.id);
  if (error) throw error;
}

export const isImage = (a: Pick<Attachment, "mime" | "name">) =>
  (a.mime ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name);
