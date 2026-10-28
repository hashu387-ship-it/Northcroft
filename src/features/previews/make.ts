// Makes the preview pictures: a PDF's first page, a drawing (the sheet it opens on, black on white),
// the top of a spreadsheet's first sheet, a frame from a video, and Drive's own picture of a Word or
// PowerPoint file made into a JPEG. Loaded only when a preview is being made; see src/lib/previews.ts.
import { closePdf, openPdf } from "@/features/pdf/pdfjs";

const LONG_SIDE = 1400;

/** A JPEG of the file, or null when it can't be drawn (damaged, password, unreadable drawing). */
export async function makePreview(kind: "pdf" | "drawing" | "sheet", data: ArrayBuffer, name: string): Promise<Blob | null> {
  if (kind === "pdf") return pdfPicture(data);
  if (kind === "sheet") return (await import("./sheet")).sheetPicture(data, name);
  return drawingPicture(data, name);
}

const jpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
    } catch {
      // A picture from another site that won't allow being copied.
      resolve(null);
    }
  });

/** A canvas at most LONG_SIDE across for a picture `w` by `h`, on white. */
function frameFor(w: number, h: number) {
  const scale = Math.min(1, LONG_SIDE / Math.max(w, h, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { canvas, ctx };
}

/** Drive's picture of a file (PNG or JPEG, any size) as a JPEG no bigger than the other previews. */
export async function asJpeg(picture: Blob): Promise<Blob | null> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(picture);
  } catch {
    return null;
  }
  try {
    const { canvas, ctx } = frameFor(bmp.width, bmp.height);
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await jpeg(canvas);
  } finally {
    bmp.close();
  }
}

/**
 * A frame from a video, about a second in (the very first frame is often black). `src` is the file
 * just picked, or a link to it: only the start of the video is downloaded. Null when this browser
 * can't play it (some phone videos only play on the phone that made them).
 */
export async function videoFrame(src: Blob | string): Promise<Blob | null> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  if (typeof src === "string") video.crossOrigin = "anonymous";
  // iPhones only load a video that's playing: nudge it if nothing has arrived after a moment.
  const nudge = setTimeout(() => {
    if (video.readyState < 2) void video.play().catch(() => undefined);
  }, 1500);
  try {
    const loaded = await when(video, "loadeddata", 30_000, () => {
      video.src = url;
      video.load();
    });
    clearTimeout(nudge);
    video.pause();
    if (!loaded || !video.videoWidth || !video.videoHeight) return null;
    const d = video.duration;
    const t = Number.isFinite(d) && d > 0 ? Math.min(1, d * 0.1) : 0;
    if (t > 0) {
      await when(video, "seeked", 8_000, () => {
        video.currentTime = t;
      });
    }
    const { canvas, ctx } = frameFor(video.videoWidth, video.videoHeight);
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await jpeg(canvas);
  } catch {
    return null;
  } finally {
    clearTimeout(nudge);
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

/** Wait for a video event (true), an error or the time running out (false). */
function when(el: HTMLMediaElement, event: string, ms: number, start: () => void): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onError);
      resolve(ok);
    };
    const onOk = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), ms);
    el.addEventListener(event, onOk);
    el.addEventListener("error", onError);
    start();
  });
}

async function pdfPicture(data: ArrayBuffer): Promise<Blob | null> {
  let doc: Awaited<ReturnType<typeof openPdf>> | null = null;
  try {
    doc = await openPdf(data);
  } catch {
    return null;
  }
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = LONG_SIDE / Math.max(base.width, base.height, 1);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport: vp, annotationMode: 1 } as unknown as Parameters<typeof page.render>[0]).promise;
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85));
  } finally {
    closePdf(doc);
  }
}

async function drawingPicture(data: ArrayBuffer, name: string): Promise<Blob | null> {
  const engine = await import("@/features/dwg/engine");
  const release = await engine.takeEngine();
  try {
    try {
      await engine.openDrawing(data, name);
    } catch (e) {
      if (e instanceof engine.DrawingError) return null;
      throw e;
    }
    await engine.whenDrawn(20_000);
    return await engine.previewPicture(false);
  } finally {
    await engine.closeDrawing();
    release();
  }
}
