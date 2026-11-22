// Missed check-in requests on the Check in page: asking Hassan to record a day you forgot to check
// in or out (3 approved a month), your requests and their answers, and for Hassan the requests
// waiting for him with Approve and Decline. The database checks every rule; this screen explains
// them before anything is sent.
import "@/styles/leave.css";
import "@/styles/checkinfix.css";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { ClipboardCheck, ClockAlert, Plus, X } from "lucide-react";
import { useInvalidate, usePeople, useSettings } from "@/lib/api";
import { useMe } from "@/lib/auth";
import {
  cancelCheckinFix,
  decideCheckinFix,
  FIX_DAYS_BACK,
  FIX_LIMIT,
  FIX_STATUS,
  fixApprover,
  fixDay,
  fixTimes,
  fixUsage,
  fixWhat,
  monthName,
  requestCheckinFix,
  useCheckinRequestsToAnswer,
  useMyCheckinRequests,
  useTeamFixesThisMonth,
} from "@/lib/checkinFix";
import { useSignoff } from "@/lib/signoff";
import { errorMessage, supabase } from "@/lib/supabase";
import { addDays, dateOf, fmtClock, fmtTime12, todayISO } from "@/lib/time";
import type { Attendance, CheckinRequest } from "@/lib/types";
import { Avatar, Field, Loading, Pill, Sheet, useConfirm, useToast } from "@/components/ui";
import { useMyAttendance } from "./shared";

/* ---------------------------------------------------------------- my side */

