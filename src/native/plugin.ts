// The JavaScript side of the app's own iPhone code (native/northcroft-native, Swift).
import { registerPlugin } from "@capacitor/core";

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
}

export const NorthcroftNative = registerPlugin<NorthcroftNativePlugin>("NorthcroftNative");
