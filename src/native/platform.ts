// Which shell is this page running in?
//   isNativeApp()   the Northcroft iPhone app: has Northcroft's own iPhone code (widget, Siri, Live
//                   Activities, Face ID, Wallet...). Most native checks in the app mean this one.
//   isAndroidApp()  the Northcroft Android app: native notifications, location and the system bars;
//                   everything else works as on the website.
//   isAppShell()    either app (anything that only needs Capacitor's own plugins).
// In a browser all three are false.
import { Capacitor } from "@capacitor/core";

const platform = (): string => {
  try {
    return Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
  } catch {
    return "web";
  }
};

export const isNativeApp = (): boolean => platform() === "ios";
export const isAndroidApp = (): boolean => platform() === "android";
export const isAppShell = (): boolean => platform() !== "web";
