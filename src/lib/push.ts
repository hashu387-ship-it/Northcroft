// Web Push: register the service worker, ask permission, and keep the subscription in Supabase.
import { VAPID_PUBLIC_KEY } from "./config";
import { supabase } from "./supabase";

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export type PushState = "unsupported" | "needs-install" | "denied" | "default" | "granted";

export function pushState(): PushState {
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!pushSupported()) return "unsupported";
  return Notification.permission as PushState;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (e) {
    console.warn("Service worker registration failed", e);
    return null;
  }
}

async function saveSubscription(sub: PushSubscription) {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.rpc("register_push_device", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
    p_origin: window.location.origin,
  });
  if (error) throw error;
}

/** Ask for permission (must be called from a tap) and subscribe this device. */
export async function enablePush(): Promise<PushState> {
  if (pushState() === "needs-install") return "needs-install";
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission as PushState;
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  if (!reg) return "unsupported";
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await saveSubscription(sub);
  return "granted";
}

/** On every launch: if permission is already granted, make sure the server has this device. */
export async function syncPushSubscription() {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await saveSubscription(sub);
  } catch (e) {
    console.warn("Push sync failed", e);
  }
}

export async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  }
}

export async function setBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    /* badge is a nice-to-have */
  }
}
