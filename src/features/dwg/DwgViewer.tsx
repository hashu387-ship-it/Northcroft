// The drawing screen: a DWG or DXF full screen, read-only. Pinch or scroll to zoom, drag to move
// around, Fit to see it all. Layers turn on and off, sheets (layouts) switch, and Black and white
// shows it like a print. The first time someone opens a drawing that has no list preview, this
// screen makes it (the drawing is already open, so it costs nothing extra).
import "./dwg.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Contrast, Download, Layers, Maximize, Search, X } from "lucide-react";
import { claimPreview, markPreviewFailed, savePreview } from "@/lib/previews";
import { Spinner } from "@/components/ui";
import type { EditorProps } from "@/features/files/editor";
import type { LayerRow, LayoutRow } from "./engine";

type Engine = typeof import("./engine");
type Phase = "waiting" | "opening" | "ready" | "failed";

const PAPER_KEY = "nc-dwg-paper";
const readPaper = () => {
  try {
    return localStorage.getItem(PAPER_KEY) === "1";
  } catch {
    return false;
  }
};

export default function DwgViewer({ attachment: a, data }: EditorProps) {
  const stage = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [layerList, setLayerList] = useState<LayerRow[]>([]);
  const [layoutList, setLayoutList] = useState<LayoutRow[]>([]);
  const [active, setActive] = useState("");
  const [paper, setPaper] = useState(readPaper);
  const paperRef = useRef(paper);
  paperRef.current = paper;
  const [panel, setPanel] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const session = { cancelled: false };
    let finish: (() => Promise<void>) | null = null;
    void (async () => {
      const engine = await import("./engine");
      engineRef.current = engine;
      const release = await engine.takeEngine();
      let stopLayers = () => {};
      let finished = false;
      finish = async () => {
        if (finished) return;
        finished = true;
        stopLayers();
        await engine.closeDrawing();
        engine.park();
        release();
      };
      if (session.cancelled || !stage.current) return void (await finish());
      setPhase("opening");
      // Opened while the canvas is still off screen, so the half-loaded drawing isn't repainted
      // over and over (much quicker on phones); then it's moved onto the screen and fitted.
      try {
        await engine.openDrawing(data, a.name);
      } catch {
        if (!a.preview) void markPreviewFailed(a).catch(() => undefined);
        if (!session.cancelled) setPhase("failed");
        return void (await finish());
      }
      if (session.cancelled || !stage.current) return void (await finish());
      engine.showIn(stage.current);
      engine.makeInteractive();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      engine.fitDrawing();
      engine.setPaperLook(paperRef.current);
      setLayerList(engine.layers());
      setLayoutList(engine.layouts());
      setActive(engine.activeLayout());
      stopLayers = engine.onLayersChange(() => setLayerList(engine.layers()));
      setPhase("ready");

      // The list preview, if this file still needs one.
      if (claimPreview(a)) {
        await engine.whenDrawn(15_000);
        if (session.cancelled) return;
        try {
          await savePreview(a, await engine.previewPicture(paperRef.current));
        } catch {
          // The list makes it another time.
        }
      }
    })();
    return () => {
      session.cancelled = true;
      if (finish) void finish();
    };
    // One drawing per screen: a different file or version opens a new one (the screen is keyed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePaper() {
    const next = !paper;
    setPaper(next);
    engineRef.current?.setPaperLook(next);
    try {
      localStorage.setItem(PAPER_KEY, next ? "1" : "0");
    } catch {
      // Not kept; fine.
    }
  }

  function pickLayout(id: string) {
    engineRef.current?.setLayout(id);
    setActive(engineRef.current?.activeLayout() ?? id);
    setLayerList(engineRef.current?.layers() ?? []);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([data], { type: a.mime || "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  const off = layerList.filter((l) => !l.on).length;
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? layerList.filter((l) => l.name.toLowerCase().includes(q)) : layerList;
  }, [layerList, filter]);
  const ready = phase === "ready";

  return (
    <div className="dwg-viewer">
      <div className="dwg-bar" role="toolbar" aria-label="Drawing">
        <button type="button" className="dwg-tool" onClick={() => engineRef.current?.fitDrawing()} disabled={!ready} title="See the whole drawing">
          <Maximize />
          <span>Fit</span>
        </button>
        {layoutList.length > 1 && (
          <label className="dwg-tool dwg-sheet" title="Model or a sheet">
            <span className="dwg-wide">Sheet</span>
            <select value={active} onChange={(e) => pickLayout(e.target.value)} disabled={!ready} aria-label="Model or sheet">
              {layoutList.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="spacer" />
        <button type="button" className={`dwg-tool${paper ? " on" : ""}`} onClick={togglePaper} disabled={!ready} aria-pressed={paper} title="Black lines on white, like a print">
          <Contrast />
          <span className="dwg-wide">Black and white</span>
        </button>
        <button
          type="button"
          className={`dwg-tool${panel ? " on" : ""}`}
          onClick={() => setPanel((v) => !v)}
          disabled={!ready || layerList.length === 0}
          aria-expanded={panel}
          title="Turn layers on and off"
        >
          <Layers />
          <span>Layers</span>
          {off > 0 && <i className="dwg-badge">{off} off</i>}
        </button>
      </div>

      <div className="dwg-main">
        <div className="dwg-stage" ref={stage} />

        {(phase === "waiting" || phase === "opening") && (
          <div className="file-loader dwg-cover" role="status">
            <Spinner size={28} />
            <div className="muted small">Opening the drawing...</div>
            <div className="faint tiny">The first drawing takes a little longer while the viewer loads.</div>
          </div>
        )}
        {phase === "failed" && (
          <div className="file-loader dwg-cover">
            <b>This drawing couldn't be opened in the app</b>
            <div className="muted small">It may be damaged, or saved in a way the viewer can't read yet. Download it to open it in AutoCAD.</div>
            <button className="btn" type="button" onClick={download}>
              <Download /> Download
            </button>
          </div>
        )}

        {panel && ready && (
          <aside className="dwg-layers" aria-label="Layers">
            <div className="dwg-layers-head">
              <b>Layers</b>
              <span className="faint small">
                {layerList.length - off} of {layerList.length} on
              </span>
              <span className="spacer" />
              <button type="button" className="icon-btn small plain" onClick={() => setPanel(false)} aria-label="Close layers">
                <X />
              </button>
            </div>
            <div className="dwg-layers-tools">
              {layerList.length > 10 && (
                <label className="dwg-find">
                  <Search />
                  <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a layer" aria-label="Find a layer" />
                </label>
              )}
              <button type="button" className="btn small" onClick={() => engineRef.current?.setAllLayersOn()} disabled={off === 0}>
                All on
              </button>
            </div>
            <ul className="dwg-layer-list">
              {shown.map((l) => (
                <li key={l.name} className={`dwg-layer${l.on ? "" : " off"}`}>
                  <span className="dwg-swatch" style={{ background: l.color }} aria-hidden />
                  <span className="dwg-layer-name">
                    {l.name}
                    {l.frozen && <span className="faint tiny"> · frozen in the drawing</span>}
                  </span>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={l.on}
                      onChange={(e) => engineRef.current?.setLayerOn(l.name, e.target.checked)}
                      aria-label={`Show layer ${l.name}`}
                    />
                    <span className="track" />
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="faint small dwg-none">No layer called that.</li>}
            </ul>
          </aside>
        )}
      </div>
    </div>
  );
}
