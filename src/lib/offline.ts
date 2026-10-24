// Working without signal: the connection state, and whose data the phone keeps.
//
// The service worker (public/sw.js) keeps a copy of what each screen loaded, in a store per person
// ("northcroft-data-<user id>"). With no signal, screens show that copy. The store is only ever
// read for the person who's signed in, and it's cleared when they sign out or someone else signs in
// on the same phone.
import { useEffect, useState } from "react";
import { SUPABASE_URL } from "./config";

const META_CACHE = "northcroft-meta";
const SESSION_KEY = "/__nc/session";
const DATA_PREFIX = "northcroft-data-";

const hasCaches = () => typeof caches !== "undefined";

/** Online or not, from the phone's own signal. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function tellWorker(msg: unknown) {
  navigator.serviceWorker?.controller?.postMessage(msg);
  navigator.serviceWorker?.ready.then((r) => r.active?.postMessage(msg)).catch(() => {});
}

/**
 * Who is signed in on this phone, for the service worker. It also clears anyone else's saved
 * copy, so a shared phone never shows one person's data to another.
 */
export async function rememberUser(userId: string) {
  if (!hasCaches()) return;
  try {
    const meta = await caches.open(META_CACHE);
    await meta.put(SESSION_KEY, new Response(JSON.stringify({ user: userId, api: new URL(SUPABASE_URL).origin }), { headers: { "Content-Type": "application/json" } }));
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(DATA_PREFIX) && k !== DATA_PREFIX + userId).map((k) => caches.delete(k)));
  } catch {
    /* storage unavailable: the app still works online */
  }
  tellWorker({ type: "nc-session", user: userId, api: new URL(SUPABASE_URL).origin });
}

/** Signing out: forget whose data this is and remove every saved copy. */
export async function forgetUser() {
  tellWorker({ type: "nc-session", user: null });
  if (!hasCaches()) return;
  try {
    const meta = await caches.open(META_CACHE);
    await meta.delete(SESSION_KEY);
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(DATA_PREFIX)).map((k) => caches.delete(k)));
  } catch {
    /* nothing saved */
  }
}

/**
 * Fetch every screen's code once per version while online, so any screen opens with no signal,
 * not just the ones already visited. The service worker keeps each file. The PDF and Excel editors
 * are left out (they're large); they're kept once they've been opened.
 */
export async function warmScreens() {
  if (!("serviceWorker" in navigator) || navigator.onLine === false) return;
  const running = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute("src");
  if (!running) return; // local development
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  try {
    if (localStorage.getItem("nc-warmed") === running) return;
  } catch {
    /* fine: warm again */
  }
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) return; // first visit: next time, once the worker is in charge
  try {
    const res = await fetch("/offline-assets.json", { cache: "no-store" });
    if (!res.ok) return;
    const { files, all } = (await res.json()) as { files: string[]; all?: string[] };
    const queue = files.filter((f) => f.startsWith("/assets/"));
    // A few at a time, so it never gets in the way of what's on screen.
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) await fetch(f).catch(() => {});
    };
    await Promise.all([worker(), worker(), worker()]);
    // The phone keeps this version's and the previous version's code, and lets older files go.
    if (all?.length) tellWorker({ type: "nc-assets", files: all });
    localStorage.setItem("nc-warmed", running);
  } catch {
    /* try again next time the app opens */
  }
}
