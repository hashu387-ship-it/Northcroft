// Profile photos: crop to a centred square, shrink to 512px and upload as a small JPEG.
import { supabase } from "./supabase";

const SIZE = 512;
const BUCKET = "avatars";

export async function loadImage(file: File): Promise<CanvasImageSource & { width: number; height: number }> {
  if ("createImageBitmap" in window) {
    try {
      // Respect the phone's rotation flag so selfies aren't sideways.
      return await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    } catch {
      /* fall back to <img> below */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** Centre-crop to a square and return a JPEG blob. */
export async function squarePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) {
    throw new Error("Choose a photo (JPEG, PNG or HEIC).");
  }
  let img: CanvasImageSource & { width: number; height: number };
  try {
    img = await loadImage(file);
  } catch {
    throw new Error("This photo couldn't be opened. Try a JPEG or PNG, or take a new photo.");
  }
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device can't resize photos.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
  if (!blob) throw new Error("Couldn't prepare the photo.");
  return blob;
}

function pathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

/** Upload a new profile photo for the signed-in person and return its public address. */
export async function setProfilePhoto(userId: string, file: File, previousUrl?: string | null): Promise<string> {
  const blob = await squarePhoto(file);
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const { error } = await supabase.from("profiles").update({ avatar_url: data.publicUrl }).eq("id", userId);
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  const old = pathFromUrl(previousUrl);
  if (old) await supabase.storage.from(BUCKET).remove([old]);
  return data.publicUrl;
}

export async function removeProfilePhoto(userId: string, currentUrl: string | null | undefined) {
  const { error } = await supabase.from("profiles").update({ avatar_url: null }).eq("id", userId);
  if (error) throw error;
  const old = pathFromUrl(currentUrl);
  if (old) await supabase.storage.from(BUCKET).remove([old]);
}
