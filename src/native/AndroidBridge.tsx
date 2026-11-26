// What the Android app adds to the website (mounted by AppShell only inside the Android app):
//   the splash screen and the colour of the status bar icons, following light or dark;
//   notifications through Firebase: asks once, saves this phone, and opens the right page when
//   one is tapped; two notification channels (normal, and quiet for digests);
//   the back button: closes an open sheet or menu first, then goes back, then leaves the app.
// The iPhone-only extras (widget, Siri, Live Activities, Face ID, Wallet) live in NativeBridge.
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import { PushNotifications, type ActionPerformed } from "@capacitor/push-notifications";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useInvalidate } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { enableNativePush, refreshNativePushState, saveNativeToken } from "./push";

const ASKED_KEY = "nc-android-push-asked";

export default function AndroidBridge() {
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const live = useRef({ navigate, invalidate });
  live.current = { navigate, invalidate };

  /* -------------------------------------------------------------- look */
  useEffect(() => {
    void SplashScreen.hide().catch(() => undefined);
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = document.documentElement.dataset.theme;
      const dark = theme ? theme === "dark" : (mq?.matches ?? false);
      // Style.Dark = light icons, for a dark page.
      void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    mq?.addEventListener?.("change", apply);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.("change", apply);
    };
  }, []);

  /* -------------------------------------------------------------- notifications */
  const onTap = useCallback((a: ActionPerformed) => {
    const data = (a.notification.data ?? {}) as { url?: string; id?: string };
    const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/inbox";
    if (data.id) void supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", data.id).is("read_at", null);
    live.current.navigate(url);
  }, []);

  useEffect(() => {
    // The channels the server's messages name (send-push/fcm.ts).
    void PushNotifications.createChannel({
      id: "northcroft",
      name: "Northcroft",
      description: "Tasks, chats, approvals and calls",
      importance: 4,
      visibility: 0,
      lights: true,
      vibration: true,
    }).catch(() => undefined);
    void PushNotifications.createChannel({
      id: "northcroft-quiet",
      name: "Summaries",
      description: "Daily digests and small changes, without a sound",
      importance: 2,
      visibility: 0,
    }).catch(() => undefined);

    const subs = [
      PushNotifications.addListener("registration", (t) => {
        void saveNativeToken(t.value).catch((e) => console.warn("Couldn't save the phone for notifications", e));
      }),
      PushNotifications.addListener("registrationError", (e) => console.warn("Notifications registration failed", e)),
      PushNotifications.addListener("pushNotificationReceived", () => void live.current.invalidate("notifications")),
      PushNotifications.addListener("pushNotificationActionPerformed", onTap),
    ];
    void (async () => {
      const state = await refreshNativePushState().catch(() => "default" as const);
      if (state === "granted") {
        await PushNotifications.register().catch(() => undefined);
      } else if (state === "default") {
        let asked = false;
        try {
          asked = localStorage.getItem(ASKED_KEY) === "1";
          localStorage.setItem(ASKED_KEY, "1");
        } catch {
          /* private mode */
        }
        if (!asked) window.setTimeout(() => void enableNativePush().catch(() => undefined), 2500);
      }
    })();
    return () => {
      subs.forEach((p) => void p.then((h) => h.remove()));
    };
  }, [onTap]);

  /* -------------------------------------------------------------- back button */
  useEffect(() => {
    const h = CapApp.addListener("backButton", ({ canGoBack }) => {
      // An open sheet, menu or search closes first (they all close on Escape).
      const open = document.querySelector(".sheet-backdrop, .ctx-layer, .search-panel, .call-screen");
      if (open) {
        // Sent to the document, so listeners on the document and on the window both hear it once.
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      if (canGoBack && window.history.length > 1 && window.location.pathname !== "/") window.history.back();
      else void CapApp.minimizeApp().catch(() => CapApp.exitApp());
    });
    return () => void h.then((x) => x.remove());
  }, []);

  return null;
}
