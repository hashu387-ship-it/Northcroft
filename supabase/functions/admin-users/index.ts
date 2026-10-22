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
