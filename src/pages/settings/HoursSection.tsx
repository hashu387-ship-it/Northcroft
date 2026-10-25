import { useEffect, useState } from "react";
import clsx from "clsx";
import { useInvalidate, useSettings } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import { DOW_SHORT, fmtClock } from "@/lib/time";
import { Field, Loading, Switch, useToast } from "@/components/ui";
import { Section } from "./common";

const hm = (t: string) => t.slice(0, 5);

export function HoursSection() {
  const { isManager } = useAuth();
  const { data: s, isLoading, error } = useSettings();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [start, setStart] = useState("08:30");
  const [end, setEnd] = useState("17:30");
  const [grace, setGrace] = useState(10);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [capacity, setCapacity] = useState(8);
  // Lunch break rules and the office check.
  const [breakOn, setBreakOn] = useState(true);
  const [breakStart, setBreakStart] = useState("12:00");
  const [breakMins, setBreakMins] = useState(60);
  const [breakConfirm, setBreakConfirm] = useState("12:35");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!s) return;
    setStart(hm(s.work_start));
    setEnd(hm(s.work_end));
    setGrace(s.grace_minutes);
    setDays(s.work_days);
    setCapacity(s.weekly_task_capacity);
    setBreakOn(s.break_rules_on !== false);
    setBreakStart(hm(s.break_start ?? "12:00"));
    setBreakMins(s.break_minutes ?? 60);
    setBreakConfirm(hm(s.break_confirm_at ?? "12:35"));
  }, [s]);

  if (error) return <Section title="Working hours"><p className="muted">{errorMessage(error)}</p></Section>;
  if (isLoading || !s) return <Loading />;

  const dirty =
    start !== hm(s.work_start) ||
    end !== hm(s.work_end) ||
    grace !== s.grace_minutes ||
    capacity !== s.weekly_task_capacity ||
    breakOn !== (s.break_rules_on !== false) ||
    breakStart !== hm(s.break_start ?? "12:00") ||
    breakMins !== (s.break_minutes ?? 60) ||
    breakConfirm !== hm(s.break_confirm_at ?? "12:35") ||
    [...days].sort().join() !== [...s.work_days].sort().join();

  async function save() {
    if (end <= start) return toast("The finish time needs to be after the start time", "error");
    if (!days.length) return toast("Pick at least one working day", "error");
    const breakEnd = addMinutes(breakStart, breakMins);
    if (breakStart < "10:00" || breakStart > "15:00") return toast("Lunch can start between 10:00 am and 3:00 pm", "error");
    if (breakConfirm <= breakStart || breakConfirm >= breakEnd)
      return toast(`The office check needs to be between ${fmtClock(breakStart)} and ${fmtClock(breakEnd)}`, "error");
    setSaving(true);
    try {
      const { error } = await supabase
        .from("app_settings")
        .update({
          work_start: start,
          work_end: end,
          grace_minutes: grace,
          work_days: [...days].sort((a, b) => a - b),
          weekly_task_capacity: capacity,
          break_rules_on: breakOn,
          break_start: breakStart,
          break_minutes: breakMins,
          break_confirm_at: breakConfirm,
        })
        .eq("id", 1);
      if (error) throw error;
      await invalidate("app_settings");
      toast("Working hours saved");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const toggleDay = (d: number) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));

  return (
    <Section
      title="Working hours"
      sub={
        isManager
          ? "Used to flag late check-ins and early check-outs, and to send reminders only on working days. The check-in reminder goes out at the start of the day to anyone not checked in; check-out reminders go out at the end of the day and an hour later to anyone still checked in."
          : `Work hours are ${fmtClock(s.work_start)} to ${fmtClock(s.work_end)}. Only Hassan can change these.`
      }
    >
      <div className="form-grid">
        <Field label="Start of day">
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={!isManager} />
        </Field>
        <Field label="End of day">
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!isManager} />
        </Field>
        <Field label="Grace period (minutes)" hint={`Checking in after ${fmtClock(addMinutes(start, grace))} counts as late`}>
          <input className="input" type="number" min={0} max={120} inputMode="numeric" value={grace} onChange={(e) => setGrace(clamp(Number(e.target.value), 0, 120))} disabled={!isManager} />
        </Field>
        <Field label="Tasks per person per week" hint="The workload view turns red above this">
          <input className="input" type="number" min={1} max={100} inputMode="numeric" value={capacity} onChange={(e) => setCapacity(clamp(Number(e.target.value), 1, 100))} disabled={!isManager} />
        </Field>
        <div className="field full">
          <span>Working days</span>
          <div className="day-chips" role="group" aria-label="Working days">
            {DOW_SHORT.map((d, i) => (
              <button key={d} className={clsx(days.includes(i) && "on")} onClick={() => toggleDay(i)} disabled={!isManager} aria-pressed={days.includes(i)} type="button">
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="solid break-settings stack">
        <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
          <div className="grow">
            <b>Lunch break rules</b>
            <div className="muted small">
              {breakOn
                ? `At ${fmtClock(breakStart)} everyone who follows break rules is reminded to tap Start break before going out. Anyone who hasn't gone out is asked at ${fmtClock(breakConfirm)} to confirm they're in the office.`
                : "Off. Nobody is asked to start a break or confirm they're in the office."}
            </div>
          </div>
          <Switch checked={breakOn} onChange={setBreakOn} disabled={!isManager} label="Lunch break rules" />
        </div>
        {breakOn && (
          <div className="form-grid">
            <Field label="Lunch starts">
              <input className="input" type="time" min="10:00" max="15:00" value={breakStart} onChange={(e) => setBreakStart(e.target.value)} disabled={!isManager} />
            </Field>
            <Field label="Break length (minutes)" hint={`Lunch runs to ${fmtClock(addMinutes(breakStart, breakMins))}`}>
              <input className="input" type="number" min={15} max={120} inputMode="numeric" value={breakMins} onChange={(e) => setBreakMins(clamp(Number(e.target.value), 15, 120))} disabled={!isManager} />
            </Field>
            <Field label="Office check" hint="When people who stayed in confirm they're in the office">
              <input className="input" type="time" value={breakConfirm} onChange={(e) => setBreakConfirm(e.target.value)} disabled={!isManager} />
            </Field>
          </div>
        )}
      </div>
      {isManager && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button className="btn primary" onClick={save} disabled={!dirty || saving} type="button">
            {saving ? "Saving..." : "Save working hours"}
          </button>
        </div>
      )}
    </Section>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo;
}

function addMinutes(t: string, m: number) {
  const [h, mm] = t.split(":").map(Number);
  const total = h * 60 + mm + m;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
