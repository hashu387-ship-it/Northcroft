// The PDF viewer and editor. View, mark up, sign and stamp, manage pages, measure drawings,
// change the file's own text, add text and pictures, and fill in forms. Saving makes a new version;
// the original is never changed.
import "./pdf.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Calendar,
  ChevronDown,
  ChevronUp,
  Circle,
  Cloud,
  Eye,
  FileStack,
  Hash,
  Highlighter,
  Image as ImageIcon,
  ListChecks,
  Lock,
  Maximize,
  Minus,
  MousePointer2,
  MoveHorizontal,
  PenLine,
  Pencil,
  Plus,
  Redo2,
  Ruler,
  Search,
  Signature,
  Slash,
  Square,
  SquareDashedMousePointer,
  Stamp,
  StickyNote,
  Type,
  Undo2,
  X,
} from "lucide-react";
import type { EditorProps } from "@/features/files/editor";
import { useToast } from "@/components/ui";
import { errorMessage } from "@/lib/supabase";
import { apply, dist, makeView, metresPerPoint, polyLength, screenRightAngle, type View } from "./geom";
import { emptyState, uid, type DocState, type FieldValue, type Obj, type Pt, type Slot, type TextEdit } from "./model";
import { closePdf, openPdf, type PDFDoc, type PDFPage } from "./pdfjs";
import { PageView } from "./PageView";
import { PagesPanel } from "./PagesPanel";
import { MeasurePanel, ScaleSheet, CalibrateSheet } from "./MeasurePanel";
import { Thumb } from "./Thumb";
import { SignaturePad } from "./SignaturePad";
import { loadSignatures, saveSignature, type Signatures } from "./signature";
import { buildPdf } from "./save";
import { loadMetrics, stampSize, textHeight, todayLabel } from "./text";
import type { EditorApi, FindHit, MeasureDraft, Pending, Selection, Style, Tab, TextRun, Tool, Widget } from "./types";
import { isMeasureTool } from "./types";

interface PageMeta {
  view: number[];
  rotate: number;
  page: PDFPage;
}

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  { key: "view", label: "View", icon: <Eye /> },
  { key: "markup", label: "Mark up", icon: <PenLine /> },
  { key: "sign", label: "Sign", icon: <Signature /> },
  { key: "pages", label: "Pages", icon: <FileStack /> },
  { key: "measure", label: "Measure", icon: <Ruler /> },
  { key: "text", label: "Edit text", icon: <Type /> },
  { key: "forms", label: "Forms", icon: <ListChecks /> },
];

const COLORS = ["#e8343e", "#0b1d46", "#007aff", "#28a745", "#e67e00", "#111111"];
const HIGHLIGHTS = ["#ffd60a", "#4cd964", "#ff6fae", "#5ac8fa"];
const STAMPS = [
  { label: "APPROVED", color: "#1f8a3b" },
  { label: "CHECKED", color: "#0a66c2" },
  { label: "REJECTED", color: "#d92f39" },
  { label: "FOR REVIEW", color: "#d97706" },
  { label: "RECEIVED", color: "#0b1d46" },
];
const TOOL_HINT: Partial<Record<Tool, string>> = {
  pen: "Draw with your finger, pen or mouse",
  highlighter: "Draw over the words to highlight them",
  line: "Drag to draw a line",
  arrow: "Drag to draw an arrow",
  rect: "Drag to draw a box",
  ellipse: "Drag to draw a circle",
  cloud: "Drag around the area to mark a change",
  text: "Tap where the text should go, or drag to set its width",
  note: "Tap where the note should go",
  place: "Tap where it should go",
  length: "Tap each point along the length, then Finish",
  area: "Tap each corner, then Finish (or tap the first corner again)",
  count: "Tap each item to count it, then Finish",
  calibrate: "Tap both ends of a dimension you know",
  edittext: "Tap any text on the page to change it",
};

const clampZoom = (z: number) => Math.min(6, Math.max(0.2, z));

