// Is this the Northcroft iPhone app (the native shell around the website) rather than a browser?
// Inside the app, iOS adds the Capacitor bridge to the page; in a browser this is always false.
import { Capacitor } from "@capacitor/core";

export const isNativeApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};
