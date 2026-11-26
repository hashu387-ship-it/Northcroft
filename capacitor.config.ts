// The Northcroft iPhone and Android apps: a native shell around the live web app, so everyday
// changes reach the phones the moment they're deployed, plus the native parts the web can't do
// (notifications with buttons, check-in when you reach the office, Face ID, sharing files in).
// See docs/iphone-app.md and docs/android-app.md.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.northcroftme.qsteam",
  appName: "Northcroft",
  // Only the offline page is bundled; the app itself loads from the website below.
  webDir: "native-shell",
  server: {
    url: "https://northcroft-qs-team.vercel.app",
    errorPath: "offline.html",
  },
  ios: {
    contentInset: "never",
    backgroundColor: "#071733",
  },
  android: {
    backgroundColor: "#000000",
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    SplashScreen: { launchShowDuration: 700, launchAutoHide: true, backgroundColor: "#071733", showSpinner: false },
    // Android draws edge to edge; the page gets the status and navigation bar sizes as
    // --safe-area-inset-* (used by --safe-top and friends in styles/core.css).
    SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover" },
  },
};

export default config;
