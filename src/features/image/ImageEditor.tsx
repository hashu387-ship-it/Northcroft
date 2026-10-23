// Photo viewer and mark-up: full screen, pinch or wheel to zoom, swipe between photos, turn the
// photo, and draw arrows, boxes, circles, lines, freehand and text labels on site photos.
// "Save as new version" keeps the original untouched (see FileView).
import "./image.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  Circle,
  Eye,
  ImageOff,
  Maximize,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui";
import { errorMessage } from "@/lib/supabase";
import type { EditorProps } from "@/features/files/editor";
import {
  COLORS,
  TEXT_SIZES,
  WIDTHS,
  bounds,
  drawMark,
  drawPhoto,
  moved,
  outSize,
  outputType,
  pick,
  renderOut,
  turnMarks,
  uid,
  unitFor,
  type Mark,
  type Pt,
  type Rotation,
  type Scene,
  type Tool,
} from "./scene";

type Tab = "view" | "markup";
type TextMark = Extract<Mark, { kind: "text" }>;
type Gesture =
  | { kind: "pinch"; d0: number; m0: Pt; s0: number; t0: Pt }
  | { kind: "draw" }
  | { kind: "move"; id: string; start: Pt; wasSelected: boolean; movedFar: boolean }
  | { kind: "pan"; start: Pt; t0: Pt; time: number; moved: boolean; zoomed: boolean }
  | { kind: "text"; start: Pt; moved: boolean };

const PREVIEW_SIDE = 2048;
const HINT_KEY = "nc-photo-hint";

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const coarse = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;

