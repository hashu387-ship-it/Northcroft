// Keeps the iPhone's own places up to date with Northcroft (iPhone app only, used by NativeBridge):
//   - the workday Live Activity (lock screen and Dynamic Island) while checked in
//   - Spotlight: projects and your open tasks in the iPhone's search
//   - the Northcroft calendar: your task deadlines, site visits and meetings (when switched on)
//   - small taps from the phone (haptics) on tabs, switches and main buttons
import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { addDays, fmtDue } from "@/lib/time";
import type { Attendance, CalendarEvent, Project, Task } from "@/lib/types";
import { EVENT_KIND } from "@/lib/constants";
import { NorthcroftNative, type CalendarEntry, type SpotlightItem, type WidgetSnapshot } from "./plugin";

/** Runs fn when the value's JSON changes (not on every render). */
function useOnChange<T>(value: T | null, fn: (v: T) => void) {
  const key = value == null ? "" : JSON.stringify(value);
  const last = useRef("");
  useEffect(() => {
    if (!key || key === last.current) return;
    last.current = key;
    fn(value as T);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/* -------------------------------------------------------------- Live Activity */
export function useLiveWorkday(snapshot: WidgetSnapshot | null, rec: Attendance | undefined, on: boolean) {
  const state = useMemo(() => {
    if (!snapshot) return null;
    const active = on && !snapshot.exempt && !!rec && !rec.check_out_at;
    return {
      checkedIn: active,
      checkedOut: !!rec?.check_out_at,
      checkInAtMs: rec ? Date.parse(rec.check_in_at) : undefined,
      place: rec?.in_place_name ?? undefined,
      dueToday: snapshot.dueToday,
      late: snapshot.late,
      firstName: snapshot.firstName ?? "",
    };
  }, [snapshot, rec, on]);
  useOnChange(state, (s) => void NorthcroftNative.workday(s).catch(() => undefined));
}

/* -------------------------------------------------------------- Spotlight */
export function useSpotlight(tasks: Task[] | undefined, projects: Project[], projectName: (id: string | null) => string | undefined) {
  const items = useMemo<SpotlightItem[] | null>(() => {
    if (!tasks) return null;
    const list: SpotlightItem[] = [];
    for (const p of projects) {
      if (p.status === "completed") continue;
      list.push({
        path: `/projects/${p.id}`,
        title: p.name,
        subtitle: ["Project", p.code, p.client, p.city].filter(Boolean).join(" · "),
        keywords: [p.code, p.client, p.city].filter((x): x is string => !!x),
      });
    }
    for (const t of tasks) {
      if (t.status === "done") continue;
      const project = projectName(t.project_id);
      list.push({
        path: `/tasks/${t.id}`,
        title: t.title,
        subtitle: ["Task", project, t.due_date ? `Due ${fmtDue(t.due_date)}` : null].filter(Boolean).join(" · "),
        keywords: [project ?? "", "task"].filter(Boolean),
      });
    }
    return list.slice(0, 400);
  }, [tasks, projects, projectName]);
  // Wait a moment after the data settles, so a burst of changes is one update.
  const timer = useRef<number>();
  useOnChange(items, (list) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void NorthcroftNative.spotlightIndex({ items: list }).catch(() => undefined), 1500);
  });
}

/* -------------------------------------------------------------- Calendar */
const RIYADH = "+03:00";

function useMyEvents(meId: string, on: boolean, from: string, to: string) {
  return useQuery({
    queryKey: ["events", "mine-for-calendar", meId, from, to],
    enabled: on,
    queryFn: async () => {
      const rows = await unwrap<CalendarEvent[]>(
        supabase.from("events").select("*").gte("event_date", from).lte("event_date", to).order("event_date"),
      );
      return rows.filter((e) => e.created_by === meId || (e.attendees ?? []).includes(meId));
    },
    staleTime: 5 * 60_000,
  });
}

export function useCalendarSync(meId: string, today: string, tasks: Task[] | undefined, projectName: (id: string | null) => string | undefined, on: boolean) {
  const from = addDays(today, -7);
  const to = addDays(today, 120);
  const events = useMyEvents(meId, on, from, to);

  const entries = useMemo<CalendarEntry[] | null>(() => {
    if (!on || !tasks || !events.data) return null;
    const list: CalendarEntry[] = [];
    for (const t of tasks) {
      if (t.status === "done" || !t.due_date || t.due_date < from || t.due_date > to) continue;
      const project = projectName(t.project_id);
      list.push({
        key: `task:${t.id}`,
        title: `Due: ${t.title}`,
        allDay: true,
        date: t.due_date,
        notes: [project ? `Project: ${project}` : null, "Open in Northcroft from the link."].filter(Boolean).join("\n"),
        path: `/tasks/${t.id}`,
      });
    }
    for (const e of events.data) {
      if (e.kind === "leave") continue;
      const kind = EVENT_KIND[e.kind]?.label ?? "Event";
      const project = projectName(e.project_id);
      const timed = !!e.start_time;
      const startMs = timed ? Date.parse(`${e.event_date}T${e.start_time!.slice(0, 8)}${RIYADH}`) : undefined;
      const endMs = timed && e.end_time ? Date.parse(`${e.event_date}T${e.end_time.slice(0, 8)}${RIYADH}`) : startMs !== undefined ? startMs + 3600_000 : undefined;
      list.push({
        key: `event:${e.id}`,
        title: `${kind}: ${e.title}`,
        allDay: !timed,
        date: timed ? undefined : e.event_date,
        startMs,
        endMs,
        location: e.location ?? undefined,
        notes: [project ? `Project: ${project}` : null, e.notes].filter(Boolean).join("\n") || undefined,
        path: "/calendar",
      });
    }
    return list;
  }, [on, tasks, events.data, from, to, projectName]);

  const timer = useRef<number>();
  useOnChange(entries, (list) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void NorthcroftNative.calendarSync({ events: list }).catch(() => undefined), 2000);
  });
}

/* -------------------------------------------------------------- haptics */
// A light tap for main buttons and switches, a "selection" click for tabs and segmented choices.
// The iPhone's own System Haptics setting still applies.
export function useHaptics() {
  useEffect(() => {
    let last = 0;
    const onDown = (ev: PointerEvent) => {
      const el = (ev.target as Element | null)?.closest?.(
        ".tabbar a, .segmented button, [role='tab'], [role='switch'], .switch, .btn.primary, .btn.danger, button.primary",
      );
      if (!el || (el as HTMLButtonElement).disabled) return;
      const now = Date.now();
      if (now - last < 60) return;
      last = now;
      const selection = el.matches(".tabbar a, .segmented button, [role='tab']");
      void NorthcroftNative.haptic({ style: selection ? "selection" : "light" }).catch(() => undefined);
    };
    document.addEventListener("pointerdown", onDown, { passive: true, capture: true });
    return () => document.removeEventListener("pointerdown", onDown, { capture: true });
  }, []);
}
