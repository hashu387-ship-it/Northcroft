import { useEffect, useState } from "react";

/**
 * Keeps the app on the latest version. Phones often keep the app open in the background for days,
 * so it never reloads by itself. This checks for a newer version when the app comes back to the
 * front (and every 20 minutes while it's open):
 *   - coming back to the app with nothing open or typed: it reloads straight away
 *   - otherwise: an "Update" bar shows, so nobody loses what they were doing
 */
const EVERY = 20 * 60_000;
const MIN_GAP = 60_000;

/** The main script of the version that's running, like /assets/index-AbC123.js. */
function runningScript(): string | null {
  return document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute("src") ?? null;
}

function scriptIn(html: string): string | null {
  return html.match(/<script[^>]*type="module"[^>]*src="(\/assets\/[^"]+)"/)?.[1] ?? null;
}

/** True when reloading now could lose something: a form, a dialog, a file being edited, typed text. */
function busy(): boolean {
  if (document.querySelector('.sheet, .file-screen, [role="dialog"], [aria-modal="true"]')) return true;
  const a = document.activeElement as HTMLElement | null;
  if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable)) return true;
  for (const t of Array.from(document.querySelectorAll("textarea"))) if (t.value.trim()) return true;
  return false;
}

export function useAppUpdates() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const running = runningScript();
    if (!running) return; // local development: there's no built version to compare
    let found = false;
    let lastCheck = Date.now();

    async function newer(): Promise<boolean> {
      if (found) return true;
      lastCheck = Date.now();
      try {
        const res = await fetch(`/?version-check=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return false;
        const latest = scriptIn(await res.text());
        found = !!latest && latest !== running;
      } catch {
        /* offline: try again later */
      }
      return found;
    }

    async function onShow() {
      if (document.visibilityState !== "visible") return;
      if (!found && Date.now() - lastCheck < MIN_GAP) return;
      if (!(await newer())) return;
      if (busy()) setReady(true);
      else window.location.reload();
    }

    document.addEventListener("visibilitychange", onShow);
    const timer = window.setInterval(async () => {
      if (document.visibilityState === "visible" && (await newer())) setReady(true);
    }, EVERY);
    return () => {
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(timer);
    };
  }, []);

  return { ready, update: () => window.location.reload() };
}