export default function ImageEditor({ attachment, data, saveVersion, setDirty, nav }: EditorProps) {
  const toast = useToast();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const preview = useRef<HTMLCanvasElement | null>(null);

  const [tab, setTab] = useState<Tab>("view");
  const [tool, setTool] = useState<Exclude<Tool, "view">>("arrow");
  const [color, setColor] = useState(COLORS[0].c);
  const [widthK, setWidthK] = useState(WIDTHS[1].k);
  const [textK, setTextK] = useState<number>(TEXT_SIZES[1].k);
  const [scene, setSceneState] = useState<Scene>({ rotation: 0, marks: [] });
  const sceneRef = useRef(scene);
  const past = useRef<Scene[]>([]);
  const future = useRef<Scene[]>([]);
  const [selected, setSelectedState] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [editing, setEditingState] = useState<{ mark: TextMark; isNew: boolean } | null>(null);
  const editingRef = useRef<{ mark: TextMark; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [hint, setHint] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // The view: scale and offset of the photo on screen, and the scale that fits it.
  const view = useRef({ s: 1, tx: 0, ty: 0, fit: 1, w: 0, h: 0 });
  const draft = useRef<Mark | null>(null);
  const moveBy = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const ptrs = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ time: number; p: Pt } | null>(null);
  const frame = useRef(0);

  const W = img?.naturalWidth ?? 1;
  const H = img?.naturalHeight ?? 1;
  const out = outSize(W, H, scene.rotation);
  const unit = unitFor(out.w, out.h);
  const effTool: Tool = tab === "view" ? "view" : tool;
  const effToolRef = useRef<Tool>(effTool);
  effToolRef.current = effTool;
  const navRef = useRef(nav);
  navRef.current = nav;

  const setScene = (s: Scene) => {
    sceneRef.current = s;
    setSceneState(s);
  };
  const setSelected = (id: string | null) => {
    selectedRef.current = id;
    setSelectedState(id);
  };
  const setEditing = (e: { mark: TextMark; isNew: boolean } | null) => {
    editingRef.current = e;
    setEditingState(e);
  };

  /* ------------------------------------------------------------ open the photo */
  useEffect(() => {
    let alive = true;
    setImg(null);
    setFailed(false);
    const url = URL.createObjectURL(new Blob([data], { type: attachment.mime || "image/jpeg" }));
    const im = new Image();
    im.decoding = "async";
    im.onload = () => {
      if (!alive) return;
      // Browsers turn phone photos upright from their camera data; naturalWidth is the upright size.
      const side = Math.max(im.naturalWidth, im.naturalHeight);
      if (side > PREVIEW_SIDE * 1.25) {
        const k = PREVIEW_SIDE / side;
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * k));
        c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const cx = c.getContext("2d");
        if (cx) {
          cx.imageSmoothingQuality = "high";
          cx.drawImage(im, 0, 0, c.width, c.height);
          preview.current = c;
        }
      } else preview.current = null;
      setImg(im);
    };
    im.onerror = () => alive && setFailed(true);
    im.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
    // A new version of the file remounts this tool; the contents don't change otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id]);

  // Development only: lets tests read the marks in photo pixels and the current view.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__ncImage = {
      scene: () => sceneRef.current,
      size: () => ({ w: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0 }),
      view: () => ({ ...view.current }),
    };
  }, [img]);

  /* ------------------------------------------------------------ drawing on screen */
  const paint = useCallback(() => {
    frame.current = 0;
    const cv = canvasRef.current;
    const im = img;
    if (!cv || !im) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const v = view.current;
    const sc = sceneRef.current;
    const o = outSize(im.naturalWidth, im.naturalHeight, sc.rotation);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);

    // A soft check pattern behind see-through parts of PNGs.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = checker(ctx);
    ctx.fillRect(v.tx, v.ty, o.w * v.s, o.h * v.s);

    ctx.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.tx, dpr * v.ty);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // A smaller copy draws faster while the whole photo is on screen; the full photo once zoomed in.
    const pv = preview.current;
    const usePreview = !!pv && v.s * dpr <= (pv.width / im.naturalWidth) * 1.1;
    drawPhoto(ctx, usePreview ? pv! : im, im.naturalWidth, im.naturalHeight, sc.rotation);

    const ed = editingRef.current;
    const mv = moveBy.current;
    for (const m of sc.marks) {
      if (ed && !ed.isNew && ed.mark.id === m.id) continue;
      drawMark(ctx, mv && mv.id === m.id ? moved(m, mv.dx, mv.dy) : m);
    }
    if (ed) drawMark(ctx, ed.mark);
    if (draft.current) drawMark(ctx, draft.current);

    // Selection outline: blue dashes over a white edge, the same thickness at any zoom.
    const selId = selectedRef.current;
    const sel = selId ? sc.marks.find((m) => m.id === selId) : null;
    if (sel && !ed) {
      const b = bounds(mv && mv.id === sel.id ? moved(sel, mv.dx, mv.dy) : sel);
      const pad = 6 / v.s;
      ctx.save();
      ctx.lineWidth = 3.5 / v.s;
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.setLineDash([6 / v.s, 4 / v.s]);
      ctx.lineWidth = 1.8 / v.s;
      ctx.strokeStyle = "#0a84ff";
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.restore();
    }
  }, [img]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    schedule();
  }, [scene, selected, editing, schedule]);

  /* ------------------------------------------------------------ fitting and zooming */
  const maxScale = () => Math.max(view.current.fit * 8, 3);

  const clampView = useCallback(() => {
    const v = view.current;
    const im = img;
    if (!im) return;
    const o = outSize(im.naturalWidth, im.naturalHeight, sceneRef.current.rotation);
    v.s = Math.min(Math.max(v.s, v.fit), maxScale());
    const cw = o.w * v.s;
    const ch = o.h * v.s;
    v.tx = cw <= v.w ? (v.w - cw) / 2 : Math.min(0, Math.max(v.w - cw, v.tx));
    v.ty = ch <= v.h ? (v.h - ch) / 2 : Math.min(0, Math.max(v.h - ch, v.ty));
    setZoomPct(Math.round((v.s / v.fit) * 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  const fitView = useCallback(() => {
    const v = view.current;
    const im = img;
    if (!im || !v.w || !v.h) return;
    const o = outSize(im.naturalWidth, im.naturalHeight, sceneRef.current.rotation);
    const pad = v.w < 600 ? 10 : 24;
    v.fit = Math.min((v.w - pad * 2) / o.w, (v.h - pad * 2) / o.h, 3);
    v.s = v.fit;
    clampView();
    schedule();
  }, [img, clampView, schedule]);

  const zoomAt = useCallback(
    (s: number, at?: Pt) => {
      const v = view.current;
      const p = at ?? { x: v.w / 2, y: v.h / 2 };
      const c = { x: (p.x - v.tx) / v.s, y: (p.y - v.ty) / v.s };
      v.s = Math.min(Math.max(s, v.fit), maxScale());
      v.tx = p.x - c.x * v.s;
      v.ty = p.y - c.y * v.s;
      clampView();
      schedule();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clampView, schedule],
  );

  // Size the canvas to the stage (sharp on high-density screens) and keep the photo fitted.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const cv = canvasRef.current;
    if (!stage || !cv || !img) return;
    const resize = () => {
      const r = stage.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const v = view.current;
      const wasFit = Math.abs(v.s - v.fit) < 1e-6 || !v.w;
      v.w = r.width;
      v.h = r.height;
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      if (wasFit) fitView();
      else {
        const o = outSize(img.naturalWidth, img.naturalHeight, sceneRef.current.rotation);
        const pad = v.w < 600 ? 10 : 24;
        v.fit = Math.min((v.w - pad * 2) / o.w, (v.h - pad * 2) / o.h, 3);
        clampView();
        schedule();
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [img, fitView, clampView, schedule]);

  // Mouse wheel and trackpad pinch zoom around the pointer.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(view.current.s * f, { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* ------------------------------------------------------------ history */
  const dirtyNow = (s: Scene) => s.rotation !== 0 || s.marks.length > 0;
  useEffect(() => {
    setDirty(dirtyNow(scene));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const commit = (next: Scene) => {
    past.current.push(sceneRef.current);
    if (past.current.length > 200) past.current.shift();
    future.current = [];
    const turned = next.rotation !== sceneRef.current.rotation;
    setScene(next);
    if (turned) requestAnimationFrame(fitView);
  };

  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(sceneRef.current);
    const turned = prev.rotation !== sceneRef.current.rotation;
    setScene(prev);
    setSelected(null);
    if (turned) requestAnimationFrame(fitView);
    setTick((t) => t + 1);
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(sceneRef.current);
    const turned = next.rotation !== sceneRef.current.rotation;
    setScene(next);
    setSelected(null);
    if (turned) requestAnimationFrame(fitView);
    setTick((t) => t + 1);
  }

  function rotate(cw: boolean) {
    if (!img) return;
    finishText();
    const s = sceneRef.current;
    const o = outSize(img.naturalWidth, img.naturalHeight, s.rotation);
    const r = (((s.rotation + (cw ? 90 : 270)) % 360) as Rotation);
    commit({ rotation: r, marks: turnMarks(s.marks, cw, o.w, o.h) });
    setSelected(null);
  }

  function removeSelected() {
    const id = selectedRef.current;
    if (!id) return;
    commit({ ...sceneRef.current, marks: sceneRef.current.marks.filter((m) => m.id !== id) });
    setSelected(null);
  }

  /** Pick a colour: also recolours the selected mark. */
  function chooseColor(c: string) {
    setColor(c);
    const ed = editingRef.current;
    if (ed) {
      setEditing({ ...ed, mark: { ...ed.mark, color: c } });
      return;
    }
    const id = selectedRef.current;
    if (!id) return;
    commit({ ...sceneRef.current, marks: sceneRef.current.marks.map((m) => (m.id === id ? { ...m, color: c } : m)) });
  }
  function chooseWidth(k: number) {
    setWidthK(k);
    const id = selectedRef.current;
    if (!id) return;
    const m = sceneRef.current.marks.find((x) => x.id === id);
    if (!m || m.kind === "text") return;
    commit({ ...sceneRef.current, marks: sceneRef.current.marks.map((x) => (x.id === id ? ({ ...x, width: unit * k } as Mark) : x)) });
  }
  function chooseText(k: number) {
    setTextK(k);
    const ed = editingRef.current;
    if (ed) {
      setEditing({ ...ed, mark: { ...ed.mark, size: unit * k } });
      return;
    }
    const id = selectedRef.current;
    if (!id) return;
    const m = sceneRef.current.marks.find((x) => x.id === id);
    if (!m || m.kind !== "text") return;
    commit({ ...sceneRef.current, marks: sceneRef.current.marks.map((x) => (x.id === id ? ({ ...x, size: unit * k } as Mark) : x)) });
  }

  /* ------------------------------------------------------------ text labels */
  function startText(at: Pt, existing?: TextMark) {
    const mark: TextMark = existing ?? { id: uid(), kind: "text", color, size: unit * textK, at, text: "" };
    setEditing({ mark: { ...mark }, isNew: !existing });
    setSelected(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function finishText(cancel = false) {
    const ed = editingRef.current;
    if (!ed) return;
    setEditing(null);
    if (cancel) {
      schedule();
      return;
    }
    const text = ed.mark.text.trim();
    const s = sceneRef.current;
    if (ed.isNew) {
      if (text) commit({ ...s, marks: [...s.marks, { ...ed.mark, text }] });
    } else if (!text) {
      commit({ ...s, marks: s.marks.filter((m) => m.id !== ed.mark.id) });
    } else {
      commit({ ...s, marks: s.marks.map((m) => (m.id === ed.mark.id ? { ...ed.mark, text } : m)) });
    }
    schedule();
  }

  function editText(value: string) {
    const ed = editingRef.current;
    if (!ed) return;
    setEditing({ ...ed, mark: { ...ed.mark, text: value } });
  }

  /* ------------------------------------------------------------ touch, pen and mouse */
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toImg = (p: Pt): Pt => {
    const v = view.current;
    return { x: (p.x - v.tx) / v.s, y: (p.y - v.ty) / v.s };
  };
  const zoomed = () => view.current.s > view.current.fit * 1.02;

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!img || (e.pointerType === "mouse" && e.button !== 0)) return;
    try {
      stageRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* some browsers refuse capture for synthetic pointers; the gesture still works */
    }
    const p = local(e);
    ptrs.current.set(e.pointerId, p);

    if (ptrs.current.size === 2) {
      // Two fingers: zoom and move, dropping anything half drawn.
      draft.current = null;
      moveBy.current = null;
      const [a, b] = [...ptrs.current.values()];
      const v = view.current;
      gesture.current = { kind: "pinch", d0: Math.max(1, dist(a, b)), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s0: v.s, t0: { x: v.tx, y: v.ty } };
      schedule();
      return;
    }
    if (ptrs.current.size > 2) return;

    // A tap away from an open label just finishes it.
    if (editingRef.current) {
      finishText();
      gesture.current = null;
      return;
    }
    const c = toImg(p);
    const t = effToolRef.current;
    const v = view.current;
    if (t === "pen") {
      draft.current = { id: uid(), kind: "pen", color, width: unit * widthK, points: [c] };
      gesture.current = { kind: "draw" };
    } else if (t === "line" || t === "arrow" || t === "rect" || t === "ellipse") {
      draft.current = { id: uid(), kind: t, color, width: unit * widthK, a: c, b: c };
      gesture.current = { kind: "draw" };
    } else if (t === "text") {
      gesture.current = { kind: "text", start: p, moved: false };
    } else if (t === "select") {
      const hit = pick(sceneRef.current.marks, c, 12 / v.s);
      if (hit) {
        const wasSelected = selectedRef.current === hit.id;
        setSelected(hit.id);
        moveBy.current = { id: hit.id, dx: 0, dy: 0 };
        gesture.current = { kind: "move", id: hit.id, start: c, wasSelected, movedFar: false };
      } else {
        setSelected(null);
        gesture.current = { kind: "pan", start: p, t0: { x: v.tx, y: v.ty }, time: performance.now(), moved: false, zoomed: zoomed() };
      }
    } else {
      gesture.current = { kind: "pan", start: p, t0: { x: v.tx, y: v.ty }, time: performance.now(), moved: false, zoomed: zoomed() };
    }
    schedule();
  }

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!ptrs.current.has(e.pointerId)) return;
    const p = local(e);
    ptrs.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    const v = view.current;
    if (g.kind === "pinch") {
      if (ptrs.current.size < 2) return;
      const [a, b] = [...ptrs.current.values()];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const c = { x: (g.m0.x - g.t0.x) / g.s0, y: (g.m0.y - g.t0.y) / g.s0 };
      v.s = Math.min(Math.max((g.s0 * dist(a, b)) / g.d0, v.fit), maxScale());
      v.tx = m.x - c.x * v.s;
      v.ty = m.y - c.y * v.s;
      clampView();
    } else if (g.kind === "draw" && draft.current) {
      const c = toImg(p);
      const d = draft.current;
      if (d.kind === "pen") {
        const last = d.points[d.points.length - 1];
        if (dist(last, c) * v.s >= 2) d.points.push(c);
      } else if (d.kind !== "text") {
        d.b = c;
      }
    } else if (g.kind === "move") {
      const c = toImg(p);
      moveBy.current = { id: g.id, dx: c.x - g.start.x, dy: c.y - g.start.y };
      if (Math.hypot(moveBy.current.dx, moveBy.current.dy) * v.s > 4) g.movedFar = true;
    } else if (g.kind === "pan") {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (Math.hypot(dx, dy) > 6) g.moved = true;
      if (g.zoomed) {
        v.tx = g.t0.x + dx;
        v.ty = g.t0.y + dy;
        clampView();
      } else if (navRef.current && navRef.current.total > 1) {
        // At the fitted size, a sideways drag shows the photo following the finger.
        v.tx = g.t0.x + dx * 0.55;
      }
    } else if (g.kind === "text") {
      if (dist(p, g.start) > 8) g.moved = true;
    }
    schedule();
  }

  function onUp(e: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    if (!ptrs.current.has(e.pointerId)) return;
    const p = local(e);
    ptrs.current.delete(e.pointerId);
    const g = gesture.current;
    const v = view.current;
    if (!g) return;

    if (g.kind === "pinch") {
      // One finger left on the screen carries on moving the photo.
      if (ptrs.current.size === 1) {
        const rest = [...ptrs.current.values()][0];
        gesture.current = { kind: "pan", start: rest, t0: { x: v.tx, y: v.ty }, time: 0, moved: true, zoomed: true };
      } else gesture.current = null;
      if (!zoomed()) fitView();
      return;
    }
    gesture.current = null;

    if (g.kind === "draw") {
      const d = draft.current;
      draft.current = null;
      if (d && !cancelled) {
        // A tap with the pen leaves a dot; shapes need a little length so stray taps don't add marks.
        const keep = d.kind === "pen" || (d.kind !== "text" && dist(d.a, d.b) * v.s > 6);
        if (keep) commit({ ...sceneRef.current, marks: [...sceneRef.current.marks, d] });
      }
    } else if (g.kind === "move") {
      const mv = moveBy.current;
      moveBy.current = null;
      if (mv && g.movedFar && !cancelled) {
        commit({ ...sceneRef.current, marks: sceneRef.current.marks.map((m) => (m.id === mv.id ? moved(m, mv.dx, mv.dy) : m)) });
      } else if (!g.movedFar && g.wasSelected) {
        const m = sceneRef.current.marks.find((x) => x.id === g.id);
        if (m && m.kind === "text") startText(m.at, m);
      }
    } else if (g.kind === "text") {
      if (!g.moved && !cancelled) startText(toImg(p));
    } else if (g.kind === "pan") {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      const n = navRef.current;
      if (!g.zoomed && n && n.total > 1 && !cancelled && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        fitView();
        if (dx < 0) n.next?.();
        else n.prev?.();
      } else if (!g.moved && !cancelled) {
        // Double tap: zoom in there, or back to the whole photo.
        const now = performance.now();
        const last = lastTap.current;
        if (last && now - last.time < 320 && dist(last.p, p) < 30) {
          lastTap.current = null;
          if (zoomed()) fitView();
          else zoomAt(v.fit * 2.5, p);
        } else lastTap.current = { time: now, p };
      } else if (!g.zoomed) {
        // A drag at the fitted size that wasn't a swipe: settle back in place.
        fitView();
      }
    }
    schedule();
  }

  /* ------------------------------------------------------------ keys */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape" && selectedRef.current) {
        setSelected(null);
      } else if (!mod && (e.key === "+" || e.key === "=")) {
        zoomAt(view.current.s * 1.25);
      } else if (!mod && (e.key === "-" || e.key === "_")) {
        zoomAt(view.current.s / 1.25);
      } else if (!mod && e.key === "0") {
        fitView();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomAt, fitView]);

  /* ------------------------------------------------------------ hints and tools */
  function chooseTab(t: Tab) {
    finishText();
    setTab(t);
    setSelected(null);
    if (t === "markup" && coarse()) {
      let seen = false;
      try {
        seen = sessionStorage.getItem(HINT_KEY) === "1";
        sessionStorage.setItem(HINT_KEY, "1");
      } catch {
        /* private browsing: show it anyway */
      }
      if (!seen) setHint("Draw with one finger. Use two fingers to zoom and move the photo.");
    } else setHint(null);
  }

  function chooseTool(t: Exclude<Tool, "view">) {
    finishText();
    setTool(t);
    if (t !== "select") setSelected(null);
  }

  /* ------------------------------------------------------------ save */
  async function save() {
    if (!img || saving) return;
    finishText();
    setSaving(true);
    try {
      const type = outputType(attachment.mime, attachment.name);
      const res = await renderOut(img, img.naturalWidth, img.naturalHeight, sceneRef.current, type);
      await saveVersion(res.blob, res.extension ? { extension: res.extension } : undefined);
    } catch (e) {
      // The marks stay, so nothing is lost.
      toast(`Not saved: ${errorMessage(e)}`, "error");
    } finally {
      setSaving(false);
    }
  }

  const dirty = dirtyNow(scene);
  const sel = selected ? scene.marks.find((m) => m.id === selected) : null;
  const showText = tool === "text" || sel?.kind === "text" || !!editing;

  if (failed) {
    return (
      <div className="img-editor">
        <div className="img-failed">
          <ImageOff />
          <b>This photo type can't be shown here</b>
          <span>Use the download button at the top to open it on your device.</span>
        </div>
      </div>
    );
  }

  const toolBtn = (t: Exclude<Tool, "view">, label: string, icon: ReactNode) => (
    <button key={t} type="button" className={`img-tool${tool === t ? " on" : ""}`} onClick={() => chooseTool(t)} aria-pressed={tool === t} aria-label={label} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="img-editor">
      <div className="img-bar">
        <div className="img-tabs" role="tablist" aria-label="Photo tools">
          <button type="button" role="tab" aria-selected={tab === "view"} className={`img-tab${tab === "view" ? " on" : ""}`} onClick={() => chooseTab("view")}>
            <Eye />
            <span>View</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "markup"} className={`img-tab${tab === "markup" ? " on" : ""}`} onClick={() => chooseTab("markup")}>
            <Pencil />
            <span>Mark up</span>
          </button>
        </div>
        <div className="img-bar-end">
          <button type="button" className="icon-btn plain img-wide" onClick={undo} disabled={!past.current.length} aria-label="Undo" title="Undo">
            <Undo2 />
          </button>
          <button type="button" className="icon-btn plain img-wide" onClick={redo} disabled={!future.current.length} aria-label="Redo" title="Redo">
            <Redo2 />
          </button>
          <button type="button" className="btn primary img-save" onClick={save} disabled={!img || !dirty || saving}>
            {saving && <span className="img-spin" />}
            <span className="img-wide-text">{saving ? "Saving..." : "Save as new version"}</span>
            <span className="img-narrow-text">{saving ? "Saving" : "Save"}</span>
          </button>
        </div>
      </div>

      <div className={`img-tools ${tab}`} role="toolbar" aria-label="Tool options">
        {tab === "view" ? (
          <>
            <button type="button" className="img-tool" onClick={() => rotate(false)} disabled={!img} title="Turn left">
              <RotateCcw />
              <span>Turn left</span>
            </button>
            <button type="button" className="img-tool" onClick={() => rotate(true)} disabled={!img} title="Turn right">
              <RotateCw />
              <span>Turn right</span>
            </button>
            <span className="img-sep" />
            <button type="button" className="img-tool" onClick={fitView} disabled={!img} title="Whole photo">
              <Maximize />
              <span>Whole photo</span>
            </button>
            <button type="button" className="img-tool img-actual" onClick={() => zoomAt(1)} disabled={!img} title="Actual size">
              <ScanSearch />
              <span>Actual size</span>
            </button>
          </>
        ) : (
          <>
            {toolBtn("select", "Select", <MousePointer2 />)}
            {toolBtn("arrow", "Arrow", <ArrowUpRight />)}
            {toolBtn("rect", "Box", <Square />)}
            {toolBtn("ellipse", "Circle", <Circle />)}
            {toolBtn("line", "Line", <Slash />)}
            {toolBtn("pen", "Pen", <Pencil />)}
            {toolBtn("text", "Text", <Type />)}
            <span className="img-sep" />
            <span className="img-colors" role="group" aria-label="Colour">
              {COLORS.map((c) => (
                <button
                  key={c.c}
                  type="button"
                  className={`img-dot${color === c.c ? " on" : ""}`}
                  style={{ background: c.c }}
                  onClick={() => chooseColor(c.c)}
                  aria-label={c.label}
                  aria-pressed={color === c.c}
                  title={c.label}
                />
              ))}
            </span>
            <span className="img-sep" />
            {showText ? (
              <span className="img-size" role="group" aria-label="Text size">
                {TEXT_SIZES.map((t) => (
                  <button key={t.key} type="button" className={`img-tsize${textK === t.k ? " on" : ""}`} onClick={() => chooseText(t.k)} aria-label={`${t.label} text`} title={`${t.label} text`}>
                    {t.key}
                  </button>
                ))}
              </span>
            ) : (
              <span className="img-size" role="group" aria-label="Line width">
                {WIDTHS.map((w) => (
                  <button key={w.k} type="button" className={`img-width${widthK === w.k ? " on" : ""}`} onClick={() => chooseWidth(w.k)} aria-label={`${w.label} line`} title={w.label}>
                    <i style={{ height: Math.round(w.k * 1.6) + 1 }} />
                  </button>
                ))}
              </span>
            )}
            {sel && (
              <>
                <span className="img-sep" />
                <button type="button" className="img-tool danger" onClick={removeSelected} title="Remove the selected mark">
                  <Trash2 />
                  <span>Remove</span>
                </button>
              </>
            )}
          </>
        )}
      </div>

      <div
        ref={stageRef}
        className={`img-stage tool-${effTool}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => onUp(e)}
        onPointerCancel={(e) => onUp(e, true)}
        aria-label={`Photo: ${attachment.name}`}
        role="group"
      >
        <canvas ref={canvasRef} />
        {!img && (
          <div className="img-loading">
            <span className="img-spin" /> Opening the photo...
          </div>
        )}

        {editing && (
          <div className="img-textbar glass-strong" onPointerDown={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              className="input"
              value={editing.mark.text}
              onChange={(e) => editText(e.target.value)}
              onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  finishText();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  finishText(true);
                }
              }}
              placeholder="Type the label"
              aria-label="Label text"
              maxLength={200}
            />
            <button type="button" className="btn primary small" onClick={() => finishText()}>
              <Check /> Done
            </button>
            <button type="button" className="icon-btn small plain" onClick={() => finishText(true)} aria-label="Cancel">
              <X />
            </button>
          </div>
        )}

        {hint && (
          <div className="img-hint" role="status">
            {hint}
            <button type="button" className="img-hint-x" onClick={() => setHint(null)} onPointerDown={(e) => e.stopPropagation()} aria-label="Hide this tip">
              <X />
            </button>
          </div>
        )}

        {(past.current.length > 0 || future.current.length > 0) && (
          <div className="img-undo-float glass-strong" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="icon-btn small plain" onClick={undo} disabled={!past.current.length} aria-label="Undo">
              <Undo2 />
            </button>
            <button type="button" className="icon-btn small plain" onClick={redo} disabled={!future.current.length} aria-label="Redo">
              <Redo2 />
            </button>
          </div>
        )}

        {img && (
          <div className="img-zoom glass-strong" onPointerDown={(e) => e.stopPropagation()}>
            <button type="button" className="icon-btn small plain" onClick={() => zoomAt(view.current.s / 1.4)} aria-label="Zoom out">
              <Minus />
            </button>
            <button type="button" className="img-zoom-pct" onClick={fitView} title="Whole photo">
              {zoomPct}%
            </button>
            <button type="button" className="icon-btn small plain" onClick={() => zoomAt(view.current.s * 1.4)} aria-label="Zoom in">
              <Plus />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* A soft grey check pattern, made once per canvas context. */
const checkers = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
function checker(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  const have = checkers.get(ctx);
  if (have) return have;
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const x = c.getContext("2d");
  if (!x) return "#ddd";
  x.fillStyle = "#e9ecf2";
  x.fillRect(0, 0, 16, 16);
  x.fillStyle = "#d5dae3";
  x.fillRect(0, 0, 8, 8);
  x.fillRect(8, 8, 8, 8);
  const p = ctx.createPattern(c, "repeat");
  if (!p) return "#ddd";
  checkers.set(ctx, p);
  return p;
}
