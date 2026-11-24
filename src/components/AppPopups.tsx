// Popups when the app opens, one at a time, in this order:
//   1. Answers to my missed check-in requests (once; OK marks them seen).
//   2. Announcements: ones that need acknowledging pop up every time the app opens until I
//      acknowledge them; the others pop up once.
//   3. Missed check-in requests waiting for me (Hassan), with Approve and Decline.
//   4. I haven't checked in and office hours have started: check in, or ask Hassan to record it.
// Before all of these, once after each app update: What's new (also opened from More, ?whatsnew=1).
// "Later" or "Not now" hides a popup until the app is next opened (this session).
import "@/styles/checkinfix.css";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, ClipboardCheck, ClockAlert, Gift, Megaphone, MapPin, X } from "lucide-react";
import { unwrap, useInvalidate, usePeople, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import {
  FIX_LIMIT,
  fixApprover,
  fixDay,
  fixTimesInWords,
  fixUsage,
  markFixAnswersSeen,
  monthName,
  useCheckinRequestsToAnswer,
  useMyCheckinRequests,
} from "@/lib/checkinFix";
import { useTeamLeave } from "@/lib/leave";
import { useSignoff } from "@/lib/signoff";
import { errorMessage, supabase } from "@/lib/supabase";
import { addDays, dateOf, fmtClock, fmtDateTime, fmtLongDate, isWorkday, todayISO } from "@/lib/time";
import { itemsFor, LATEST, markReleaseSeen, RELEASES, releasesSince, seenRelease, type WhatsNewContext, type WhatsNewItem } from "@/lib/whatsNew";
import { tileStyle } from "@/lib/menu";
import type { AnnouncementView } from "@/lib/types";
import { acknowledge, needsMyAck, useAnnouncementsWithAcks, useAttendanceOn, type AnnouncementWithAcks } from "@/pages/home/data";
import { CheckinFixForm, FixAllowance, FixToAnswer } from "@/pages/attendance/CheckinFix";
import { Avatar, Pill, Sheet, useToast } from "./ui";

const LATER_KEY = "nc-popups-later";

function readLater(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(LATER_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

function useMyAnnouncementViews(userId: string) {
  return useQuery({
    queryKey: ["announcement_views", userId],
    retryOnMount: false,
    queryFn: () => unwrap<AnnouncementView[]>(supabase.from("announcement_views").select("*").eq("user_id", userId).limit(1000)),
    staleTime: 60_000,
  });
}

/** "HH:MM" now in Riyadh. */
const clockNow = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit" });
const addMinutes = (hhmm: string, mins: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  const t = h * 60 + m + mins;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

type Popup =
  | { kind: "whatsnew"; key: string }
  | { kind: "answers"; key: string }
  | { kind: "announcement"; key: string; a: AnnouncementWithAcks }
  | { kind: "approve"; key: string }
  | { kind: "forgot"; key: string };

export function AppPopups() {
  const me = useMe();
  const { canAssign, isManager } = useAuth();
  const signoff = useSignoff();
  const location = useLocation();
  const navigate = useNavigate();
  const [wnSeen, setWnSeen] = useState(() => seenRelease(me.id));
  const today = todayISO();
  const settings = useSettings().data;
  const [later, setLater] = useState<Set<string>>(readLater);
  const [ready, setReady] = useState(false);
  const [asking, setAsking] = useState(false);
  // Let the app settle (splash, first data) before anything pops up.
  useEffect(() => {
    const t = window.setTimeout(() => setReady(true), 1500);
    return () => window.clearTimeout(t);
  }, []);
  // Re-check the time now and then, for the check-in reminder.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const checksIn = !me.attendance_exempt;
  const mine = useMyCheckinRequests(me.id);
  const anns = useAnnouncementsWithAcks();
  const views = useMyAnnouncementViews(me.id);
  const toAnswer = useCheckinRequestsToAnswer();
  const todayRow = useAttendanceOn(today, me.id);
  const away = useTeamLeave(today, today, checksIn);

  const hide = (key: string) => {
    setLater((prev) => {
      const next = new Set(prev).add(key);
      try {
        sessionStorage.setItem(LATER_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode: hidden until a reload */
      }
      return next;
    });
  };

  const answers = useMemo(
    () => (mine.data ?? []).filter((r) => (r.status === "approved" || r.status === "declined") && !r.seen_at),
    [mine.data],
  );

  const popAnns = useMemo(() => {
    if (anns.isLoading || views.isLoading) return [];
    const seen = new Set((views.data ?? []).map((v) => v.announcement_id));
    const month = addDays(today, -30);
    const week = addDays(today, -7);
    return anns.data
      .filter((a) => {
        if (a.author_id === me.id) return false;
        const made = dateOf(a.created_at);
        if (needsMyAck(a, me.id)) return made >= month;
        // Without a record of what's been seen (it couldn't load), only the ones to acknowledge pop up.
        return !views.isError && !a.requires_ack && !seen.has(a.id) && made >= week;
      })
      .sort((x, y) => Number(y.important) - Number(x.important) || x.created_at.localeCompare(y.created_at));
  }, [anns.data, anns.isLoading, views.data, views.isLoading, views.isError, me.id, today]);

  // Not checked in, a working day, past the start time plus the grace minutes, not on leave and
  // not already asked about today. Worked out on every render (the clock moves).
  const forgot = (() => {
    if (!checksIn || !settings || todayRow.isLoading || todayRow.data === undefined || !mine.isFetched || away.isLoading) return false;
    if (!isWorkday(today, settings.work_days)) return false;
    if ((todayRow.data ?? []).length > 0) return false;
    if ((away.data ?? []).some((l) => l.user_id === me.id)) return false;
    if ((mine.data ?? []).some((r) => r.work_date === today && r.status === "pending")) return false;
    const start = addMinutes((settings.work_start ?? "08:30").slice(0, 5), settings.grace_minutes ?? 10);
    return clockNow() >= start;
  })();

  // What's new: once per update, only the items that apply to me. Items about missed check-ins wait
  // until those tables are in place, so nobody reads about something they can't use yet.
  const fixReady = mine.isFetched && !mine.isError;
  const wnCtx: WhatsNewContext = {
    checksIn,
    approves: isManager || signoff.first?.id === me.id || signoff.final?.id === me.id,
    canAssign,
    approverName: fixApprover(me.id, signoff)?.short_name ?? "a manager",
  };
  // Opened from More or Settings: everything recent. On its own: what's new since I last looked.
  const wnForcedEarly = new URLSearchParams(location.search).get("whatsnew") === "1";
  const wnReleases = wnForcedEarly ? RELEASES : releasesSince(wnSeen);
  const wnItems = itemsFor(wnReleases, wnCtx, fixReady);
  const wnHeld = !fixReady && wnReleases.some((r) => r.items.some((i) => i.needsCheckinFix && (!i.for || i.for(wnCtx))));
  const wnForced = wnForcedEarly;
  const closeWhatsNew = () => {
    markReleaseSeen(me.id);
    setWnSeen(LATEST.id);
    if (wnForced) {
      const next = new URLSearchParams(location.search);
      next.delete("whatsnew");
      navigate({ pathname: location.pathname, search: next.toString() }, { replace: true });
    }
  };

  // The first popup that's due and not put off.
  const path = location.pathname;
  const queue: Popup[] = [];
  if (wnItems.length && (wnForced || (wnSeen !== LATEST.id && !wnHeld))) queue.push({ kind: "whatsnew", key: "whatsnew" });
  if (answers.length) queue.push({ kind: "answers", key: "answers" });
  if (!path.startsWith("/announcements")) {
    popAnns.forEach((a) => queue.push({ kind: "announcement", key: `ann-${a.id}`, a }));
  }
  if (toAnswer.list.length && !path.startsWith("/attendance")) queue.push({ kind: "approve", key: "approve" });
  if (forgot && !path.startsWith("/attendance")) queue.push({ kind: "forgot", key: `forgot-${today}` });
  const due = queue.filter((p) => p.kind === "whatsnew" || !later.has(p.key));
  const current = ready && !asking && !/^\/(enter|share)/.test(path) ? due[0] : undefined;
  // Number the announcements among those still due.
  const annLeft = due.filter((p) => p.kind === "announcement").length;

  return (
    <>
      {current?.kind === "whatsnew" && <WhatsNewPopup key="whatsnew" items={wnItems} ctx={wnCtx} onClose={closeWhatsNew} />}
      {current?.kind === "answers" && <AnswersPopup key="answers" onClose={() => hide("answers")} />}
      {current?.kind === "announcement" && (
        <AnnouncementPopup key={current.key} a={current.a} left={annLeft} onLater={() => hide(current.key)} canAssign={canAssign} />
      )}
      {current?.kind === "approve" && <ApprovePopup key="approve" onLater={() => hide("approve")} />}
      {current?.kind === "forgot" && (
        <ForgotPopup
          key="forgot"
          onLater={() => hide(current.key)}
          onAsk={() => {
            hide(current.key);
            setAsking(true);
          }}
        />
      )}
      <CheckinFixForm open={asking} onClose={() => setAsking(false)} day={today} />
    </>
  );
}

/* ---------------------------------------------------------------- what's new */

function WhatsNewPopup({ items, ctx, onClose }: { items: WhatsNewItem[]; ctx: WhatsNewContext; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Sheet
      open
      onClose={onClose}
      title="What's new"
      footer={
        <button className="btn primary" type="button" onClick={onClose}>
          Got it
        </button>
      }
    >
      <div className="pop-body">
        <div className="pop-hero" style={{ ["--pop-tone" as string]: "var(--accent)" }}>
          <span className="pop-icon">
            <Gift />
          </span>
          <div>
            <h3>New in Northcroft</h3>
            <p className="muted small">
              Updated {fmtLongDate(LATEST.date)} · {items.length} {items.length === 1 ? "change" : "changes"}
            </p>
          </div>
        </div>
        <ul className="wn-list">
          {items.map((it, i) => (
            <li key={it.id} style={{ ["--i" as string]: i }}>
              <span className="wn-ic" style={tileStyle(it.color)}>
                <it.icon />
              </span>
              <div className="wn-text">
                <b>{it.title(ctx)}</b>
                <span>{it.body(ctx)}</span>
                {it.to && (
                  <button
                    type="button"
                    className="wn-try"
                    onClick={() => {
                      onClose();
                      navigate(it.to!);
                    }}
                  >
                    {it.cta ?? "Try it"} <ArrowRight />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- 1. answers */

function AnswersPopup({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const people = usePeople();
  const invalidate = useInvalidate();
  const mine = useMyCheckinRequests(me.id);
  const list = (mine.data ?? []).filter((r) => (r.status === "approved" || r.status === "declined") && !r.seen_at);
  const [ids] = useState(() => list.map((r) => r.id));
  const shown = (mine.data ?? []).filter((r) => ids.includes(r.id));
  const month = shown[0]?.work_date ?? todayISO();
  const use = fixUsage(mine.data, month);
  const allOk = shown.every((r) => r.status === "approved");

  async function done() {
    onClose();
    try {
      await markFixAnswersSeen(ids);
      await invalidate("checkin_requests");
    } catch {
      /* shows again next time */
    }
  }

  return (
    <Sheet open onClose={() => void done()} title="Your missed check-in" footer={<button className="btn primary" type="button" onClick={() => void done()}>OK</button>}>
      <div className="pop-body">
        <div className="pop-hero" style={{ ["--pop-tone" as string]: allOk ? "var(--green)" : "var(--red)" }}>
          <span className="pop-icon">{allOk ? <CircleCheck /> : <X />}</span>
          <div>
            <h3>{shown.length === 1 ? (allOk ? "Approved" : "Declined") : `${shown.length} answers`}</h3>
            <p className="muted small">{allOk ? "The times are now in your attendance." : "Here's what came back."}</p>
          </div>
        </div>
        <div className="pop-list">
          {shown.map((r) => {
            const by = people.get(r.decided_by)?.short_name ?? "The manager";
            return (
              <div key={r.id} className={r.status === "approved" ? "pop-answer ok" : "pop-answer no"}>
                <b>
                  {by} {r.status} {fixDay(r.work_date)}
                </b>
                <span className="small">{r.status === "approved" ? `Recorded your ${fixTimesInWords(r)}.` : `You asked for ${fixTimesInWords(r)}. Nothing was changed.`}</span>
                {r.decision_note && <span className="small">"{r.decision_note}"</span>}
              </div>
            );
          })}
        </div>
        <FixAllowance used={use.approved} waiting={use.waiting} month={monthName(month)} />
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- 2. announcements */

function AnnouncementPopup({ a, left, onLater, canAssign }: { a: AnnouncementWithAcks; left: number; onLater: () => void; canAssign: boolean }) {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const author = people.get(a.author_id);
  const mustAck = needsMyAck(a, me.id);

  async function markSeen() {
    const { error } = await supabase.from("announcement_views").insert({ announcement_id: a.id, user_id: me.id });
    if (error && !/duplicate key/i.test(error.message)) throw error;
  }

  async function ack() {
    setBusy(true);
    try {
      await acknowledge(a.id, me.id);
      await markSeen().catch(() => undefined);
      await qc.invalidateQueries({ queryKey: ["announcement_acks"] });
      await qc.invalidateQueries({ queryKey: ["announcement_views"] });
      toast("Thanks, marked as acknowledged");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function ok() {
    setBusy(true);
    try {
      await markSeen();
      await qc.invalidateQueries({ queryKey: ["announcement_views"] });
    } catch {
      onLater();
    } finally {
      setBusy(false);
    }
  }

  function open() {
    onLater();
    navigate(`/announcements?id=${a.id}`);
  }

  const extras = !!a.voice_path;
  return (
    <Sheet
      open
      onClose={mustAck ? onLater : () => void ok()}
      title={left > 1 ? `Announcement · ${left} new` : "Announcement"}
      footer={
        mustAck ? (
          <>
            <button className="btn" type="button" onClick={onLater} disabled={busy}>
              Later
            </button>
            <button className="btn primary" type="button" onClick={() => void ack()} disabled={busy}>
              <CircleCheck /> Acknowledge
            </button>
          </>
        ) : (
          <>
            <button className="btn" type="button" onClick={open} disabled={busy}>
              Open
            </button>
            <button className="btn primary" type="button" onClick={() => void ok()} disabled={busy}>
              OK
            </button>
          </>
        )
      }
    >
      <div className="pop-body">
        <div className="pop-hero" style={{ ["--pop-tone" as string]: a.important ? "var(--red)" : "var(--accent)" }}>
          <span className="pop-icon">
            <Megaphone />
          </span>
          <div className="pop-ann-meta">
            <Avatar person={author} size={26} />
            <span className="small">
              <b>{author?.short_name ?? "Someone"}</b> <span className="muted">· {fmtDateTime(a.created_at)}</span>
            </span>
            {a.important && <Pill tone="red">Important</Pill>}
          </div>
        </div>
        <h3 className="pop-ann-title">{a.title}</h3>
        {a.body.trim() && <div className="pop-ann-body">{a.body}</div>}
        {extras && (
          <button className="btn small ghost" type="button" onClick={open} style={{ alignSelf: "flex-start" }}>
            Has a voice note. Open the announcement to play it
          </button>
        )}
        {mustAck && <p className="muted tiny">{canAssign ? "The team is asked to acknowledge this." : "Please acknowledge that you've read this."} It shows here each time you open the app until you do.</p>}
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- 3. requests to approve */

function ApprovePopup({ onLater }: { onLater: () => void }) {
  const { list } = useCheckinRequestsToAnswer();
  return (
    <Sheet
      open
      onClose={onLater}
      title="Missed check-ins to approve"
      footer={
        <button className="btn" type="button" onClick={onLater}>
          Later
        </button>
      }
    >
      <div className="pop-body">
        <div className="pop-hero" style={{ ["--pop-tone" as string]: "var(--purple)" }}>
          <span className="pop-icon">
            <ClipboardCheck />
          </span>
          <div>
            <h3>
              {list.length === 1 ? "1 request is" : `${list.length} requests are`} waiting for you
            </h3>
            <p className="muted small">Approving records the times in their attendance. Each person can have {FIX_LIMIT} a month.</p>
          </div>
        </div>
        <div className="pop-list">
          {list.map((r) => (
            <FixToAnswer key={r.id} r={r} />
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- 4. not checked in */

function ForgotPopup({ onLater, onAsk }: { onLater: () => void; onAsk: () => void }) {
  const me = useMe();
  const signoff = useSignoff();
  const settings = useSettings().data;
  const navigate = useNavigate();
  const mine = useMyCheckinRequests(me.id);
  const today = todayISO();
  const use = fixUsage(mine.data, today);
  // Requests can't be sent if they couldn't be loaded (e.g. offline): only Check in is offered.
  const canAsk = use.canAsk && !mine.isError;
  const approver = fixApprover(me.id, signoff)?.short_name ?? "a manager";
  const start = fmtClock(settings?.work_start ?? "08:30");
  const afterHours = clockNow() >= (settings?.work_end ?? "17:30").slice(0, 5);

  return (
    <Sheet
      open
      onClose={onLater}
      title="Check in"
      footer={
        <>
          <button className="btn" type="button" onClick={onLater}>
            Not now
          </button>
          {canAsk && (
            <button className="btn" type="button" onClick={onAsk}>
              <ClockAlert /> Ask {approver}
            </button>
          )}
          {!afterHours && (
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                onLater();
                navigate("/attendance");
              }}
            >
              <MapPin /> Check in
            </button>
          )}
        </>
      }
    >
      <div className="pop-body">
        <div className="pop-hero" style={{ ["--pop-tone" as string]: "var(--orange)" }}>
          <span className="pop-icon">
            <ClockAlert />
          </span>
          <div>
            <h3>{afterHours ? "You didn't check in today" : "You haven't checked in yet"}</h3>
            <p className="muted small">Office hours started at {start}.</p>
          </div>
        </div>
        <p className="small" style={{ margin: 0 }}>
          {afterHours
            ? `If you were at work today, ask ${approver} to record the times you came in and left.`
            : `If you're at the office, check in now. If you got here earlier and forgot, ask ${approver} to record the time you came in.`}
        </p>
        {mine.isError ? null : use.canAsk ? (
          <FixAllowance used={use.approved} waiting={use.waiting} month={monthName(today)} />
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            You've used your {FIX_LIMIT} missed check-ins for {monthName(today)}.
          </p>
        )}
      </div>
    </Sheet>
  );
}
