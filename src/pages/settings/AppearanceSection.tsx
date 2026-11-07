import { useState } from "react";
import clsx from "clsx";
import { chime, extrasOn, setExtrasOn } from "@/lib/celebrate";
import { Switch } from "@/components/ui";
import { Section } from "./common";

type Theme = "system" | "light" | "dark" | "purple" | "clay" | "qs" | "onyx" | "pearl" | "navy";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("nc-theme");
    return t === "light" || t === "dark" || t === "system" || t === "purple" || t === "clay" || t === "qs" || t === "pearl" || t === "onyx" || t === "navy" ? t : "navy";
  } catch {
    return "navy";
  }
}

function readSolid(): boolean {
  try {
    return localStorage.getItem("nc-solid-v2") === "true";
  } catch {
    return false;
  }
}

export function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [solid, setSolid] = useState(readSolid);
  const [extras, setExtras] = useState(extrasOn);

  function applyTheme(t: Theme) {
    setTheme(t);
    const root = document.documentElement;
    // Onyx, QS Team glass and Purple glass are the dark theme with a palette over it; Pearl and Clay
    // glass are the light theme with a palette over it.
    if (t === "purple" || t === "clay" || t === "qs" || t === "onyx" || t === "pearl" || t === "navy") root.dataset.palette = t;
    else delete root.dataset.palette;
    const base = t === "purple" || t === "qs" || t === "onyx" || t === "navy" ? "dark" : t === "clay" || t === "pearl" ? "light" : t;
    try {
      if (base === "system") delete root.dataset.theme;
      else root.dataset.theme = base;
      localStorage.setItem("nc-theme", t);
    } catch {
      if (base !== "system") root.dataset.theme = base;
    }
  }

  function applySolid(v: boolean) {
    setSolid(v);
    const root = document.documentElement;
    if (v) root.dataset.solid = "true";
    else delete root.dataset.solid;
    try {
      if (v) localStorage.setItem("nc-solid-v2", "true");
      else localStorage.removeItem("nc-solid-v2");
    } catch {
      /* the switch still works for this visit */
    }
  }

  const options: { value: Theme; label: string }[] = [
    { value: "navy", label: "Northcroft navy" },
    { value: "onyx", label: "Onyx" },
    { value: "pearl", label: "Pearl" },
    { value: "qs", label: "QS Team glass" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "purple", label: "Purple glass" },
    { value: "clay", label: "Clay glass" },
    { value: "system", label: "Automatic" },
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Section title="Appearance" sub="These choices are saved on this device only.">
        <div className="theme-choice" role="radiogroup" aria-label="Theme">
          {options.map((o) => (
            <button key={o.value} className={clsx(theme === o.value && "active")} onClick={() => applyTheme(o.value)} role="radio" aria-checked={theme === o.value} type="button">
              <span className={clsx("theme-swatch", o.value)} />
              {o.label}
            </button>
          ))}
        </div>
        <div className="muted small">
          Northcroft navy is the default: deep navy clay with white text, the Northcroft red main button, soft blue highlights,
          and each card's icon in its own colour. Onyx is soft charcoal clay in the Northcroft QS Team world, with film grain, a soft red glow and the skyline,
          white serif headings, puffy clay buttons that squash when you press them, and every row of a table as its own thick clay
          block. Pearl is the same clay in warm light grey, with black ink and the logo on its black plate. QS Team glass is deep navy with a blue glow and the Riyadh skyline along the
          bottom. Purple glass is a deep navy-to-purple background with frosted panels and a soft glow. Clay glass keeps the light glass
          but makes cards, buttons and tabs soft and puffy, like clay, and buttons sink a little when you press them. Automatic follows your phone or
          computer, switching to dark at night if you've set it up that way.
        </div>
      </Section>
      <Section title="Easier reading">
        <div className="setting-row">
          <div className="grow">
            <b>Solid surfaces</b>
            <small>Replaces the see-through glass in the glass looks with solid panels. Turn this on if text over the coloured background is hard to read, or to save battery on older phones. Onyx and Pearl are solid clay already.</small>
          </div>
          <Switch checked={solid} onChange={applySolid} label="Solid surfaces" />
        </div>
      </Section>
      <Section title="Celebrations">
        <div className="setting-row">
          <div className="grow">
            <b>Sound and buzz</b>
            <small>A short chime, and a small buzz on Android phones, with the confetti when work is approved or handed in early. iPhones stay quiet when on silent.</small>
          </div>
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
      </Section>
    </div>
  );
}
