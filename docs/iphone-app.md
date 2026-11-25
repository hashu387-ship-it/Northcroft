# The Northcroft iPhone app: building it and getting it on the App Store

The iPhone app is a native shell around the live website. It opens https://northcroft-qs-team.vercel.app,
so every change to the website reaches the app straight away. The shell adds what a website can't do:

- **Notifications with buttons:** Approve or Decline missed check-ins and leave requests, and Reply to
  chats, from the notification itself.
- **Check-in at the office:** when someone arrives at the office and hasn't checked in, the phone says
  "You're at the office". Tapping it checks them in.
- **Face ID lock:** switched on in Settings > iPhone app.
- **Share into Northcroft:** Northcroft appears in the share sheet of other apps (Photos, Files,
  WhatsApp, Mail).
- **Scan documents:** the iPhone's document scanner (More > Scan a document) turns paper into a PDF
  that goes to a chat or a task, through the Share screen.
- **Home screen and lock screen widget:** whether you've checked in today, and your tasks due today.
- **Siri and Shortcuts:** "Check me in with Northcroft", "Scan a document with Northcroft", "Show my
  Northcroft tasks", "Open Northcroft chats". Also in the Shortcuts app and on the Action button.
- **App icon menu:** press and hold the icon for Check in, Scan a document, My tasks and Chats.
- **Workday Live Activity:** from check-in until check-out, the lock screen and Dynamic Island show
  the check-in time, the time since and what's due, with a Check out button.
- **Control Center:** Check in and Scan a document buttons (iOS 18 and later), also for the lock screen.
- **Searchable scans:** scanned PDFs carry the text read on the phone, so they can be searched.
- **Spotlight:** projects and your open tasks in the iPhone's search; a result opens straight to it.
- **Calendar:** your task deadlines, site visits and meetings in a "Northcroft" calendar on the phone
  (Settings > iPhone app).
- **Liquid Glass:** the iOS 26 look, with springy animations and haptics; the default in the iPhone
  app, and a choice in Settings > Appearance everywhere else.

Only the native parts (the folders `ios/` and `native/`) need a new version through Apple. Everything
else updates the moment it's deployed.

Plan on about two hours the first time, plus Apple's waiting times (account approval, review).

---

## 1. Apple Developer account (once)

1. Go to https://developer.apple.com/programs/enroll and sign in with your Apple ID.
2. Enrol as an **Individual**. It costs $99 a year, and the App Store shows your name as the developer.
3. Wait for the confirmation email. It's usually within a day, sometimes up to two.

## 2. Set up the Mac (once)

1. Install **Xcode** from the Mac App Store. It's free and large, so give it time to download.
2. Open Xcode once and let it install its extra parts. Then open **Xcode > Settings > Accounts**,
   click **+**, choose **Apple ID** and sign in with the developer account.
