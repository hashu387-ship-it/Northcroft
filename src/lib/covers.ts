// Project cover photos: shrink to at most 1600px wide and upload as a JPEG.
import { loadImage } from "./avatar";
import { supabase } from "./supabase";

const BUCKET = "covers";
const MAX_W = 1600;
const MAX_H = 1000;

async function coverJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new Error("Choose a photo (JPEG, PNG or HEIC).");
  }
  let img: Awaited<ReturnType<typeof loadImage>>;
  try {
    img = await loadImage(file);
  } catch {
    throw new Error("This photo couldn't be opened. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device can't resize photos.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
  if (!blob) throw new Error("Couldn't prepare the photo.");
  return blob;
}

function pathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

export async function setProjectCover(projectId: string, file: File, previousUrl?: string | null): Promise<string> {
  const blob = await coverJpeg(file);
  const path = `${projectId}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const { error } = await supabase.from("projects").update({ cover_url: data.publicUrl }).eq("id", projectId);
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  const old = pathFromUrl(previousUrl);
  if (old) await supabase.storage.from(BUCKET).remove([old]);
  return data.publicUrl;
}

export async function removeProjectCover(projectId: string, currentUrl: string | null | undefined) {
  const { error } = await supabase.from("projects").update({ cover_url: null }).eq("id", projectId);
  if (error) throw error;
  const old = pathFromUrl(currentUrl);
  if (old) await supabase.storage.from(BUCKET).remove([old]);
}
