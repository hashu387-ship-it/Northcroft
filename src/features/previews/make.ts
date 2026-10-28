// Makes the preview picture for a PDF (its first page) or a drawing (the sheet it opens on, black
// on white). Loaded only when a preview is being made; see src/lib/previews.ts.
import { closePdf, openPdf } from "@/features/pdf/pdfjs";

const LONG_SIDE = 1400;

/** A JPEG of the file, or null when it can't be drawn (damaged, password, unreadable drawing). */
export async function makePreview(kind: "pdf" | "drawing", data: ArrayBuffer, name: string): Promise<Blob | null> {
  return kind === "pdf" ? pdfPicture(data) : drawingPicture(data, name);
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
