// Excel colours: plain ARGB, theme colours with a tint, and the old 64-colour palette.

export interface XColor {
  argb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
}

/** The standard Office theme, used when a workbook doesn't carry its own. Order: lt1, dk1, lt2, dk2, accent1-6, hlink, folHlink. */
const OFFICE = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "0563C1", "954F72"];

// prettier-ignore
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "000000", "FFFFFF", "FF0000", "00FF00", "0000FF",
  "FFFF00", "FF00FF", "00FFFF", "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080", "9999FF", "993366",
  "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF", "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080",
  "0000FF", "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99", "3366FF", "33CCCC", "99CC00", "FFCC00",
  "FF9900", "FF6600", "666699", "969696", "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

/** Read the colour scheme out of the workbook's theme XML (in theme order lt1, dk1, lt2, dk2, ...). */
export function themePalette(themeXml: string | undefined): string[] {
  if (!themeXml) return OFFICE;
  const scheme = /<a:clrScheme[^>]*>([\s\S]*?)<\/a:clrScheme>/.exec(themeXml)?.[1];
  if (!scheme) return OFFICE;
  const pick = (tag: string, fallback: string) => {
    const block = new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`).exec(scheme)?.[1] ?? "";
    return (/srgbClr val="([0-9A-Fa-f]{6})"/.exec(block)?.[1] ?? /lastClr="([0-9A-Fa-f]{6})"/.exec(block)?.[1] ?? fallback).toUpperCase();
  };
  return [
    pick("lt1", OFFICE[0]),
    pick("dk1", OFFICE[1]),
    pick("lt2", OFFICE[2]),
    pick("dk2", OFFICE[3]),
    pick("accent1", OFFICE[4]),
    pick("accent2", OFFICE[5]),
    pick("accent3", OFFICE[6]),
    pick("accent4", OFFICE[7]),
    pick("accent5", OFFICE[8]),
    pick("accent6", OFFICE[9]),
    pick("hlink", OFFICE[10]),
    pick("folHlink", OFFICE[11]),
  ];
}

function rgbToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r = l;
  let g = l;
  let b = l;
  if (s) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = f(p, q, h + 1 / 3);
    g = f(p, q, h);
    b = f(p, q, h - 1 / 3);
  }
  const x = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
  return (x(r) + x(g) + x(b)).toUpperCase();
}

function applyTint(hex: string, tint: number): string {
  if (!tint) return hex;
  const [h, s, l] = rgbToHsl(hex);
  const nl = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  return hslToHex(h, s, nl);
}

/** A colour as "#RRGGBB", or null when there's none (automatic). */
export function resolveColor(c: XColor | undefined | null, palette: string[]): string | null {
  if (!c) return null;
  let hex: string | null = null;
  if (c.argb && /^[0-9A-Fa-f]{6,8}$/.test(c.argb)) hex = c.argb.slice(-6).toUpperCase();
  else if (c.theme != null && palette[c.theme]) hex = palette[c.theme];
  else if (c.indexed != null) hex = c.indexed === 64 || c.indexed === 65 ? null : INDEXED[c.indexed] ?? null;
  if (!hex) return null;
  if (c.tint) hex = applyTint(hex, c.tint);
  return `#${hex}`;
}

/** 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const v = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5);
}

/** Swatches offered in the toolbar for fill and text colour. */
export const SWATCHES = [
  "#000000", "#595959", "#A6A6A6", "#FFFFFF",
  "#012061", "#1F4E79", "#2F75B5", "#BDD7EE",
  "#C00000", "#E8343E", "#F8CBAD", "#FCE4D6",
  "#548235", "#A9D08E", "#E2EFDA",
  "#BF8F00", "#FFD966", "#FFF2CC",
];
