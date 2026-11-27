// Face ID lock for the iPhone app (Settings > iPhone app). When it's on, the app asks for Face ID
// (or the phone's passcode) when it opens, and again after being away for more than a minute.
import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { ScanFace } from "lucide-react";
import { QsTitle } from "@/components/Brand";
import { isNativeApp } from "./platform";
import { NorthcroftNative } from "./plugin";
import { getPref, PREF, usePref } from "./prefs";

const AWAY_MS = 60_000;

export function FaceIdLock() {
  const on = usePref(PREF.faceId) && isNativeApp();
  const [locked, setLocked] = useState(() => isNativeApp() && getPref(PREF.faceId));
  const [failed, setFailed] = useState<string | null>(null);
  const trying = useRef(false);
  const awayAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (trying.current) return;
    trying.current = true;
    setFailed(null);
    try {
      const r = await NorthcroftNative.authenticate({ reason: "Unlock Northcroft" });
      if (r.ok) setLocked(false);
      else if (r.reason === "lockout") setFailed("Face ID is locked after too many tries. Unlock your iPhone with its passcode, then try again.");
      else if (r.reason === "no-passcode") setFailed("Set a passcode on this iPhone to use Face ID lock.");
      else if (r.reason !== "cancelled") setFailed("That didn't work. Try again.");
    } catch {
      // Face ID isn't available (for example in the simulator): don't lock anyone out.
      setLocked(false);
    } finally {
      trying.current = false;
    }
  }, []);

  useEffect(() => {
    if (on && locked) void unlock();
  }, [on, locked, unlock]);

  useEffect(() => {
    if (!on) return;
    const subs = [
      App.addListener("pause", () => {
        awayAt.current = Date.now();
      }),
      App.addListener("resume", () => {
        if (awayAt.current && Date.now() - awayAt.current > AWAY_MS) setLocked(true);
        awayAt.current = null;
      }),
    ];
    return () => subs.forEach((p) => void p.then((h) => h.remove()));
  }, [on]);

  if (!on || !locked) return null;
  return (
    <div className="faceid-lock" role="dialog" aria-modal="true" aria-label="Northcroft is locked">
      <QsTitle size={44} />
      <p>Northcroft is locked</p>
      {failed && <p className="faceid-why">{failed}</p>}
      <button type="button" className="btn primary large" onClick={() => void unlock()}>
        <ScanFace /> Unlock with Face ID
      </button>
    </div>
  );
}
