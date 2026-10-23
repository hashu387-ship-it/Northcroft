// One page: the rendered PDF, the marks drawn over it, and everything you can do with a finger,
// pen or mouse on it.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPE } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { apply, bounds, boxLocal, dist, mul, type Mat, type View } from "./geom";
import type { DocState, FieldValue, Obj, Pt, Slot, TextEdit } from "./model";
import { uid } from "./model";
import type { PDFPage } from "./pdfjs";
import { EditShape, ObjShape, ScreenLabels, boxMatrix, hits, moved, outline, FONT_STACK } from "./render";
import { LINE, textHeight, textPad, wrap } from "./text";
import type { EditorApi, FindHit, MeasureDraft, Pending, Style, TextRun, Tool, Widget } from "./types";
import { isDrawTool, isMeasureTool } from "./types";

const css = (m: Mat) => `matrix(${m.map((v) => +v.toFixed(5)).join(",")})`;
const PALETTE = ["#e8343e", "#0b1d46", "#007aff", "#28a745", "#e67e00", "#111111"];

export interface PageProps {
  slot: Slot;
  number: number;
  view: View;
  page: PDFPage | null;
  visible: boolean;
  keepCanvas: boolean;
  objects: Obj[];
  edits: TextEdit[];
  mpp?: number;
  tool: Tool;
  style: Style;
  selectedId: string | null;
  editingId: string | null;
  runs: TextRun[] | null;
  widgets: Widget[] | null;
  forms: Record<string, FieldValue>;
  hits: FindHit[];
  currentHit: FindHit | null;
  draft: MeasureDraft | null;
  runEdit: { run: TextRun; value: string } | null;
  setRunEditValue: (v: string) => void;
  commitRunEdit: (cancel?: boolean) => void;
  pending: Pending | null;
  locked: boolean;
  api: EditorApi;
  register: (slot: string, el: HTMLDivElement | null) => void;
}

