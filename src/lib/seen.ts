// Opening a chat or a task counts as reading it, like WhatsApp:
// its unread notifications are marked read and cleared from the phone's notification list.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUnreadCount } from "./api";
import { useMe } from "./auth";
import { supabase } from "./supabase";

export type SeenTarget = { taskId: string } | { link: string };

/** The same tag the push sender gives a conversation (see supabase/functions/send-push/compose.ts). */
export function notificationTag(t: SeenTarget): string {
  if ("taskId" in t) return `task-${t.taskId}`;
  return `l-${t.link.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

async function clearPhoneNotifications(tag: string) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const list = (await reg?.getNotifications({ tag })) ?? [];
    list.forEach((n) => n.close());
  } catch {
    /* not every browser can list notifications */
  }
}

export function useMarkSeen(target: SeenTarget | null) {
  const me = useMe();
  const qc = useQueryClient();
  const unread = useUnreadCount(me.id).data ?? 0;
  const unreadRef = useRef(unread);
  unreadRef.current = unread;
  const key = target ? ("taskId" in target ? `task:${target.taskId}` : `link:${target.link}`) : null;

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const run = async () => {
      if (document.visibilityState !== "visible") return;
      void clearPhoneNotifications(notificationTag(target));
      if (!unreadRef.current) return;
      let q = supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", me.id)
        .is("read_at", null);
      q = "taskId" in target ? q.eq("task_id", target.taskId) : q.eq("link", target.link);
      const { data } = await q.select("id");
      if (!cancelled && data?.length) qc.invalidateQueries({ queryKey: ["notifications"] });
    };
    // Runs when the page opens, whenever a new notification arrives while it's open,
    // and when the app comes back to the front.
    run();
    document.addEventListener("visibilitychange", run);

    // A message for this chat arrived while you're looking at it: clear it from the phone.
    const tag = notificationTag(target);
    const onPush = (e: MessageEvent) => {
      if (e.data?.type === "push" && e.data.payload?.notification?.tag === tag && document.visibilityState === "visible") {
        void clearPhoneNotifications(tag);
      }
    };
    navigator.serviceWorker?.addEventListener("message", onPush);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", run);
      navigator.serviceWorker?.removeEventListener("message", onPush);
    };
    // `target` is described fully by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, unread, me.id, qc]);
}
