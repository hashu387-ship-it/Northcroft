// The page manager: rotate, reorder and remove pages, add blank pages, join other PDFs,
// and download chosen pages as their own PDF.
import { useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, FilePlus2, Plus, RotateCcw, RotateCw, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui";
import { makeView } from "./geom";
import { uid, type Slot } from "./model";
import type { PDFPage } from "./pdfjs";
import { Thumb } from "./Thumb";

export function PagesPanel({
  slots,
  pageOf,
  metaOf,
  onChange,
  hasMarks,
  onAddPdfs,
  onExtract,
  onOpen,
}: {
  slots: Slot[];
  pageOf: (s: Slot) => PDFPage | null;
  metaOf: (s: Slot) => { view: number[]; rotate: number };
  onChange: (slots: Slot[]) => void;
  hasMarks: (id: string) => boolean;
  onAddPdfs: (files: FileList | null, after: number) => void;
  onExtract: (ids: string[]) => void;
  onOpen: (id: string) => void;
}) {
  const confirm = useConfirm();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chosen = slots.filter((s) => picked.has(s.id));
  const lastPicked = chosen.length ? slots.indexOf(chosen[chosen.length - 1]) : slots.length - 1;

  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function rotate(ids: string[], by: number) {
    onChange(slots.map((s) => (ids.includes(s.id) ? { ...s, rotate: (((s.rotate + by) % 360) + 360) % 360 } : s)));
  }

  function move(id: string, by: number) {
    const i = slots.findIndex((s) => s.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= slots.length) return;
    const next = [...slots];
    const [s] = next.splice(i, 1);
    next.splice(j, 0, s);
    onChange(next);
  }

  function moveTo(id: string, target: string) {
    if (id === target) return;
    const next = slots.filter((s) => s.id !== id);
    const j = next.findIndex((s) => s.id === target);
    const s = slots.find((x) => x.id === id)!;
    next.splice(j < 0 ? next.length : j, 0, s);
    onChange(next);
  }

  async function remove(ids: string[]) {
    if (ids.length >= slots.length) {
      await confirm({ title: "A PDF needs at least one page", message: "Keep at least one page, or add another before removing this one.", confirmLabel: "OK" });
      return;
    }
    const marked = ids.some(hasMarks);
    const ok = await confirm({
      title: ids.length === 1 ? "Remove this page?" : `Remove ${ids.length} pages?`,
      message: marked ? "Anything you've drawn or written on them goes too. The original file keeps every page." : "The original file keeps every page.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    onChange(slots.filter((s) => !ids.includes(s.id)));
    setPicked(new Set());
  }

  function addBlank() {
    const after = slots[lastPicked] ?? slots[slots.length - 1];
    let size: [number, number] = [595.28, 841.89];
    if (after) {
      const m = metaOf(after);
      const v = makeView(m.view, 1, m.rotate + after.rotate);
      size = [v.width, v.height];
    }
    const next = [...slots];
    next.splice(lastPicked + 1, 0, { id: uid("p"), doc: "blank", index: -1, rotate: 0, size });
    onChange(next);
  }

  return (
    <div className="pdf-pagesmgr">
      <div className="pdf-pagesbar">
        <button type="button" className="btn small" onClick={addBlank}>
          <Plus /> Blank page
        </button>
        <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
          <FilePlus2 /> Add pages from another PDF
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            onAddPdfs(e.target.files, lastPicked);
            e.target.value = "";
          }}
        />
        {chosen.length > 0 && (
          <span className="pdf-pagesbar-sel">
            <span className="small muted">{chosen.length} chosen</span>
            <button type="button" className="icon-btn small" onClick={() => rotate([...picked], -90)} aria-label="Rotate chosen pages left" title="Rotate left">
              <RotateCcw />
            </button>
            <button type="button" className="icon-btn small" onClick={() => rotate([...picked], 90)} aria-label="Rotate chosen pages right" title="Rotate right">
              <RotateCw />
            </button>
            <button type="button" className="btn small" onClick={() => onExtract(chosen.map((s) => s.id))}>
              <Download /> Download as a PDF
            </button>
            <button type="button" className="btn small danger" onClick={() => remove([...picked])}>
              <Trash2 /> Remove
            </button>
            <button type="button" className="btn small ghost" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </span>
        )}
      </div>
      <p className="small muted pdf-pages-tip">Rotate, move or remove pages, add blank pages, or join other PDFs. Tap a page to choose it; on a computer you can also drag pages into order.</p>
      <div className="pdf-grid">
        {slots.map((s, i) => (
          <div
            key={s.id}
            className={`pdf-gridcell${picked.has(s.id) ? " on" : ""}${dragging === s.id ? " dragging" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragging(s.id);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", s.id);
            }}
            onDragEnd={() => setDragging(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              if (id) moveTo(id, s.id);
              setDragging(null);
            }}
          >
            <button type="button" className="pdf-gridpage" onClick={() => toggle(s.id)} onDoubleClick={() => onOpen(s.id)} aria-pressed={picked.has(s.id)} aria-label={`Page ${i + 1}`}>
              <Thumb page={pageOf(s)} meta={metaOf(s)} rotate={s.rotate} width={132} />
              {s.index < 0 && <span className="pdf-tag">Blank</span>}
              {s.doc !== "main" && s.index >= 0 && <span className="pdf-tag">Added</span>}
            </button>
            <div className="pdf-gridfoot">
              <b>{i + 1}</b>
              <span className="pdf-gridacts">
                <button type="button" className="icon-btn small plain" onClick={() => move(s.id, -1)} disabled={i === 0} aria-label="Move earlier" title="Move earlier">
                  <ArrowLeft className="wide-only" />
                  <ArrowUp className="narrow-only" />
                </button>
                <button type="button" className="icon-btn small plain" onClick={() => move(s.id, 1)} disabled={i === slots.length - 1} aria-label="Move later" title="Move later">
                  <ArrowRight className="wide-only" />
                  <ArrowDown className="narrow-only" />
                </button>
                <button type="button" className="icon-btn small plain" onClick={() => rotate([s.id], 90)} aria-label="Rotate right" title="Rotate">
                  <RotateCw />
                </button>
                <button type="button" className="icon-btn small plain" onClick={() => remove([s.id])} aria-label="Remove page" title="Remove">
                  <Trash2 />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