function PageViewImpl(p: PageProps) {
  const { slot, view, page, api } = p;
  const box = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);
  const [draft, setDraft] = useState<Obj | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const gesture = useRef<{ kind: string; start: Pt; base: Obj; pointer: number } | null>(null);

  useEffect(() => {
    p.register(slot.id, box.current);
    return () => p.register(slot.id, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot.id]);

  // ---- render the page picture (only while it's on or near the screen)
  useEffect(() => {
    if (!page || !p.visible) return;
    let cancelled = false;
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    const timer = window.setTimeout(
      async () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        const wPt = view.width / view.scale;
        const hPt = view.height / view.scale;
        const small = window.matchMedia("(max-width: 899px)").matches;
        const maxPixels = small ? 7e6 : 16e6;
        let rs = view.scale * dpr;
        rs = Math.min(rs, Math.sqrt(maxPixels / (wPt * hPt)), 8192 / Math.max(wPt, hPt));
        const vp = page.getViewport({ scale: rs, rotation: view.rotation });
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.floor(vp.width));
        c.height = Math.max(1, Math.floor(vp.height));
        c.className = "pdf-canvas";
        try {
          task = page.render({ canvas: c, viewport: vp, annotationMode: 2 }) as unknown as typeof task;
          await task!.promise;
        } catch {
          return;
        }
        if (cancelled || !host.current) return;
        host.current.replaceChildren(c);
        canvas.current = c;
        setRendered(true);
      },
      canvas.current ? 140 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [page, p.visible, view.scale, view.rotation, view.width, view.height]);

  // Far off screen in a long document: let the picture go to save memory.
  useEffect(() => {
    if (p.visible || p.keepCanvas || !canvas.current) return;
    const t = window.setTimeout(() => {
      host.current?.replaceChildren();
      canvas.current = null;
      setRendered(false);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [p.visible, p.keepCanvas]);

  // ---- pointer helpers
  const toPage = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect();
    return apply(view.inv, [e.clientX - r.left, e.clientY - r.top]);
  };
  const tolPt = (px: number) => px / view.scale;

  const selected = useMemo(() => p.objects.find((o) => o.id === p.selectedId) ?? null, [p.objects, p.selectedId]);
  const drawing = isDrawTool(p.tool) || isMeasureTool(p.tool) || p.tool === "place";

  function topHit(at: Pt): Obj | null {
    for (let i = p.objects.length - 1; i >= 0; i--) if (hits(p.objects[i], at, tolPt(8))) return p.objects[i];
    return null;
  }

  function onDown(e: RPE<HTMLDivElement>) {
    if (p.locked || e.button > 0) return;
    const at = toPage(e);
    const t = p.tool;
    if (t === "select") {
      if (e.pointerType !== "mouse") return; // fingers: a tap selects (see onClick), dragging scrolls
      const o = topHit(at);
      api.select(o ? { slot: slot.id, id: o.id } : null);
      if (o) startGesture(e, "move", o, at);
      return;
    }
    if (!drawing) return;
    // No pretend mouse events after a touch (see onTouchEnd), and no text selection while drawing.
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (t === "pen" || t === "highlighter") {
      setDraft({
        id: uid(),
        type: "ink",
        tool: t,
        points: [at],
        color: t === "highlighter" ? p.style.highlight : p.style.color,
        width: t === "highlighter" ? Math.max(10, p.style.width * 5) : p.style.width,
      });
    } else if (t === "line" || t === "arrow") {
      setDraft({ id: uid(), type: "line", arrow: t === "arrow", a: at, b: at, color: p.style.color, width: p.style.width });
    } else if (t === "rect" || t === "ellipse" || t === "cloud") {
      setDraft({ id: uid(), type: "shape", shape: t, a: at, b: at, color: p.style.color, width: p.style.width });
    } else if (t === "text" || t === "note") {
      setDraft({ id: "textdraft", type: "shape", shape: "rect", a: at, b: at, color: "#007aff", width: 0.6 });
    }
  }

  function onMove(e: RPE<HTMLDivElement>) {
    if (gesture.current) {
      gestureMove(e);
      return;
    }
    const at = toPage(e);
    if (isMeasureTool(p.tool)) setHover(at);
    if (!draft) return;
    if (draft.type === "ink") {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      const pts = [...draft.points];
      for (const ev of events) {
        const q = toPage(ev);
        if (dist(q, pts[pts.length - 1]) >= tolPt(1.2)) pts.push(q);
      }
      setDraft({ ...draft, points: pts });
    } else if (draft.type === "line" || draft.type === "shape") {
      let b = at;
      if (e.shiftKey && draft.type === "line") {
        // Shift keeps lines straight: horizontal, vertical or at 45 degrees.
        const dx = at[0] - draft.a[0];
        const dy = at[1] - draft.a[1];
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        b = [draft.a[0] + len * Math.cos(ang), draft.a[1] + len * Math.sin(ang)];
      }
      setDraft({ ...draft, b });
    }
  }

  function onUp(e: RPE<HTMLDivElement>) {
    if (gesture.current) {
      gestureEnd(e);
      return;
    }
    const at = toPage(e);
    const t = p.tool;
    if (isMeasureTool(t)) {
      api.measureTap(slot.id, at);
      return;
    }
    if (t === "place") {
      api.placePending(slot.id, at, view);
      return;
    }
    const d = draft;
    setDraft(null);
    if (!d) return;
    if (d.id === "textdraft" && d.type === "shape") {
      // Text box: a tap gives a standard width, dragging sets it.
      const wide = Math.abs(d.b[0] - d.a[0]) > tolPt(20) || Math.abs(d.b[1] - d.a[1]) > tolPt(20);
      const r = box.current!.getBoundingClientRect();
      const s0 = apply(view.t, d.a);
      const s1 = apply(view.t, d.b);
      const left = Math.min(s0[0], s1[0]);
      const top = Math.min(s0[1], s1[1]);
      const widthPx = wide ? Math.abs(s1[0] - s0[0]) : Math.min(220 * view.scale, r.width - left - 8);
      const o = apply(view.inv, [left, top]);
      const right = apply(view.inv, [left + 1, top]);
      const angle = Math.atan2(right[1] - o[1], right[0] - o[0]);
      const w = Math.max(40, widthPx / view.scale);
      const note = t === "note";
      api.addObject(
        slot.id,
        {
          id: uid(),
          type: "text",
          o,
          angle,
          w,
          h: textHeight(1, p.style.textSize, note),
          text: "",
          size: p.style.textSize,
          color: note ? "#3b3200" : p.style.color,
          bold: p.style.bold,
          note,
        },
        true,
      );
      return;
    }
    if (d.type === "ink") {
      if (d.points.length === 1) d.points.push([d.points[0][0] + 0.01, d.points[0][1]]);
      api.addObject(slot.id, d);
    } else if (d.type === "line" || d.type === "shape") {
      if (dist(d.a, d.b) < tolPt(4)) return;
      api.addObject(slot.id, d);
    }
  }

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (p.tool !== "select" || p.locked) return;
    const at = toPage(e);
    const o = topHit(at);
    api.select(o ? { slot: slot.id, id: o.id } : null);
  }

  function onDouble(e: React.MouseEvent<HTMLDivElement>) {
    if (isMeasureTool(p.tool)) {
      api.measureFinish();
      return;
    }
    if (p.tool === "select") {
      const o = topHit(toPage(e));
      if (o?.type === "text") api.editText(o.id);
    }
  }

  // ---- moving and resizing the selected mark
  function startGesture(e: RPE<HTMLElement>, kind: string, base: Obj, at?: Pt) {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    api.beginGesture();
    gesture.current = { kind, start: at ?? toPage(e), base, pointer: e.pointerId };
  }

  function gestureMove(e: RPE<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    const at = toPage(e);
    const dx = at[0] - g.start[0];
    const dy = at[1] - g.start[1];
    let next: Obj = g.base;
    const b = g.base;
    if (g.kind === "move") next = moved(b, dx, dy);
    else if (g.kind === "a" && b.type === "line") next = { ...b, a: at };
    else if (g.kind === "b" && b.type === "line") next = { ...b, b: at };
    else if (g.kind === "resize") {
      if (b.type === "shape") next = { ...b, b: at };
      else if (b.type === "text") {
        const [lx] = boxLocal(b, at);
        const w = Math.max(30, lx);
        const pad = textPad(b.note);
        const lines = wrap(b.text || " ", b.size, b.bold, w - pad * 2).length;
        next = { ...b, w, h: textHeight(lines, b.size, b.note) };
      } else if (b.type === "image" || b.type === "stamp") {
        const [lx] = boxLocal(b, at);
        const w = Math.max(16, lx);
        next = { ...b, w, h: (w * b.h) / b.w };
      }
    }
    const s = api.get();
    api.preview({ ...s, objects: { ...s.objects, [slot.id]: (s.objects[slot.id] ?? []).map((o) => (o.id === b.id ? next : o)) } });
  }

  function gestureEnd(e: RPE<HTMLElement>) {
    if (!gesture.current || gesture.current.pointer !== e.pointerId) return;
    gesture.current = null;
    api.endGesture();
  }

  function setObj(next: Obj) {
    const s = api.get();
    api.commit({ ...s, objects: { ...s.objects, [slot.id]: (s.objects[slot.id] ?? []).map((o) => (o.id === next.id ? next : o)) } });
  }

  function removeObj(id: string) {
    const s = api.get();
    api.commit({ ...s, objects: { ...s.objects, [slot.id]: (s.objects[slot.id] ?? []).filter((o) => o.id !== id) } });
    api.select(null);
  }

  const frame = selected && p.tool === "select" ? frameFor(selected, view) : null;
  const editing = p.objects.find((o) => o.id === p.editingId && o.type === "text") as Extract<Obj, { type: "text" }> | undefined;

  const layerStyle: CSSProperties = {
    cursor: p.tool === "select" ? "default" : drawing ? (p.tool === "text" || p.tool === "note" ? "text" : "crosshair") : "auto",
    touchAction: drawing ? "none" : "pan-x pan-y",
    pointerEvents: p.tool === "none" || p.tool === "edittext" || p.locked ? "none" : "auto",
  };

  return (
    <div
      ref={box}
      className="pdf-page"
      data-slot={slot.id}
      data-number={p.number}
      style={{ width: view.width, height: view.height }}
      aria-label={`Page ${p.number}`}
    >
      <div ref={host} className="pdf-canvas-host" />
      {!page && <div className="pdf-blank" />}
      {page && !rendered && <div className="pdf-page-loading" aria-hidden />}

      <svg className="pdf-svg" width={view.width} height={view.height} viewBox={`0 0 ${view.width} ${view.height}`} aria-hidden>
        <g transform={`matrix(${view.t.join(" ")})`}>
          {p.edits.map((e) => (
            <EditShape key={e.id} e={e} />
          ))}
          {p.objects.map((o) => (o.id === p.editingId ? null : <ObjShape key={o.id} o={o} mpp={p.mpp} />))}
          {draft && <ObjShape o={draft} />}
          {p.draft && p.draft.slot === slot.id && <DraftShape draft={p.draft} hover={hover} />}
          {p.hits.map((h, i) => (
            <HitMark key={i} h={h} current={p.currentHit === h} />
          ))}
        </g>
        <ScreenLabels objects={p.objects} view={view} mpp={p.mpp} />
      </svg>

      {p.tool === "edittext" && p.runs && (
        <div className="pdf-runs">
          {p.runs.map((r) => {
            const rb = runScreenBox(r, view);
            const done = p.edits.some((e) => e.run.m.join() === r.m.join());
            return (
              <button
                key={r.key}
                type="button"
                className={`pdf-run${done ? " done" : ""}`}
                style={{ left: rb[0], top: rb[1], width: rb[2] - rb[0], height: rb[3] - rb[1] }}
                title="Change this text"
                aria-label={`Change "${r.str}"`}
                onClick={() => api.startRunEdit(slot.id, r, view, canvas.current, box.current!.getBoundingClientRect())}
              />
            );
          })}
        </div>
      )}

      {p.widgets && p.widgets.length > 0 && (
        <div className="pdf-forms" style={{ pointerEvents: drawing ? "none" : undefined }}>
          {p.widgets.map((w) => (
            <FormField key={w.id} w={w} view={view} value={p.forms[w.name] ?? w.value} locked={p.locked} onChange={(v) => api.setField(w.name, v)} />
          ))}
        </div>
      )}

      <div
        className="pdf-layer"
        style={layerStyle}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setDraft(null)}
        // After a finger tap the browser sends a pretend mouse click. While drawing, measuring or
        // placing, that click would land on whatever the tap just opened (a dialog, a button), so stop it.
        onTouchEnd={(e) => {
          if (drawing && e.cancelable) e.preventDefault();
        }}
        onClick={onClick}
        onDoubleClick={onDouble}
      />

      {frame && selected && (
        <>
          <div
            className="pdf-frame"
            style={{ left: frame[0], top: frame[1], width: frame[2] - frame[0], height: frame[3] - frame[1] }}
            onPointerDown={(e) => startGesture(e, "move", selected)}
            onPointerMove={gestureMove}
            onPointerUp={gestureEnd}
            onPointerCancel={gestureEnd}
            onDoubleClick={() => selected.type === "text" && api.editText(selected.id)}
          >
            {(selected.type === "shape" || selected.type === "text" || selected.type === "image" || selected.type === "stamp") && (
              <span
                className="pdf-handle br"
                onPointerDown={(e) => startGesture(e, "resize", selected)}
                onPointerMove={gestureMove}
                onPointerUp={gestureEnd}
                onPointerCancel={gestureEnd}
                aria-label="Resize"
              />
            )}
          </div>
          {selected.type === "line" &&
            (["a", "b"] as const).map((k) => {
              const q = apply(view.t, selected[k]);
              return (
                <span
                  key={k}
                  className="pdf-handle end"
                  style={{ left: q[0], top: q[1] }}
                  onPointerDown={(e) => startGesture(e, k, selected)}
                  onPointerMove={gestureMove}
                  onPointerUp={gestureEnd}
                  onPointerCancel={gestureEnd}
                  aria-label={k === "a" ? "Move the start" : "Move the end"}
                />
              );
            })}
          <div className="pdf-mini glass-strong" style={{ left: Math.max(4, frame[0]), top: frame[1] > 52 ? frame[1] - 46 : frame[3] + 8 }}>
            {"color" in selected && selected.type !== "stamp" && !(selected.type === "text" && selected.note) && (
              <span className="pdf-mini-colors">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`pdf-dot${"color" in selected && selected.color === c ? " on" : ""}`}
                    style={{ background: c }}
                    aria-label="Colour"
                    onClick={() => setObj({ ...selected, color: c } as Obj)}
                  />
                ))}
              </span>
            )}
            {selected.type === "text" && (
              <button type="button" className="icon-btn small plain" aria-label="Edit text" title="Edit text" onClick={() => api.editText(selected.id)}>
                <Pencil />
              </button>
            )}
            <button type="button" className="icon-btn small plain" aria-label="Remove" title="Remove" onClick={() => removeObj(selected.id)}>
              <Trash2 />
            </button>
          </div>
        </>
      )}

      {editing && <TextBoxEditor o={editing} view={view} api={api} slotId={slot.id} />}
      {p.runEdit && <RunEditor run={p.runEdit.run} value={p.runEdit.value} view={view} onChange={p.setRunEditValue} onDone={p.commitRunEdit} />}
    </div>
  );
}

