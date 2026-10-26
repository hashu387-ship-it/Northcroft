// Who's online right now, and when everyone was last on.
//
// Online: the app joins the "online" Realtime presence channel while it's open on the screen and
// the person has used it in the last 10 minutes. It leaves when the app goes to the background,
// the screen locks, the person stops using it for 10 minutes, or the phone loses signal. A photo
// of someone who's online gets a green dot. Nothing about this is saved.
//
// Last online: saved in last_online through mark_online(), every minute while the person is online
// and once more when they go (the time they last touched the app, when they went idle).
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AUTH_STORAGE_KEY, supabase } from "./supabase";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";
import { DOW_SHORT, dateOf, diffDays, dow, fmtDate, fmtTime12, todayISO } from "./time";

/** No taps, typing or scrolling for this long and you show as away (last online when you stopped). */
const IDLE_MS = 10 * 60_000;
/** How often your last online time is saved while you're online. */
const BEAT_MS = 60_000;

/* ---------------------------------------------------------------- who's online, for every screen */
type State = { me: string | null; ids: ReadonlySet<string> };
let state: State = { me: null, ids: new Set() };
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function setState(next: State) {
  state = next;
  listeners.forEach((fn) => fn());
}

/** True while this person has the app open (never true for yourself: you know you're here). */
export function useIsOnline(id: string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => !!id && id !== state.me && state.ids.has(id));
}

/** Everyone online now, not counting you. */
export function useOnlineIds(): ReadonlySet<string> {
  const s = useSyncExternalStore(subscribe, () => state);
  return useMemo(() => {
    const out = new Set(s.ids);
    if (s.me) out.delete(s.me);
    return out;
  }, [s]);
}

/* ---------------------------------------------------------------- last online, from the database */
type SeenRow = { user_id: string; seen_at: string };

/** When each person was last on (user id to time). People with no time yet aren't in it. */
export function useLastOnline(): Map<string, string> {
  const q = useQuery({
    queryKey: ["last_online"],
    queryFn: async () => {
      const { data, error } = await supabase.from("last_online").select("user_id, seen_at");
      if (error) throw error;
      return (data ?? []) as SeenRow[];
    },
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return useMemo(() => new Map((q.data ?? []).map((r) => [r.user_id, r.seen_at])), [q.data]);
}

/** The time now, refreshed every half minute, so "5 min ago" keeps moving. */
export function useClock(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * When someone was last on, in words.
 * Long: "just now", "12 min ago", "today at 3:42 pm", "yesterday at 6:05 pm", "Mon at 9:10 am", "12 Oct".
 * Short (lists): "Just now", "12 min ago", "Today 3:42 pm", "Yesterday 6:05 pm", "Mon 9:10 am", "12 Oct".
 */
export function lastOnlineWhen(at: string, now = Date.now(), long = false): string {
  const mins = Math.floor((now - new Date(at).getTime()) / 60_000);
  if (mins < 1) return long ? "just now" : "Just now";
  if (mins < 60) return `${mins} min ago`;
  const day = dateOf(at);
  const days = diffDays(todayISO(), day);
  const time = fmtTime12(at);
  if (days <= 0) return long ? `today at ${time}` : `Today ${time}`;
  if (days === 1) return long ? `yesterday at ${time}` : `Yesterday ${time}`;
  if (days < 7) return long ? `${DOW_SHORT[dow(day)]} at ${time}` : `${DOW_SHORT[dow(day)]} ${time}`;
  return day.slice(0, 4) === todayISO().slice(0, 4) ? fmtDate(day) : fmtDate(day, { day: "numeric", month: "short", year: "numeric" });
}

/** "Online", "Last online today at 3:42 pm", or null when there's no time yet. */
export function useOnlineLine(id: string | null | undefined): { online: boolean; text: string | null } {
  const online = useIsOnline(id);
  const seen = useLastOnline();
  const now = useClock();
  if (!id) return { online: false, text: null };
  if (online) return { online: true, text: "Online" };
  const at = seen.get(id);
  return { online: false, text: at ? `Last online ${lastOnlineWhen(at, now, true)}` : null };
}

/* ---------------------------------------------------------------- being online yourself */

/** Joins the online list while you're using the app, and saves your last online time. Call once, in the app shell. */
export function useOnlineTracking(meId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!meId) return;
    return startOnline(meId, qc);
  }, [meId, qc]);
}

function savedToken(): string | null {
  try {
    return (JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? "null") as { access_token?: string } | null)?.access_token ?? null;
  } catch {
    return null;
  }
}

function startOnline(meId: string, qc: QueryClient) {
  setState({ me: meId, ids: new Set() });
  let lastInput = Date.now();
  let joined = false;
  let tracking = false;
  let lastMark = 0;
  let refetchTimer = 0;
  const channel = supabase.channel("online", { config: { presence: { key: meId } } });

  /** Save "on now", or the time they last used the app. */
  const mark = (at?: number) => {
    lastMark = Date.now();
    supabase.rpc("mark_online", at ? { p_at: new Date(at).toISOString() } : {}).then(
      () => undefined,
      () => undefined,
    );
  };
  /** The same, sent so it still arrives while the app is being closed or put away. */
  const markOnLeave = () => {
    lastMark = Date.now();
    const token = savedToken();
    if (!token) return;
    fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_online`, {
      method: "POST",
      keepalive: true,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
  };

  const using = () => document.visibilityState === "visible" && navigator.onLine !== false && Date.now() - lastInput < IDLE_MS;

  const update = () => {
    const want = joined && using();
    if (want && !tracking) {
      tracking = true;
      void channel.track({ online_at: new Date().toISOString() });
      mark();
    } else if (!want && tracking) {
      tracking = false;
      if (document.visibilityState === "hidden") markOnLeave();
      else mark(Date.now() - lastInput >= IDLE_MS ? lastInput : undefined);
      void channel.untrack();
    } else if (want && Date.now() - lastMark >= BEAT_MS) {
      mark();
    }
  };

  channel.on("presence", { event: "sync" }, () => {
    const ids = new Set(Object.keys(channel.presenceState()));
    const prev = state.ids;
    if (ids.size === prev.size && [...ids].every((id) => prev.has(id))) return;
    // Someone went: their last online time has just been saved, so fetch it.
    if ([...prev].some((id) => !ids.has(id))) {
      window.clearTimeout(refetchTimer);
      refetchTimer = window.setTimeout(() => void qc.invalidateQueries({ queryKey: ["last_online"] }), 2500);
    }
    setState({ me: meId, ids });
  });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      // Joined (or back after losing signal): say we're here again if we're using the app.
      joined = true;
      tracking = false;
      update();
    } else {
      // Lost the connection: don't keep showing dots we can no longer vouch for. They come back
      // with the full list as soon as it reconnects.
      joined = false;
      tracking = false;
      if (state.ids.size) setState({ me: meId, ids: new Set() });
    }
  });

  const onInput = () => {
    lastInput = Date.now();
    if (!tracking) update();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") lastInput = Date.now();
    update();
  };
  const onPageHide = () => {
    if (tracking) markOnLeave();
  };
  const inputs = ["pointerdown", "pointermove", "keydown", "touchstart", "wheel", "scroll"] as const;
  for (const e of inputs) window.addEventListener(e, onInput, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  const timer = window.setInterval(update, 20_000);

  return () => {
    for (const e of inputs) window.removeEventListener(e, onInput, { capture: true });
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
    window.clearInterval(timer);
    window.clearTimeout(refetchTimer);
    if (tracking) {
      mark();
      void channel.untrack();
    }
    void supabase.removeChannel(channel);
    setState({ me: null, ids: new Set() });
  };
}