3. Install **Node.js** (the LTS version) from https://nodejs.org.
4. Get the code. The easiest way is **GitHub Desktop** (https://desktop.github.com): sign in, then
   **File > Clone repository** and pick `hashu387-ship-it/Northcroft`.

## 3. Open the project in Xcode

Open **Terminal**, go to the folder you cloned and run:

```
npm install
npm run ios
```

`npm run ios` copies the latest settings into the iPhone project and opens it in Xcode. Run it again
whenever the `ios/` or `native/` folders change.

Then, in Xcode:

1. In the left column, click the blue **App** project at the top.
2. Under **TARGETS**, click **App**, then the **Signing & Capabilities** tab.
3. Make sure **Automatically manage signing** is ticked, and pick your name under **Team**.
4. Do the same for the other two targets, **ShareExtension** and **NorthcroftWidget**.
5. If Xcode shows a red message under **App Groups** or **Push Notifications**, click
   **Try Again**. Xcode registers them with Apple for you.

If Xcode says the bundle identifier `com.northcroftme.qsteam` is taken, stop and tell Claude. The
identifier, the share extension's identifier and the app group all have to change together.

## 4. Try it on your iPhone

1. Plug the iPhone into the Mac and tap **Trust** on the phone.
2. On the iPhone, turn on **Settings > Privacy & Security > Developer Mode**. The iPhone restarts.
3. In Xcode's top bar, pick your iPhone as the device and press **Run** (the play button).
4. Sign in to Northcroft on the phone and allow notifications when it asks.
5. Check each part:
   - **Settings > iPhone app:** switch on **Lock with Face ID** and **Remind me when I arrive**.
     Allow location **Always** when the iPhone asks.
   - **Share:** in Photos, share a photo, pick **Northcroft**, then open the app. The Share screen
     shows the photo.
   - **Notifications:** these only arrive once step 5 below is done.
   - **Scan:** More > Scan a document. Scan a page, then send it to yourself in a chat.
   - **Widget:** add the Northcroft widget to the home screen; it shows today's check-in and tasks.
   - **Siri:** say "Show my Northcroft tasks". Press and hold the app icon for its menu.

## 5. Notifications key (once)

Notifications reach iPhones through Apple's push service, which needs a key:

1. Go to https://developer.apple.com/account/resources/authkeys/list and click **+**.
2. Name it `Northcroft push`, tick **Apple Push Notifications service (APNs)**, click **Configure**,
   choose **Sandbox & Production**, then **Save**, **Continue** and **Register**.
3. Click **Download**. You can only download the `.p8` file once, so keep it somewhere safe.
4. Note the **Key ID** shown on that page, and your **Team ID** from
   https://developer.apple.com/account (under Membership details).
5. In Supabase, open the Northcroft project, then **Edge Functions > Secrets**, and add:
   - `APNS_KEY_ID`: the Key ID
   - `APNS_TEAM_ID`: the Team ID
   - `APNS_PRIVATE_KEY`: open the `.p8` file in TextEdit and paste everything, including the
     `BEGIN` and `END` lines.

Never paste the `.p8` contents into a chat or an email. In Northcroft, **Settings > Notifications >
Send a test notification** checks that it works.

## 6. Create the app in App Store Connect (once)

1. Go to https://appstoreconnect.apple.com, open **Apps**, click **+** and choose **New App**.
2. Fill it in:
   - **Platform:** iOS
   - **Name:** `Northcroft QS Team`. The name has to be unique on the App Store.
   - **Primary language:** English (U.K.)
   - **Bundle ID:** `com.northcroftme.qsteam`
   - **SKU:** `northcroft-qs-team`
3. Under **App Privacy**:
   - Set the privacy policy to https://northcroft-qs-team.vercel.app/privacy.html.
   - Answer the questions. The app collects name, email address, phone number, photos and files,
     precise location (for check-in), and user content such as tasks and messages. All of it is
     linked to the person, and none of it is used for tracking or advertising.

## 7. Send a build to Apple

1. In Xcode's top bar, choose **Any iOS Device (arm64)** as the device.
2. Choose **Product > Archive**. When it finishes, the Organizer window opens.
3. Click **Distribute App**, choose **App Store Connect**, then **Upload**, and accept the defaults.
4. After 15 to 30 minutes the build appears in App Store Connect under **TestFlight**.

Before each new upload, raise the **Build** number (and the **Version** for a new release) on the
**General** tab. Do it for all three targets, **App**, **ShareExtension** and **NorthcroftWidget**;
they must match.

## 8. Test with TestFlight

1. In App Store Connect, open **TestFlight > Internal Testing**, add yourself, and pick the build.
2. Install **TestFlight** from the App Store on the iPhone, then install Northcroft from it.
3. Check notifications, the buttons on them, check-in at the office, Face ID and sharing.

## 9. Submit for review

On the app's **1.0** page in App Store Connect:

- **Screenshots:** 6.9-inch iPhone screenshots are required. Claude can make these for you.
- **Description, keywords and support URL:** the support URL can be
  https://northcroft-qs-team.vercel.app/about.html.
- **App Review Information:**
  - **Sign-in:** a login the reviewer can use. Ask Claude to set up a demo account with sample data,
    so the reviewer never sees real projects.
  - **Notes**, which you can paste:
    > Northcroft QS Team is the internal app for Northcroft's quantity surveying team (about 10 people).
    > Accounts are created by the team's manager; there is no public sign-up. The app uses location
    > "Always" only to notice arriving at the office (region monitoring) and remind the person to
    > check in; location is not tracked. Notifications have Approve/Decline buttons for missed
    > check-in and leave requests and a Reply box for chats.
- Click **Add for Review** and then **Submit**. Review usually takes one to three days.

## 10. Make it unlisted

Fill in Apple's form at https://developer.apple.com/contact/request/unlisted-app/ with the app's
details and a note that it's for Northcroft's QS team only. You can send it before or after review.

Once Apple agrees, the app doesn't appear in App Store search. Send the team the App Store link from
App Store Connect, under **App Information**. People install it like any other app and get updates
automatically.

---

## For developers

- **Shell config:** `capacitor.config.ts`. The app loads the live site. `native-shell/offline.html`
  shows when there's no connection on first open.
- **Native code:**
  - `native/northcroft-native`: a local Capacitor plugin (Swift) covering the office watcher,
    Face ID, the share inbox, the badge and the notification buttons.
  - `ios/App/ShareExtension`: the share sheet extension.
  - `ios/App/App/AppDelegate.swift`: starts the office watcher and passes notification tokens on.
- **Web side:** `src/native/`. `NativeBridge` is loaded only inside the app.
  `src/pages/settings/IphoneSection.tsx` is the settings page.
- **Server:**
  - `supabase/migrations/0055_native_push.sql`: the `native_push_devices` table and
    `register_native_push`.
  - `supabase/functions/send-push/apns.ts`: sending through APNs.
- **Share extension target:** if the iOS project is ever made again with `npx cap add ios`, run
  `npx -y -p xcode@3.0.1 node scripts/ios/add-share-extension.cjs` to add the share extension
  target back, then `npx -y -p xcode@3.0.1 node scripts/ios/add-widget-and-intents.cjs` for the
  widget target, the Siri file and the `NC_APP_GROUP` setting.
- **Widget:** `ios/App/NorthcroftWidget` (WidgetKit, iOS 17 and later). It reads the copy the app
  saves in the shared app group (`WidgetData.swift`); the web app sends it from `NativeBridge`.
- **Siri, Shortcuts, app icon menu, widget taps:** `ios/App/App/NorthcroftIntents.swift`,
  `UIApplicationShortcutItems` and the `northcroft://action/...` links in `Info.plist`, handled in
  `SceneDelegate.swift`. They all leave an action in `LaunchActions.swift`; the web app takes it
  (`takeLaunchAction`) and does it, since it needs the sign-in.
- **Document scanner:** `DocumentScanner.swift` (VisionKit) gives back a PDF, with the text read by
  Vision laid invisibly over each page; `src/native/scan.ts` opens the Share screen with it.
- **Live Activity:** `WorkdayActivity.swift` (started, updated and ended by `src/native/sync.ts`) and
  `ios/App/NorthcroftWidget/WorkdayLiveActivity.swift`, which keeps its own copy of the attributes.
- **Control Center:** `ios/App/NorthcroftWidget/NorthcroftControls.swift`, running the actions in
  `ios/App/Shared/NorthcroftActionIntents.swift` (built into both the app and the widget).
- **Spotlight and Calendar:** `Spotlight.swift` and `CalendarSync.swift`, fed by `src/native/sync.ts`.
- **Liquid Glass look:** `src/styles/liquidglass.css` and `src/lib/liquidglass.ts`.
- **App group:** named once by the `NC_APP_GROUP` build setting, used by the entitlements and the
  `NCAppGroup` key in each Info.plist, so a test build can use its own group.
- The new iPhone features need both a new iPhone build and the website update; an older iPhone
  build just doesn't show them (Scan a document says to update the app).
