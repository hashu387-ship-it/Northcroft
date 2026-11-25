// Settings > iPhone app (only inside the Northcroft iPhone app): Face ID lock, the check-in
// reminder at the office, the workday Live Activity, the Northcroft calendar, the document scanner,
// and how to use the widget, Siri, Control Center, Spotlight and the app icon.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, ScanLine } from "lucide-react";
import { useMe } from "@/lib/auth";
import { pushState } from "@/lib/push";
import { NorthcroftNative, type CalendarPermission, type LocationPermission } from "@/native/plugin";
import { scanToShare } from "@/native/scan";
import { PREF, setPref, usePref } from "@/native/prefs";
import { Pill, Switch, useToast } from "@/components/ui";
import { Section } from "./common";

export function IphoneSection() {
  const me = useMe();
  const toast = useToast();
  const navigate = useNavigate();
  const faceOn = usePref(PREF.faceId);
  const officeOn = usePref(PREF.officeWatch);
  const liveOn = !usePref(PREF.liveActivityOff);
  const calendarOn = usePref(PREF.calendar);
  const [cal, setCal] = useState<CalendarPermission | null>(null);
  const [bio, setBio] = useState<{ available: boolean; type: string } | null>(null);
  const [loc, setLoc] = useState<LocationPermission | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void NorthcroftNative.biometry().then(setBio).catch(() => setBio({ available: false, type: "none" }));
    void NorthcroftNative.officeStatus().then((s) => setLoc(s.permission)).catch(() => undefined);
    void NorthcroftNative.calendarStatus().then((s) => setCal(s.permission)).catch(() => undefined);
  }, []);

  async function setCalendar(v: boolean) {
    if (!v) {
      setPref(PREF.calendar, false);
      await NorthcroftNative.calendarDisable().catch(() => undefined);
      toast("The Northcroft calendar is removed from this iPhone.");
      return;
    }
    setBusy(true);
    try {
      const { permission } = await NorthcroftNative.calendarEnable();
      setCal(permission);
      if (permission === "granted") {
        setPref(PREF.calendar, true);
        toast("On. Your deadlines, site visits and meetings will appear in a Northcroft calendar.");
      } else {
        toast("Calendar access is off for Northcroft. Turn on Full Access in iPhone Settings > Northcroft > Calendars, then try again.", "error");
      }
    } catch {
      toast("Update the Northcroft app to use the calendar.", "error");
    } finally {
      setBusy(false);
    }
  }

  const faceName = bio?.type === "touchID" ? "Touch ID" : "Face ID";

  async function setFace(v: boolean) {
    if (!v) {
      setPref(PREF.faceId, false);
      return;
    }
    // Check it works before relying on it.
    const r = await NorthcroftNative.authenticate({ reason: `Turn on ${faceName} for Northcroft` }).catch(() => ({ ok: false, reason: "failed" }));
    if (r.ok) {
      setPref(PREF.faceId, true);
      toast(`${faceName} lock is on`);
    } else if (r.reason !== "cancelled") {
      toast(`${faceName} didn't work, so the lock stays off.`, "error");
    }
  }

  async function setOffice(v: boolean) {
    if (!v) {
      setPref(PREF.officeWatch, false);
      return;
    }
    setBusy(true);
    try {
      const { permission } = await NorthcroftNative.officePermission();
      setLoc(permission);
      if (permission === "always" || permission === "whenInUse") {
        setPref(PREF.officeWatch, true);
        toast(
          permission === "always"
            ? "On. You'll get a reminder when you arrive at the office."
            : "On. For it to work with the app closed, allow location Always when your iPhone asks.",
        );
      } else {
        toast("Location is off for Northcroft. Turn it on in iPhone Settings > Northcroft > Location, then try again.", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const push = pushState();
  const locLabel: Record<string, string> = {
    always: "Location: Always",
    whenInUse: "Location: While using the app",
    denied: "Location: Off",
    restricted: "Location: Restricted",
    notDetermined: "Location: Not asked yet",
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Section title="Security">
        <div className="setting-row">
          <div className="grow">
            <b>Lock with {faceName}</b>
            <small>
              Asks for {faceName} (or your iPhone passcode) when Northcroft opens, and again after you've been away from it for a minute.
              {bio && !bio.available && ` ${faceName} isn't set up on this iPhone, so the passcode is used.`}
            </small>
          </div>
          <Switch checked={faceOn} onChange={(v) => void setFace(v)} label={`Lock with ${faceName}`} />
        </div>
      </Section>

      {!me.attendance_exempt && (
        <Section title="Check-in at the office">
          <div className="setting-row">
            <div className="grow">
              <b>Remind me when I arrive</b>
              <small>
                When you reach the office on a working day and haven't checked in, your iPhone says "You're at the office". Tap it and Northcroft checks you in.
                Your iPhone only notices arriving at the office; your location isn't tracked or sent anywhere.
              </small>
              {loc && officeOn && (
                <div style={{ marginTop: 6 }}>
                  <Pill tone={loc === "always" ? "green" : "orange"}>{locLabel[loc] ?? "Location"}</Pill>
                </div>
              )}
            </div>
            <Switch checked={officeOn} onChange={(v) => void setOffice(v)} disabled={busy} label="Remind me when I arrive" />
          </div>
        </Section>
      )}

      {!me.attendance_exempt && (
        <Section title="Lock screen and Dynamic Island">
          <div className="setting-row">
            <div className="grow">
              <b>Show my workday</b>
              <small>
                From check-in until check-out, your lock screen and the Dynamic Island show when you checked in, the time since, and what's due today,
                with a Check out button.
              </small>
            </div>
            <Switch checked={liveOn} onChange={(v) => setPref(PREF.liveActivityOff, !v)} label="Show my workday" />
          </div>
        </Section>
      )}

      <Section title="Calendar">
        <div className="setting-row">
          <div className="grow">
            <b>Show in my iPhone Calendar</b>
            <small>
              Your task deadlines, and the site visits and meetings you're in, go into a calendar called Northcroft on this iPhone. It stays up to date,
              and you can hide it or change its colour in the Calendar app.
            </small>
            {calendarOn && cal && cal !== "granted" && (
              <div style={{ marginTop: 6 }}>
                <Pill tone="orange">Calendar access is off in iPhone Settings</Pill>
              </div>
            )}
          </div>
          <Switch checked={calendarOn} onChange={(v) => void setCalendar(v)} disabled={busy} label="Show in my iPhone Calendar" />
        </div>
      </Section>

      <Section title="Scan documents">
        <button type="button" className="setting-row" style={{ color: "inherit", width: "100%", textAlign: "left", background: "none", border: 0 }} onClick={() => void scanToShare(navigate, toast)}>
          <div className="grow">
            <b>Scan a document</b>
            <small>
              Delivery notes, site sheets, marked-up drawings: the camera finds the page edges and straightens them, and the pages become one PDF you send to
              a chat or one of your tasks. The words in it are read on the phone, so you can search the PDF and copy from it.
            </small>
          </div>
          <ScanLine className="muted" />
        </button>
      </Section>

      <Section title="Widget, Siri, Control Center and search">
        <div className="setting-row">
          <div className="grow">
            <b>Home screen widget</b>
            <small>
              Shows whether you've checked in and your tasks due today. Press and hold an empty spot on your home screen (or lock screen), tap Edit, then Add Widget,
              and pick Northcroft.
            </small>
          </div>
        </div>
        <div className="setting-row">
          <div className="grow">
            <b>Siri and Shortcuts</b>
            <small>
              Say {me.attendance_exempt ? "" : "“Check me in with Northcroft”, “Check me out with Northcroft”, "}“Scan a document with Northcroft”,
              “Show my Northcroft tasks” or “Open Northcroft chats”. They're also in the Shortcuts app, and can go on the Action button.
            </small>
          </div>
        </div>
        <div className="setting-row">
          <div className="grow">
            <b>Control Center</b>
            <small>Swipe down from the top right, tap + to edit, then Add a Control and search for Northcroft: Check in, and Scan a document. You can also put them on the lock screen.</small>
          </div>
        </div>
        <div className="setting-row">
          <div className="grow">
            <b>Apple Watch</b>
            <small>
              Northcroft is on your watch too (install it from the Watch app on this iPhone if it isn't): today's check-in and tasks due
              {me.attendance_exempt ? "." : ", and a Check in button that finishes on this iPhone."}
            </small>
          </div>
        </div>
        <div className="setting-row">
          <div className="grow">
            <b>Search</b>
            <small>Swipe down on the home screen and type a project or task name: Northcroft's projects and your open tasks show up, and open straight to them.</small>
          </div>
        </div>
        <div className="setting-row">
          <div className="grow">
            <b>App icon</b>
            <small>Press and hold the Northcroft icon for Check in, Scan a document, My tasks and Chats.</small>
          </div>
        </div>
      </Section>

      <Section title="Notifications">
        <Link to="/settings/notifications" className="setting-row" style={{ color: "inherit" }}>
          <div className="grow">
            <b>Notifications {push === "granted" ? "are on" : "are off"}</b>
            <small>Approve or decline missed check-ins and leave, and reply to chats, straight from the notification.</small>
          </div>
          <ChevronRight className="muted" />
        </Link>
      </Section>
    </div>
  );
}
