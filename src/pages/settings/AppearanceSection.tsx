// Settings > Appearance, laid out like iOS Settings > Display & Brightness:
//   Light, Dark or Automatic, with a little phone for each
//   Colour: Northcroft navy (standard) or Apple blue
//   Glass: how see-through the bars and cards are (Clear to Tinted, like iOS 27's slider)
//   Text size and list spacing
//   Reduce transparency
//   App icon style (in the iPhone app)
//   Celebrations
// Everything is saved on this device (lib/appearance.ts) and applies straight away.
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Link } from "react-router-dom";
import { Check, ChevronRight, Palette } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { chime, extrasOn, setExtrasOn } from "@/lib/celebrate";
import { readAppearance, saveAppearance, type AccentPref, type Appearance, type DensityPref, type GlassPref, type TextPref, type ThemePref } from "@/lib/appearance";
import { Segmented, Switch, useToast } from "@/components/ui";
import { isNativeApp } from "@/native/platform";
import { NorthcroftNative } from "@/native/plugin";
import { haptic } from "@/lib/motion";
import "@/styles/appearance.css";

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Automatic" },
];

const GLASS: { value: GlassPref; label: string }[] = [
  { value: "clear", label: "Clear" },
  { value: "default", label: "Default" },
  { value: "tinted", label: "Tinted" },
];

const ACCENTS: { value: AccentPref; label: string }[] = [
  { value: "northcroft", label: "Northcroft" },
  { value: "apple", label: "Apple blue" },
];

const TEXT: TextPref[] = ["s", "m", "l", "xl"];
const TEXT_LABEL: Record<TextPref, string> = { s: "Small", m: "Default", l: "Large", xl: "Larger" };

const ICONS: { name: string | null; label: string; src: string }[] = [
  { name: null, label: "Standard", src: "/icons/styles/standard.png" },
  { name: "AppIcon-Light", label: "Light", src: "/icons/styles/light.png" },
  { name: "AppIcon-Blue", label: "Blue", src: "/icons/styles/blue.png" },
];

/** A tiny phone screen in light or dark, the way iOS shows the choice. */
function MiniPhone({ kind }: { kind: ThemePref }) {
  return (
    <span className={clsx("ap-phone", kind)} aria-hidden>
      <span className="ap-screen">
        <span className="ap-title" />
        <span className="ap-card">
          <i />
          <i />
          <i />
        </span>
        <span className="ap-bar">
          <b />
          <b />
          <b />
        </span>
      </span>
      {kind === "system" && (
        <span className="ap-screen dark-half">
          <span className="ap-title" />
          <span className="ap-card">
            <i />
            <i />
            <i />
          </span>
          <span className="ap-bar">
            <b />
            <b />
            <b />
          </span>
        </span>
      )}
    </span>
  );
}

