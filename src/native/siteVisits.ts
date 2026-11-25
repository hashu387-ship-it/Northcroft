// The site visit log and site trips (iPhone app). The phone notices arriving at and leaving
// project sites (SiteWatcher) and keeps the times; this saves them to public.site_visits when the
// app opens. Saving is retried later if it fails (offline, say), so no visit is lost.
import { useCallback, useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { unwrap } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Place } from "@/lib/types";
import { NorthcroftNative, type SiteEvent } from "./plugin";
import { isNativeApp } from "./platform";

export interface SiteVisit {
  id: string;
  user_id: string;
  place_id: string | null;
  place_name: string;
  project_id: string | null;
  arrived_at: string;
  left_at: string | null;
  source: "gps" | "trip";
  created_at: string;
}

const QUEUE = "nc-site-queue";
/** placeId -> the open visit's id (arrived, not left yet). */
const OPEN = "nc-site-open";

function load<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

/** Takes what the phone noticed and saves it. Returns how many were saved. */
let flushing = false;
export async function flushSiteVisits(meId: string): Promise<number> {
  if (flushing || !isNativeApp()) return 0;
  flushing = true;
  try {
    const { events } = await NorthcroftNative.siteTake().catch(() => ({ events: [] as SiteEvent[] }));
    const queue = [...load<SiteEvent[]>(QUEUE, []), ...events].slice(-300);
    save(QUEUE, queue);
    const open = load<Record<string, string>>(OPEN, {});
    let done = 0;
    while (queue.length) {
      const e = queue[0];
      const at = new Date(e.atMs).toISOString();
      if (e.kind === "arrive") {
        if (!open[e.placeId]) {
          const id = crypto.randomUUID();
          const { error } = await supabase.from("site_visits").insert({
            id,
            user_id: meId,
            place_id: e.placeId,
            place_name: e.name.slice(0, 120),
            project_id: e.projectId ?? null,
            arrived_at: at,
            source: e.source === "trip" ? "trip" : "gps",
          });
          if (error) break;
          open[e.placeId] = id;
        }
      } else {
        let id = open[e.placeId];
        if (!id) {
          // Arrived before the log was on, or on another phone: close the latest open visit there.
          const { data, error } = await supabase
            .from("site_visits")
            .select("id")
            .eq("user_id", meId)
            .eq("place_id", e.placeId)
            .is("left_at", null)
            .gte("arrived_at", new Date(e.atMs - 16 * 3600_000).toISOString())
            .order("arrived_at", { ascending: false })
            .limit(1)
            .maybeSingle<{ id: string }>();
          if (error) break;
          id = data?.id ?? "";
        }
        if (id) {
          const { error } = await supabase.from("site_visits").update({ left_at: at }).eq("id", id).lte("arrived_at", at);
          if (error) break;
        }
        delete open[e.placeId];
      }
      queue.shift();
      done++;
      save(QUEUE, queue);
      save(OPEN, open);
    }
    return done;
  } finally {
    flushing = false;
  }
}

/** Keeps the phone watching the team's active sites while the log is on, and saves visits when the app opens. */
export function useSiteVisitLog(meId: string, places: Place[] | undefined, on: boolean) {
  const qc = useQueryClient();
  const key = JSON.stringify(
    (places ?? [])
      .filter((p) => p.kind === "site" && p.active)
      .map((p) => [p.id, p.lat, p.lng, p.radius_m])
      .sort(),
  );
  useEffect(() => {
    if (!places) return;
    if (!on) {
      void NorthcroftNative.siteStop().catch(() => undefined);
      return;
    }
    const sites = places
      .filter((p) => p.kind === "site" && p.active)
      .map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, radius: p.radius_m, projectId: p.project_id ?? undefined }));
    void NorthcroftNative.siteWatch({ sites }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key]);

  useEffect(() => {
    const flush = () =>
      void flushSiteVisits(meId).then((n) => {
        if (n) void qc.invalidateQueries({ queryKey: ["site_visits"] });
      });
    flush();
    const sub = App.addListener("appStateChange", (s) => {
      if (s.isActive) flush();
    });
    return () => void sub.then((h) => h.remove());
  }, [meId, qc]);
}

/** My recent site visits, or everyone's today (managers and those who assign tasks). */
export function useSiteVisits(scope: { userId: string } | { since: string }) {
  return useQuery({
    queryKey: ["site_visits", scope],
    retry: false,
    queryFn: () => {
      let q = supabase.from("site_visits").select("*").order("arrived_at", { ascending: false });
      if ("userId" in scope) q = q.eq("user_id", scope.userId).limit(20);
      else q = q.gte("arrived_at", scope.since).limit(100);
      return unwrap<SiteVisit[]>(q);
    },
  });
}

/** The site trip running on this phone, if any. */
export function useTrip() {
  const [trip, setTrip] = useState<{ placeId: string; placeName: string; startedAtMs: number } | null>(null);
  const refresh = useCallback(async () => {
    if (!isNativeApp()) return;
    const r = await NorthcroftNative.tripStatus().catch(() => ({ running: false }) as { running: boolean });
    const t = r as { running: boolean; placeId?: string; placeName?: string; startedAtMs?: number };
    setTrip(t.running && t.placeId ? { placeId: t.placeId, placeName: t.placeName ?? "Site", startedAtMs: t.startedAtMs ?? Date.now() } : null);
  }, []);
  useEffect(() => {
    if (!isNativeApp()) return;
    void refresh();
    const sub = App.addListener("appStateChange", (s) => {
      if (s.isActive) void refresh();
    });
    return () => void sub.then((h) => h.remove());
  }, [refresh]);
  return { trip, refresh };
}
