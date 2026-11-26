// Notifications in the apps come through the phone maker's push service, not Web Push: Apple's
// (APNs) on iPhone, Google's (Firebase Cloud Messaging) on Android. The phone gives the app a
// device token; the app saves it with register_native_push and the send-push function sends each
// notification to it, with Approve/Decline or Reply buttons where they fit (iPhone).
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { supabase } from "@/lib/supabase";
import type { PushState } from "@/lib/push";

const STATE_KEY = "nc-native-push";
const TOKEN_KEY = "nc-native-token";

function remember(state: PushState) {
  try {
    localStorage.setItem(STATE_KEY, state);
  } catch {
    /* private mode */
  }
}

/** The last known permission (checked again on every launch by NativeBridge). */
export function nativePushState(): PushState {
  try {
    const s = localStorage.getItem(STATE_KEY);
    if (s === "granted" || s === "denied" || s === "default") return s;
  } catch {
    /* fall through */
  }
  return "default";
}

/** Reads the real permission from the phone and remembers it. */
export async function refreshNativePushState(): Promise<PushState> {
  const p = await PushNotifications.checkPermissions();
  const s: PushState = p.receive === "granted" ? "granted" : p.receive === "denied" ? "denied" : "default";
  remember(s);
  return s;
}

/** Asks for permission (from a tap) and registers with Apple; the token arrives in NativeBridge. */
export async function enableNativePush(): Promise<PushState> {
  const p = await PushNotifications.requestPermissions();
  const s: PushState = p.receive === "granted" ? "granted" : p.receive === "denied" ? "denied" : "default";
  remember(s);
  if (s === "granted") await PushNotifications.register();
  return s;
}

/** Saves this phone's token for the signed-in person. */
export async function saveNativeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode */
  }
  const { error } = await supabase.rpc("register_native_push", {
    p_token: token,
    p_platform: Capacitor.getPlatform() === "android" ? "android" : "ios",
    p_device_name: Capacitor.getPlatform() === "android" ? "Android" : navigator.userAgent.includes("iPad") ? "iPad" : "iPhone",
    p_app_version: null,
  });
  if (error) throw error;
}

export async function disableNativePush() {
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
  if (token) await supabase.from("native_push_devices").delete().eq("token", token);
  await PushNotifications.unregister().catch(() => undefined);
  remember("default");
}
