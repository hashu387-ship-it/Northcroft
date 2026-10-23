import type { DocState, FieldValue, Obj, Pt, Slot, TextEdit } from "./model";
import type { View } from "./geom";

export type Tab = "view" | "markup" | "sign" | "pages" | "measure" | "text" | "forms";

export type DrawTool = "pen" | "highlighter" | "line" | "arrow" | "rect" | "ellipse" | "cloud" | "text" | "note";
export type MeasureTool = "length" | "area" | "count" | "calibrate";
export type Tool = "none" | "select" | DrawTool | MeasureTool | "place" | "edittext";

export const DRAW_TOOLS: Tool[] = ["pen", "highlighter", "line", "arrow", "rect", "ellipse", "cloud", "text", "note"];
export const isDrawTool = (t: Tool) => DRAW_TOOLS.includes(t);
export const isMeasureTool = (t: Tool): t is MeasureTool => t === "length" || t === "area" || t === "count" || t === "calibrate";

export interface Style {
  color: string;
  width: number;
  highlight: string;
  textSize: number;
  bold: boolean;
  measureColor: string;
}

/** Something waiting to be placed with the next tap: a signature, picture, stamp or date. */
export type Pending =
  | { kind: "image"; imageKind: "signature" | "initials" | "picture"; src: string; w: number; h: number }
  | { kind: "stamp"; label: string; color: string }
  | { kind: "date" };

export interface Selection {
  slot: string;
  id: string;
}

/** A form field on a page, from the PDF. */
export interface Widget {
  id: string;
  name: string;
  type: "text" | "checkbox" | "radio" | "select" | "list";
  rect: [number, number, number, number];
  value: FieldValue;
  /** For checkboxes and radio buttons: the value this box stands for. */
  onValue?: string;
  options?: { value: string; label: string }[];
  multiline?: boolean;
  readOnly?: boolean;
  maxLen?: number;
  multiple?: boolean;
}

/** A run of the file's own text, as pdf.js reads it. */
export interface TextRun {
  key: string;
  str: string;
  m: [number, number, number, number, number, number];
  width: number;
  ascent: number;
  descent: number;
  fontName: string;
  fallbackFamily: string;
}

export interface FindHit {
  slot: string;
  run: TextRun;
  start: number;
  len: number;
}

export interface MeasureDraft {
  slot: string;
  kind: "length" | "area" | "count" | "calibrate";
  points: Pt[];
}

/** What a page needs from the editor. Functions read the latest state, so they're stable. */
export interface EditorApi {
  get: () => DocState;
  commit: (next: DocState) => void;
  /** Change without adding an undo step (while dragging); `endGesture` adds one. */
  preview: (next: DocState) => void;
  beginGesture: () => void;
  endGesture: () => void;
  select: (s: Selection | null) => void;
  setTool: (t: Tool) => void;
  addObject: (slot: string, o: Obj, select?: boolean) => void;
  placePending: (slot: string, at: Pt, view: View) => void;
  editText: (id: string | null) => void;
  startRunEdit: (slot: string, run: TextRun, view: View, canvas: HTMLCanvasElement | null, pageBox: DOMRect) => void;
  measureTap: (slot: string, at: Pt) => void;
  measureFinish: () => void;
  setField: (name: string, value: FieldValue) => void;
  needScale: (slot: string) => void;
}

export type { DocState, Obj, Pt, Slot, TextEdit, FieldValue };
