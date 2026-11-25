// Site visits on the Check in page: start a trip to a site (the iPhone shows the distance and
// arrival time on the lock screen, like a delivery), switch on the automatic site visit log, and
// see your recent visits. Managers and those who assign tasks also see the team's visits today.
import { useState } from "react";
import clsx from "clsx";
import { Car, HardHat, MapPinned, Navigation, Square } from "lucide-react";
import { usePeople, useProjectMap } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/supabase";
import { dateOf, fmtDate, fmtTime12, todayISO } from "@/lib/time";
import { Avatar, Empty, Pill, Switch, useToast } from "@/components/ui";
import { isNativeApp } from "@/native/platform";
import { NorthcroftNative } from "@/native/plugin";
import { PREF, setPref, usePref } from "@/native/prefs";
import { useSiteVisits, useTrip, type SiteVisit } from "@/native/siteVisits";
import { usePlaces } from "./shared";

function stay(v: SiteVisit) {
  if (!v.left_at) return "On site now";
  const mins = Math.max(1, Math.round((Date.parse(v.left_at) - Date.parse(v.arrived_at)) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}

function VisitRow({ v, showWho }: { v: SiteVisit; showWho?: boolean }) {
  const people = usePeople();
  const who = people.get(v.user_id);
  const day = dateOf(v.arrived_at);
  return (
    <div className="list-item">
      {showWho ? <Avatar person={who} size={32} /> : <HardHat className="muted" size={20} />}
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="bold ellipsis">{showWho ? `${who?.short_name ?? "Someone"} · ${v.place_name}` : v.place_name}</div>
        <div className="small muted num">
          {day === todayISO() ? "Today" : fmtDate(day, { weekday: "short", day: "numeric", month: "short" })}, {fmtTime12(v.arrived_at)}
          {v.left_at ? ` to ${fmtTime12(v.left_at)}` : ""}
        </div>
      </div>
      <Pill tone={v.left_at ? "gray" : "green"}>{stay(v)}</Pill>
    </div>
  );
}

export function SiteVisitsCard() {
  const me = useMe();
  const { canAssign } = useAuth();
  const toast = useToast();
  const places = usePlaces();
  const projects = useProjectMap();
  const native = isNativeApp();
  const logOn = usePref(PREF.siteLog);
  const { trip, refresh } = useTrip();
  const [busy, setBusy] = useState<string | null>(null);
  const mine = useSiteVisits({ userId: me.id });
  const team = useSiteVisits({ since: `${todayISO()}T00:00:00+03:00` });
  const sites = (places.data ?? []).filter((p) => p.kind === "site" && p.active);

  // The table isn't there yet (the database update hasn't been added): show nothing on the web.
  if (!native && (mine.isError || (!mine.data?.length && !sites.length))) return null;

  async function start(id: string) {
    const p = sites.find((s) => s.id === id);
    if (!p) return;
    setBusy(id);
    try {
      const r = await NorthcroftNative.tripStart({
        placeId: p.id,
        placeName: p.name,
        lat: p.lat,
        lng: p.lng,
        radius: p.radius_m,
        projectId: p.project_id ?? undefined,
      });
      if (!r.ok) toast(r.reason === "location-off" ? "Turn on Location for Northcroft in Settings to start a trip." : "Couldn't start the trip.", "error");
      else toast(`On the way to ${p.name}. Follow it on your lock screen.`);
      await refresh();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function end() {
    await NorthcroftNative.tripStop().catch(() => undefined);
    await refresh();
  }

  const others = (team.data ?? []).filter((v) => v.user_id !== me.id);

  return (
    <div className="glass card site-visits">
      <div className="card-head">
        <h2>
          <MapPinned /> Site visits
        </h2>
        {native && (
          <Switch
            checked={logOn}
            onChange={(v) => {
              setPref(PREF.siteLog, v);
              if (v) toast("Your phone will log arriving at and leaving project sites.");
            }}
            label="Log my site visits"
          />
        )}
      </div>

      {native && (
        <div className="small muted" style={{ marginBottom: 10 }}>
          {logOn
            ? "On: arriving at and leaving a project site is logged, even with the app closed."
            : "Switch on to log arriving at and leaving project sites automatically."}
        </div>
      )}

      {native && trip && (
        <div className="banner solid trip-banner" role="status">
          <Car />
          <div className="grow small">
            <b>On the way to {trip.placeName}</b>
            <div className="muted">Distance and arrival time are on your lock screen. It ends by itself when you arrive.</div>
          </div>
          <button type="button" className="btn small" onClick={() => void end()}>
            <Square size={14} /> End trip
          </button>
        </div>
      )}

      {native && sites.length > 0 && !trip && (
        <div className="list" style={{ marginBottom: 12 }}>
          {sites.slice(0, 6).map((p) => (
            <div key={p.id} className="list-item">
              <HardHat className="muted" size={20} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bold ellipsis">{p.name}</div>
                <div className="small muted ellipsis">{projects.get(p.project_id)?.name ?? p.address ?? "Project site"}</div>
              </div>
              <button type="button" className={clsx("btn small", busy === p.id && "loading")} disabled={!!busy} onClick={() => void start(p.id)}>
                <Navigation size={14} /> Start trip
              </button>
            </div>
          ))}
        </div>
      )}

      {native && sites.length === 0 && (
        <div className="small muted" style={{ marginBottom: 12 }}>
          No project sites yet. {canAssign ? "Add them in Settings > Places (type: Site)." : "Your manager can add them in Settings > Places."}
        </div>
      )}

      <div className="section-label small bold muted">My recent visits</div>
      {mine.isError ? (
        <div className="small muted">The site visit log isn't switched on in the database yet.</div>
      ) : !mine.data?.length ? (
        <Empty icon={<HardHat />} title="No site visits yet">
          {native ? "Visits appear here when the log is on, or after a trip." : "Visits logged by the iPhone app appear here."}
        </Empty>
      ) : (
        <div className="list">
          {mine.data.slice(0, 8).map((v) => (
            <VisitRow key={v.id} v={v} />
          ))}
        </div>
      )}

      {canAssign && others.length > 0 && (
        <>
          <div className="section-label small bold muted" style={{ marginTop: 14 }}>
            Team on site today
          </div>
          <div className="list">
            {others.map((v) => (
              <VisitRow key={v.id} v={v} showWho />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