/** "Forgot to check in?" with how many are left this month, the button and my requests. */
export function MissedCheckinCard() {
  const me = useMe();
  const signoff = useSignoff();
  const mine = useMyCheckinRequests(me.id);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState<CheckinRequest | null>(null);
  const [all, setAll] = useState(false);
  const today = todayISO();
  const use = fixUsage(mine.data, today);
  const approver = fixApprover(me.id, signoff)?.short_name;
  const list = useMemo(() => (mine.data ?? []).filter((r) => r.work_date >= addDays(today, -62)), [mine.data, today]);
  const shown = all ? list : list.slice(0, 3);

  return (
    <div className="glass card fix-card">
      <div className="card-head">
        <h2 className="tone-purple">
          <ClockAlert /> Missed check-in
        </h2>
        <button className="btn small primary" onClick={() => setAsking(true)} type="button" disabled={!use.canAsk}>
          <Plus /> Ask {approver ?? "a manager"}
        </button>
      </div>
      <p className="muted small fix-intro">
        Forgot to check in or out? Ask {approver ?? "a manager"} to record the day. Once approved it shows in your attendance like a normal check-in.
      </p>
      <FixAllowance used={use.approved} waiting={use.waiting} month={monthName(today)} />

      {mine.isLoading ? (
        <Loading rows={1} />
      ) : list.length === 0 ? null : (
        <div className="list">
          {shown.map((r) => (
            <FixRow key={r.id} r={r} onOpen={() => setOpen(r)} />
          ))}
          {list.length > 3 && (
            <button className="btn small ghost leave-more" onClick={() => setAll(!all)} type="button">
              {all ? "Show fewer" : `Show all ${list.length}`}
            </button>
          )}
        </div>
      )}

      <CheckinFixForm open={asking} onClose={() => setAsking(false)} />
      {open && <FixDetail r={(mine.data ?? []).find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Three dots: approved (filled), waiting (ringed), left (empty), and the words. */
export function FixAllowance({ used, waiting, month, compact }: { used: number; waiting: number; month: string; compact?: boolean }) {
  const left = Math.max(0, FIX_LIMIT - used);
  return (
    <div className={clsx("fix-allow", compact && "compact")} aria-label={`${left} of ${FIX_LIMIT} left in ${month}`}>
      <span className="fix-dots" aria-hidden>
        {Array.from({ length: FIX_LIMIT }, (_, i) => (
          <i key={i} className={clsx(i < used ? "used" : i < used + waiting ? "waiting" : "free")} />
        ))}
      </span>
      <span>
        <b>
          {left} of {FIX_LIMIT}
        </b>{" "}
        left in {month}
        {waiting > 0 && <span className="muted"> · {waiting} waiting</span>}
      </span>
    </div>
  );
}

function FixRow({ r, onOpen, person }: { r: CheckinRequest; onOpen: () => void; person?: boolean }) {
  const people = usePeople();
  const p = people.get(r.user_id);
  const st = FIX_STATUS[r.status];
  return (
    <button className="list-item fix-row" onClick={onOpen} type="button">
      {person ? (
        <Avatar person={p} size={34} />
      ) : (
        <span className={clsx("leave-date", (r.status === "declined" || r.status === "cancelled") && "off")} aria-hidden>
          <b>{Number(r.work_date.slice(8, 10))}</b>
          <small>{fixDay(r.work_date).split(" ")[2]}</small>
        </span>
      )}
      <span className="grow">
        <span className="title">{person ? `${p?.short_name ?? "Someone"} · ${fixWhat(r)}` : fixWhat(r)}</span>
        <span className="meta">
          <span>{fixDay(r.work_date)}</span>
          <span>{fixTimes(r)}</span>
        </span>
      </span>
      <Pill tone={st.tone}>{st.label}</Pill>
    </button>
  );
}

/** One request: the day, the times, the reason and the answer. The person can cancel a waiting one. */
export function FixDetail({ r, onClose }: { r: CheckinRequest; onClose: () => void }) {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const mine = r.user_id === me.id;
  const who = people.get(r.user_id);
  const answeredBy = people.get(r.decided_by);
  const approver = people.get(r.approver_id);
  const st = FIX_STATUS[r.status];

  async function cancel() {
    const ok = await confirm({ title: "Cancel this request?", message: "It won't be recorded, and it won't count towards your 3.", confirmLabel: "Cancel request", danger: true });
    if (!ok) return;
    setBusy(true);
    try {
      await cancelCheckinFix(r.id);
      await invalidate("checkin_requests");
      toast("Request cancelled");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={mine ? "Missed check-in request" : `${who?.short_name ?? "Someone"}'s request`}
      footer={
        mine && r.status === "pending" ? (
          <>
            <button className="btn" onClick={onClose} type="button">
              Close
            </button>
            <button className="btn danger" onClick={cancel} disabled={busy} type="button">
              Cancel request
            </button>
          </>
        ) : undefined
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="fix-sum">
          <span className="fix-sum-day">{fixDay(r.work_date)}</span>
          <b>{fixTimes(r)}</b>
          <Pill tone={st.tone}>{st.label}</Pill>
        </div>
        <Field label="Reason">
          <div className="fix-reason">{r.reason}</div>
        </Field>
        {r.status === "pending" && (
          <p className="muted small">Waiting for {approver?.short_name ?? "a manager"} to answer. You'll get a notification when they do.</p>
        )}
        {(r.status === "approved" || r.status === "declined") && (
          <p className="small">
            {answeredBy?.short_name ?? "A manager"} {r.status} it on {fixDay(dateOf(r.decided_at!))} at {fmtTime12(r.decided_at)}.
            {r.status === "approved" ? " The times are in your attendance." : " Nothing was changed."}
          </p>
        )}
        {r.decision_note && (
          <Field label={`Note from ${answeredBy?.short_name ?? "the manager"}`}>
            <div className="fix-reason">{r.decision_note}</div>
          </Field>
        )}
        {!mine && r.status === "pending" && <FixAnswer r={r} onDone={onClose} />}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- the form */

const timeOf = (ts: string | null | undefined) => (ts ? new Date(ts).toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" }) : "");
const nowClock = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });

/** Ask for a day to be recorded. `day` picks the day it opens on (today from the popup). */
export function CheckinFixForm({ open, onClose, day: startDay }: { open: boolean; onClose: () => void; day?: string }) {
  const me = useMe();
  const signoff = useSignoff();
  const settings = useSettings().data;
  const toast = useToast();
  const invalidate = useInvalidate();
  const att = useMyAttendance(me.id);
  const mine = useMyCheckinRequests(me.id);
  const today = todayISO();
  const days = useMemo(() => Array.from({ length: FIX_DAYS_BACK + 1 }, (_, i) => addDays(today, -i)), [today]);
  const [day, setDay] = useState(startDay ?? today);
  const [wantIn, setWantIn] = useState(true);
  const [wantOut, setWantOut] = useState(false);
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const start = (settings?.work_start ?? "08:30").slice(0, 5);
  const end = (settings?.work_end ?? "17:30").slice(0, 5);
  const row: Attendance | undefined = (att.data ?? []).find((a) => a.work_date === day);

  // Sensible starting choices for the day picked: what's missing, with the usual hours.
  function prime(d: string) {
    const a = (att.data ?? []).find((x) => x.work_date === d);
    const past = d < today;
    if (!a) {
      setWantIn(true);
      setInTime(start);
      setWantOut(past);
      setOutTime(past ? end : "");
    } else if (!a.check_out_at) {
      setWantIn(false);
      setInTime(timeOf(a.check_in_at));
      setWantOut(past);
      setOutTime(past ? end : "");
    } else {
      setWantIn(false);
      setInTime(timeOf(a.check_in_at));
      setWantOut(false);
      setOutTime(timeOf(a.check_out_at));
    }
  }

  useEffect(() => {
    if (!open) return;
    const d = startDay ?? today;
    setDay(d);
    setReason("");
    prime(d);
  }, [open, att.data === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const use = fixUsage(mine.data, day);
  const waitingSame = (mine.data ?? []).some((r) => r.status === "pending" && r.work_date === day);
  const approver = fixApprover(me.id, signoff)?.short_name;
  const inVal = wantIn ? inTime : "";
  const outVal = wantOut ? outTime : "";
  const effIn = inVal || (row ? timeOf(row.check_in_at) : "");
  const problem = waitingSame
    ? "You've already asked about this day. It's waiting for an answer."
    : !use.canAsk
      ? use.approved >= FIX_LIMIT
        ? `You've had ${FIX_LIMIT} days recorded this way in ${monthName(day)}, which is the most for a month.`
        : `You already have ${use.waiting} waiting, and only ${FIX_LIMIT} can be recorded in ${monthName(day)}.`
      : !wantIn && !wantOut
        ? "Tick the time you came in, the time you left, or both."
        : (wantIn && !inTime) || (wantOut && !outTime)
          ? "Fill in the time."
          : !row && !wantIn
            ? "There's no check-in that day, so add the time you came in too."
            : outVal && effIn && outVal <= effIn
              ? "The time you left has to be after the time you came in."
              : day === today && ((inVal && inVal > nowClock()) || (outVal && outVal > nowClock()))
                ? "That time hasn't happened yet."
                : reason.trim().length < 3
                  ? "Add a short reason, like \"Phone battery died\"."
                  : null;

  async function send() {
    if (problem) {
      toast(problem, "error");
      return;
    }
    setBusy(true);
    try {
      await requestCheckinFix(day, inVal || null, outVal || null, reason.trim());
      await invalidate("checkin_requests");
      toast(approver ? `Sent to ${approver}` : "Request sent");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const dayLabel = (d: string) => (d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : fixDay(d));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Missed check-in"
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" onClick={send} disabled={busy} type="button">
            {busy ? "Sending..." : `Send to ${approver ?? "a manager"}`}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Which day?" group>
          <div className="fix-days" role="radiogroup" aria-label="Which day">
            {days.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={day === d}
                className={clsx("leave-kind", day === d && "on")}
                onClick={() => {
                  setDay(d);
                  prime(d);
                }}
              >
                {dayLabel(d)}
              </button>
            ))}
          </div>
          <small className="muted tiny fix-dayline">
            {att.isLoading
              ? "Checking that day..."
              : !row
                ? "No check-in recorded that day."
                : row.check_out_at
                  ? `Recorded: in ${fmtTime12(row.check_in_at)}, out ${fmtTime12(row.check_out_at)}.`
                  : `Recorded: in ${fmtTime12(row.check_in_at)}, no check-out.`}
          </small>
        </Field>

        <div className="fix-times">
          <label className={clsx("fix-time", wantIn && "on")}>
            <span className="fix-time-head">
              <input type="checkbox" className="fix-check" checked={wantIn} onChange={(e) => setWantIn(e.target.checked)} />
              <span>{row ? "Change my check-in" : "I came in at"}</span>
            </span>
            <input className="input" type="time" value={inTime} disabled={!wantIn} onChange={(e) => setInTime(e.target.value)} aria-label="Time you came in" />
          </label>
          <label className={clsx("fix-time", wantOut && "on")}>
            <span className="fix-time-head">
              <input type="checkbox" className="fix-check" checked={wantOut} onChange={(e) => setWantOut(e.target.checked)} />
              <span>{row?.check_out_at ? "Change my check-out" : "I left at"}</span>
            </span>
            <input className="input" type="time" value={outTime} disabled={!wantOut} onChange={(e) => setOutTime(e.target.value)} aria-label="Time you left" />
          </label>
        </div>
        <small className="muted tiny">Office hours are {fmtClock(start)} to {fmtClock(end)}.</small>

        <Field label="Reason">
          <textarea className="input" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Phone battery died, so I couldn't tap Check in." />
        </Field>

        <div className={clsx("leave-summary solid", problem && "warn")} aria-live="polite">
          {problem ?? (
            <>
              {approver ?? "A manager"} gets a notification and can approve or decline it.{" "}
              <FixAllowance used={use.approved} waiting={use.waiting} month={monthName(day)} compact />
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- answering */

/** Approve or Decline (with an optional note). Used in the list, the detail and the popup. */
export function FixAnswer({ r, onDone }: { r: CheckinRequest; onDone?: () => void }) {
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const name = people.get(r.user_id)?.short_name ?? "them";

  async function answer(approve: boolean) {
    setBusy(approve ? "approve" : "decline");
    try {
      await decideCheckinFix(r.id, approve, approve ? undefined : note);
      await invalidate("checkin_requests", "attendance");
      toast(approve ? `Approved. ${fixDay(r.work_date)} is recorded for ${name}.` : `Declined. ${name} will be told.`);
      onDone?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  }

  if (declining) {
    return (
      <div className="fix-decline">
        <textarea
          className="input"
          rows={2}
          maxLength={500}
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`Why? ${name} will see this (optional).`}
          aria-label="Reason for declining"
        />
        <div className="fix-actions">
          <button className="btn small" type="button" onClick={() => setDeclining(false)} disabled={!!busy}>
            Back
          </button>
          <button className="btn small danger" type="button" onClick={() => void answer(false)} disabled={!!busy}>
            {busy === "decline" ? "Declining..." : "Decline"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="fix-actions">
      <button className="btn small" type="button" onClick={() => setDeclining(true)} disabled={!!busy}>
        <X /> Decline
      </button>
      <button className="btn small primary" type="button" onClick={() => void answer(true)} disabled={!!busy}>
        <ClipboardCheck /> {busy === "approve" ? "Approving..." : "Approve"}
      </button>
    </div>
  );
}

/** A waiting request with the person, the times, the reason, their allowance and the buttons. */
export function FixToAnswer({ r, onDone }: { r: CheckinRequest; onDone?: () => void }) {
  const people = usePeople();
  const team = useTeamFixesThisMonth();
  const p = people.get(r.user_id);
  const used = (team.data ?? []).filter((x) => x.user_id === r.user_id && x.status === "approved" && x.work_date.slice(0, 7) === r.work_date.slice(0, 7)).length;
  return (
    <div className="fix-ask">
      <div className="fix-ask-head">
        <Avatar person={p} size={38} />
        <span className="grow">
          <b>
            {p?.short_name ?? "Someone"} · {fixWhat(r)}
          </b>
          <span className="meta small">
            {fixDay(r.work_date)} · {fixTimes(r)}
          </span>
        </span>
      </div>
      <div className="fix-reason">{r.reason}</div>
      <span className="muted tiny">
        {used} of {FIX_LIMIT} used in {monthName(r.work_date)}
      </span>
      <FixAnswer r={r} onDone={onDone} />
    </div>
  );
}

/** Requests waiting for me (Hassan), on the Check in page. Nothing when there are none. */
export function FixesToAnswerCard() {
  const { list, isLoading } = useCheckinRequestsToAnswer();
  if (isLoading || list.length === 0) return null;
  return (
    <div className="glass card fix-card">
      <div className="card-head">
        <h2 className="tone-purple">
          <ClockAlert /> Missed check-ins to approve
        </h2>
        <Pill tone="purple">{list.length}</Pill>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {list.map((r) => (
          <FixToAnswer key={r.id} r={r} />
        ))}
      </div>
    </div>
  );
}

/** Opens a request from a notification link (?fix=...). */
export function FixFromLink() {
  const [params, setParams] = useSearchParams();
  const id = params.get("fix");
  const [r, setR] = useState<CheckinRequest | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void supabase
      .from("checkin_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => live && setR((data as CheckinRequest | null) ?? null));
    return () => {
      live = false;
    };
  }, [id]);
  if (!id || !r) return null;
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("fix");
    setParams(next, { replace: true });
    setR(null);
  };
  return <FixDetail r={r} onClose={close} />;
}
