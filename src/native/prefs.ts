// The iPhone app's own settings (Settings > iPhone app), kept on the phone.
import { useSyncExternalStore } from "react";

export const PREF = {
  /** Lock the app with Face ID. */
  faceId: "nc-faceid",
  /** Remind me to check in when I arrive at the office. */
  officeWatch: "nc-office-watch",
} as const;

const EVENT = "nc-native-prefs";

export function getPref(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function setPref(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function usePref(key: string): boolean {
  return useSyncExternalStore(subscribe, () => getPref(key), () => false);
}
