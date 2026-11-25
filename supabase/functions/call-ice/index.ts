// The connection helpers for Northcroft voice calls (WebRTC "ICE servers").
//
// The two phones in a call talk to each other directly. STUN (free, Cloudflare and Google) lets
// them find each other on most networks. Where a mobile network or office firewall blocks that,
// the call goes through a TURN relay: Cloudflare Realtime TURN, free up to 1,000 GB a month
// (roughly 30,000 hours of voice calls), when these two Edge Function secrets are set
// (Supabase > Edge Functions > Secrets) from Cloudflare > Realtime > TURN Server:
//   CLOUDFLARE_TURN_KEY_ID      the TURN key's ID
//   CLOUDFLARE_TURN_API_TOKEN   the TURN key's API token
// Without them calls still work on most Wi-Fi networks; some mobile-to-mobile calls may not connect.
//
// POST (signed-in team member) {}  ->  { iceServers: RTCIceServer[], relay: boolean }
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth?.user) return json({ error: "Please sign in again." }, 401);
  const { data: me } = await admin.from("profiles").select("id, active").eq("id", auth.user.id).maybeSingle<{ id: string; active: boolean }>();
  if (!me?.active) return json({ error: "Your account doesn't have access." }, 403);

  const keyId = Deno.env.get("CLOUDFLARE_TURN_KEY_ID");
  const apiToken = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN");
  if (!keyId || !apiToken) return json({ iceServers: STUN, relay: false });

  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      // A few hours is plenty for a call; short-lived so a leaked one soon stops working.
      body: JSON.stringify({ ttl: 4 * 3600 }),
    });
    if (!res.ok) {
      console.error("Cloudflare TURN", res.status, await res.text().catch(() => ""));
      return json({ iceServers: STUN, relay: false });
    }
    const data = (await res.json()) as { iceServers?: unknown };
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    return json({ iceServers: list.length ? list : STUN, relay: list.length > 0 });
  } catch (e) {
    console.error("Cloudflare TURN", String(e));
    return json({ iceServers: STUN, relay: false });
  }
});
