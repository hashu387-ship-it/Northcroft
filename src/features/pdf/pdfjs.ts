// pdf.js, loaded only when a PDF is opened. The "legacy" build runs on older phones too
// (iPhone iOS 16.4 and up), and its worker does the heavy lifting off the main thread.
import type * as PdfJs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

export type PdfJsLib = typeof PdfJs;
export type PDFDoc = PdfJs.PDFDocumentProxy;
export type PDFPage = PdfJs.PDFPageProxy;

// pdf.js's own data files: character maps for Asian scripts, the 14 standard fonts for files that
// don't include them, and decoders for JPEG 2000 and JBIG2 scans. They're only downloaded when a
// file needs them.
const files: Record<string, () => Promise<string>> = {
  ...import.meta.glob("/node_modules/pdfjs-dist/cmaps/*.bcmap", { query: "?url", import: "default" }),
  ...import.meta.glob("/node_modules/pdfjs-dist/standard_fonts/*", { query: "?url", import: "default" }),
  ...import.meta.glob("/node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms}*.{wasm,js}", { query: "?url", import: "default" }),
} as Record<string, () => Promise<string>>;

const folder: Record<string, string> = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" };

class AppDataFactory {
  constructor(_opts: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const load = files[`/node_modules/pdfjs-dist/${folder[kind]}/${filename}`];
    if (!load) throw new Error(`Missing PDF data file ${filename}`);
    const res = await fetch(await load());
    if (!res.ok) throw new Error(`Couldn't load ${filename}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

let lib: Promise<PdfJsLib> | null = null;

export function loadPdfJs(): Promise<PdfJsLib> {
  if (!lib) {
    lib = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      const pdfjs = m as unknown as PdfJsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    });
  }
  return lib;
}

export async function openPdf(data: ArrayBuffer | Uint8Array, password?: string): Promise<PDFDoc> {
  const pdfjs = await loadPdfJs();
  // pdf.js takes ownership of the bytes it's given, so it gets its own copy.
  const copy = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  return pdfjs.getDocument({
    data: copy,
    password,
    useWorkerFetch: false,
    BinaryDataFactory: AppDataFactory,
    // Truthy placeholders: the factory above finds the real files.
    cMapUrl: "pdfjs/cmaps/",
    standardFontDataUrl: "pdfjs/standard_fonts/",
    wasmUrl: "pdfjs/wasm/",
    cMapPacked: true,
    enableXfa: false,
    // Font names and styles, so retyped text can match the original (bold, serif, monospace).
    fontExtraProperties: true,
  }).promise;
}

/** Close a document and free its memory. */
export function closePdf(doc: PDFDoc | null | undefined) {
  if (doc) void doc.loadingTask.destroy().catch(() => {});
}
