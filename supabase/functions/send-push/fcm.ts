// Google's push service (Firebase Cloud Messaging, HTTP v1), for the Northcroft Android app.
//
// Needs one secret on the send-push function (Supabase > Edge Functions > Secrets); without it
// Android phones that have the app are skipped and everything else carries on as before:
//   FCM_SERVICE_ACCOUNT  the whole service account key file from Firebase (Project settings >
//                        Service accounts > Generate new private key), pasted as it is.
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let account: ServiceAccount | null | undefined;

function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  try {
    const raw = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";
    const a = raw ? (JSON.parse(raw) as ServiceAccount) : null;
    account = a?.project_id && a.client_email && a.private_key ? a : null;
  } catch {
    console.error("FCM_SERVICE_ACCOUNT isn't valid JSON");
    account = null;
  }
  return account;
}

export const fcmConfigured = (): boolean => !!serviceAccount();

// Google's sign-in tokens last an hour; a new one is fetched after 50 minutes.
let access: { token: string; at: number } | null = null;

async function accessToken(a: ServiceAccount): Promise<string> {
  if (access && Date.now() - access.at < 50 * 60_000) return access.token;
  const key = await importPKCS8(a.private_key.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(a.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google sign-in failed: ${res.status} ${j.error ?? ""}`);
  access = { token: j.access_token, at: Date.now() };
  return j.access_token;
}

export interface FcmMessage {
  title: string;
  body: string;
  /** Path to open when tapped, e.g. /chats/... */
  url: string;
  id: string;
  type: string;
  /** Notifications with the same tag replace each other (one per chat). */
  tag: string;
  badge: number;
  /** Quiet ones (digests, small changes) don't make a sound or pop up. */
  quiet: boolean;
  /** The person behind it: their photo is shown large on the notification. */
  photo?: string | null;
}

export interface FcmResult {
  ok: boolean;
  status: number;
  /** The token is no longer valid: forget the phone. */
  gone?: boolean;
  reason?: string;
}

/** Sends one notification to one Android phone. */
export async function sendFcm(deviceToken: string, m: FcmMessage): Promise<FcmResult> {
  const a = serviceAccount();
  if (!a) return { ok: false, status: 0, reason: "not configured" };
  const bearer = await accessToken(a);
  const message = {
    token: deviceToken,
    notification: { title: m.title, body: m.body, ...(m.photo ? { image: m.photo } : {}) },
    // Everything in data has to be text.
    data: { url: m.url, id: m.id, type: m.type },
    android: {
      priority: m.quiet ? "NORMAL" : "HIGH",
      collapse_key: m.tag.slice(0, 60),
      ttl: "86400s",
      notification: {
        channel_id: m.quiet ? "northcroft-quiet" : "northcroft",
        tag: m.tag.slice(0, 60),
        icon: "ic_stat_northcroft",
        color: "#007AFF",
        notification_priority: m.quiet ? "PRIORITY_LOW" : "PRIORITY_HIGH",
        notification_count: m.badge,
        default_sound: !m.quiet,
        default_vibrate_timings: !m.quiet,
      },
    },
  };
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (res.ok) return { ok: true, status: res.status };
  const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
  const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status ?? "";
  const gone = res.status === 404 || code === "UNREGISTERED" || (res.status === 400 && /registration token/i.test(err.error?.message ?? ""));
  return { ok: false, status: res.status, gone, reason: code || err.error?.message };
}