export const PageView = memo(PageViewImpl);

/* ---------------------------------------------------------------- pieces */
function frameFor(o: Obj, view: View): [number, number, number, number] {
  const pts = outline(o).map((q) => apply(view.t, q));
  const [x1, y1, x2, y2] = bounds(pts);
  const pad = o.type === "ink" || o.type === "line" || o.type === "measure" ? 8 : 3;
  return [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
}

export function runScreenBox(r: TextRun, view: View): [number, number, number, number] {
  const [a, b, c, d, x, y] = r.m;
  const lx = Math.hypot(a, b) || 1;
  const ly = Math.hypot(c, d) || 1;
  const at = (u: number, v: number): Pt => apply(view.t, [x + (a / lx) * u + (c / ly) * v, y + (b / lx) * u + (d / ly) * v]);
  const top = Math.max(r.ascent, 0.75) * ly;
  const bottom = Math.min(r.descent, -0.2) * ly;
  return bounds([at(0, bottom), at(r.width, bottom), at(r.width, top), at(0, top)]);
}

function DraftShape({ draft, hover }: { draft: MeasureDraft; hover: Pt | null }) {
  const pts = hover && draft.kind !== "count" ? [...draft.points, hover] : draft.points;
  const color = draft.kind === "calibrate" ? "#e67e00" : "#007aff";
  return (
    <>
      {pts.length > 1 && (
        <path
          d={`M ${pts.map((q) => `${q[0]} ${q[1]}`).join(" L ")}${draft.kind === "area" && pts.length > 2 ? " Z" : ""}`}
          stroke={color}
          strokeWidth={1.4}
          strokeDasharray="4 3"
          fill={draft.kind === "area" ? color : "none"}
          fillOpacity={0.1}
        />
      )}
      {draft.points.map((q, i) => (
        <circle key={i} cx={q[0]} cy={q[1]} r={draft.kind === "count" ? 6 : 2.4} fill={color} />
      ))}
    </>
  );
}

function HitMark({ h, current }: { h: FindHit; current: boolean }) {
  const r = h.run;
  const [a, b, c, d, x, y] = r.m;
  const lx = Math.hypot(a, b) || 1;
  const ly = Math.hypot(c, d) || 1;
  const n = Math.max(1, r.str.length);
  const u0 = (r.width * h.start) / n;
  const u1 = (r.width * (h.start + h.len)) / n;
  const at = (u: number, v: number) => `${x + (a / lx) * u + (c / ly) * v},${y + (b / lx) * u + (d / ly) * v}`;
  const top = Math.max(r.ascent, 0.75) * ly;
  const bottom = Math.min(r.descent, -0.2) * ly;
  return (
    <polygon
      points={`${at(u0, bottom)} ${at(u1, bottom)} ${at(u1, top)} ${at(u0, top)}`}
      fill={current ? "#ff9f0a" : "#ffd60a"}
      fillOpacity={current ? 0.55 : 0.4}
    />
  );
}

/** Typing into a text box or sticky note, right where it sits on the page. */
function TextBoxEditor({ o, view, api, slotId }: { o: Extract<Obj, { type: "text" }>; view: View; api: EditorApi; slotId: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(o.text);
  const m = mul(boxMatrix(o), view.t);
  useLayoutEffect(() => {
    ref.current?.focus();
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
  }, []);
  const pad = textPad(o.note);
  const lines = wrap(value || " ", o.size, o.bold, Math.max(4, o.w - pad * 2)).length;

  function done() {
    const s = api.get();
    const list = s.objects[slotId] ?? [];
    const text = value.replace(/\s+$/, "");
    const next = text
      ? list.map((x) => (x.id === o.id ? { ...o, text, h: textHeight(wrap(text, o.size, o.bold, Math.max(4, o.w - pad * 2)).length, o.size, o.note) } : x))
      : list.filter((x) => x.id !== o.id);
    // The first words typed into a new box belong to the same undo step as creating it.
    if (o.text === "") api.preview({ ...s, objects: { ...s.objects, [slotId]: next } });
    else api.commit({ ...s, objects: { ...s.objects, [slotId]: next } });
    api.editText(null);
    if (!text) api.select(null);
  }

  return (
    <textarea
      ref={ref}
      className={`pdf-textedit${o.note ? " note" : ""}`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
        e.stopPropagation();
      }}
      placeholder={o.note ? "Write a note" : "Type here"}
      aria-label={o.note ? "Note text" : "Text"}
      style={{
        width: o.w,
        height: textHeight(lines, o.size, o.note),
        transform: css(m),
        fontSize: o.size,
        lineHeight: LINE,
        padding: pad,
        fontWeight: o.bold ? 700 : 400,
        color: o.color,
        fontFamily: FONT_STACK,
      }}
    />
  );
}

/** Retyping a run of the file's own text in place. */
function RunEditor({ run, value, view, onChange, onDone }: { run: TextRun; value: string; view: View; onChange: (v: string) => void; onDone: (cancel?: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [a, b, c, d, x, y] = run.m;
  const size = Math.hypot(c, d) || 10;
  const lx = Math.hypot(a, b) || 1;
  const m = mul([a / lx, b / lx, -c / size, -d / size, x, y], view.t);
  const top = Math.max(run.ascent, 0.78) * size + 2;
  const height = top + -Math.min(run.descent, -0.22) * size + 2;
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="pdf-runedit"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onDone()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onDone();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onDone(true);
        }
      }}
      aria-label="New text"
      style={{
        transform: css(m),
        left: 0,
        top: 0,
        marginLeft: -2,
        marginTop: -top,
        height,
        minWidth: Math.max(run.width + 24, 60),
        width: Math.max(run.width + 24, value.length * size * 0.6 + 24),
        fontSize: size,
        fontFamily: FONT_STACK,
      }}
    />
  );
}

