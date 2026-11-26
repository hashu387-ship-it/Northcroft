# The Northcroft Android app

The Android app is the same Northcroft website inside a Capacitor shell (`android/`), like the
iPhone app. On top of the website it adds:

- **Notifications that arrive like any other app's**, through Google's push service (Firebase
  Cloud Messaging). There are two channels: "Northcroft" for tasks, chats, approvals and calls,
  which makes a sound, and "Summaries" for digests and small changes, which arrive quietly.
  Tapping one opens the right page.
- **The back button**: it closes an open sheet, menu or search first, then goes back a page, then
  leaves the app.
- **Location for check-in, the camera and the microphone** through Android's own permission prompts.
- Status bar icons that follow light and dark mode, and a black splash screen with the app icon.

The iPhone-only extras (widget, Siri, Live Activities, Face ID, Wallet) aren't in the Android app.
In the code, `isNativeApp()` means the iPhone app only, `isAndroidApp()` means Android, and
`isAppShell()` means either one.

## Firebase (done once)

- Firebase project: **Northcroft** (`northcroft-625cd`), on the free Spark plan. Analytics and
  Gemini are off.
- Android app registered as `com.northcroftme.qsteam`.
- `android/app/google-services.json` comes from Firebase > Project settings > General > Your apps.
  It isn't in git, so each machine that builds the app needs its own copy. Without it, the app
  still builds but can't get notifications.
- The server needs one secret, set on the Supabase project (Edge Functions > Secrets):
  `FCM_SERVICE_ACCOUNT`. Its value is the whole JSON file from Firebase > Project settings >
  Service accounts > Generate new private key, pasted as it is. Until the secret is there,
  `send-push` skips Android phones and everything else carries on.
- Database change `0058_android_push.sql` lets `native_push_devices` hold Android phones next to
  iPhones.

## Signing key

Release builds are signed with `northcroft-release.jks`. The key lives on the Mac in
`Documents/GitHub/Northcroft-android-keys`, never in git. Every update has to be signed with
the same key; if it's lost, phones can't update the app and people have to delete and reinstall it.

To build on the Mac, copy `keystore.properties` from that folder into `android/`. Without it,
release builds come out unsigned.

## Building

Production builds load the live site (`server.url` in `capacitor.config.ts`), so website updates
reach the app without a new install:

```sh
npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

A **test build** carries its own copy of the website instead, so it can be tried before anything
goes live. After `npx cap sync android`, copy `dist/` into `android/app/src/main/assets/public/`
and remove the `server` block from `android/app/src/main/assets/capacitor.config.json`, then run
Gradle.

Requirements: Android SDK platform 36, build-tools 35 and 36, and Java 21. The app runs on
Android 7 (API 24) and newer.

## Installing a test build on a phone

1. Send the `.apk` to the phone (WhatsApp, email or Google Drive).
2. Open it. Android asks to allow installs from that app (Chrome, Files or WhatsApp): allow it once.
3. Tap **Install**. Google Play Protect may warn about an unknown developer: choose
   **Install anyway**.
4. Open Northcroft, sign in, and allow notifications when asked.

## Google Play (later)

To publish on Google Play, open a Google Play Console account (a one-time US$25 fee), build an
`.aab` with `./gradlew bundleRelease`, and upload it with the same signing key.
