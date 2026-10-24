import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { usePeople, useSettings } from "@/lib/api";
import { addDays, fmtDuration, fmtLongDate, fmtTime12, isWorkday, todayISO } from "@/lib/time";
import { initials } from "@/lib/format";
import type { Attendance, Profile } from "@/lib/types";
import { PersonAvatar, WhatsAppButton } from "@/components/People";
import { Empty, Loading, Pill } from "@/components/ui";
import { MapBox, PlacePill, isOffsite, useAttendanceRange } from "./shared";
import { SentLater } from "./SentLater";

export function TeamBoard() {
  const people = usePeople();
  const { data: settings } = useSettings();
  const [date, setDate] = useState(todayISO());
  const { data: rows = [], isLoading } = useAttendanceRange(date, date);
  const isToday = date === todayISO();
  const working = settings ? isWorkday(date, settings.work_days) : true;

  const byUser = useMemo(() => new Map(rows.map((r) => [r.user_id, r])), [rows]);
  // Only people who check in (the Commercial Manager doesn't).
  const list = people.attenders;
  const inNow = rows.filter((r) => !r.check_out_at).length;
  const out = rows.filter((r) => r.check_out_at).length;
  const missing = list.filter((p) => !byUser.has(p.id)).length;
  const offsite = rows.filter(isOffsite).length;
  const late = rows.filter((r) => r.late_minutes > 0).length;

  const points = useMemo(
    () =>
      rows
        .filter((r) => r.in_lat != null && r.in_lng != null)
        .map((r) => {
          const p = people.get(r.user_id);
          return {
            id: r.id,
            lat: r.in_lat!,
            lng: r.in_lng!,
            label: `${p?.short_name ?? "Someone"} ${fmtTime12(r.check_in_at)}`,
            color: p?.color,
            // Show their photo on the map (or initials if the photo can't load).
            photo: p?.avatar_url ?? null,
            initials: p ? initials(p.full_name) : "?",
          };
        }),
    [rows, people],
  );

  return (
    <div className="glass card stack" style={{ gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0, flexWrap: "wrap" }}>
        <h2>
          <Users /> {isToday ? "Team today" : "Team on this day"}
        </h2>
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn small" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day" type="button">
            <ChevronLeft />
          </button>
          <input className="input" type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} style={{ minHeight: 36, padding: "6px 10px", width: 160 }} aria-label="Pick a day" />
          <button className="icon-btn small" onClick={() => setDate(addDays(date, 1))} disabled={isToday} aria-label="Next day" type="button">
            <ChevronRight />
          </button>
          {!isToday && (
            <button className="btn small" onClick={() => setDate(todayISO())} type="button">
              Today
            </button>
          )}
        </div>
      </div>
      <div className="muted small" style={{ marginTop: -6 }}>
        {fmtLongDate(date)}
        {!working && " · weekend"}
      </div>

      <div className="grid-4 team-stats">
        <Stat label={isToday ? "In now" : "Checked in"} value={isToday ? inNow : rows.length} tone="green" />
        <Stat label="Checked out" value={out} tone="blue" />
        <Stat label="Not in yet" value={missing} tone={missing && working ? "red" : "gray"} />
        <Stat label="Late / off-site" value={`${late} / ${offsite}`} tone={late || offsite ? "orange" : "gray"} />
      </div>

      {isLoading ? (
        <Loading />
      ) : (
        <div className="list">
          {list.map((p) => {
            const r = byUser.get(p.id);
            return <TeamRow key={p.id} person={p} r={r} working={working} isToday={isToday} />;
          })}
        </div>
      )}

      {points.length > 0 ? (
        <MapBox points={points} className="map" showLabels />
      ) : (
        !isLoading && (
          <Empty title="No locations to show">Check-in points appear on a map here once people check in with location on.</Empty>
        )
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="solid stat" style={{ borderRadius: 10, padding: 12 }}>
      <span className="label">{label}</span>
      <span className="value" style={{ fontSize: 20, color: tone === "gray" ? undefined : `var(--${tone === "blue" ? "accent" : tone})` }}>
        {value}
      </span>
    </div>
  );
}

function TeamRow({
  person,
  r,
  working,
  isToday,
}: {
  person: Profile;
  r: Attendance | undefined;
  working: boolean;
  isToday: boolean;
}) {
  return (
    <div className="list-item" style={{ alignItems: "flex-start" }}>
      <PersonAvatar person={person} size={36} />
      <div className="grow stack" style={{ gap: 6 }}>
        <div>
          <div className="title">{person.short_name}</div>
          <div className="faint tiny">{person.title}</div>
        </div>
        {r ? (
          <div className="stack" style={{ gap: 6 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="small bold num">In {fmtTime12(r.check_in_at)}</span>
              <PlacePill kind={r.in_place_kind} name={r.in_place_name} />
              {r.late_minutes > 0 && <Pill tone="orange">Late {r.late_minutes} min</Pill>}
              {r.in_sent_later && <SentLater receivedAt={r.in_received_at} />}
            </div>
            {r.check_out_at && (
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="small bold num">Out {fmtTime12(r.check_out_at)}</span>
                <PlacePill kind={r.out_place_kind} name={r.out_place_name} />
                {r.early_minutes > 0 && <Pill tone="orange">Left {r.early_minutes} min early</Pill>}
                {r.out_sent_later && <SentLater receivedAt={r.out_received_at} />}
              </div>
            )}
            {r.in_address && <div className="tiny faint">{r.in_address}</div>}
            {r.note && <div className="tiny muted">Note: {r.note}</div>}
          </div>
        ) : null}
      </div>
      <div className="stack" style={{ alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
        {r ? (
          r.check_out_at ? (
            <Pill tone="blue">{fmtDuration(r.check_in_at, r.check_out_at)}</Pill>
          ) : isToday ? (
            <Pill tone="green">In · {fmtDuration(r.check_in_at, null)}</Pill>
          ) : (
            <Pill tone="gray">No check-out</Pill>
          )
        ) : (
          <Pill tone={working ? "red" : "gray"}>{isToday ? "Not in yet" : "No record"}</Pill>
        )}
        <WhatsAppButton person={person} variant="small" />
      </div>
    </div>
  );
}
