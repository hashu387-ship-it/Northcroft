import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

export const AUTH_STORAGE_KEY = "northcroft-auth";

/* ---- Working without signal ----
   The sign-in token lasts an hour. With no signal the app can't renew it, and the Supabase client
   would then treat the person as signed out and keep retrying for half a minute on every request.
   So while there's no signal, the saved sign-in is read as if it were still fresh: the app opens
   and shows what was saved on the phone. As soon as the phone is back online the real expiry is
   used again, the token is renewed, and anything that was really signed out is signed out. */
let lastNetworkFailure = 0;

/** No signal: the phone says it's offline, or a request has just failed to reach the internet. */
export function looksOffline(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return Date.now() - lastNetworkFailure < 8_000;
}

const authStorage = {
  getItem(key: string): string | null {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      return null;
    }
    if (!raw || key !== AUTH_STORAGE_KEY || !looksOffline()) return raw;
    try {
      const s = JSON.parse(raw) as { expires_at?: number };
      if (s?.expires_at && s.expires_at * 1000 < Date.now() + 5 * 60_000) {
        return JSON.stringify({ ...s, expires_at: Math.floor(Date.now() / 1000) + 3600 });
      }
    } catch {
      /* not ours to read; hand it back as it is */
    }
    return raw;
  },
  setItem(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage blocked: the session lasts for this visit only */
    }
  },
  removeItem(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to remove */
    }
  },
};

/** Notes when a request couldn't reach the internet, so the sign-in above isn't renewed in a loop. */
const trackingFetch: typeof fetch = async (input, init) => {
  try {
    const res = await fetch(input, init);
    lastNetworkFailure = 0;
    return res;
  } catch (e) {
    if (!(init?.signal?.aborted)) lastNetworkFailure = Date.now();
    throw e;
  }
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY, storage: authStorage },
  global: { fetch: trackingFetch },
  realtime: { params: { eventsPerSecond: 10 } },
});

/** True when an error means the request never got through (no signal), rather than being refused. */
export function isNetworkError(e: unknown): boolean {
  if (!e) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const err = e as { name?: string; message?: string; status?: number; code?: string; originalError?: unknown; context?: unknown };
  const msg = `${err.name ?? ""} ${err.message ?? ""}`;
  if (/Failed to fetch|NetworkError|Load failed|network connection was lost|Network request failed|ERR_INTERNET|fetch failed|No connection/i.test(msg)) return true;
  if (err.name === "AuthRetryableFetchError" || err.name === "FunctionsFetchError") return true;
  if (err.originalError) return isNetworkError(err.originalError);
  return false;
}

/** Turn a Supabase/Postgres error into a sentence a person can act on. */
export function errorMessage(e: unknown): string {
  if (!e) return "Something went wrong";
  const msg = typeof e === "string" ? e : (e as { message?: string }).message || "Something went wrong";
  if (/Invalid login credentials/i.test(msg)) return "That email or password is not right.";
  if (/JWT expired|invalid JWT/i.test(msg)) return "Your session expired. Please sign in again.";
  if (/row-level security/i.test(msg)) return "You don't have permission to do that.";
  if (/duplicate key.*vo_number/i.test(msg)) return "That VO number already exists on this project.";
  if (/duplicate key/i.test(msg)) return "That already exists.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "No connection. Check your internet and try again.";
  return msg;
}
