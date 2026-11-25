// Apple's push service (APNs), for the Northcroft iPhone app.
//
// Needs these secrets on the send-push function (Supabase > Edge Functions > Secrets); without
// them iPhones that have the app are skipped and everything else carries on as before:
//   APNS_KEY_ID       the key's ID (10 characters) from Apple Developer > Keys
//   APNS_TEAM_ID      your Team ID (10 characters) from Apple Developer > Membership
//   APNS_PRIVATE_KEY  the whole contents of the .p8 key file, BEGIN and END lines included
//   APNS_BUNDLE_ID    optional; com.northcroftme.qsteam unless the app's bundle ID changes
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

export type ApnsEnv = "production" | "sandbox";

const HOSTS: Record<ApnsEnv, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

export function apnsConfigured(): boolean {
  return !!(Deno.env.get("APNS_KEY_ID") && Deno.env.get("APNS_TEAM_ID") && Deno.env.get("APNS_PRIVATE_KEY"));
}

export const apnsTopic = () => Deno.env.get("APNS_BUNDLE_ID") || "com.northcroftme.qsteam";

// Apple wants a fresh sign-in token at most every hour and no more than every 20 minutes.
let token: { jwt: string; at: number } | null = null;

async function authToken(): Promise<string> {
  if (token && Date.now() - token.at < 40 * 60_000) return token.jwt;
  const pem = (Deno.env.get("APNS_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n").trim();
  const key = await importPKCS8(pem, "ES256");
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: Deno.env.get("APNS_KEY_ID")! })
    .setIssuer(Deno.env.get("APNS_TEAM_ID")!)
    .setIssuedAt()
    .sign(key);
  token = { jwt, at: Date.now() };
  return jwt;
}

export interface ApnsResult {
  ok: boolean;
  status: number;
  reason?: string;
}

/** Sends one notification to one phone. */
export async function sendApns(
  deviceToken: string,
  env: ApnsEnv,
  payload: Record<string, unknown>,
  opts: { collapseId?: string } = {},
): Promise<ApnsResult> {
  const headers: Record<string, string> = {
    authorization: `bearer ${await authToken()}`,
    "apns-topic": apnsTopic(),
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 3600),
    "content-type": "application/json",
  };
  if (opts.collapseId) headers["apns-collapse-id"] = new TextEncoder().encode(opts.collapseId).length <= 64 ? opts.collapseId : opts.collapseId.slice(0, 60);
  const res = await fetch(`${HOSTS[env]}/3/device/${deviceToken}`, { method: "POST", headers, body: JSON.stringify(payload) });
  if (res.ok) return { ok: true, status: res.status };
  let reason: string | undefined;
  try {
    reason = ((await res.json()) as { reason?: string }).reason;
  } catch {
    /* no body */
  }
  return { ok: false, status: res.status, reason };
}

/**
 * How the phone treats it (iOS interruption levels):
 *   time-sensitive  calls and things waiting on you now: they get through Focus and stay on the lock screen
 *   passive         digests and small changes: quietly into the list (and the Scheduled Summary, if on)
 *   active          everything else, as before
 * relevance-score decides which shows on top in a Scheduled Summary.
 */
const URGENT = new Set(["call", "checkin_request", "leave_request", "task_request", "overdue", "checkin_reminder"]);
const QUIET = new Set(["review_digest", "weekly_check", "weekly_checked", "weekly_update", "weekly_updates", "leave_days", "task_time_logs", "group_added", "leave_cancelled"]);

export function levelFor(type: string, chat: boolean): { level: "time-sensitive" | "active" | "passive"; relevance: number } {
  if (URGENT.has(type)) return { level: "time-sensitive", relevance: 1 };
  if (QUIET.has(type)) return { level: "passive", relevance: 0.2 };
  return { level: "active", relevance: chat ? 0.8 : 0.5 };
}

/** Which buttons the notification shows on the phone (see NotificationButtons in the app). */
export function categoryFor(type: string, link: string | null, chat: boolean): { category?: string; ref?: string } {
  if (type === "checkin_request" && link?.includes("fix=")) return { category: "CHECKIN_REQUEST", ref: link.split("fix=")[1].split("&")[0] };
  if (type === "leave_request" && link?.includes("leave=")) return { category: "LEAVE_REQUEST", ref: link.split("leave=")[1].split("&")[0] };
  if (chat) return { category: "CHAT" };
  return {};
}
