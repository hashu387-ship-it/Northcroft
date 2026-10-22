// Sends a Web Push message for one row of public.notifications.
// Called by the dispatch_push() database trigger with a shared secret header.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

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

  const { notification_id } = await req.json().catch(() => ({}));
  if (!notification_id) return json({ error: "notification_id is required" }, 400);

  const { data: n, error } = await supabase
    .from("notifications")
    .select("id, user_id, type, title, body, link, task_id, announcement_id")
    .eq("id", notification_id)
    .maybeSingle();
  if (error || !n) return json({ error: "Notification not found" }, 404);

  const [{ data: subs }, { count }] = await Promise.all([
    supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", n.user_id)
      .is("read_at", null)
      .is("archived_at", null),
  ]);

  const base = (cfg.app_url || "").replace(/\/$/, "");
  const url = base + (n.link || "/inbox");
  const tag = n.task_id ? `task-${n.task_id}` : n.announcement_id ? `ann-${n.announcement_id}` : `n-${n.id}`;

  // Declarative Web Push shape (Safari 18.4+), also read by our service worker everywhere else.
  const payload = JSON.stringify({
    web_push: 8030,
    notification: {
      title: n.title,
      body: n.body ?? "",
      navigate: url,
      app_badge: String(count ?? 0),
      tag,
      lang: "en-GB",
      dir: "ltr",
    },
    data: { id: n.id, type: n.type, url },
  });

  let sent = 0;
  let removed = 0;
  let failed = 0;

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
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