/** Background and text colour of a run, read from the rendered page. */
function sampleColors(canvas: HTMLCanvasElement | null, rect: [number, number, number, number], pageW: number): { bg: [number, number, number]; ink: [number, number, number] } {
  const fallback = { bg: [1, 1, 1] as [number, number, number], ink: [0, 0, 0] as [number, number, number] };
  if (!canvas) return fallback;
  try {
    const k = canvas.width / pageW;
    const x1 = Math.max(0, Math.floor(rect[0] * k) - 3);
    const y1 = Math.max(0, Math.floor(rect[1] * k) - 3);
    const x2 = Math.min(canvas.width - 1, Math.ceil(rect[2] * k) + 3);
    const y2 = Math.min(canvas.height - 1, Math.ceil(rect[3] * k) + 3);
    const w = x2 - x1 + 1;
    const h = y2 - y1 + 1;
    if (w < 3 || h < 3) return fallback;
    const px = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(x1, y1, w, h).data;
    const at = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };
    const ring: number[][] = [];
    for (let x = 0; x < w; x++) ring.push(at(x, 0), at(x, h - 1));
    for (let y = 0; y < h; y++) ring.push(at(0, y), at(w - 1, y));
    const med = (i: number) => ring.map((c) => c[i]).sort((a, b) => a - b)[Math.floor(ring.length / 2)];
    const bg = [med(0), med(1), med(2)];
    let best = bg;
    let bestD = -1;
    for (let y = 3; y < h - 3; y++) {
      for (let x = 3; x < w - 3; x++) {
        const c = at(x, y);
        const d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return { bg: bg.map((v) => v / 255) as [number, number, number], ink: (bestD > 60 ? best : [0, 0, 0]).map((v) => v / 255) as [number, number, number] };
  } catch {
    return fallback;
  }
}

function familyOf(page: PDFPage | undefined, run: TextRun): { family: TextEdit["family"]; bold: boolean; italic: boolean } {
  let name = "";
  let bold = false;
  let italic = false;
  try {
    const objs = (page as unknown as { commonObjs: { has: (k: string) => boolean; get: (k: string) => { name?: string; bold?: boolean; italic?: boolean; black?: boolean } } }).commonObjs;
    if (objs.has(run.fontName)) {
      const f = objs.get(run.fontName);
      name = f.name ?? "";
      bold = !!(f.bold || f.black);
      italic = !!f.italic;
    }
  } catch {
    /* font details aren't available; guess from the family */
  }
  bold = bold || /bold|black|heavy|semibold|demi/i.test(name);
  italic = italic || /italic|oblique/i.test(name);
  const hint = `${name} ${run.fallbackFamily}`;
  const family = /courier|mono|consol/i.test(hint) ? "Courier" : /times|serif|roman|georgia|garamond|cambria|book/i.test(hint) && !/sans/i.test(hint) ? "Times" : "Helvetica";
  return { family, bold, italic };
}

export default function PdfEditor({ attachment, data, me, saveVersion, setDirty }: EditorProps) {
  const toast = useToast();

  /* ------------------------------------------------------------ the documents */
  const [docs, setDocs] = useState<Map<string, PDFDoc>>(new Map());
  const docsRef = useRef(docs);
  docsRef.current = docs;
  const extraBytes = useRef<Record<string, ArrayBuffer>>({});
  const [meta, setMeta] = useState<Map<string, PageMeta>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | undefined>(undefined);
  const [needPassword, setNeedPassword] = useState<"ask" | "wrong" | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [locked, setLocked] = useState(false);

  /* ------------------------------------------------------------ editable state and undo */
  const [state, setStateRaw] = useState<DocState>(emptyState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const initial = useRef<DocState | null>(null);
  const past = useRef<DocState[]>([]);
  const future = useRef<DocState[]>([]);
  const gestureBase = useRef<DocState | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  const set = useCallback((next: DocState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);
  const commit = useCallback(
    (next: DocState) => {
      past.current.push(stateRef.current);
      if (past.current.length > 200) past.current.shift();
      future.current = [];
      set(next);
      rerender();
    },
    [set],
  );
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(stateRef.current);
    set(prev);
    rerender();
  }, [set]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(stateRef.current);
    set(next);
    rerender();
  }, [set]);

  const dirty = initial.current !== null && state !== initial.current;
  useEffect(() => setDirty(dirty), [dirty, setDirty]);

  /* ------------------------------------------------------------ tools */
  const [tab, setTab] = useState<Tab>("view");
  const [tool, setToolRaw] = useState<Tool>("none");
  const [style, setStyle] = useState<Style>({ color: "#e8343e", width: 2, highlight: "#ffd60a", textSize: 12, bold: false, measureColor: "#007aff" });
  const [selected, setSelected] = useState<Selection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState<MeasureDraft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [runEdit, setRunEdit] = useState<{ slot: string; run: TextRun; value: string; family: TextEdit["family"]; bold: boolean; italic: boolean; color: [number, number, number]; bg: [number, number, number] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [sigs, setSigs] = useState<Signatures>({ signature: null, initials: null });
  const [padFor, setPadFor] = useState<"signature" | "initials" | null>(null);
  const [scaleFor, setScaleFor] = useState<string | null>(null);
  const [calibrate, setCalibrate] = useState<{ slot: string; length: number } | null>(null);
  const [showList, setShowList] = useState(false);
  const [showThumbs, setShowThumbs] = useState(() => window.matchMedia("(min-width: 1100px)").matches);
  const pictureInput = useRef<HTMLInputElement>(null);

  const setTool = useCallback((t: Tool) => {
    setToolRaw(t);
    setEditingId(null);
    if (t !== "select") setSelected(null);
    if (!isMeasureTool(t)) setDraft(null);
    if (t !== "place") setPending(null);
  }, []);

  function chooseTab(t: Tab) {
    setTab(t);
    setRunEdit(null);
    setTool(t === "markup" ? "select" : t === "measure" ? "select" : t === "text" ? "edittext" : t === "sign" ? "select" : "none");
  }

  /* ------------------------------------------------------------ loading */
  useEffect(() => {
    let cancelled = false;
    let opened: PDFDoc | null = null;
    (async () => {
      try {
        const [pdf] = await Promise.all([openPdf(data, password), loadMetrics()]);
        opened = pdf;
        if (cancelled) return;
        const metas = new Map<string, PageMeta>();
        const indexes = Array.from({ length: pdf.numPages }, (_, i) => i);
        for (let i = 0; i < indexes.length; i += 24) {
          const batch = await Promise.all(indexes.slice(i, i + 24).map((k) => pdf.getPage(k + 1)));
          batch.forEach((page, k) => metas.set(`main:${i + k}`, { view: page.view, rotate: page.rotate, page }));
        }
        if (cancelled) return;
        const md = await pdf.getMetadata().catch(() => null);
        if ((md?.info as { EncryptFilterName?: string } | undefined)?.EncryptFilterName) setLocked(true);
        const s0: DocState = { ...emptyState(), slots: indexes.map((k) => ({ id: uid("p"), doc: "main", index: k, rotate: 0 })) };
        initial.current = s0;
        past.current = [];
        future.current = [];
        set(s0);
        setMeta(metas);
        setDocs(new Map([["main", pdf]]));
        setNeedPassword(null);
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (name === "PasswordException") setNeedPassword(password ? "wrong" : "ask");
        else setLoadError("This PDF couldn't be opened. It may be damaged. You can still download it.");
      }
    })();
    return () => {
      cancelled = true;
      closePdf(opened);
    };
    // Reload only for another file or a password.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, password]);

  useEffect(() => {
    return () => {
      for (const [k, d] of docsRef.current) if (k !== "main") closePdf(d);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    loadSignatures(me.id).then((s) => alive && setSigs(s));
    return () => {
      alive = false;
    };
  }, [me.id]);

  /* ------------------------------------------------------------ layout and zoom */
  const scroller = useRef<HTMLDivElement>(null);
  const pagesBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(0);
  const [fit, setFit] = useState<"auto" | "width" | "page" | null>("auto");
  const anchor = useRef<{ slot: string; pt: Pt; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [docs.size, tab]);

  const metaOf = useCallback(
    (s: Slot): { view: number[]; rotate: number } => {
      if (s.index < 0) return { view: [0, 0, s.size?.[0] ?? 595.28, s.size?.[1] ?? 841.89], rotate: 0 };
      return meta.get(`${s.doc}:${s.index}`) ?? { view: [0, 0, 595.28, 841.89], rotate: 0 };
    },
    [meta],
  );

  const sizeAt1 = useCallback(
    (s: Slot) => {
      const m = metaOf(s);
      const v = makeView(m.view, 1, m.rotate + s.rotate);
      return [v.width, v.height];
    },
    [metaOf],
  );

  const [current, setCurrent] = useState(0);
  const fitZoom = useCallback(
    (mode: "auto" | "width" | "page") => {
      if (!box.w || !state.slots.length) return 1;
      const pad = box.w < 600 ? 16 : 48;
      const widest = Math.max(...state.slots.map((s) => sizeAt1(s)[0]));
      const zw = (box.w - pad) / widest;
      if (mode === "width") return clampZoom(zw);
      if (mode === "auto") return clampZoom(Math.min(zw, box.w < 600 ? zw : 1.35));
      const s = state.slots[Math.min(current, state.slots.length - 1)];
      const [w, h] = sizeAt1(s);
      return clampZoom(Math.min((box.w - pad) / w, (box.h - 32) / h));
    },
    [box.w, box.h, state.slots, sizeAt1, current],
  );

  useEffect(() => {
    if (fit && box.w && state.slots.length) setZoom(fitZoom(fit));
  }, [fit, box.w, box.h, state.slots.length, fitZoom]);

  const views = useMemo(() => {
    const out = new Map<string, View>();
    if (!zoom) return out;
    for (const s of state.slots) {
      const m = metaOf(s);
      out.set(s.id, makeView(m.view, zoom, m.rotate + s.rotate));
    }
    return out;
  }, [state.slots, metaOf, zoom]);

  const pageEls = useRef(new Map<string, HTMLDivElement>());
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    observer.current = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.slot!;
            if (e.isIntersecting) next.add(id);
            else next.delete(id);
          }
          return next;
        });
      },
      { root, rootMargin: "900px 0px" },
    );
    for (const el of pageEls.current.values()) observer.current.observe(el);
    return () => observer.current?.disconnect();
  }, [docs.size, tab]);

  const register = useCallback((id: string, el: HTMLDivElement | null) => {
    const old = pageEls.current.get(id);
    if (old && old !== el) observer.current?.unobserve(old);
    if (el) {
      pageEls.current.set(id, el);
      observer.current?.observe(el);
    } else pageEls.current.delete(id);
  }, []);

  // Which page is in the middle of the screen.
  const onScroll = useCallback(() => {
    const root = scroller.current;
    if (!root) return;
    const mid = root.scrollTop + root.clientHeight / 2;
    const slots = stateRef.current.slots;
    let lo = 0;
    let hi = slots.length - 1;
    let best = 0;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const el = pageEls.current.get(slots[m].id);
      if (!el) break;
      if (el.offsetTop <= mid) {
        best = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    setCurrent(best);
  }, []);

  /** Zoom keeping the point under (x, y) (relative to the scroll area) in place. */
  const zoomTo = useCallback(
    (z: number, x?: number, y?: number) => {
      const root = scroller.current;
      if (!root) return;
      const next = clampZoom(z);
      const fx = x ?? root.clientWidth / 2;
      const fy = y ?? root.clientHeight / 2;
      const rr = root.getBoundingClientRect();
      for (const s of stateRef.current.slots) {
        const el = pageEls.current.get(s.id);
        const v = views.get(s.id);
        if (!el || !v) continue;
        const r = el.getBoundingClientRect();
        if (rr.top + fy >= r.top && rr.top + fy <= r.bottom + 14) {
          anchor.current = { slot: s.id, pt: apply(v.inv, [rr.left + fx - r.left, rr.top + fy - r.top]), x: fx, y: fy };
          break;
        }
      }
      setFit(null);
      setZoom(next);
    },
    [views],
  );

  useLayoutEffect(() => {
    const a = anchor.current;
    const root = scroller.current;
    if (!a || !root) return;
    anchor.current = null;
    const el = pageEls.current.get(a.slot);
    const v = views.get(a.slot);
    if (!el || !v) return;
    const q = apply(v.t, a.pt);
    const rr = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    root.scrollLeft += r.left + q[0] - (rr.left + a.x);
    root.scrollTop += r.top + q[1] - (rr.top + a.y);
  }, [views]);

  // Pinch to zoom (two fingers), and two-finger panning while a drawing tool is on.
  useEffect(() => {
    const root = scroller.current;
    const inner = pagesBox.current;
    if (!root || !inner) return;
    let pinch: { d: number; cx: number; cy: number; z: number; sl: number; st: number; scale: number } | null = null;
    const center = (t: TouchList) => {
      const rr = root.getBoundingClientRect();
      return [(t[0].clientX + t[1].clientX) / 2 - rr.left, (t[0].clientY + t[1].clientY) / 2 - rr.top];
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const [cx, cy] = center(e.touches);
      pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), cx, cy, z: zoomRef.current, sl: root.scrollLeft, st: root.scrollTop, scale: 1 };
    };
    const move = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const [cx, cy] = center(e.touches);
      pinch.scale = Math.min(6 / pinch.z, Math.max(0.2 / pinch.z, d / pinch.d));
      root.scrollLeft = pinch.sl - (cx - pinch.cx);
      root.scrollTop = pinch.st - (cy - pinch.cy);
      inner.style.transformOrigin = `${pinch.cx + root.scrollLeft}px ${pinch.cy + root.scrollTop}px`;
      inner.style.transform = `scale(${pinch.scale})`;
    };
    const end = (e: TouchEvent) => {
      if (!pinch || e.touches.length >= 2) return;
      const p = pinch;
      pinch = null;
      inner.style.transform = "";
      if (Math.abs(p.scale - 1) > 0.02) zoomToRef.current(p.z * p.scale, p.cx, p.cy);
    };
    root.addEventListener("touchstart", start, { passive: true });
    root.addEventListener("touchmove", move, { passive: false });
    root.addEventListener("touchend", end);
    root.addEventListener("touchcancel", end);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rr = root.getBoundingClientRect();
      zoomToRef.current(zoomRef.current * Math.exp(-e.deltaY * 0.0022), e.clientX - rr.left, e.clientY - rr.top);
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => {
      root.removeEventListener("touchstart", start);
      root.removeEventListener("touchmove", move);
      root.removeEventListener("touchend", end);
      root.removeEventListener("touchcancel", end);
      root.removeEventListener("wheel", wheel);
    };
  }, [docs.size, tab]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomToRef = useRef(zoomTo);
  zoomToRef.current = zoomTo;

  // Tests in the preview page tap exact points on a drawing through this.
  const viewsRef = useRef(views);
  viewsRef.current = views;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __ncPdf: unknown }).__ncPdf = {
      toClient: (n: number, x: number, y: number) => {
        const s = stateRef.current.slots[n - 1];
        const el = s && pageEls.current.get(s.id);
        const v = s && viewsRef.current.get(s.id);
        if (!el || !v) return null;
        const r = el.getBoundingClientRect();
        const q = apply(v.t, [x, y]);
        return [r.left + q[0], r.top + q[1]];
      },
      state: () => stateRef.current,
    };
  }, []);

  const scrollToSlot = useCallback((id: string, smooth = true) => {
    const el = pageEls.current.get(id);
    const root = scroller.current;
    if (!el || !root) return;
    root.scrollTo({ top: el.offsetTop - 10, behavior: smooth ? "smooth" : "auto" });
  }, []);

  /* ------------------------------------------------------------ text and form fields from the PDF */
  const runsCache = useRef(new Map<string, Promise<TextRun[]>>());
  const runsFor = useCallback(async (s: Slot): Promise<TextRun[]> => {
    if (s.index < 0) return [];
    const key = `${s.doc}:${s.index}`;
    let p = runsCache.current.get(key);
    if (!p) {
      const page = meta.get(key)?.page;
      p = page
        ? page.getTextContent().then((tc) =>
            tc.items.flatMap((it, i) => {
              if (!("str" in it) || !it.str.trim()) return [];
              const st = tc.styles[it.fontName] ?? { ascent: 0.8, descent: -0.2, fontFamily: "sans-serif" };
              return [{ key: `${key}:${i}`, str: it.str, m: it.transform as TextRun["m"], width: it.width, ascent: st.ascent || 0.8, descent: st.descent || -0.2, fontName: it.fontName, fallbackFamily: st.fontFamily }];
            }),
          )
        : Promise.resolve([]);
      runsCache.current.set(key, p);
    }
    return p;
  }, [meta]);

  const [runs, setRuns] = useState<Map<string, TextRun[]>>(new Map());
  useEffect(() => {
    if (tool !== "edittext") return;
    let alive = true;
    for (const s of state.slots) {
      if (!visible.has(s.id) || runs.has(s.id)) continue;
      runsFor(s).then((r) => alive && setRuns((m) => new Map(m).set(s.id, r)));
    }
    return () => {
      alive = false;
    };
  }, [tool, visible, state.slots, runs, runsFor]);

  const [widgets, setWidgets] = useState<Map<string, Widget[]>>(new Map());
  const widgetsLoading = useRef(new Set<string>());
  useEffect(() => {
    for (const s of state.slots) {
      if (s.doc !== "main" || s.index < 0 || (!visible.has(s.id) && tab !== "forms")) continue;
      const key = `main:${s.index}`;
      if (widgets.has(key) || widgetsLoading.current.has(key)) continue;
      const page = meta.get(key)?.page;
      if (!page) continue;
      widgetsLoading.current.add(key);
      page
        .getAnnotations({ intent: "display" })
        .then((anns) => {
          const list: Widget[] = [];
          for (const a of anns as Record<string, unknown>[]) {
            if (a.annotationType !== 20 || !a.fieldName || a.hidden) continue;
            const base = { id: String(a.id), name: String(a.fieldName), rect: a.rect as Widget["rect"], readOnly: !!a.readOnly };
            if (a.fieldType === "Tx") list.push({ ...base, type: "text", value: String(a.fieldValue ?? ""), multiline: !!a.multiLine, maxLen: (a.maxLen as number) || undefined });
            else if (a.fieldType === "Btn" && a.checkBox) list.push({ ...base, type: "checkbox", value: !!a.fieldValue && a.fieldValue !== "Off", onValue: String(a.exportValue ?? "Yes") });
            else if (a.fieldType === "Btn" && a.radioButton) list.push({ ...base, type: "radio", value: String(a.fieldValue ?? ""), onValue: String(a.buttonValue ?? "") });
            else if (a.fieldType === "Ch") {
              const opts = ((a.options as { exportValue: string; displayValue: string }[]) ?? []).map((o) => ({ value: String(o.exportValue), label: String(o.displayValue ?? o.exportValue) }));
              const fv = a.fieldValue as string | string[] | undefined;
              list.push({ ...base, type: a.combo ? "select" : "list", options: opts, multiple: !!a.multiSelect, value: a.multiSelect ? (Array.isArray(fv) ? fv : fv ? [fv] : []) : Array.isArray(fv) ? fv[0] ?? "" : fv ?? "" });
            }
          }
          setWidgets((m) => new Map(m).set(key, list));
        })
        .catch(() => setWidgets((m) => new Map(m).set(key, [])));
    }
  }, [state.slots, visible, meta, widgets, tab]);

  const allFormsLoaded = state.slots.every((s) => s.doc !== "main" || s.index < 0 || widgets.has(`main:${s.index}`));
  const fieldCount = useMemo(() => new Set([...widgets.values()].flat().map((w) => w.name)).size, [widgets]);

  /* ------------------------------------------------------------ find */
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [findHits, setFindHits] = useState<FindHit[]>([]);
  const [hitIndex, setHitIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setFindHits([]);
      return;
    }
    let alive = true;
    const t = window.setTimeout(async () => {
      setSearching(true);
      const out: FindHit[] = [];
      for (const s of stateRef.current.slots) {
        const rs = await runsFor(s);
        for (const r of rs) {
          const low = r.str.toLowerCase();
          let i = low.indexOf(q);
          while (i >= 0) {
            out.push({ slot: s.id, run: r, start: i, len: q.length });
            i = low.indexOf(q, i + q.length);
          }
        }
        if (!alive) return;
      }
      setSearching(false);
      setFindHits(out);
      setHitIndex(0);
      if (out[0]) goToHit(out[0]);
    }, 260);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, runsFor]);

  function goToHit(h: FindHit) {
    const el = pageEls.current.get(h.slot);
    const v = views.get(h.slot);
    const root = scroller.current;
    if (!el || !v || !root) return;
    const q = apply(v.t, [h.run.m[4], h.run.m[5]]);
    root.scrollTo({ top: el.offsetTop + q[1] - root.clientHeight / 3, left: Math.max(0, el.offsetLeft + q[0] - root.clientWidth / 2), behavior: "smooth" });
  }

  function stepHit(d: number) {
    if (!findHits.length) return;
    const i = (hitIndex + d + findHits.length) % findHits.length;
    setHitIndex(i);
    goToHit(findHits[i]);
  }

  /* ------------------------------------------------------------ the editor's actions for pages */
  const placeObj = useCallback((slot: string, o: Obj, select = true) => {
    const s = stateRef.current;
    commit({ ...s, objects: { ...s.objects, [slot]: [...(s.objects[slot] ?? []), o] } });
    if (o.type === "text" && !o.text) {
      setToolRaw("select");
      setSelected({ slot, id: o.id });
      setEditingId(o.id);
    } else if (select) {
      setToolRaw("select");
      setSelected({ slot, id: o.id });
    }
  }, [commit]);

  const finishMeasure = useCallback(() => {
    const d = draftRef.current;
    if (!d) return;
    setDraft(null);
    if (d.kind === "calibrate") return;
    const need = d.kind === "length" ? 2 : d.kind === "area" ? 3 : 1;
    if (d.points.length < need) return;
    const s = stateRef.current;
    const o: Obj = { id: uid(), type: "measure", kind: d.kind, points: d.points, color: style.measureColor };
    commit({ ...s, objects: { ...s.objects, [d.slot]: [...(s.objects[d.slot] ?? []), o] } });
  }, [commit, style.measureColor]);

  const api: EditorApi = useMemo(
    () => ({
      get: () => stateRef.current,
      commit,
      preview: (next) => set(next),
      beginGesture: () => {
        gestureBase.current = stateRef.current;
      },
      endGesture: () => {
        const base = gestureBase.current;
        gestureBase.current = null;
        if (base && base !== stateRef.current) {
          past.current.push(base);
          future.current = [];
          rerender();
        }
      },
      select: (s) => {
        setSelected(s);
        if (!s) setEditingId(null);
      },
      setTool,
      addObject: (slot, o, select) => placeObj(slot, o, select),
      placePending: (slot, at, view) => {
        const p = pendingRef.current;
        if (!p) return;
        const angle = screenRightAngle(view);
        const center = (w: number, h: number): Pt => {
          const c = Math.cos(angle);
          const s = Math.sin(angle);
          return [at[0] - (w / 2) * c - (h / 2) * s, at[1] - (w / 2) * s + (h / 2) * c];
        };
        let o: Obj;
        if (p.kind === "image") o = { id: uid(), type: "image", kind: p.imageKind, src: p.src, w: p.w, h: p.h, angle, o: center(p.w, p.h) };
        else if (p.kind === "stamp") {
          const sub = `${me.short_name} · ${todayLabel()}`;
          const [w, h] = stampSize(p.label, sub);
          o = { id: uid(), type: "stamp", label: p.label, sub, color: p.color, w, h, angle, o: center(w, h) };
        } else {
          const text = todayLabel();
          const w = Math.max(60, text.length * 6.4 + 8);
          const h = textHeight(1, 11, false);
          o = { id: uid(), type: "text", text, size: 11, color: "#111111", bold: false, note: false, w, h, angle, o: center(w, h) };
        }
        setPending(null);
        placeObj(slot, o, true);
      },
      editText: (id) => setEditingId(id),
      startRunEdit: (slot, run, view, canvas) => {
        const s = stateRef.current;
        const existing = s.edits.find((e) => e.slot === slot && e.run.m.join() === run.m.join());
        const sl = s.slots.find((x) => x.id === slot)!;
        const page = sl.index >= 0 ? meta.get(`${sl.doc}:${sl.index}`)?.page : undefined;
        const f = familyOf(page, run);
        const [x1, y1, x2, y2] = runBox(run, view);
        const colors = sampleColors(canvas, [x1, y1, x2, y2], view.width);
        setRunEdit({
          slot,
          run,
          value: existing?.text ?? run.str,
          family: existing?.family ?? f.family,
          bold: existing?.bold ?? f.bold,
          italic: existing?.italic ?? f.italic,
          color: existing?.color ?? colors.ink,
          bg: existing?.bg ?? colors.bg,
        });
      },
      measureTap: (slot, at) => {
        const t = toolRef.current;
        if (!isMeasureTool(t)) return;
        if ((t === "length" || t === "area") && !stateRef.current.scales[slot]) {
          setScaleFor(slot);
          return;
        }
        let d = draftRef.current;
        if (d && (d.slot !== slot || d.kind !== t)) {
          finishMeasure();
          d = null;
        }
        if (!d) d = { slot, kind: t, points: [] };
        const zoomNow = zoomRef.current || 1;
        if (t === "area" && d.points.length >= 3 && dist(at, d.points[0]) < 10 / zoomNow) {
          draftRef.current = d;
          finishMeasure();
          return;
        }
        const next = { ...d, points: [...d.points, at] };
        if (t === "calibrate" && next.points.length === 2) {
          setDraft(null);
          setCalibrate({ slot, length: polyLength(next.points) });
          return;
        }
        draftRef.current = next;
        setDraft(next);
      },
      measureFinish: finishMeasure,
      setField: (name, value) => {
        const s = stateRef.current;
        commit({ ...s, forms: { ...s.forms, [name]: value } });
      },
      needScale: (slot) => setScaleFor(slot),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, set, setTool, placeObj, finishMeasure, meta, me.short_name],
  );
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  const runEditRef = useRef(runEdit);
  runEditRef.current = runEdit;
  const setRunEditValue = useCallback((v: string) => setRunEdit((r) => (r ? { ...r, value: v } : r)), []);
  const commitRunEdit = useCallback((cancel?: boolean) => {
    const r = runEditRef.current;
    runEditRef.current = null;
    setRunEdit(null);
    if (!r || cancel) return;
    const s = stateRef.current;
    const same = (e: TextEdit) => e.slot === r.slot && e.run.m.join() === r.run.m.join();
    const existing = s.edits.find(same);
    if (r.value === r.run.str) {
      if (existing) commit({ ...s, edits: s.edits.filter((e) => !same(e)) });
      return;
    }
    if (existing && existing.text === r.value) return;
    const edit: TextEdit = {
      id: existing?.id ?? uid("t"),
      slot: r.slot,
      run: { str: r.run.str, m: r.run.m, width: r.run.width, ascent: r.run.ascent, descent: r.run.descent },
      text: r.value,
      family: r.family,
      bold: r.bold,
      italic: r.italic,
      color: r.color,
      bg: r.bg,
    };
    commit({ ...s, edits: existing ? s.edits.map((e) => (same(e) ? edit : e)) : [...s.edits, edit] });
  }, [commit]);

  /* ------------------------------------------------------------ keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector(".sheet-backdrop")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setTab("view");
        setFindOpen(true);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        const s = stateRef.current;
        commit({ ...s, objects: { ...s.objects, [selected.slot]: (s.objects[selected.slot] ?? []).filter((o) => o.id !== selected.id) } });
        setSelected(null);
      } else if (e.key === "Enter" && draftRef.current) {
        finishMeasure();
      } else if (e.key === "Escape") {
        if (draftRef.current) setDraft(null);
        else if (pending) setTool("select");
        else setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, selected, commit, finishMeasure, pending, setTool]);

  /* ------------------------------------------------------------ signing and pictures */
  function placeSignature(kind: "signature" | "initials", src = sigs[kind]) {
    if (!src) {
      setPadFor(kind);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const w = kind === "signature" ? 150 : 62;
      const h = (w * img.naturalHeight) / Math.max(1, img.naturalWidth);
      setPending({ kind: "image", imageKind: kind, src, w, h });
      setToolRaw("place");
      setSelected(null);
    };
    img.src = src;
  }

  function onPadDone(png: string) {
    const kind = padFor!;
    setPadFor(null);
    setSigs({ ...sigs, [kind]: png });
    placeSignature(kind, png);
    // Saved in the background, so placing it doesn't wait for the connection.
    void saveSignature(me.id, kind, png, sigs).then((everywhere) => {
      if (!everywhere) toast("Saved on this device for now. It will be saved to your account next time you're online.", "info");
    });
  }

  function onPicture(files: FileList | null) {
    const f = files?.[0];
    if (pictureInput.current) pictureInput.current.value = "";
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(f.type)) {
      toast("Choose a PNG or JPG picture.", "error");
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      // Pictures go in as JPEG (or PNG when they have see-through parts), at most 2000 px across.
      const max = 2000;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const src = f.type === "image/png" || f.type === "image/gif" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88);
      URL.revokeObjectURL(url);
      const w = Math.min(220, c.width);
      const h = (w * c.height) / c.width;
      setPending({ kind: "image", imageKind: "picture", src, w, h });
      setToolRaw("place");
      setSelected(null);
      toast("Tap where the picture should go", "info");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast("That picture couldn't be opened.", "error");
    };
    img.src = url;
  }

  /* ------------------------------------------------------------ pages */
  async function addPdfs(files: FileList | null, after: number) {
    if (!files?.length) return;
    let s = stateRef.current;
    const slots = [...s.slots];
    let at = after + 1;
    const nextDocs = new Map(docsRef.current);
    const nextMeta = new Map(meta);
    for (const f of Array.from(files)) {
      try {
        const bytes = await f.arrayBuffer();
        const pdf = await openPdf(bytes);
        const key = uid("x");
        extraBytes.current[key] = bytes;
        nextDocs.set(key, pdf);
        for (let i = 0; i < pdf.numPages; i++) {
          const page = await pdf.getPage(i + 1);
          nextMeta.set(`${key}:${i}`, { view: page.view, rotate: page.rotate, page });
          slots.splice(at++, 0, { id: uid("p"), doc: key, index: i, rotate: 0 });
        }
      } catch (e) {
        const locked = (e as { name?: string })?.name === "PasswordException";
        toast(locked ? `${f.name} needs a password, so it can't be added.` : `${f.name} couldn't be read as a PDF.`, "error");
      }
    }
    setMeta(nextMeta);
    setDocs(nextDocs);
    s = stateRef.current;
    commit({ ...s, slots });
    const added = slots.length - s.slots.length;
    if (added > 0) toast(`${added} page${added === 1 ? "" : "s"} added`);
  }

  async function extractPages(ids: string[]) {
    const s = stateRef.current;
    const keep = s.slots.filter((x) => ids.includes(x.id));
    if (!keep.length) return;
    try {
      const out = await buildPdf({ main: data, extra: extraBytes.current, state: { ...s, slots: keep } });
      const nums = keep.map((x) => s.slots.indexOf(x) + 1);
      const base = attachment.name.replace(/\.pdf$/i, "");
      const name = `${base} (page${nums.length > 1 ? "s" : ""} ${nums.length > 3 ? `${nums[0]}-${nums[nums.length - 1]}` : nums.join(", ")}).pdf`;
      const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast(`${name} downloaded`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  /* ------------------------------------------------------------ save */
  async function save() {
    if (saving || !dirty) return;
    if (editingId) setEditingId(null);
    setSaving(true);
    try {
      const out = await buildPdf({ main: data, extra: extraBytes.current, state: stateRef.current });
      if (out.covered) {
        toast(
          out.covered === 1
            ? "One piece of retyped text couldn't be wiped from the file, so it was covered over instead."
            : `${out.covered} pieces of retyped text couldn't be wiped from the file, so they were covered over instead.`,
          "info",
        );
      }
      if (out.replacedChars) toast("Some characters can't be written in the PDF's standard font and were replaced with a question mark.", "info");
      await saveVersion(new Blob([out.bytes as BlobPart], { type: "application/pdf" }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  // Per-page lists stay the same object while unchanged, so untouched pages don't redraw.
  const editsBySlot = useMemo(() => {
    const m = new Map<string, TextEdit[]>();
    for (const e of state.edits) m.set(e.slot, [...(m.get(e.slot) ?? []), e]);
    return m;
  }, [state.edits]);
  const hitsBySlot = useMemo(() => {
    const m = new Map<string, FindHit[]>();
    for (const h of findHits) m.set(h.slot, [...(m.get(h.slot) ?? []), h]);
    return m;
  }, [findHits]);

  /* ------------------------------------------------------------ render */
  if (needPassword) {
    return (
      <div className="pdf-center">
        <div className="pdf-card glass-strong">
          <Lock />
          <b>This PDF needs a password to open</b>
          <form
            className="row"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              setPassword(passwordInput);
            }}
          >
            <input className="input" type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} aria-label="Password" autoFocus />
            <button className="btn primary" type="submit" disabled={!passwordInput}>
              Open
            </button>
          </form>
          {needPassword === "wrong" && <span className="small" style={{ color: "var(--red)" }}>That password didn't work.</span>}
        </div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="pdf-center">
        <div className="pdf-card glass-strong">
          <b>{loadError}</b>
        </div>
      </div>
    );
  }
  if (!docs.size) {
    return (
      <div className="pdf-center">
        <span className="pdf-spin" style={{ color: "var(--accent)" }} />
        <span className="muted small">Opening the PDF...</span>
      </div>
    );
  }

  const slotIndex = new Map(state.slots.map((s, i) => [s.id, i]));
  const NONE: never[] = [];
  const measureCount = Object.values(state.objects).flat().filter((o) => o.type === "measure").length;
  const hint = locked ? null : pending ? TOOL_HINT.place : draft ? null : TOOL_HINT[tool];
  const pagesTab = tab === "pages";

  const toolBtn = (t: Tool, label: string, icon: ReactNode) => (
    <button key={t} type="button" className={`pdf-tool${tool === t ? " on" : ""}`} onClick={() => setTool(tool === t ? "select" : t)} aria-pressed={tool === t} title={label}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <div className="pdf-editor">
      <div className="pdf-bar">
        <div className="pdf-tabs" role="tablist" aria-label="Tools">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-label={t.label} title={t.label} className={`pdf-tab${tab === t.key ? " on" : ""}`} onClick={() => chooseTab(t.key)} disabled={locked && t.key !== "view"}>
              {t.icon}
              <span>{t.label}</span>
              {t.key === "forms" && fieldCount > 0 && <i className="pdf-badge">{fieldCount}</i>}
            </button>
          ))}
        </div>
        <div className="pdf-bar-end">
          <button type="button" className="icon-btn plain wide-only-btn" onClick={undo} disabled={!past.current.length} aria-label="Undo" title="Undo">
            <Undo2 />
          </button>
          <button type="button" className="icon-btn plain wide-only-btn" onClick={redo} disabled={!future.current.length} aria-label="Redo" title="Redo">
            <Redo2 />
          </button>
          <button type="button" className="btn primary pdf-save" onClick={save} disabled={!dirty || saving || locked}>
            {saving ? <span className="pdf-spin" /> : null}
            <span className="wide-only">{saving ? "Saving..." : "Save as new version"}</span>
            <span className="narrow-only">{saving ? "Saving" : "Save"}</span>
          </button>
        </div>
      </div>

      {locked && (
        <div className="pdf-note">
          <Lock /> This PDF is locked by whoever made it. You can read it and download it, but changes can't be saved.
        </div>
      )}

      {!locked && tab !== "pages" && (
        <div className="pdf-tools" role="toolbar" aria-label="Tool options">
          {tab === "view" && (
            <>
              <button type="button" className={`pdf-tool${findOpen ? " on" : ""}`} onClick={() => setFindOpen((v) => !v)} title="Find text">
                <Search />
                <span>Find</span>
              </button>
              <button type="button" className={`pdf-tool${showThumbs ? " on" : ""} wide-flex`} onClick={() => setShowThumbs((v) => !v)} title="Page list">
                <FileStack />
                <span>Page list</span>
              </button>
              <span className="pdf-sep" />
              <button type="button" className="pdf-tool" onClick={() => setFit("width")} title="Fit to width">
                <MoveHorizontal />
                <span>Fit width</span>
              </button>
              <button type="button" className="pdf-tool" onClick={() => setFit("page")} title="Fit the whole page">
                <Maximize />
                <span>Whole page</span>
              </button>
            </>
          )}
          {tab === "markup" && (
            <>
              {toolBtn("select", "Select", <MousePointer2 />)}
              {toolBtn("pen", "Pen", <Pencil />)}
              {toolBtn("highlighter", "Highlight", <Highlighter />)}
              {toolBtn("line", "Line", <Slash />)}
              {toolBtn("arrow", "Arrow", <ArrowUpRight />)}
              {toolBtn("rect", "Box", <Square />)}
              {toolBtn("ellipse", "Circle", <Circle />)}
              {toolBtn("cloud", "Cloud", <Cloud />)}
              {toolBtn("text", "Text", <Type />)}
              {toolBtn("note", "Note", <StickyNote />)}
              <span className="pdf-sep" />
              <StylePicker style={style} setStyle={setStyle} tool={tool} />
            </>
          )}
          {tab === "sign" && (
            <>
              {toolBtn("select", "Select", <MousePointer2 />)}
              <button type="button" className="pdf-tool" onClick={() => placeSignature("signature")} title="Signature">
                <Signature />
                <span>{sigs.signature ? "Signature" : "Draw signature"}</span>
              </button>
              <button type="button" className="pdf-tool" onClick={() => placeSignature("initials")} title="Initials">
                <PenLine />
                <span>{sigs.initials ? "Initials" : "Draw initials"}</span>
              </button>
              <button
                type="button"
                className="pdf-tool"
                onClick={() => {
                  setPending({ kind: "date" });
                  setToolRaw("place");
                }}
                title="Today's date"
              >
                <Calendar />
                <span>Date</span>
              </button>
              <span className="pdf-sep" />
              {STAMPS.map((st) => (
                <button
                  key={st.label}
                  type="button"
                  className={`pdf-tool stamp${pending?.kind === "stamp" && pending.label === st.label ? " on" : ""}`}
                  style={{ color: st.color }}
                  onClick={() => {
                    setPending({ kind: "stamp", label: st.label, color: st.color });
                    setToolRaw("place");
                    setSelected(null);
                  }}
                  title={`${st.label[0]}${st.label.slice(1).toLowerCase()} stamp`}
                >
                  <Stamp />
                  <span>{st.label[0] + st.label.slice(1).toLowerCase()}</span>
                </button>
              ))}
              <span className="pdf-sep" />
              <button type="button" className="pdf-tool" onClick={() => pictureInput.current?.click()} title="Picture">
                <ImageIcon />
                <span>Picture</span>
              </button>
              {(sigs.signature || sigs.initials) && (
                <button type="button" className="pdf-tool subtle" onClick={() => setPadFor(sigs.signature ? "signature" : "initials")} title="Draw your signature again">
                  <Pencil />
                  <span>Redraw</span>
                </button>
              )}
            </>
          )}
          {tab === "measure" && (
            <>
              {toolBtn("select", "Select", <MousePointer2 />)}
              {toolBtn("length", "Length", <Ruler />)}
              {toolBtn("area", "Area", <SquareDashedMousePointer />)}
              {toolBtn("count", "Count", <Hash />)}
              <span className="pdf-sep" />
              <button type="button" className="pdf-tool" onClick={() => setScaleFor(state.slots[current]?.id ?? null)} title="Scale">
                <Ruler />
                <span>
                  Scale {state.scales[state.slots[current]?.id] ? scaleLabel(state.scales[state.slots[current].id]) : "not set"}
                </span>
              </button>
              <button type="button" className={`pdf-tool${showList ? " on" : ""}`} onClick={() => setShowList((v) => !v)} title="Measurements">
                <ListChecks />
                <span>List{measureCount ? ` (${measureCount})` : ""}</span>
              </button>
              {draft && draft.kind !== "calibrate" && (
                <>
                  <button type="button" className="btn small primary" onClick={finishMeasure}>
                    Finish
                  </button>
                  <button type="button" className="btn small" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                </>
              )}
            </>
          )}
          {tab === "text" && (
            <>
              {toolBtn("edittext", "Change text", <Type />)}
              {toolBtn("text", "Add text", <Plus />)}
              <button type="button" className="pdf-tool" onClick={() => pictureInput.current?.click()} title="Add a picture">
                <ImageIcon />
                <span>Add picture</span>
              </button>
              {toolBtn("select", "Select", <MousePointer2 />)}
              <span className="pdf-sep" />
              <StylePicker style={style} setStyle={setStyle} tool="text" />
            </>
          )}
          {tab === "forms" && (
            <>
              <span className="muted small pdf-tools-note">
                {fieldCount
                  ? `${fieldCount} field${fieldCount === 1 ? "" : "s"} to fill in. Type straight into the form.`
                  : allFormsLoaded
                    ? "This PDF has no form to fill in. Use Edit text or Mark up to add words."
                    : "Looking for form fields..."}
              </span>
              {fieldCount > 0 && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    const s = stateRef.current;
                    const cleared: Record<string, FieldValue> = {};
                    for (const w of [...widgets.values()].flat()) cleared[w.name] = w.type === "checkbox" ? false : w.multiple ? [] : "";
                    commit({ ...s, forms: cleared });
                  }}
                >
                  Clear the form
                </button>
              )}
            </>
          )}
          <input ref={pictureInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onPicture(e.target.files)} />
        </div>
      )}

      {findOpen && tab === "view" && (
        <div className="pdf-find">
          <Search />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in this PDF" aria-label="Find in this PDF" autoFocus onKeyDown={(e) => e.key === "Enter" && stepHit(e.shiftKey ? -1 : 1)} />
          <span className="muted small">{searching ? "Searching" : query ? (findHits.length ? `${hitIndex + 1} of ${findHits.length}` : "Not found") : ""}</span>
          <button type="button" className="icon-btn small plain" onClick={() => stepHit(-1)} disabled={!findHits.length} aria-label="Previous">
            <ChevronUp />
          </button>
          <button type="button" className="icon-btn small plain" onClick={() => stepHit(1)} disabled={!findHits.length} aria-label="Next">
            <ChevronDown />
          </button>
          <button
            type="button"
            className="icon-btn small plain"
            onClick={() => {
              setFindOpen(false);
              setQuery("");
            }}
            aria-label="Close find"
          >
            <X />
          </button>
        </div>
      )}

      <div className="pdf-main">
        {pagesTab ? (
          <PagesPanel
            slots={state.slots}
            pageOf={(s) => (s.index >= 0 ? meta.get(`${s.doc}:${s.index}`)?.page ?? null : null)}
            metaOf={metaOf}
            onChange={(slots) => commit({ ...stateRef.current, slots })}
            hasMarks={(id) => (state.objects[id]?.length ?? 0) > 0 || state.edits.some((e) => e.slot === id)}
            onAddPdfs={addPdfs}
            onExtract={extractPages}
            onOpen={(id) => {
              chooseTab("view");
              setTimeout(() => scrollToSlot(id, false), 60);
            }}
          />
        ) : (
          <>
            {showThumbs && tab === "view" && (
              <div className="pdf-thumbs" aria-label="Pages">
                {state.slots.map((s, i) => (
                  <button key={s.id} type="button" className={`pdf-thumb${i === current ? " on" : ""}`} onClick={() => scrollToSlot(s.id)} aria-label={`Go to page ${i + 1}`}>
                    <Thumb page={s.index >= 0 ? meta.get(`${s.doc}:${s.index}`)?.page ?? null : null} meta={metaOf(s)} rotate={s.rotate} width={104} />
                    <span>{i + 1}</span>
                  </button>
                ))}
              </div>
            )}
            <div className={`pdf-scroll${isMeasureTool(tool) || tool === "place" ? " measuring" : ""}`} ref={scroller} onScroll={onScroll}>
              <div className="pdf-pages" ref={pagesBox}>
                {state.slots.map((s) => {
                  const view = views.get(s.id);
                  if (!view) return null;
                  const i = slotIndex.get(s.id)!;
                  return (
                    <PageView
                      key={s.id}
                      slot={s}
                      number={i + 1}
                      view={view}
                      page={s.index >= 0 ? meta.get(`${s.doc}:${s.index}`)?.page ?? null : null}
                      visible={visible.has(s.id) || Math.abs(i - current) <= 1}
                      keepCanvas={state.slots.length <= 12}
                      objects={state.objects[s.id] ?? []}
                      edits={editsBySlot.get(s.id) ?? NONE}
                      mpp={state.scales[s.id]}
                      tool={locked ? "none" : tool}
                      style={style}
                      selectedId={selected?.slot === s.id ? selected.id : null}
                      editingId={selected?.slot === s.id ? editingId : null}
                      runs={tool === "edittext" ? runs.get(s.id) ?? null : null}
                      widgets={s.doc === "main" && s.index >= 0 ? widgets.get(`main:${s.index}`) ?? null : null}
                      forms={state.forms}
                      hits={findOpen && tab === "view" ? hitsBySlot.get(s.id) ?? NONE : NONE}
                      currentHit={findOpen ? findHits[hitIndex] ?? null : null}
                      draft={draft}
                      runEdit={runEdit?.slot === s.id ? { run: runEdit.run, value: runEdit.value } : null}
                      setRunEditValue={setRunEditValue}
                      commitRunEdit={commitRunEdit}
                      pending={pending}
                      locked={locked}
                      api={api}
                      register={register}
                    />
                  );
                })}
              </div>
            </div>
            {showList && tab === "measure" && (
              <MeasurePanel
                state={state}
                pageNumber={(id) => (slotIndex.get(id) ?? 0) + 1}
                onPick={(slot, id) => {
                  setTool("select");
                  setSelected({ slot, id });
                  scrollToSlot(slot);
                }}
                onClose={() => setShowList(false)}
              />
            )}
          </>
        )}
      </div>

      {hint && !pagesTab && (
        <div className="pdf-hint" role="status">
          {hint}
          {pending && (
            <button type="button" className="pdf-hint-x" onClick={() => setTool("select")} aria-label="Cancel">
              <X />
            </button>
          )}
        </div>
      )}

      {!pagesTab && !locked && (
        <div className="pdf-undo-float glass-strong">
          <button type="button" className="icon-btn small plain" onClick={undo} disabled={!past.current.length} aria-label="Undo">
            <Undo2 />
          </button>
          <button type="button" className="icon-btn small plain" onClick={redo} disabled={!future.current.length} aria-label="Redo">
            <Redo2 />
          </button>
        </div>
      )}

      {!pagesTab && (
        <div className="pdf-zoom glass-strong">
          <span className="pdf-pageno">
            {Math.min(current + 1, state.slots.length)} / {state.slots.length}
          </span>
          <button type="button" className="icon-btn small plain" onClick={() => zoomTo(zoom / 1.2)} aria-label="Zoom out" title="Zoom out">
            <Minus />
          </button>
          <button type="button" className="pdf-zoom-pct" onClick={() => setFit("auto")} title="Reset zoom">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="icon-btn small plain" onClick={() => zoomTo(zoom * 1.2)} aria-label="Zoom in" title="Zoom in">
            <Plus />
          </button>
        </div>
      )}

      <SignaturePad open={!!padFor} kind={padFor ?? "signature"} onClose={() => setPadFor(null)} onDone={onPadDone} />
      <ScaleSheet
        open={!!scaleFor}
        slot={scaleFor}
        current={scaleFor ? state.scales[scaleFor] : undefined}
        suggest={scaleFor ? () => suggestScale(state.slots.find((x) => x.id === scaleFor), runsFor) : undefined}
        onClose={() => setScaleFor(null)}
        onPick={(mpp, all) => {
          const s = stateRef.current;
          const scales = { ...s.scales };
          if (all) for (const x of s.slots) scales[x.id] = mpp;
          else if (scaleFor) scales[scaleFor] = mpp;
          commit({ ...s, scales });
          setScaleFor(null);
          toast(`Scale set to ${scaleLabel(mpp)}${all ? " for every page" : ""}`);
        }}
        onCalibrate={() => {
          setScaleFor(null);
          setTool("calibrate");
        }}
      />
      <CalibrateSheet
        open={!!calibrate}
        lengthPt={calibrate?.length ?? 0}
        onClose={() => {
          setCalibrate(null);
          setTool("select");
        }}
        onDone={(metres, all) => {
          const c = calibrate!;
          const mpp = metres / c.length;
          const s = stateRef.current;
          const scales = { ...s.scales };
          if (all) for (const x of s.slots) scales[x.id] = mpp;
          else scales[c.slot] = mpp;
          commit({ ...s, scales });
          setCalibrate(null);
          setTool("length");
          toast(`Scale set to ${scaleLabel(mpp)}`);
        }}
      />
    </div>
  );
}

