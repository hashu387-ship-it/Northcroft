# Northcroft QS Workspace

A team workspace for the Northcroft quantity surveying team in Saudi Arabia. It works in any browser and installs on iPhone and Android like a normal app, with push notifications.

## What it does

- **Projects**: an overview, a task list and board, the variation (VO) register, BOQ package stages, project chat, files and a full history.
- **Tasks**: you assign work with due dates, priorities and checklists. The person moves it to *In progress*, then *Submitted for review*. Hassan or a senior approves it or sends it back with a note. Tasks can also repeat daily, weekly or monthly.
- **Announcements**: everyone taps *Acknowledge*. Managers see who hasn't, and can nudge them. Anyone who hasn't acknowledged gets an automatic reminder the next morning.
- **Inbox and push notifications**, WhatsApp style:
  - The sender's name is the title. On Android and computers their photo shows beside the message, or their initials if they have no photo. iPhone always shows the app icon for Home Screen apps.
  - One notification per chat or task. It updates with the latest message and a count, and clears when you open that chat or task.
  - Sent for:
    - new tasks, review requests, approvals and requested changes
    - every team chat and project chat message
    - @mentions, and comments on tasks you follow
    - announcements and calendar invites
    - 8:00 am reminders, Sunday to Thursday, for work that's due or overdue
- **Calendar**: task due dates, VO action dates, BOQ deadlines, site visits and meetings.
- **Check in and check out** with location:
  - Each check-in is labelled Office, a project site or Elsewhere.
  - Late arrivals and early finishes are flagged against 8:30 am to 5:30 pm.
  - Managers get a team board with a map and a monthly CSV export.
- **Workload**: open tasks per person per week, shown in red when someone has too much.
- **Team chat** with @mentions and file sharing.
- **Voice notes** in team chat, project chat, task comments and announcements:
  - Tap the microphone, speak (up to 3 minutes), then send. Others get a play button with a waveform.
  - Each note is written out in English a few seconds later, even if spoken in Arabic or Tamil. The sender can correct the text.
- **Files and Google Drive**: attach drawings, BOQs, PDFs and photos to tasks, projects and chats.
  - Files up to 50 MB stay in the app's storage.
  - Bigger files go straight from the phone or computer to a **Northcroft** folder in Google Drive, with a subfolder per project (plus General). A progress figure shows while they upload.
  - Drive files stay private. Only signed-in team members can open them, through the app (PDFs, photos and videos open in the browser; other files download). Deleting one in the app moves it to the Drive bin for 30 days.
  - A manager connects Google Drive once in **Settings > Google Drive**, which has the step-by-step set-up. The app can only see the files and folders it creates, nothing else in that Drive.
- **Profiles and WhatsApp**:
  - Everyone adds a photo and a +966 mobile number the first time they sign in.
  - Tap anyone's photo to see their card, with WhatsApp, call and email buttons.
  - WhatsApp buttons also sit on the Team list, the attendance board and task pages. On a task, the WhatsApp message starts with the task name and a link to it.
  - People's check-ins show on the attendance map as their photo.
- **Liquid glass design**, light by default (Dark or Automatic in Settings > Appearance), with a *Solid surfaces* option for easier reading.
  - Every page opens with a navy glass header with the Northcroft tower behind it; the side menu, top bar and tab bar are navy glass too.
  - Main buttons are glossy Northcroft red; other buttons are frosted glass.
  - Navy is the main colour; Northcroft red marks counts, urgent items, the active tab and New task.
  - Home opens with a banner of the Northcroft tower, a greeting and a one-line summary of your day.
  - Projects can have a cover photo (Hassan and seniors add it on the project page).
  - Empty screens show small navy and red drawings, and sections have coloured icon tiles.
  - Gentle motion: sections rise in, numbers count up, a tick draws when a task is finished. It switches off if the phone's reduce-motion setting is on.

## Who can do what

| | Managers: Fawaz (Commercial Manager) and Hassan | Seniors (switched on in Settings > Team) | Team members |
|---|---|---|---|
| Create and assign tasks, approve work | Yes | Yes | No |
| Post announcements, create projects | Yes | Yes | No |
| See everyone's attendance | Yes | Yes | Own only |
| Add people, reset passwords, set hours, office pins | Yes | No | No |
| Update VOs and BOQ packages, comment, chat, upload files | Yes | Yes | Yes |

