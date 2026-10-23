// Sends a Web Push message for one row of public.notifications.
// Called by the dispatch_push() database trigger with a shared secret header.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Actor, compose, initials, isChat, type NotificationRow, tagFor } from "./compose.ts";

type PushConfig = {
  vapid_public_key: string;
  vapid_private_key: string;
  vapid_subject: string;
  push_webhook_secret: string;
  app_url: string;
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let config: PushConfig | null = null;
let loadedAt = 0;

async function getConfig(): Promise<PushConfig> {
  if (config && Date.now() - loadedAt < 5 * 60_000) return config;
  const { data, error } = await supabase.rpc("get_push_config");
  if (error) throw new Error(`Could not load push config: ${error.message}`);
  config = data as PushConfig;
  loadedAt = Date.now();
  webpush.setVapidDetails(config.vapid_subject, config.vapid_public_key, config.vapid_private_key);
  return config;
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let cfg: PushConfig;
  try {
    cfg = await getConfig();
  } catch (e) {
    console.error(e);
    return json({ error: "Push is not configured" }, 500);
  }
  if (!sameSecret(req.headers.get("x-push-secret") ?? "", cfg.push_webhook_secret)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { notification_id, dry_run } = await req.json().catch(() => ({}));
  if (!notification_id) return json({ error: "notification_id is required" }, 400);

  const { data: n, error } = await supabase
    .from("notifications")
    .select("id, user_id, type, title, body, link, actor_id, task_id, project_id, announcement_id")
    .eq("id", notification_id)
    .maybeSingle<NotificationRow>();
  if (error || !n) return json({ error: "Notification not found" }, 404);

  // How many unread notifications from people are waiting in this same conversation.
  const sameConversation = () =>
    n.link && n.actor_id
      ? supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", n.user_id)
          .eq("link", n.link)
          .not("actor_id", "is", null)
          .is("read_at", null)
          .is("archived_at", null)
      : Promise.resolve({ count: 1 });

  const [{ data: subs }, { count }, { data: actor }, { data: project }, { count: waiting }] = await Promise.all([
    supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth, origin").eq("user_id", n.user_id),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", n.user_id)
      .is("read_at", null)
      .is("archived_at", null),
    n.actor_id
      ? supabase.from("profiles").select("short_name, full_name, avatar_url, color").eq("id", n.actor_id).maybeSingle<Actor>()
      : Promise.resolve({ data: null }),
    isChat(n) && n.project_id
      ? supabase.from("projects").select("name").eq("id", n.project_id).maybeSingle<{ name: string }>()
      : Promise.resolve({ data: null }),
    sameConversation(),
  ]);
  // Group and one-to-one chats: the group's name, or nothing for a one-to-one chat.
  const convId = isChat(n) && n.link?.startsWith("/chats/") ? n.link.slice(7) : null;
  const { data: conv } = convId
    ? await supabase.from("conversations").select("kind, name").eq("id", convId).maybeSingle<{ kind: string; name: string | null }>()
    : { data: null };

  const shown = compose(n, actor ?? null, {
    place: conv?.name ?? project?.name,
    direct: conv?.kind === "direct",
    count: waiting ?? 1,
  });
  const tag = tagFor(n);
  const path = n.link || "/inbox";
  const person = actor
    ? { name: actor.short_name, photo: actor.avatar_url, color: actor.color, initials: initials(actor.full_name || actor.short_name) }
    : null;

  // Declarative Web Push shape (Safari 18.4+), also read by our service worker everywhere else.
  // Links open on the same site the device installed the app from.
  // The service worker turns `data.actor` into a round photo (or initials) on Android and computers.
  const payloadFor = (origin: string | null) => {
    const base = (origin || cfg.app_url || "").replace(/\/$/, "");
    const url = base + path;
    return JSON.stringify({
      web_push: 8030,
      notification: {
        title: shown.title,
        body: shown.body,
        navigate: url,
        app_badge: String(count ?? 0),
        tag,
        lang: "en-GB",
        dir: "ltr",
      },
      data: { id: n.id, type: n.type, url, actor: person },
    });
  };

  // Preview the message without sending it (used to check the wording).
  if (dry_run) return json({ devices: subs?.length ?? 0, payload: JSON.parse(payloadFor(null)) });

  let sent = 0;
  let removed = 0;
  let failed = 0;

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payloadFor(s.origin),
          { TTL: 60 * 60 * 24, urgency: "high" },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
          removed++;
        } else {
          failed++;
          console.error("Push failed", status, (e as { body?: string }).body ?? String(e));
        }
      }
    }),
  );

  await supabase
    .from("notifications")
    .update({ push_status: sent ? "sent" : failed ? "failed" : "no_device" })
    .eq("id", n.id);

  return json({ sent, removed, failed });
});
