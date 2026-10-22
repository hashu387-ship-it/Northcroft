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
- **Liquid glass design** in light and dark mode, with a *Solid surfaces* option for easier reading.

## Who can do what

| | Hassan (manager) | Seniors (switched on in Settings > Team) | Team members |
|---|---|---|---|
| Create and assign tasks, approve work | Yes | Yes | No |
| Post announcements, create projects | Yes | Yes | No |
| See everyone's attendance | Yes | Yes | Own only |
| Add people, reset passwords, set hours, office pins | Yes | No | No |
| Update VOs and BOQ packages, comment, chat, upload files | Yes | Yes | Yes |

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
