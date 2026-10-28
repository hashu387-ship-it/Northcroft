// The drawing engine behind the DWG viewer and drawing previews: mlightcad's CAD viewer (MIT),
// which draws lines, text, blocks, hatches and dimensions the way AutoCAD does, with zoom, pan,
// layers and layouts. DWG files are read by LibreDWG (GPL) in its own background worker, which
// loads its 11 MB engine from /cad/ only when a drawing is first opened. DXF needs no worker.
//
// The viewer is one per page, so the full-screen viewer and the preview maker take turns
// (`takeEngine`). Every drawing gets a brand-new engine, torn down completely when it's closed:
// nothing from one drawing can trip up the next, and the phone gets its memory back.
import "./dwg.css";
import { AcApDocManager, AcEdOpenMode } from "@mlightcad/cad-simple-viewer";
import { AcDbDatabaseConverterManager, AcDbFileType, acdbHostApplicationServices } from "@mlightcad/data-model";
import { AcDbLibreDwgConverter } from "@mlightcad/libredwg-converter";
import { FontManager } from "@mlightcad/mtext-renderer";
import { AcTrMTextRenderer } from "@mlightcad/three-renderer";

declare const __CAD_BASE__: string;

// Latin CAD fonts only (a few KB each). The viewer's default also loads two large Chinese fonts
// (7 MB) for every drawing, which this team's drawings don't need.
const TEXT_FONTS = ["simplex", "txt"];
const SYMBOL_FONTS = ["simplex", "amgdt"];
const OPEN_TIMEOUT_MS = 120_000;

export class DrawingError extends Error {}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

let mgr: AcApDocManager | null = null;
let host: HTMLDivElement | null = null;

// Closing a drawing while some of its text is still being laid out cancels that work, and the
// text worker reports each cancelled piece as "Renderer terminated". That's expected, not a fault.
let quietInstalled = false;
function quietShutdownNoise() {
  if (quietInstalled) return;
  quietInstalled = true;
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as { message?: unknown } | null | undefined;
    if (reason && reason.message === "Renderer terminated") e.preventDefault();
  });
}

function start(): AcApDocManager {
  if (mgr) return mgr;
  quietShutdownNoise();
  host = document.createElement("div");
  host.className = "dwg-host parked";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  const parser = `${__CAD_BASE__}libredwg-parser-worker.js`;
  // A new DWG reader for every engine too.
  AcDbDatabaseConverterManager.instance.register(
    AcDbFileType.DWG,
    new AcDbLibreDwgConverter({ convertByEntityType: false, useWorker: true, parserWorkerUrl: parser }),
  );
  const m = AcApDocManager.createInstance({
    container: host,
    autoResize: true,
    notificationCenter: false,
    builtinOpenFileDialog: false,
    disableExport: true,
    webworkerFileUrls: { dwgParser: parser, mtextRender: `${__CAD_BASE__}mtext-renderer-worker.js` },
  });
  if (!m) throw new DrawingError("The drawing viewer didn't start. Reload the app and try again.");
  FontManager.instance.setDefaultFonts(TEXT_FONTS);
  FontManager.instance.setSymbolFonts(SYMBOL_FONTS);
  void AcTrMTextRenderer.getInstance().setDefaultFonts(TEXT_FONTS);
  mgr = m;
  return m;
}

/* ---------------------------------------------------------------- taking turns */

let tail: Promise<void> = Promise.resolve();

/**
 * Wait for the engine to be free, then have it until `release` is called. The viewer keeps it
 * while it's open; the preview maker takes it for one drawing at a time.
 */
export function takeEngine(): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const turn = tail;
  tail = tail.then(() => held);
  return turn.then(() => {
    let done = false;
    return () => {
      if (!done) {
        done = true;
        release();
      }
    };
  });
}

/* ---------------------------------------------------------------- where the canvas is */

/** Show the drawing inside `el` (the viewer's stage). */
export function showIn(el: HTMLElement) {
  start();
  if (!host) return;
  host.classList.remove("parked");
  el.appendChild(host);
}

/** Put the canvas back off screen (it's taken away altogether when the drawing is closed). */
export function park() {
  if (!host) return;
  host.classList.add("parked");
  document.body.appendChild(host);
}

/* ---------------------------------------------------------------- opening and closing */

/**
 * Open a drawing read-only. `name` must end in .dwg or .dxf (that picks the reader). The bytes are
 * copied first: the reader hands them to its worker, which would leave the caller's copy empty.
 * Throws DrawingError when the file can't be read.
 */
export async function openDrawing(data: ArrayBuffer, name: string): Promise<void> {
  const m = start();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), OPEN_TIMEOUT_MS);
  });
  let ok = false;
  try {
    // No repainting of the half-loaded drawing while it opens (nobody sees it, the screen shows
    // "Opening the drawing" over it): opening is quicker, and slow phones never stall on it.
    ok = await Promise.race([m.openDocument(name, data.slice(0), { mode: AcEdOpenMode.Read, cooperativeYield: false }), timeout]);
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  if (!ok) throw new DrawingError("This drawing couldn't be read in the app.");
}

