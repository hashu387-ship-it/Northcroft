// Settings > iPhone app > This phone: what the phone lets Northcroft do, at a glance, with a
// button to fix anything that's off in the Settings app. Nothing here asks for a permission.
import { useCallback, useEffect, useState } from "react";
import { App } from "@capacitor/app";
import {
  BatteryCharging,
  BatteryMedium,
  Bell,
  CalendarDays,
  Camera,
  MapPin,
  Mic,
  RefreshCw,
  Smartphone,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { NorthcroftNative, type PhoneStatus } from "@/native/plugin";
import { Pill } from "@/components/ui";
import { Section } from "./common";

type Tone = "green" | "orange" | "red" | "gray";
interface Row {
  icon: LucideIcon;
  name: string;
  value: string;
  tone: Tone;
  /** Why it matters, shown when it's not all good. */
  why?: string;
  fix?: "app" | "notifications";
}

function rows(s: PhoneStatus): Row[] {
  const out: Row[] = [];
  const loc = s.location;
  out.push({
    icon: MapPin,
    name: "Location",
    value: loc === "always" ? "Always" : loc === "whenInUse" ? "While using" : loc === "off" ? "Off" : loc === "notAsked" ? "Not asked yet" : "Restricted",
    tone: loc === "always" ? "green" : loc === "whenInUse" ? "orange" : loc === "notAsked" ? "gray" : "red",
    why:
      loc === "always"
        ? s.preciseLocation === false
          ? "Precise Location is off, so check-in places may be wrong."
          : undefined
        : loc === "whenInUse"
          ? "Set to Always for the office reminder and the site visit log with the app closed."
          : loc === "notAsked"
            ? undefined
            : "Check-in, site trips and the site visit log need Location.",
    fix: loc === "always" && s.preciseLocation !== false ? undefined : loc === "notAsked" ? undefined : "app",
  });
  if (s.preciseLocation === false && loc === "always") out[0].tone = "orange";
  const n = s.notifications;
  out.push({
    icon: Bell,
    name: "Notifications",
    value: n === "on" ? (s.timeSensitive ? "On, time-sensitive allowed" : "On") : n === "quiet" ? "Delivered quietly" : n === "off" ? "Off" : "Not asked yet",
    tone: n === "on" ? (s.timeSensitive === false ? "orange" : "green") : n === "quiet" ? "orange" : n === "off" ? "red" : "gray",
    why:
      n === "off"
        ? "You won't hear about tasks, chats, approvals or calls."
        : n === "on" && s.timeSensitive === false
          ? "Turn on Time Sensitive so calls and approvals get through Focus."
          : n === "on" && s.summary
            ? "Some notifications wait for your Scheduled Summary."
            : undefined,
    fix: n === "off" || n === "quiet" || (n === "on" && s.timeSensitive === false) ? "notifications" : undefined,
  });
  if (s.liveActivities !== undefined)
    out.push({
      icon: Smartphone,
      name: "Live Activities",
      value: s.liveActivities ? "On" : "Off",
      tone: s.liveActivities ? "green" : "orange",
      why: s.liveActivities ? undefined : "Your workday, tasks and site trips can't show on the lock screen.",
      fix: s.liveActivities ? undefined : "app",
    });
  const simple = (icon: LucideIcon, name: string, v: string | undefined, needed: string): Row => ({
    icon,
    name,
    value: v === "on" ? "On" : v === "addOnly" ? "Add only" : v === "off" ? "Off" : v === "notAsked" ? "Not asked yet" : "Restricted",
    tone: v === "on" ? "green" : v === "notAsked" ? "gray" : v === "addOnly" ? "orange" : "red",
    why: v === "on" || v === "notAsked" ? undefined : needed,
    fix: v === "on" || v === "notAsked" ? undefined : "app",
  });
  out.push(simple(Mic, "Microphone", s.microphone, "Voice calls and voice notes need the microphone."));
  out.push(simple(Camera, "Camera", s.camera, "Photos and the document scanner need the camera."));
  out.push(simple(CalendarDays, "Calendar", s.calendar, "The Northcroft calendar needs Full Access."));
  out.push({
    icon: RefreshCw,
    name: "Background App Refresh",
    value: s.backgroundRefresh === "on" ? "On" : s.backgroundRefresh === "off" ? "Off" : "Restricted",
    tone: s.backgroundRefresh === "on" ? "green" : "orange",
    why: s.backgroundRefresh === "on" ? undefined : "The widget and Watch update less often.",
    fix: s.backgroundRefresh === "on" ? undefined : "app",
  });
  out.push({
    icon: s.batteryState === "charging" || s.batteryState === "full" ? BatteryCharging : BatteryMedium,
    name: "Battery",
    value: `${s.battery !== undefined ? `${s.battery}%` : "Unknown"}${s.batteryState === "charging" ? ", charging" : ""}${s.lowPower ? ", Low Power Mode" : ""}`,
    tone: s.lowPower ? "orange" : "green",
    why: s.lowPower ? "Low Power Mode can delay site visits and widget updates." : undefined,
  });
  out.push({
    icon: s.online === false ? WifiOff : Wifi,
    name: "Network",
    value: s.online === false ? "Offline" : s.network === "wifi" ? "Wi-Fi" : s.network === "cellular" ? "Mobile data" : s.network === "wired" ? "Wired" : "Connected",
    tone: s.online === false ? "red" : s.lowData ? "orange" : "green",
    why: s.online === false ? "Changes wait until you're back online." : s.lowData ? "Low Data Mode is on: calls may sound worse." : undefined,
  });
  return out;
}

export function PhoneStatusSection() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [missing, setMissing] = useState(false);
  const read = useCallback(() => {
    void NorthcroftNative.phoneStatus()
      .then((s) => {
        setStatus(s);
        setMissing(false);
      })
      .catch(() => setMissing(true));
  }, []);

  useEffect(() => {
    read();
    // Coming back from the Settings app: read it again.
    const sub = App.addListener("appStateChange", (s) => {
      if (s.isActive) read();
    });
    return () => void sub.then((h) => h.remove());
  }, [read]);

  if (missing) {
    return (
      <Section title="This phone">
        <div className="setting-row">
          <div className="grow">
            <small>Update the Northcroft app to see what this phone allows.</small>
          </div>
        </div>
      </Section>
    );
  }
  if (!status) return null;

  return (
    <Section title="This phone">
      {rows(status).map((r) => (
        <div className="setting-row phone-row" key={r.name}>
          <r.icon className="muted" size={20} />
          <div className="grow">
            <b>{r.name}</b>
            {r.why && <small>{r.why}</small>}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Pill tone={r.tone}>{r.value}</Pill>
            {r.fix && (
              <button type="button" className="btn small" onClick={() => void NorthcroftNative.openSettings({ kind: r.fix })}>
                Fix
              </button>
            )}
          </div>
        </div>
      ))}
      {status.system && <div className="tiny faint" style={{ padding: "6px 2px 0" }}>{`${status.device ?? "iPhone"} · ${status.system}`}</div>}
    </Section>
  );
}
