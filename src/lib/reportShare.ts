// Print, download and send the weekly update report.
//   Print: the report alone, in a page of its own, so the app around it doesn't print.
//   Send: the phone's share menu with the PDF attached (WhatsApp, email, Teams...). Where there's no
//   share menu (most computers), the PDF downloads to attach by hand.
import { saveBlob } from "./vologExcel";

/** Prints the report element on its own, with the report's styles and fonts. */
export async function printReport(el: HTMLElement, css: string, title: string): Promise<void> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/</g, "&lt;")}</title><base href="${location.origin}/"><style>${css}</style><style>html,body{margin:0;background:#fff}</style></head><body>${el.outerHTML}</body></html>`;
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
  const win = frame.contentWindow!;
  const doc = frame.contentDocument!;
  // Wait for the fonts and the logo, so the printout looks like the screen.
  try {
    await doc.fonts?.ready;
    await Promise.all([...doc.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
  } catch {
    /* print anyway */
  }
  const done = () => window.setTimeout(() => frame.remove(), 1000);
  win.addEventListener("afterprint", done, { once: true });
  window.setTimeout(() => frame.isConnected && frame.remove(), 120_000);
  win.focus();
  win.print();
}

export type SendResult = "shared" | "saved" | "cancelled";

/** Opens the share menu with the PDF; where there isn't one, saves the PDF instead. */
export async function sendPdf(blob: Blob, name: string, title: string): Promise<SendResult> {
  const file = new File([blob], name, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
      // Not allowed here (for example the tap was too long ago): save it instead.
    }
  }
  saveBlob(blob, name);
  return "saved";
}

export function downloadPdf(blob: Blob, name: string) {
  saveBlob(blob, name);
}