/**
 * Close the drawing: the whole engine is torn down (the drawing, its canvas and its background
 * workers) and the next drawing starts a new one. Never waits more than a few seconds, and gives
 * the browser a moment to finish tidying up before the next drawing is opened.
 */
export async function closeDrawing() {
  const m = mgr;
  const el = host;
  mgr = null;
  host = null;
  if (m) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      m.destroy().then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((r) => {
        timer = setTimeout(r, 5_000);
      }),
    ]);
    clearTimeout(timer);
  }
  el?.remove();
  await nextFrame();
  await new Promise((r) => setTimeout(r, 50));
}

/** After opening for the viewer: back to normal on-screen drawing (layers turned on later draw smoothly). */
export function makeInteractive() {
  if (mgr) mgr.curView.cooperativeYield = true;
}

/** Wait until everything (text, blocks, hatches) is drawn, up to `ms`. */
export async function whenDrawn(ms = 15_000): Promise<void> {
  if (!mgr) return;
  try {
    await mgr.curView.waitUntilIdle(ms);
  } catch {
    // Draw what's there.
  }
}

/* ---------------------------------------------------------------- the view */

/** Zoom to show the whole drawing (or the whole sheet in a layout). */
export function fitDrawing() {
  mgr?.curView.zoomToFitDrawing();
}

/** Black lines on white, like a print, instead of the drawing's own colours. */
export function setPaperLook(on: boolean) {
  mgr?.setReadingMode(on);
}

export interface LayerRow {
  name: string;
  on: boolean;
  frozen: boolean;
  /** The layer's colour as CSS. */
  color: string;
}

export function layers(): LayerRow[] {
  const store = mgr?.curDocument?.layerStore;
  if (!store) return [];
  return store
    .getLayers()
    .map((l) => ({ name: l.name, on: l.isOn, frozen: l.isFrozen, color: l.cssColor }))
    .sort((a, b) => (a.name === "0" ? -1 : b.name === "0" ? 1 : a.name.localeCompare(b.name, undefined, { numeric: true })));
}

export function setLayerOn(name: string, on: boolean) {
  mgr?.curDocument?.layerStore.setLayerOn(name, on);
}

export function setAllLayersOn() {
  mgr?.curDocument?.layerStore.setAllLayersOn();
}

/** Tell `fn` when layers change; returns the way to stop. */
export function onLayersChange(fn: () => void): () => void {
  const store = mgr?.curDocument?.layerStore;
  if (!store) return () => undefined;
  const listener = () => fn();
  store.events.changed.addEventListener(listener);
  return () => store.events.changed.removeEventListener(listener);
}

export interface LayoutRow {
  name: string;
  /** The layout's block record, which picks it. */
  id: string;
}

/** Model and the drawing's sheets (layouts), in tab order. */
export function layouts(): LayoutRow[] {
  const db = mgr?.curDocument?.database;
  if (!db) return [];
  return [...db.objects.layout.entries()]
    .map(([, l]) => l)
    .sort((a, b) => a.tabOrder - b.tabOrder)
    .map((l) => ({ name: l.layoutName, id: l.blockTableRecordId }));
}

export function activeLayout(): string {
  return mgr?.curView.activeLayoutBtrId ?? "";
}

export function setLayout(id: string) {
  const db = mgr?.curDocument?.database;
  if (!db) return;
  acdbHostApplicationServices().layoutManager.setCurrentLayoutBtrId(id, db);
}

/* ---------------------------------------------------------------- pictures */


/**
 * A JPEG of what the viewer shows now, at most `longSide` pixels across. The canvas is drawn and
 * copied in one go, before the browser clears it, so sheets come out with their viewports.
 */
export async function snapshot(longSide = 1400): Promise<Blob> {
  const m = start();
  const view = m.curView;
  await nextFrame();
  // The layout view manager draws the sheet and every viewport on it (no public way to do this).
  const v = view as unknown as { _layoutViewManager?: { render: (s: unknown) => void }; _scene?: unknown };
  v._layoutViewManager?.render(v._scene);
  const src = view.canvas;
  const scale = Math.min(1, longSide / Math.max(src.width, src.height, 1));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(src.width * scale));
  out.height = Math.max(1, Math.round(src.height * scale));
  const ctx = out.getContext("2d");
  if (!ctx) throw new DrawingError("Couldn't make a picture of the drawing.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0, out.width, out.height);
  view.isDirty = true;
  return new Promise<Blob>((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new DrawingError("Couldn't make a picture of the drawing."))), "image/jpeg", 0.85),
  );
}

/**
 * The preview picture for the list: the sheet the drawing opens on, black on white. Leaves the
 * viewer's own colours as they were.
 */
export async function previewPicture(paperBefore: boolean): Promise<Blob> {
  setPaperLook(true);
  await nextFrame();
  await whenDrawn(8_000);
  try {
    return await snapshot();
  } finally {
    setPaperLook(paperBefore);
  }
}
