// Settings > Appearance, saved on this device and applied to <html> before the app draws:
//   theme     Automatic (follows the phone or computer), Light or Dark       data-theme
//   glass     how see-through the Liquid Glass bars are: Clear, Default, Tinted (iOS 27's slider)
//                                                                            data-glass
//   text      text size: Small, Default, Large, Larger                       data-text
//   density   list rows: Compact, Standard, Roomy                            data-density
//   solid     Reduce transparency: the glass turns solid                      data-solid
// The styles that read these are in styles/core.css.
export type ThemePref = "system" | "light" | "dark";
export type GlassPref = "clear" | "default" | "tinted";
export type TextPref = "s" | "m" | "l" | "xl";
export type DensityPref = "compact" | "standard" | "roomy";

export interface Appearance {
  theme: ThemePref;
  glass: GlassPref;
  text: TextPref;
  density: DensityPref;
  solid: boolean;
}

const KEYS = {
  theme: "nc-theme",
  glass: "nc-glass",
  text: "nc-text",
  density: "nc-density",
  solid: "nc-solid-v2",
} as const;

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: it still applies for this visit */
  }
}

export function readAppearance(): Appearance {
  const t = get(KEYS.theme);
  const g = get(KEYS.glass);
  const x = get(KEYS.text);
  const d = get(KEYS.density);
  return {
    // The old looks (navy, onyx, aurora, liquid, ...) all become Automatic in the new design.
    theme: t === "light" || t === "dark" ? t : "system",
    glass: g === "clear" || g === "tinted" ? g : "default",
    text: x === "s" || x === "l" || x === "xl" ? x : "m",
    density: d === "compact" || d === "roomy" ? d : "standard",
    solid: get(KEYS.solid) === "true",
  };
}

export function applyAppearance(a: Appearance = readAppearance()) {
  const root = document.documentElement;
  delete root.dataset.palette;
  if (a.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = a.theme;
  if (a.glass === "default") delete root.dataset.glass;
  else root.dataset.glass = a.glass;
  if (a.text === "m") delete root.dataset.text;
  else root.dataset.text = a.text;
  if (a.density === "standard") delete root.dataset.density;
  else root.dataset.density = a.density;
  if (a.solid) root.dataset.solid = "true";
  else delete root.dataset.solid;
  const look = readPreviewLook();
  if (look.thick) root.dataset.depth = "thick";
  else delete root.dataset.depth;
  if (look.wash) root.dataset.wash = "on";
  else delete root.dataset.wash;
  window.dispatchEvent(new Event("nc-appearance"));
}

/**
 * Looks being tried out before they're part of Settings, switched on in the Design gallery and
 * kept on this device so they can be judged across the whole app (styles/depth.css):
 *   thick  folder-style thick Liquid Glass on the bars, menus and sheets   data-depth="thick"
 *   wash   a soft colour background behind the glass                        data-wash="on"
 */
export interface PreviewLook {
  thick: boolean;
  wash: boolean;
}

export function readPreviewLook(): PreviewLook {
  return { thick: get("nc-preview-thick") === "1", wash: get("nc-preview-wash") === "1" };
}

export function savePreviewLook(patch: Partial<PreviewLook>): PreviewLook {
  const next = { ...readPreviewLook(), ...patch };
  put("nc-preview-thick", next.thick ? "1" : null);
  put("nc-preview-wash", next.wash ? "1" : null);
  applyAppearance();
  return next;
}

export function saveAppearance(patch: Partial<Appearance>) {
  const next = { ...readAppearance(), ...patch };
  put(KEYS.theme, next.theme);
  put(KEYS.glass, next.glass === "default" ? null : next.glass);
  put(KEYS.text, next.text === "m" ? null : next.text);
  put(KEYS.density, next.density === "standard" ? null : next.density);
  put(KEYS.solid, next.solid ? "true" : null);
  applyAppearance(next);
  return next;
}

/** Once, when the new design arrives: every device starts on Automatic with the default glass. */
export function migrateAppearance() {
  if (get("nc-look-apple")) return;
  put("nc-look-apple", "1");
  put(KEYS.theme, "system");
  put(KEYS.solid, null);
  for (const old of ["nc-look-navy", "nc-look-onyx", "nc-look-liquid", "nc-solid"]) put(old, null);
}
