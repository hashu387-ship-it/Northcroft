// Manager-only account tools: add a team member, reset a password, switch access off or on.
import { createClient } from "npm:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const COLORS = ["#0A84FF", "#30D158", "#FF9F0A", "#BF5AF2", "#FF375F", "#5AC8FA", "#FFD60A", "#64D2FF", "#AC8E68"];

// Where a sign-in link may send the person after they're in: always a page inside the app, never
// another website (so a link can't be bent into sending the token somewhere else).
const DEFAULT_TO = "/updates?tab=week";
function safeToPath(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  // Must be one internal path: starts with a single "/", and no scheme, host or backslash.
  if (!/^\/(?!\/)[A-Za-z0-9/_\-.?=&%#]*$/.test(s)) return DEFAULT_TO;
  return s;
}
// The sign-in link opens the app, and only the app, so the one-time token lands nowhere else.
// Only the new address: the old one (northcroft.vercel.app) was wrongly flagged by Google Safe
// Browsing on 1 Nov 2026, so a link made from there still opens the new address.
const ALLOWED_ORIGINS = ["https://northcroft-qs-team.vercel.app"];
function safeOrigin(v: unknown): string {
  const s = typeof v === "string" ? v.trim().replace(/\/$/, "") : "";
  if (ALLOWED_ORIGINS.includes(s)) return s;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s)) return s; // only for local testing
  return ALLOWED_ORIGINS[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return json({ error: "Please sign in again" }, 401);

  const { data: me } = await admin.from("profiles").select("role, active").eq("id", auth.user.id).maybeSingle();
  if (!me || me.role !== "manager" || !me.active) return json({ error: "Only the manager can do this" }, 403);

  const body = await req.json().catch(() => ({}));

  try {
    switch (body.action) {
      case "reset_password": {
        const password = String(body.password ?? "");
        if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { password });
        if (error) return json({ error: error.message }, 400);
        await admin.from("profiles").update({ must_change_password: true }).eq("id", body.user_id);
        return json({ ok: true });
      }

      case "create_user": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const fullName = String(body.full_name ?? "").trim();
        const shortName = String(body.short_name ?? "").trim() || fullName.split(" ")[0];
        const password = String(body.password ?? "");
        if (!email.includes("@")) return json({ error: "Enter a valid email" }, 400);
        if (!fullName) return json({ error: "Enter the person's name" }, 400);
        if (password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true });
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: fullName,
            short_name: shortName,
            title: String(body.title ?? "Quantity Surveyor"),
            role: "member",
            can_assign: Boolean(body.can_assign),
            color: body.color || COLORS[(count ?? 0) % COLORS.length],
            must_change_password: true,
          },
        });
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, id: data.user?.id });
      }

      case "signin_link": {
        // A one-tap sign-in link for a teammate: single-use and expiring, it signs them into their
        // own account and opens a page inside the app. The manager sends it on (WhatsApp, etc.).
        const userId = String(body.user_id ?? "");
        if (!userId) return json({ error: "Pick who the link is for" }, 400);
        const { data: target } = await admin.from("profiles").select("short_name, active").eq("id", userId).maybeSingle();
        if (!target) return json({ error: "That person isn't on the team" }, 404);
        if (!target.active) return json({ error: "Their access is switched off. Restore it first." }, 400);
        const { data: targetUser, error: lookupErr } = await admin.auth.admin.getUserById(userId);
        const email = targetUser?.user?.email;
        if (lookupErr || !email) return json({ error: "That account has no email to sign in with" }, 400);

        const to = safeToPath(body.to);
        const origin = safeOrigin(body.origin);
        const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
        const hashed = link?.properties?.hashed_token;
        if (linkErr || !hashed) return json({ error: linkErr?.message || "The link couldn't be made. Try again." }, 400);

        const url = `${origin}/enter?token=${encodeURIComponent(hashed)}&to=${encodeURIComponent(to)}`;
        // Keep a trail of who made a link for whom (never the token itself).
        await admin.from("signin_links").insert({ actor_id: auth.user.id, target_id: userId, to_path: to }).then(
          () => {},
          () => {},
        );
        return json({ ok: true, link: url, name: target.short_name });
      }

      case "set_active": {
        const active = Boolean(body.active);
        if (body.user_id === auth.user.id && !active) return json({ error: "You cannot switch off your own access" }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { ban_duration: active ? "none" : "876000h" });
        if (error) return json({ error: error.message }, 400);
        await admin.from("profiles").update({ active }).eq("id", body.user_id);
        if (!active) await admin.from("push_subscriptions").delete().eq("user_id", body.user_id);
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
