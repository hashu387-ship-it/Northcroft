// Data hooks for the home and communication screens. Keys start with the table name
// so the realtime channel refreshes them automatically.
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { unwrap } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { addDays, todayISO } from "@/lib/time";
import type {
  Announcement,
  AnnouncementAck,
  Attendance,
  BoqPackage,
  CalendarEvent,
  Notification,
  Variation,
} from "@/lib/types";

export const PENDING_VO = ["identified", "requested", "quoted", "evaluation", "recommended", "disputed"];

/** Attendance rows for one day. Pass userId for just one person. */
export function useAttendanceOn(date: string, userId?: string) {
  return useQuery({
    queryKey: ["attendance", "day", date, userId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("attendance").select("*").eq("work_date", date);
      if (userId) q = q.eq("user_id", userId);
      return unwrap<Attendance[]>(q);
    },
  });
}

export function useAnnouncements() {
  return useQuery({
    queryKey: ["announcements", "list"],
    queryFn: () =>
      unwrap<Announcement[]>(
        supabase
          .from("announcements")
          .select("*")
          .order("pinned", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(100),
      ),
  });
}

export function useAcks() {
  return useQuery({
    queryKey: ["announcement_acks", "all"],
    queryFn: () => unwrap<AnnouncementAck[]>(supabase.from("announcement_acks").select("*").limit(5000)),
  });
}

/** Announcements with who has acknowledged each one. */
export function useAnnouncementsWithAcks() {
  const anns = useAnnouncements();
  const acks = useAcks();
  const data = useMemo(() => {
    const byAnn = new Map<string, AnnouncementAck[]>();
    for (const a of acks.data ?? []) byAnn.set(a.announcement_id, [...(byAnn.get(a.announcement_id) ?? []), a]);
    return (anns.data ?? []).map((a) => ({ ...a, acks: byAnn.get(a.id) ?? [] }));
  }, [anns.data, acks.data]);
  return { data, isLoading: anns.isLoading || acks.isLoading };
}

export type AnnouncementWithAcks = Announcement & { acks: AnnouncementAck[] };

export function needsMyAck(a: AnnouncementWithAcks, meId: string) {
  return a.requires_ack && a.author_id !== meId && !a.acks.some((k) => k.user_id === meId);
}

export async function acknowledge(announcementId: string, userId: string) {
  const { error } = await supabase.from("announcement_acks").insert({ announcement_id: announcementId, user_id: userId });
  if (error && !/duplicate key/i.test(error.message)) throw error;
}

/** VOs with an action date in the next couple of days (or already past) that are still open. */
export function useVoAlerts(days = 2) {
  const today = todayISO();
  return useQuery({
    queryKey: ["variations", "alerts", today, days],
    queryFn: () =>
      unwrap<Variation[]>(
        supabase
          .from("variations")
          .select("*")
          .in("status", PENDING_VO)
          .not("response_due", "is", null)
          .lte("response_due", addDays(today, days))
          .order("response_due"),
      ),
  });
}

export function useBoqAlerts(days = 5) {
  const today = todayISO();
  return useQuery({
    queryKey: ["boq_packages", "alerts", today, days],
    queryFn: () =>
      unwrap<BoqPackage[]>(
        supabase
          .from("boq_packages")
          .select("*")
          .neq("status", "issued")
          .not("due_date", "is", null)
          .lte("due_date", addDays(today, days))
          .order("due_date"),
      ),
  });
}

export function useEventsBetween(from: string, to: string) {
  return useQuery({
    queryKey: ["events", "range", from, to],
    queryFn: () =>
      unwrap<CalendarEvent[]>(
        supabase
          .from("events")
          .select("*")
          .gte("event_date", from)
          .lte("event_date", to)
          .order("event_date")
          .order("start_time", { ascending: true, nullsFirst: true }),
      ),
  });
}

export function useBoqBetween(from: string, to: string) {
  return useQuery({
    queryKey: ["boq_packages", "range", from, to],
    queryFn: () =>
      unwrap<BoqPackage[]>(
        supabase.from("boq_packages").select("*").neq("status", "issued").gte("due_date", from).lte("due_date", to),
      ),
  });
}

export function useVosBetween(from: string, to: string) {
  return useQuery({
    queryKey: ["variations", "range", from, to],
    queryFn: () =>
      unwrap<Variation[]>(
        supabase.from("variations").select("*").in("status", PENDING_VO).gte("response_due", from).lte("response_due", to),
      ),
  });
}

export function useNotifications(userId: string) {
  return useQuery({
    queryKey: ["notifications", "list", userId],
    queryFn: () =>
      unwrap<Notification[]>(
        supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(300),
      ),
  });
}
