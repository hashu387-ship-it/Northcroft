import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

const TABLES = [
  "tasks", "task_checklist", "comments", "announcements", "announcement_acks", "attendance",
  "variations", "boq_packages", "events", "projects", "attachments", "profiles",
];

/** One channel that refreshes cached queries whenever a row changes anywhere in the team. */
export function useRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const timers = new Map<string, number>();
    const bump = (table: string) => {
      // Coalesce bursts (a trigger can touch several rows at once).
      window.clearTimeout(timers.get(table));
      timers.set(
        table,
        window.setTimeout(() => {
          qc.invalidateQueries({ queryKey: [table] });
          if (table === "tasks" || table === "variations" || table === "boq_packages") qc.invalidateQueries({ queryKey: ["activity"] });
        }, 150),
      );
    };
    let channel = supabase.channel(`northcroft-${userId}`);
    for (const t of TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: t }, () => bump(t));
    }
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      () => bump("notifications"),
    );
    channel.subscribe();

    // Catch up after the phone wakes or the tab comes back.
    const onVisible = () => {
      if (document.visibilityState === "visible") qc.invalidateQueries();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      timers.forEach((t) => window.clearTimeout(t));
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
