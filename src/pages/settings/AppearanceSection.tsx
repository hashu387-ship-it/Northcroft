import { useState } from "react";
import clsx from "clsx";
import { chime, extrasOn, setExtrasOn } from "@/lib/celebrate";
import { Switch } from "@/components/ui";
import { Section } from "./common";

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("nc-theme");
    return t === "dark" || t === "system" ? t : "light";
  } catch {
    return "light";
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
    try {
      if (t === "system") delete root.dataset.theme;
      else root.dataset.theme = t;
      // Light is the default, so only Dark and Automatic need remembering.
      if (t === "light") localStorage.removeItem("nc-theme");
      else localStorage.setItem("nc-theme", t);
    } catch {
      if (t !== "system") root.dataset.theme = t;
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
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
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
        <div className="muted small">Light is the default. Automatic follows your phone or computer, switching to dark at night if you've set it up that way.</div>
      </Section>
      <Section title="Easier reading">
        <div className="setting-row">
          <div className="grow">
            <b>Solid surfaces</b>
            <small>Replaces the see-through glass with solid panels. Turn this on if text over the coloured background is hard to read, or to save battery on older phones.</small>
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
