// Lunch break on the Check in page: Start break and Close break when going out, and the
// "Confirm I'm in the office" step for people staying in. Each tap takes the phone's location once.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { Building2, CircleCheck, Coffee, LocateFixed, LogIn, LogOut, MapPinOff, TriangleAlert } from "lucide-react";
import { useInvalidate, usePeople, useSettings } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { getPosition, reverseGeocode } from "@/lib/geo";
import { errorMessage, supabase } from "@/lib/supabase";
import { isWorkday, todayISO } from "@/lib/time";
import type { Attendance, LunchBreak } from "@/lib/types";
import { Pill, useToast } from "@/components/ui";
import { PlacePill, useNow } from "./shared";
import { breakLength, followsBreakRules, lunchClock, lunchRules, minutesClock, roughDistance, teamMinutes, useMyLunch, watcherNames } from "./lunch";

type Action = "start" | "close" | "confirm";
const RPC: Record<Action, string> = { start: "start_break", close: "close_break", confirm: "confirm_in_office" };

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => window.setTimeout(() => r(fallback), ms))]);
}

/**
 * Rendered twice on the Check in page: "top" shows the card above the clock while lunch is on (the
 * buttons and the break timer); "after" shows the short summary below the day's record afterwards.
 */
export function BreakCard({ today, slot }: { today: Attendance | undefined; slot: "top" | "after" }) {
  const me = useMe();
  const people = usePeople();
  const { data: settings } = useSettings();
  const toast = useToast();
  const invalidate = useInvalidate();
  const now = useNow(1000);
  const date = todayISO();
  const rules = lunchRules(settings);
  const [params, setParams] = useSearchParams();
  const askedToConfirm = params.get("lunch") === "confirm";
  const cardRef = useRef<HTMLDivElement>(null);

  const applies =
    !!settings && rules.on && followsBreakRules(me) && isWorkday(date, settings.work_days) && !!today && !today.check_out_at;
  const lunch = useMyLunch(me.id, date, applies);
  const b = lunch.data ?? null;

  const [busy, setBusy] = useState<{ action: Action; phase: "locating" | "saving" } | null>(null);
  const [locError, setLocError] = useState<{ action: Action; message: string } | null>(null);
  // What the last tap found, shown under the buttons.
  const [result, setResult] = useState<{ tone: "good" | "warn"; text: string } | null>(null);

  const nowMin = teamMinutes(now);
  const inWindow = nowMin >= rules.start && nowMin < rules.end;
  const open = !!b?.break_start_at && !b.break_end_at;
  const closed = !!b?.break_end_at;
  const confirmedIn = !!b?.confirm_in_office;
  const told = watcherNames(people.active);

  // Coming from the 12:35 message: bring the card into view.
  useEffect(() => {
    if (askedToConfirm && applies && cardRef.current) cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [askedToConfirm, applies, lunch.isSuccess]);

  if (!applies) return null;
  // Before lunch there's nothing to do; after the window only a started break or a check stays on show.
  if (nowMin < rules.start) return null;
  if (!inWindow && !open && !closed && !b?.confirmed_at) return null;
  // While lunch is on (or a break is running) the card goes above the clock; afterwards, below.
  const live = open || (inWindow && !closed);
  if ((slot === "top") !== live) return null;

  function clearAsk() {
    if (!askedToConfirm) return;
    const next = new URLSearchParams(params);
    next.delete("lunch");
    setParams(next, { replace: true });
  }

  async function act(action: Action, withLocation = true) {
    setLocError(null);
    setResult(null);
    let fix: { lat: number; lng: number; accuracy: number } | null = null;
    let address: string | null = null;
    if (withLocation) {
      setBusy({ action, phase: "locating" });
      try {
        fix = await getPosition();
      } catch (e) {
        setLocError({ action, message: errorMessage(e) });
        setBusy(null);
        return;
      }
      setBusy({ action, phase: "saving" });
      address = await withTimeout(reverseGeocode(fix.lat, fix.lng), 4500, null);
    } else {
      setBusy({ action, phase: "saving" });
    }
    try {
      const { data, error } = await supabase.rpc(RPC[action], {
        p_lat: fix?.lat ?? null,
        p_lng: fix?.lng ?? null,
        p_accuracy: fix?.accuracy ?? null,
        p_address: address,
      });
      if (error) throw error;
      const row = data as LunchBreak;
      if (action === "start") {
        toast(`Break started at ${lunchClock(row.break_start_at)}. Enjoy your lunch.`);
      } else if (action === "close") {
        // The card moves below the day's record once the break is closed, so this goes in a toast;
        // closing away from the office also stays on the card.
        toast(
          row.end_in_office
            ? `Welcome back. Break closed at ${lunchClock(row.break_end_at)}.`
            : `Break closed at ${lunchClock(row.break_end_at)}, away from the office. ${told} has been told.`,
        );
      } else {
        clearAsk();
        if (row.confirm_in_office) {
          setResult({ tone: "good", text: `Thanks, you're confirmed in the office at ${lunchClock(row.confirmed_at)}.` });
        } else {
          setResult({
            tone: "warn",
            text: `You're outside the office radius, and ${told} has been told. If you've gone out for lunch, tap Start break.`,
          });
        }
      }
      await invalidate("lunch_breaks");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const startAt = b?.break_start_at ? new Date(b.break_start_at).getTime() : 0;
  const elapsed = open ? Math.max(0, Math.floor((now.getTime() - startAt) / 1000)) : 0;
  const leftSec = rules.minutes * 60 - elapsed;
  const over = open && leftSec < 0;
  const pct = open ? Math.min(100, (elapsed / (rules.minutes * 60)) * 100) : 0;
  const mins = (s: number) => Math.floor(Math.abs(s) / 60);

  const busyText = (a: Action, idle: string) =>
    busy?.action === a ? (busy.phase === "locating" ? "Finding your location..." : "Saving...") : idle;
  const showConfirm = inWindow && !open && !closed && !confirmedIn;
  const showStart = inWindow && !open && !closed;
  const outsideNote = !!b?.confirmed_at && !b.confirm_in_office && !open && !closed && !result;

  return (
    <div ref={cardRef} className={clsx("glass card stack break-card", askedToConfirm && showConfirm && "asked")} style={{ gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0, flexWrap: "wrap", gap: 8 }}>
        <h2>
          <Coffee /> Lunch break
        </h2>
        <Pill tone="gray">
          {minutesClock(rules.start)} to {minutesClock(rules.end)}
        </Pill>
      </div>

      {open ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className={clsx("break-timer", over && "over")} aria-live="off">
            <span className="big num">{over ? `${mins(leftSec)} min over` : `${Math.max(0, Math.ceil(leftSec / 60))} min left`}</span>
            <span className="muted small">
              Out since {lunchClock(b!.break_start_at)} · {mins(elapsed)} min so far
            </span>
          </div>
          <div className={clsx("break-bar", over && "over")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Break time used">
            <span style={{ width: `${pct}%` }} />
          </div>
          {b!.start_place_name && (
            <div className="row wrap small muted" style={{ gap: 6 }}>
              Started at <PlacePill kind={b!.start_place_kind} name={b!.start_place_name} />
            </div>
          )}
          {over && <div className="small danger-text">Your break is over. Tap Close break as soon as you're back in the office.</div>}
          <button className="btn large block primary" type="button" onClick={() => act("close")} disabled={!!busy}>
            {busy ? <LocateFixed /> : <LogIn />} {busyText("close", "Close break")}
          </button>
          <div className="tiny faint" style={{ textAlign: "center" }}>
            Tap it when you're back in the office. It takes your location once.
          </div>
        </div>
      ) : closed ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <Pill tone="blue">
              <CircleCheck /> Out {lunchClock(b!.break_start_at)} to {lunchClock(b!.break_end_at)}
            </Pill>
            <Pill tone={(breakLength(b!) ?? 0) > rules.minutes ? "red" : "gray"}>{breakLength(b!)} min</Pill>
            {b!.end_in_office === false && <Pill tone="red">Closed away from the office</Pill>}
          </div>
          {b!.end_in_office === false && (
            <div className="solid break-note warn small" role="status">
              <TriangleAlert size={18} />
              <span>
                {b!.end_lat == null
                  ? `You closed your break without sharing a location, so ${told} has been told.`
                  : `You closed your break away from the office${roughDistance(b!.end_distance_m) ? `, ${roughDistance(b!.end_distance_m)} from it` : ""}, so ${told} has been told.`}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          {confirmedIn ? (
            <div className="row wrap" style={{ gap: 6 }}>
              <Pill tone="green">
                <Building2 /> Confirmed in the office at {lunchClock(b!.confirmed_at)}
              </Pill>
            </div>
          ) : askedToConfirm && showConfirm ? (
            <div className="solid break-ask small">
              <b>Are you in the office?</b>
              <div className="muted">Tap Confirm I'm in the office. It takes your location once.</div>
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Going out? Tap Start break before you leave. Staying in the office? Tap Confirm I'm in the office
              {nowMin < rules.confirm ? ` (you'll be asked at ${minutesClock(rules.confirm)})` : ""}.
            </p>
          )}
          {outsideNote && (
            <div className="solid break-note warn small" role="status">
              <TriangleAlert size={18} />
              <span>
                You confirmed from outside the office radius at {lunchClock(b!.confirmed_at)}, and {told} has been told. If you've gone out for lunch, tap Start break.
              </span>
            </div>
          )}
          {(showStart || showConfirm) && (
            <div className="break-actions">
              {showConfirm && (
                <button className={clsx("btn", askedToConfirm ? "primary large" : "glassy")} type="button" onClick={() => act("confirm")} disabled={!!busy}>
                  {busy?.action === "confirm" ? <LocateFixed /> : <Building2 />} {busyText("confirm", "Confirm I'm in the office")}
                </button>
              )}
              {showStart && (
                <button className={clsx("btn", askedToConfirm && showConfirm ? "glassy" : "primary")} type="button" onClick={() => act("start")} disabled={!!busy}>
                  {busy?.action === "start" ? <LocateFixed /> : <LogOut />} {busyText("start", "Start break")}
                </button>
              )}
            </div>
          )}
          {confirmedIn && showStart && <div className="tiny faint">Going out after all? Tap Start break before you leave.</div>}
        </div>
      )}

      {result && (
        <div className={clsx("solid break-note small", result.tone)} role="status">
          {result.tone === "good" ? <CircleCheck size={18} /> : <TriangleAlert size={18} />}
          <span>{result.text}</span>
        </div>
      )}

      {locError && (
        <div className="solid stack" style={{ padding: 14, gap: 10, borderRadius: 10 }} role="alert">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <MapPinOff size={20} className="danger-text" style={{ flexShrink: 0, marginTop: 2 }} />
            <div className="small">
              <b>We couldn't get your location.</b>
              <div className="muted">{locError.message}</div>
              {locError.action === "confirm" && <div className="muted" style={{ marginTop: 4 }}>Confirming needs your location, so turn it on and try again.</div>}
            </div>
          </div>
          <div className="row wrap">
            <button className="btn small primary" type="button" onClick={() => act(locError.action)} disabled={!!busy}>
              Try again
            </button>
            {locError.action !== "confirm" && (
              <button className="btn small" type="button" onClick={() => act(locError.action, false)} disabled={!!busy}>
                {locError.action === "start" ? "Start" : "Close"} without location
              </button>
            )}
          </div>
          {locError.action === "close" && <div className="tiny faint">Closing without a location counts as away from the office, and {told} will be told.</div>}
        </div>
      )}
    </div>
  );
}
