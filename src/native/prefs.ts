// The iPhone app's own settings (Settings > iPhone app), kept on the phone.
import { useSyncExternalStore } from "react";

export const PREF = {
  /** Lock the app with Face ID. */
  faceId: "nc-faceid",
  /** Remind me to check in when I arrive at the office. */
  officeWatch: "nc-office-watch",
  /** Task deadlines, site visits and meetings in a Northcroft calendar on the phone. */
  calendar: "nc-calendar-sync",
  /** The workday Live Activity is on unless this is set. */
  liveActivityOff: "nc-live-activity-off",
  /** Tasks on the lock screen are on unless this is set. */
  liveTasksOff: "nc-live-tasks-off",
  /** Log arrivals at and departures from project sites. */
  siteLog: "nc-site-log",
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