function runBox(run: TextRun, view: View): [number, number, number, number] {
  const [a, b, c, d, x, y] = run.m;
  const lx = Math.hypot(a, b) || 1;
  const ly = Math.hypot(c, d) || 1;
  const at = (u: number, v: number) => apply(view.t, [x + (a / lx) * u + (c / ly) * v, y + (b / lx) * u + (d / ly) * v]);
  const top = Math.max(run.ascent, 0.75) * ly;
  const bottom = Math.min(run.descent, -0.2) * ly;
  const pts = [at(0, bottom), at(run.width, bottom), at(run.width, top), at(0, top)];
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

/** "1:100" for a metres-per-point value, or "custom" when it isn't a round scale. */
export function scaleLabel(mpp: number): string {
  const n = mpp / metresPerPoint(1);
  const r = Math.round(n);
  return Math.abs(n - r) / n < 0.004 ? `1:${r}` : `1:${n.toFixed(1)}`;
}

/** A scale written on the drawing ("SCALE 1:100"), if any. */
async function suggestScale(slot: Slot | undefined, runsFor: (s: Slot) => Promise<TextRun[]>): Promise<number | null> {
  if (!slot) return null;
  const rs = await runsFor(slot);
  for (const r of rs) {
    const m = /\b1\s*:\s*(\d{1,4})\b/.exec(r.str);
    if (m && /scale|@|1\s*:/i.test(r.str)) return Number(m[1]);
  }
  return null;
}

function StylePicker({ style, setStyle, tool }: { style: Style; setStyle: (s: Style) => void; tool: Tool }) {
  if (tool === "highlighter") {
    return (
      <span className="pdf-colors">
        {HIGHLIGHTS.map((c) => (
          <button key={c} type="button" className={`pdf-dot${style.highlight === c ? " on" : ""}`} style={{ background: c }} onClick={() => setStyle({ ...style, highlight: c })} aria-label="Highlight colour" />
        ))}
      </span>
    );
  }
  const text = tool === "text" || tool === "note";
  return (
    <>
      <span className="pdf-colors">
        {COLORS.map((c) => (
          <button key={c} type="button" className={`pdf-dot${style.color === c ? " on" : ""}`} style={{ background: c }} onClick={() => setStyle({ ...style, color: c })} aria-label="Colour" />
        ))}
      </span>
      {text ? (
        <span className="pdf-size">
          <button type="button" className="icon-btn small plain" onClick={() => setStyle({ ...style, textSize: Math.max(6, style.textSize - 1) })} aria-label="Smaller text">
            <Minus />
          </button>
          <span className="small">{style.textSize} pt</span>
          <button type="button" className="icon-btn small plain" onClick={() => setStyle({ ...style, textSize: Math.min(72, style.textSize + 1) })} aria-label="Bigger text">
            <Plus />
          </button>
          <button type="button" className={`pdf-tool bold${style.bold ? " on" : ""}`} onClick={() => setStyle({ ...style, bold: !style.bold })} aria-pressed={style.bold} title="Bold">
            <b>B</b>
          </button>
        </span>
      ) : (
        <span className="pdf-size">
          {[1, 2, 4].map((w) => (
            <button key={w} type="button" className={`pdf-width${style.width === w ? " on" : ""}`} onClick={() => setStyle({ ...style, width: w })} aria-label={`Line ${w === 1 ? "thin" : w === 2 ? "medium" : "thick"}`} title={w === 1 ? "Thin" : w === 2 ? "Medium" : "Thick"}>
              <i style={{ height: w + 1 }} />
            </button>
          ))}
        </span>
      )}
    </>
  );
}
