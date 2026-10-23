// The editable state of a PDF in the app. Everything is kept in each page's own PDF coordinates
// (points, origin bottom-left, before the page's rotation), so it maps straight onto the saved file.

export type Pt = [number, number];
export type RGB = [number, number, number];

/** A page in the order shown. The original file's pages, pages joined from other PDFs, or blank pages. */
export interface Slot {
  id: string;
  /** "main" for the file itself, otherwise the key of a PDF that was joined in. */
  doc: string;
  /** Page index in that document (-1 for a blank page). */
  index: number;
  /** Extra rotation chosen here, in degrees (0, 90, 180, 270), on top of the page's own. */
  rotate: number;
  /** Size of a blank page, in points. */
  size?: [number, number];
}

interface Base {
  id: string;
}

/** Pen and highlighter strokes. */
export interface InkObj extends Base {
  type: "ink";
  tool: "pen" | "highlighter";
  points: Pt[];
  color: string;
  width: number;
}

export interface LineObj extends Base {
  type: "line";
  arrow: boolean;
  a: Pt;
  b: Pt;
  color: string;
  width: number;
}

/** Rectangle, ellipse or revision cloud between two corners (axis-aligned on the page). */
export interface ShapeObj extends Base {
  type: "shape";
  shape: "rect" | "ellipse" | "cloud";
  a: Pt;
  b: Pt;
  color: string;
  width: number;
}

/**
 * Things laid out in a box of their own (text, notes, pictures, signatures, stamps).
 * `o` is the box's top-left corner as seen when it was placed, `angle` the direction of its top
 * edge on the page (radians, counter-clockwise), `w` and `h` its size in points.
 */
export interface BoxBase extends Base {
  o: Pt;
  angle: number;
  w: number;
  h: number;
}

export interface TextObj extends BoxBase {
  type: "text";
  text: string;
  size: number;
  color: string;
  bold: boolean;
  /** A yellow sticky note rather than plain text. */
  note: boolean;
}

export interface ImageObj extends BoxBase {
  type: "image";
  kind: "signature" | "initials" | "picture";
  /** PNG or JPEG data URL. */
  src: string;
}

export interface StampObj extends BoxBase {
  type: "stamp";
  label: string;
  sub: string;
  color: string;
}

export interface MeasureObj extends Base {
  type: "measure";
  kind: "length" | "area" | "count";
  points: Pt[];
  color: string;
}

export type Obj = InkObj | LineObj | ShapeObj | TextObj | ImageObj | StampObj | MeasureObj;
export type BoxObj = TextObj | ImageObj | StampObj;

export const isBox = (o: Obj): o is BoxObj => o.type === "text" || o.type === "image" || o.type === "stamp";

/** A piece of the file's own text, retyped in place. */
export interface TextEdit {
  id: string;
  slot: string;
  /** The original run, from the PDF's text: its words and where they sit. */
  run: {
    str: string;
    /** Text matrix in page coordinates: [a b c d e f], e/f is the start of the baseline. */
    m: [number, number, number, number, number, number];
    width: number;
    ascent: number;
    descent: number;
  };
  text: string;
  family: "Helvetica" | "Times" | "Courier";
  bold: boolean;
  italic: boolean;
  color: RGB;
  /** The background behind the run, for covering it if it can't be wiped. */
  bg: RGB;
}

export type FieldValue = string | boolean | string[];

export interface DocState {
  slots: Slot[];
  objects: Record<string, Obj[]>;
  edits: TextEdit[];
  forms: Record<string, FieldValue>;
  /** Metres per point, per page, once the scale is set. */
  scales: Record<string, number>;
}

export const emptyState = (): DocState => ({ slots: [], objects: {}, edits: [], forms: {}, scales: {} });

let seq = 0;
export const uid = (p = "o") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
