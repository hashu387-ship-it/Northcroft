// "What's new": a short list of what changed in the app, shown once to each person after an
// update (a popup when the app opens) and again from More whenever they like. Each item says who
// it's for, so people only see what applies to them.
import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  ClipboardCheck,
  ClockAlert,
  Megaphone,
  Palette,
  Smartphone,
  Sparkles,
  SquareKanban,
  Timer,
  ChartColumn,
  UserRound,
  Users,
} from "lucide-react";

export interface WhatsNewContext {
  /** Checks in and out (not the Commercial Manager). */
  checksIn: boolean;
  /** Answers missed check-in requests (managers, Hassan and Fawaz). */
  approves: boolean;
  /** Sees the team (managers and seniors). */
  canAssign: boolean;
  /** Who their own missed check-in requests go to. */
  approverName: string;
}

export interface WhatsNewItem {
  id: string;
  icon: LucideIcon;
  color: string;
  title: (c: WhatsNewContext) => string;
  body: (c: WhatsNewContext) => string;
  to?: string;
  cta?: string;
  /** Shown only to these people. */
  for?: (c: WhatsNewContext) => boolean;
  /** Needs the missed check-in tables (held back until they're in place). */
  needsCheckinFix?: boolean;
}

export interface Release {
  id: string;
  date: string;
  items: WhatsNewItem[];
}

/** Newest first. Add a release at the top when something new ships. */
export const RELEASES: Release[] = [
  {
    id: "2026-11-22",
    date: "2026-11-22",
    items: [
      {
        id: "missed-checkin",
        icon: ClockAlert,
        color: "#BF5AF2",
        title: (c) => `Forgot to check in? Ask ${c.approverName}`,
        body: (c) => `Pick the day and the times you came in and left. Once ${c.approverName} approves it, it's in your attendance. Up to 3 a month.`,
        to: "/attendance",
        cta: "Open Check in",
        for: (c) => c.checksIn,
        needsCheckinFix: true,
      },
      {
        id: "checkin-reminder",
        icon: AlarmClock,
        color: "#FF9F0A",
        title: () => "A reminder when you haven't checked in",
        body: (c) => `Open the app after office hours start without checking in, and it reminds you, with a quick way to ask ${c.approverName}.`,
        for: (c) => c.checksIn,
      },
      {
        id: "approve-missed",
        icon: ClipboardCheck,
        color: "#5E5CE6",
        title: () => "Missed check-ins to approve",
        body: () => "When someone forgets to check in, their request pops up when you open the app. Approve or decline it right there.",
        to: "/attendance",
        cta: "Open Attendance",
        for: (c) => c.approves,
        needsCheckinFix: true,
      },
      {
        id: "announcement-popups",
        icon: Megaphone,
        color: "#F13E44",
        title: () => "Announcements pop up",
        body: () => "New announcements show when you open the app. Ones that need acknowledging keep showing until you press Acknowledge.",
        to: "/announcements",
        cta: "Open Announcements",
      },
      {
        id: "home-photo",
        icon: UserRound,
        color: "#0A84FF",
        title: () => "Your photo on Home",
        body: () => "Your photo now sits next to the greeting on Home. Tap it to see your profile.",
      },
      {
        id: "photos-names",
        icon: Users,
        color: "#30D158",
        title: () => "Photos next to names",
        body: () => "Everyone's photo shows next to their name on tasks, comments, files and registers.",
      },
      {
        id: "stopwatch",
        icon: Timer,
        color: "#0FA37F",
        title: () => "A stopwatch on every task",
        body: () => "Start it on any task you're on, and Home shows who's working on what right now. It stops by itself when you check out.",
        to: "/my-tasks",
        cta: "Open My tasks",
      },
      {
        id: "time-report",
        icon: ChartColumn,
        color: "#0FA37F",
        title: () => "Time report",
        body: (c) =>
          c.canAssign
            ? "How long the team spent on each task, by person or by task, with an Excel download."
            : "How long you spent on each task this week, with an Excel download.",
        to: "/time",
        cta: "Open Time report",
      },
      {
        id: "task-board",
        icon: SquareKanban,
        color: "#5E5CE6",
        title: () => "Board view in My tasks",
        body: () => "Switch My tasks to Board, then drag a task from To do to In progress, or drag it to In review to hand it in.",
        to: "/my-tasks",
        cta: "Open My tasks",
      },
      {
        id: "motion",
        icon: Sparkles,
        color: "#FF9F0A",
        title: () => "Smoother screens",
        body: () => "Cards open into their page, numbers roll up, and the deadline countdown flips.",
      },
      {
        id: "aurora",
        icon: Palette,
        color: "#1B3570",
        title: () => "A new look: Aurora glass",
        body: () => "Try it in Settings, Appearance. Your current look stays until you switch.",
        to: "/settings/appearance",
        cta: "Open Appearance",
      },
      {
        id: "shortcuts",
        icon: Smartphone,
        color: "#3A6EA5",
        title: () => "Shortcuts on the app icon",
        body: () => "On your phone, press and hold the Northcroft icon for Check in, New task, Daily update and Time report.",
      },
    ],
  },
];

export const LATEST = RELEASES[0];

const key = (userId: string) => `nc-whatsnew-seen:${userId}`;

/** The release this person last saw, or null. */
export function seenRelease(userId: string): string | null {
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function markReleaseSeen(userId: string, id = LATEST.id) {
  try {
    localStorage.setItem(key(userId), id);
  } catch {
    /* private mode: shows again next time */
  }
}

/** The items of a release that apply to this person. */
export function itemsFor(release: Release, c: WhatsNewContext, checkinFixReady: boolean): WhatsNewItem[] {
  return release.items.filter((i) => (!i.for || i.for(c)) && (!i.needsCheckinFix || checkinFixReady));
}
