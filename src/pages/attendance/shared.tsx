import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, HardHat, MapPin, MapPinOff } from "lucide-react";
import { unwrap } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { TZ } from "@/lib/config";
import { addDays, todayISO } from "@/lib/time";
import type { Attendance, Place } from "@/lib/types";
import { Pill, Spinner } from "@/components/ui";
import type { MapPoint } from "@/components/MapView";

export const LazyMap = lazy(() => import("@/components/MapView"));

export function MapBox({ points, className = "map small", onPick, showLabels }: { points: MapPoint[]; className?: string; onPick?: (lat: number, lng: number) => void; showLabels?: boolean }) {
  return (
    <Suspense
      fallback={
        <div className={className} style={{ display: "grid", placeItems: "center", background: "var(--fill)" }}>
          <Spinner />
        </div>
      }
    >
      <LazyMap points={points} className={className} onPick={onPick} showLabels={showLabels} />
    </Suspense>
  );
}

type Kind = Attendance["in_place_kind"];

export function placeTone(kind: Kind): string {
  if (kind === "office") return "green";
  if (kind === "site") return "blue";
  if (kind === "elsewhere") return "orange";
  return "gray";
}

export function PlacePill({ kind, name }: { kind: Kind; name: string | null }) {
  const Icon = kind === "office" ? Building2 : kind === "site" ? HardHat : kind === "elsewhere" ? MapPin : MapPinOff;
  return (
    <Pill tone={placeTone(kind)}>
      <Icon />
      <span className="ellipsis" style={{ maxWidth: 180 }}>
        {name || (kind === "unknown" ? "Location unavailable" : "Elsewhere")}
      </span>
    </Pill>
  );
}

export function isOffsite(a: Attendance) {
  return a.in_place_kind === "elsewhere" || a.out_place_kind === "elsewhere";
}

const clockFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
const hmFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

export function clockParts(d: Date) {
  const parts = clockFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hm: `${get("hour")}:${get("minute")}`, s: get("second"), ampm: get("dayPeriod").toLowerCase() };
}

export function hhmm(ts: string | null | undefined) {
  return ts ? hmFmt.format(new Date(ts)) : "";
}

/** Re-render on an interval (for live clocks and running durations). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function hoursWorked(a: Attendance): number | null {
  if (!a.check_out_at) return null;
  return Math.max(0, (new Date(a.check_out_at).getTime() - new Date(a.check_in_at).getTime()) / 3600000);
}

export function useMyAttendance(userId: string) {
  return useQuery({
    queryKey: ["attendance", "mine", userId],
    queryFn: () =>
      unwrap<Attendance[]>(
        supabase
          .from("attendance")
          .select("*")
          .eq("user_id", userId)
          .gte("work_date", addDays(todayISO(), -45))
          .order("work_date", { ascending: false }),
      ),
  });
}

export function useAttendanceRange(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["attendance", "range", from, to],
    enabled,
    queryFn: () =>
      unwrap<Attendance[]>(
        supabase.from("attendance").select("*").gte("work_date", from).lte("work_date", to).order("work_date").order("check_in_at"),
      ),
  });
}

/** One person on one day, without times or places: for managers who see presence only. */
export interface PresenceRow {
  user_id: string;
  work_date: string;
  present: boolean;
  on_leave: boolean;
}

/** Who was present, absent or on leave each day (up to two months at a time). No times or places. */
export function usePresenceRange(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: ["attendance", "presence", from, to],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("team_presence", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []) as PresenceRow[];
    },
  });
}

/** First day anyone checked in: absences are only counted from here on. */
export function useTrackingStart() {
  return useQuery({
    queryKey: ["attendance", "first"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance").select("work_date").order("work_date", { ascending: true }).limit(1);
      if (error) throw error;
      return (data?.[0]?.work_date as string | undefined) ?? null;
    },
  });
}

export function usePlaces() {
  return useQuery({
    queryKey: ["places"],
    queryFn: () => unwrap<Place[]>(supabase.from("places").select("*").order("kind").order("name")),
    staleTime: 60_000,
  });
}