export function AppearanceSection() {
  const toast = useToast();
  const { isManager } = useAuth();
  const [a, setA] = useState<Appearance>(readAppearance);
  const [extras, setExtras] = useState(extrasOn);
  const [icon, setIcon] = useState<{ supported: boolean; current: string | null } | null>(null);

  useEffect(() => {
    if (!isNativeApp()) return;
    NorthcroftNative.appIcon()
      .then((r) => setIcon({ supported: r.supported, current: r.current ?? null }))
      .catch(() => setIcon(null));
  }, []);

  const set = (patch: Partial<Appearance>) => {
    haptic();
    setA(saveAppearance(patch));
  };

  const textIndex = TEXT.indexOf(a.text);

  return (
    <div className="appearance">
      <div className="group-title first">Appearance</div>
      <div className="group">
        <div className="ap-themes" role="radiogroup" aria-label="Appearance">
          {THEMES.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={a.theme === t.value} className={clsx("ap-theme", a.theme === t.value && "on")} onClick={() => set({ theme: t.value })}>
              <MiniPhone kind={t.value} />
              <span className="ap-label">{t.label}</span>
              <span className="ap-radio">{a.theme === t.value && <Check />}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="group-foot">Automatic follows your phone or computer, so the app turns dark at night if you've set it up that way.</div>

      <div className="group-title">Colour</div>
      <div className="group">
        <div className="group-row no-tile static">
          <span className="label">Buttons and links</span>
          <Segmented<AccentPref> value={a.accent} onChange={(v) => set({ accent: v })} options={ACCENTS} />
        </div>
      </div>
      <div className="group-foot">Northcroft is the company navy. Apple blue is the iPhone's standard blue.</div>

      <div className="group-title">Liquid Glass</div>
      <div className="group">
        <div className="ap-glass-preview" aria-hidden>
          <span className="ap-glass-art" />
          <span className="ap-glass-bar lg">
            <span className="on" />
            <span />
            <span />
            <span />
          </span>
        </div>
        <div className="group-row no-tile static">
          <span className="label">Glass</span>
          <Segmented<GlassPref> value={a.glass} onChange={(v) => set({ glass: v })} options={GLASS} />
        </div>
        <div className="group-row no-tile static">
          <span className="label">
            Reduce transparency
            <small>The bars, menus, panels and cards turn solid.</small>
          </span>
          <Switch checked={a.solid} onChange={(v) => set({ solid: v })} label="Reduce transparency" />
        </div>
      </div>
      <div className="group-foot">Clear lets more colour show through the bars, menus and cards; Tinted makes them frostier and easier to read.</div>

      <div className="group-title">Text and lists</div>
      <div className="group">
        <div className="group-row no-tile static column">
          <span className="label">
            Text size <span className="ap-value">{TEXT_LABEL[a.text]}</span>
          </span>
          <div className="ap-slider">
            <span className="ap-a small">A</span>
            <input
              type="range"
              min={0}
              max={TEXT.length - 1}
              step={1}
              value={textIndex}
              onChange={(e) => set({ text: TEXT[Number(e.target.value)] })}
              aria-label="Text size"
              aria-valuetext={TEXT_LABEL[a.text]}
              style={{ ["--pct" as string]: `${(textIndex / (TEXT.length - 1)) * 100}%` }}
            />
            <span className="ap-a large">A</span>
          </div>
        </div>
        <div className="group-row no-tile static">
          <span className="label">List spacing</span>
          <Segmented<DensityPref>
            value={a.density}
            onChange={(v) => set({ density: v })}
            options={[
              { value: "compact", label: "Compact" },
              { value: "standard", label: "Standard" },
              { value: "roomy", label: "Roomy" },
            ]}
          />
        </div>
      </div>

      {icon?.supported && (
        <>
          <div className="group-title">App icon</div>
          <div className="group">
            <div className="ap-icons" role="radiogroup" aria-label="App icon">
              {ICONS.map((i) => {
                const on = (icon.current ?? null) === i.name;
                return (
                  <button
                    key={i.label}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={clsx("ap-icon", on && "on")}
                    onClick={async () => {
                      haptic();
                      const r = await NorthcroftNative.setAppIcon({ name: i.name }).catch(() => ({ ok: false }));
                      if (r.ok) setIcon({ supported: true, current: i.name });
                      else toast("The icon couldn't be changed just now", "error");
                    }}
                  >
                    <img src={i.src} alt="" />
                    <span>{i.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="group-foot">The Standard icon also follows the Home Screen's dark and tinted icon styles.</div>
        </>
      )}

      <div className="group-title">Celebrations</div>
      <div className="group">
        <div className="group-row no-tile static">
          <span className="label">
            Sound and buzz
            <small>A short chime and a small buzz with the confetti when work is approved or handed in early.</small>
          </span>
          <Switch
            checked={extras}
            onChange={(v) => {
              setExtras(v);
              setExtrasOn(v);
              if (v) chime(false);
            }}
            label="Celebration sound and buzz"
          />
        </div>
      </div>
      <div className="group-foot">These choices are saved on this device only.</div>

      {isManager && (
        <>
          <div className="group">
            <Link to="/design" className="group-row">
              <span className="tile" style={{ background: "#AF52DE" }}>
                <Palette />
              </span>
              <span className="label">
                Design gallery
                <small>Every part of the look with sample data</small>
              </span>
              <ChevronRight className="chev" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
