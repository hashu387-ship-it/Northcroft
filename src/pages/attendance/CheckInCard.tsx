import { useMemo, useState, type ReactNode } from "react";
import { CircleCheck, Clock, LocateFixed, LogIn, LogOut, MapPinOff, Navigation } from "lucide-react";
import { useInvalidate, useSettings } from "@/lib/api";
import { getPosition, mapsLink, reverseGeocode } from "@/lib/geo";
import { errorMessage, supabase } from "@/lib/supabase";
import { DOW_LONG, fmtClock, fmtDuration, fmtLongDate, fmtTime12, isWorkday, todayISO } from "@/lib/time";
import type { Attendance } from "@/lib/types";
import { Pill, useToast } from "@/components/ui";
import { MapBox, PlacePill, clockParts, useNow } from "./shared";

type Phase = "idle" | "locating" | "saving";

function workDaysText(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length > 2 && contiguous) return `${DOW_LONG[sorted[0]]} to ${DOW_LONG[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => DOW_LONG[d]).join(", ");
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => window.setTimeout(() => r(fallback), ms))]);
}

export function CheckInCard({ today }: { today: Attendance | undefined }) {
  const { data: settings } = useSettings();
  const toast = useToast();
  const invalidate = useInvalidate();
  const now = useNow(1000);
  const [phase, setPhase] = useState<Phase>("idle");
  const [locError, setLocError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const clock = clockParts(now);
  const date = todayISO();
  const working = settings ? isWorkday(date, settings.work_days) : true;
  const mode: "in" | "out" | "done" = !today ? "in" : today.check_out_at ? "done" : "out";

  async function record(withLocation: boolean) {
    setLocError(null);
    let fix: { lat: number; lng: number; accuracy: number } | null = null;
    let address: string | null = null;
    if (withLocation) {
      setPhase("locating");
      try {
        fix = await getPosition();
      } catch (e) {
        setLocError(errorMessage(e));
        setPhase("idle");
        return;
      }
      setPhase("saving");
      address = await withTimeout(reverseGeocode(fix.lat, fix.lng), 4500, null);
    } else {
      setPhase("saving");
    }
    try {
      const fn = mode === "in" ? "check_in" : "check_out";
      const { data, error } = await supabase.rpc(fn, {
        p_lat: fix?.lat ?? null,
        p_lng: fix?.lng ?? null,
        p_accuracy: fix?.accuracy ?? null,
        p_address: address,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      const rec = data as Attendance;
      const where = mode === "in" ? rec.in_place_name : rec.out_place_name;
      toast(`${mode === "in" ? "Checked in" : "Checked out"} at ${fmtTime12(mode === "in" ? rec.check_in_at : rec.check_out_at)}${where ? `, ${where}` : ""}`);
      setNote("");
      setShowNote(false);
      await invalidate("attendance");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setPhase("idle");
    }
  }

  const points = useMemo(() => {
    if (!today) return [];
    const pts = [];
    if (today.in_lat != null && today.in_lng != null)
      pts.push({ id: "in", lat: today.in_lat, lng: today.in_lng, label: `In ${fmtTime12(today.check_in_at)}`, color: "#30D158" });
    if (today.out_lat != null && today.out_lng != null && today.check_out_at)
      pts.push({ id: "out", lat: today.out_lat, lng: today.out_lng, label: `Out ${fmtTime12(today.check_out_at)}`, color: "#FF375F" });
    return pts;
  }, [today]);

  const busyLabel = phase === "locating" ? "Finding your location..." : phase === "saving" ? "Saving..." : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="glass-strong checkin-hero">
        <div className="checkin-top">
          <div>
            <div className="clock" aria-live="off">
              {clock.hm}
              <span className="clock-sec">:{clock.s}</span>
              <span className="clock-ampm">{clock.ampm}</span>
            </div>
            <div className="bold" style={{ marginTop: 8, fontSize: 17 }}>
              {fmtLongDate(date)}
            </div>
            {settings && (
              <div className="muted small" style={{ marginTop: 2 }}>
                Work hours {fmtClock(settings.work_start)} to {fmtClock(settings.work_end)}, {workDaysText(settings.work_days)}
              </div>
            )}
            {!working && (
              <div style={{ marginTop: 8 }}>
                <Pill tone="teal">It's the weekend. You can still check in if you're working.</Pill>
              </div>
            )}
          </div>
          <div className="checkin-status">
            {mode === "in" && <Pill tone="gray" lg>Not checked in yet</Pill>}
            {mode === "out" && (
              <Pill tone="green" lg>
                <Clock /> In since {fmtTime12(today!.check_in_at)} · {fmtDuration(today!.check_in_at, null)}
              </Pill>
            )}
            {mode === "done" && (
              <Pill tone="blue" lg>
                <CircleCheck /> Done for today · {fmtDuration(today!.check_in_at, today!.check_out_at)}
              </Pill>
            )}
          </div>
        </div>

        {mode !== "done" ? (
          <div className="stack" style={{ gap: 10 }}>
            <button
              className={`btn large block checkin-btn ${mode === "in" ? "success" : "primary"}`}
              onClick={() => record(true)}
              disabled={phase !== "idle"}
              type="button"
            >
              {busyLabel ? (
                <>
                  <LocateFixed /> {busyLabel}
                </>
              ) : mode === "in" ? (
                <>
                  <LogIn /> Check in
                </>
              ) : (
                <>
                  <LogOut /> Check out
                </>
              )}
            </button>
            {showNote ? (
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note, e.g. Client meeting at the site office"
                maxLength={500}
              />
            ) : (
              <button className="btn small ghost" style={{ alignSelf: "center" }} onClick={() => setShowNote(true)} type="button">
                Add a note
              </button>
            )}
            {locError && (
              <div className="solid stack" style={{ padding: 14, gap: 10, borderRadius: 16 }} role="alert">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <MapPinOff size={20} className="danger-text" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div className="small">
                    <b>We couldn't get your location.</b>
                    <div className="muted">{locError}</div>
                    <div className="muted" style={{ marginTop: 4 }}>
                      You can still {mode === "in" ? "check in" : "check out"}. It will be recorded as "Location unavailable" so Hassan knows why.
                    </div>
                  </div>
                </div>
                <div className="row wrap">
                  <button className="btn small primary" onClick={() => record(true)} type="button" disabled={phase !== "idle"}>
                    Try again
                  </button>
                  <button className="btn small" onClick={() => record(false)} type="button" disabled={phase !== "idle"}>
                    {mode === "in" ? "Check in" : "Check out"} without location
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="muted small" style={{ textAlign: "center" }}>
            Checked out at {fmtTime12(today!.check_out_at)}. See you tomorrow.
          </div>
        )}
      </div>

      {today && (
        <div className="glass card stack" style={{ gap: 14 }}>
          <div className="card-head" style={{ marginBottom: 0 }}>
            <h2>Today's record</h2>
            {today.late_minutes > 0 && <Pill tone="orange">Late by {today.late_minutes} min</Pill>}
          </div>
          <div className="grid-2">
            <RecordSide
              label="Checked in"
              time={today.check_in_at}
              kind={today.in_place_kind}
              place={today.in_place_name}
              address={today.in_address}
              accuracy={today.in_accuracy}
              lat={today.in_lat}
              lng={today.in_lng}
            />
            {today.check_out_at ? (
              <RecordSide
                label="Checked out"
                time={today.check_out_at}
                kind={today.out_place_kind}
                place={today.out_place_name}
                address={today.out_address}
                accuracy={today.out_accuracy}
                lat={today.out_lat}
                lng={today.out_lng}
                extra={today.early_minutes > 0 ? <Pill tone="orange">Left {today.early_minutes} min early</Pill> : null}
              />
            ) : (
              <div className="solid record-side" style={{ display: "grid", placeItems: "center", color: "var(--text-2)" }}>
                <span className="small">Not checked out yet</span>
              </div>
            )}
          </div>
          {today.note && (
            <div className="small">
              <span className="muted">Note: </span>
              {today.note}
            </div>
          )}
          {points.length > 0 && <MapBox points={points} />}
        </div>
      )}
    </div>
  );
}

function RecordSide({
  label,
  time,
  kind,
  place,
  address,
  accuracy,
  lat,
  lng,
  extra,
}: {
  label: string;
  time: string;
  kind: Attendance["in_place_kind"];
  place: string | null;
  address: string | null;
  accuracy: number | null;
  lat: number | null;
  lng: number | null;
  extra?: ReactNode;
}) {
  return (
    <div className="solid record-side stack" style={{ gap: 8 }}>
      <div className="row">
        <span className="muted small bold">{label}</span>
        <span className="spacer" />
        <span className="bold num" style={{ fontSize: 18 }}>
          {fmtTime12(time)}
        </span>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <PlacePill kind={kind} name={place} />
        {extra}
      </div>
      {address && <div className="small muted">{address}</div>}
      {lat != null && lng != null && (
        <div className="row tiny faint" style={{ gap: 10 }}>
          {accuracy != null && <span>Accurate to about {Math.round(accuracy)} m</span>}
          <a href={mapsLink(lat, lng)} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}>
            <Navigation size={12} /> Open in Maps
          </a>
        </div>
      )}
    </div>
  );
}