Work flows down: Fawaz gives tasks to Hassan, and Hassan gives tasks to the team. Two switches in Settings > Team control this for anyone:

- **Checks in and out**: off for Fawaz. He has no Check in tab and isn't on the attendance board, map, late list or monthly export. Managers who don't check in still see everyone else's attendance.
- **Can be given tasks**: off for Fawaz. He doesn't appear in anyone's "Assign to" list (the database blocks it too), but he can give himself a reminder task.

## Tech

- **Front end**: React, TypeScript and Vite, built as a PWA. The service worker is in `public/sw.js`.
- **Back end**: Supabase project `hfekwhvnyzpneydqrnsz` in the `ap-south-1` (Mumbai) region.
  - Postgres with row level security on every table.
  - Database triggers create notifications and keep the activity history.
  - `pg_cron` runs reminders at 08:00 Riyadh time and recurring tasks at 05:00.
  - Storage bucket `files` holds attachments.
  - Edge Functions:
    - `send-push` sends Web Push messages, signed with VAPID keys kept in Supabase Vault.
    - `admin-users` lets the manager add people and reset passwords.
    - `transcribe` writes voice notes out in English in two steps:
      1. Groq Whisper (`whisper-large-v3`) writes down what was said, in the language it was spoken, and reports the language. This needs a `GROQ_API_KEY` secret. Without it, voice notes still work but show "Voice-to-text isn't switched on yet".
      2. Claude (`claude-opus-5-5`, low effort) finishes it. English is tidied (misheard names, projects and QS terms, punctuation). Arabic, Tamil or any other language is translated into English, keeping names, dates and times exactly; this is much more accurate than Whisper's own translation. This step turns on with an `ANTHROPIC_API_KEY` secret. Without Claude, English is kept as Whisper wrote it and other languages use Whisper's translation.
    - `drive` handles Google Drive for files over 50 MB: connecting (Google sign-in with the `drive.file` permission only), starting uploads that the browser sends straight to Google in 8 MB pieces, attaching them, and streaming them back to signed-in team members through 1-hour signed links. The Google client, refresh token and link-signing key are kept in Supabase Vault.
    - `assist` is retired (it answers "no longer available").
  - Where the Claude and Groq keys live: Supabase Vault, as `anthropic_api_key` and `groq_api_key` (encrypted at rest; read only by the Edge Functions through `get_ai_keys()`). An Edge Function secret with the same name in capitals (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`) takes priority if you add one. The keys are never stored in this repository.
  - To replace a key, run this in the Supabase SQL editor (a changed key is picked up within 5 minutes):
    `select vault.update_secret((select id from vault.secrets where name = 'anthropic_api_key'), '<new key>');`
- **Database**: the SQL is in `supabase/migrations/`, and the Edge Function source is in `supabase/functions/`.

## Running locally

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks, then builds to dist/
```

The Supabase address, publishable key and VAPID public key are in `src/lib/config.ts`. All three are safe to ship to a browser. To override them, set `VITE_SUPABASE_URL`, `VITE_SUPABASE_KEY` and `VITE_VAPID_PUBLIC_KEY`.

## Hosting on Vercel

1. Open https://vercel.com/new and import `hashu387-ship-it/Northcroft`.
2. Keep the defaults and press **Deploy**. `vercel.json` already sets the build command, the output folder, and the settings the app and service worker need.

After that, every push to GitHub redeploys the site automatically. Notification links follow whichever web address each phone installed the app from, so nothing needs changing after the first deploy.

## Installing on a phone

- **iPhone (iOS 16.4 or newer)**:
  1. Open the site in Safari.
  2. Tap **Share**, then **Add to Home Screen**.
  3. Open Northcroft from the Home Screen.
  4. Go to **Settings > Notifications** and tap **Turn on notifications**.
- **Android**: open the site in Chrome, tap **Install** when it's offered, then turn on notifications the same way.