function FormField({ w, view, value, onChange, locked }: { w: Widget; view: View; value: FieldValue; onChange: (v: FieldValue) => void; locked: boolean }) {
  const [x1, y1, x2, y2] = w.rect;
  const pts = [apply(view.t, [x1, y1]), apply(view.t, [x2, y2])];
  const [l, t, r, b] = bounds(pts);
  const h = b - t;
  const style: CSSProperties = { left: l, top: t, width: r - l, height: h, fontSize: Math.max(9, Math.min(h * 0.62, 18)) };
  const [text, setText] = useState(typeof value === "string" ? value : "");
  useEffect(() => setText(typeof value === "string" ? value : ""), [value]);
  const disabled = locked || w.readOnly;
  if (w.type === "checkbox") {
    return (
      <label className="pdf-field check" style={style} title={w.name}>
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={w.name} />
      </label>
    );
  }
  if (w.type === "radio") {
    return (
      <label className="pdf-field check round" style={style} title={w.name}>
        <input type="radio" name={`pdf-${w.name}`} checked={value === w.onValue} disabled={disabled} onChange={() => onChange(w.onValue ?? "")} aria-label={`${w.name} ${w.onValue ?? ""}`} />
      </label>
    );
  }
  if (w.type === "select" || w.type === "list") {
    return (
      <select
        className="pdf-field"
        style={style}
        disabled={disabled}
        multiple={w.multiple}
        value={w.multiple ? (Array.isArray(value) ? value : []) : typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : ""}
        onChange={(e) => onChange(w.multiple ? Array.from(e.target.selectedOptions, (o) => o.value) : e.target.value)}
        aria-label={w.name}
      >
        {!w.multiple && <option value="">{" "}</option>}
        {(w.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  const commit = () => text !== (typeof value === "string" ? value : "") && onChange(text);
  return w.multiline ? (
    <textarea className="pdf-field" style={style} value={text} disabled={disabled} maxLength={w.maxLen} onChange={(e) => setText(e.target.value)} onBlur={commit} aria-label={w.name} />
  ) : (
    <input
      className="pdf-field"
      style={style}
      value={text}
      disabled={disabled}
      maxLength={w.maxLen}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      aria-label={w.name}
    />
  );
}

export type { DocState };
