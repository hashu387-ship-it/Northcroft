// Settings > iPhone app (only inside the Northcroft iPhone app): Face ID lock and the check-in
// reminder at the office.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useMe } from "@/lib/auth";
import { pushState } from "@/lib/push";
import { NorthcroftNative, type LocationPermission } from "@/native/plugin";
import { PREF, setPref, usePref } from "@/native/prefs";
import { Pill, Switch, useToast } from "@/components/ui";
import { Section } from "./common";

export function IphoneSection() {
  const me = useMe();
  const toast = useToast();
  const faceOn = usePref(PREF.faceId);
  const officeOn = usePref(PREF.officeWatch);
  const [bio, setBio] = useState<{ available: boolean; type: string } | null>(null);
  const [loc, setLoc] = useState<LocationPermission | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void NorthcroftNative.biometry().then(setBio).catch(() => setBio({ available: false, type: "none" }));
    void NorthcroftNative.officeStatus().then((s) => setLoc(s.permission)).catch(() => undefined);
  }, []);

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
