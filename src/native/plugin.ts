// The JavaScript side of the app's own iPhone code (native/northcroft-native, Swift).
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type LocationPermission = "always" | "whenInUse" | "denied" | "restricted" | "notDetermined" | "unknown";

export interface SharedBatch {
  id: string;
  at: string;
  title: string;
  text: string;
  url: string;
  /** The folder the files are in, on the phone. */
  dir: string;
  files: { name: string; file: string; type: string; size: number }[];
}

/** Something asked for from Siri, the Shortcuts app, the app icon's press-and-hold menu or the widget. */
export type LaunchAction = "checkin" | "scan" | "tasks" | "chats";

/** What the home screen widget shows (ios/App/NorthcroftWidget reads the same fields). */
export interface WidgetSnapshot {
  /** The day this copy is for (Riyadh date). On a later day the widget ignores the check-in. */
  day: string;
  firstName?: string;
  /** Doesn't check in: the widget shows tasks only. */
  exempt: boolean;
  checkedIn: boolean;
  checkInAt?: string;
  checkedOut?: boolean;
  checkOutAt?: string;
  place?: string;
  /** Open tasks due today, and open tasks past their date. */
  dueToday: number;
  late: number;
  /** The first few of those, late ones first. */
  tasks: { id: string; title: string; due?: string; project?: string; late?: boolean }[];
}

export interface NorthcroftNativePlugin {
  /** Check-in at the office. */
  officeStatus(): Promise<{ permission: LocationPermission; watching: boolean }>;
  officePermission(): Promise<{ permission: LocationPermission }>;
  officeWatch(o: { offices: { id: string; name: string; lat: number; lng: number; radius: number }[]; workDays: number[] }): Promise<{ watching: boolean }>;
  officeStop(): Promise<void>;
  officeMarkCheckedIn(o: { day: string }): Promise<void>;
  /** An arrival at the office from the last three hours that hasn't been acted on. */
  officePending(): Promise<{ kind?: "in"; at?: string; place?: string }>;
  /** Face ID. */
  biometry(): Promise<{ available: boolean; type: "faceID" | "touchID" | "other" | "none" }>;
  authenticate(o: { reason: string }): Promise<{ ok: boolean; reason?: string }>;
  /** Files shared in from other apps. */
  shareInbox(): Promise<{ batch?: SharedBatch }>;
  readShared(o: { path: string }): Promise<{ data: string }>;
  clearShared(o: { id: string }): Promise<void>;
  /** The number on the app icon. */
  setBadge(o: { count: number }): Promise<void>;
  /** The iPhone's document scanner; the pages come back as one PDF (base64). */
  scanDocument(): Promise<{ supported: boolean; cancelled?: boolean; data?: string; name?: string; pages?: number }>;
  /** A Siri, Shortcuts, app icon or widget action waiting to be done (taken once). */
  takeLaunchAction(): Promise<{ action?: LaunchAction }>;
  /** What the home screen widget shows. */
  updateWidget(s: WidgetSnapshot): Promise<{ saved: boolean }>;
  clearWidget(): Promise<void>;
  /** A launch action arrived while the app was open: take it with takeLaunchAction. */
  addListener(event: "launchAction", fn: () => void): Promise<PluginListenerHandle>;
}

export const NorthcroftNative = registerPlugin<NorthcroftNativePlugin>("NorthcroftNative");
