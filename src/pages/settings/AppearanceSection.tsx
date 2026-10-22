import { useState } from "react";
import clsx from "clsx";
import { Switch } from "@/components/ui";
import { Section } from "./common";

type Theme = "system" | "light" | "dark";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("nc-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function readSolid(): boolean {
  try {
    return localStorage.getItem("nc-solid") === "true";
  } catch {
    return false;
  }
}

export function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [solid, setSolid] = useState(readSolid);

  function applyTheme(t: Theme) {
    setTheme(t);
    const root = document.documentElement;
    try {
      if (t === "system") {
        delete root.dataset.theme;
        localStorage.removeItem("nc-theme");
      } else {
        root.dataset.theme = t;
        localStorage.setItem("nc-theme", t);
      }
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
      if (v) localStorage.setItem("nc-solid", "true");
      else localStorage.removeItem("nc-solid");
    } catch {
      /* the switch still works for this visit */
    }
  }

  const options: { value: Theme; label: string }[] = [
    { value: "system", label: "Automatic" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
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
        <div className="muted small">Automatic follows your phone or computer, switching to dark at night if you've set it up that way.</div>
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
    </div>
  );
}
