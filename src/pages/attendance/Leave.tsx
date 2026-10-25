// Leave: asking for it, approving it in two steps (the first checker, then the final OK), and
// seeing who is away and everyone's annual leave. The database enforces the order and the rules
// (leave_guard); this screen shows whose turn it is and the right buttons.
import "@/styles/leave.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { CalendarRange, ChevronLeft, ChevronRight, ClipboardCheck, Lock, Paperclip, Plus, TreePalm, TriangleAlert, X } from "lucide-react";
import { useInvalidate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  annualLeaveLocked,
  annualOpensOn,
  daysText,
  firstStageFor,
  fmtLeaveDates,
  fmtLeaveDay,
  leaveApprovers,
  leaveKindLabel,
  leavePassesOn,
  leaveRouteText,
  leaveTurnLabel,
  LEAVE_KINDS,
  LEAVE_STATUS,
  needsFile,
  requestLeave,
  setLeaveStatus,
  useLeaveBalances,
  useLeaveContext,
  useLeaveRequest,
  useMyLeave,
  workingDays,
} from "@/lib/leave";
import { errorMessage } from "@/lib/supabase";
import { addDays, dateOf, isWorkday, todayISO } from "@/lib/time";
import type { LeaveBalance, LeaveKind, LeaveRequest } from "@/lib/types";
import { Avatar, Empty, Field, Loading, Pill, Segmented, Sheet, useConfirm, useToast } from "@/components/ui";
import { Attachments } from "@/components/Attachments";
import { uploadFile } from "@/lib/files";
import { fileSize } from "@/lib/format";

const thisYear = () => Number(todayISO().slice(0, 4));

/** The next working day from today (today if it is one). */
function nextWorkday(workDays?: number[]) {
  let d = todayISO();
  for (let i = 0; i < 10 && !isWorkday(d, workDays); i++) d = addDays(d, 1);
  return d;
}

/** "16 of 21 days left" sentences for an annual request. */
function balanceLine(b: LeaveBalance | undefined, days: number, who: string | null) {
  if (!b) return null;
  const you = who === null;
  const has = you ? "You have" : `${who} has`;
  const left = b.remaining;
  const after = left - days;
  const base = `${has} ${Math.max(left, 0)} of ${b.allowance} annual leave days left this year`;
  if (after < 0) return { tone: "red" as const, text: `${base}. This is ${days - Math.max(left, 0)} ${days - Math.max(left, 0) === 1 ? "day" : "days"} more than that.` };
  return { tone: "gray" as const, text: `${base}. This leaves ${after}.` };
}

/* ---------------------------------------------------------------- my leave */

/** My leave: request button, balance and my requests. For everyone who checks in. */
export function MyLeaveCard() {
  const { me, signoff, people, managers } = useLeaveContext();
  const mine = useMyLeave(me.id);
  const balances = useLeaveBalances(thisYear());
  const mineBal = (balances.data ?? []).find((b) => b.user_id === me.id);
  const [asking, setAsking] = useState(false);
  const [open, setOpen] = useState<LeaveRequest | null>(null);
  const [all, setAll] = useState(false);
  const today = todayISO();

  // Waiting and coming up first, then the rest (newest first), this year and later.
  const list = useMemo(() => {
    const rows = (mine.data ?? []).filter((r) => r.end_date >= `${thisYear() - 1}-12-01`);
    const live = rows.filter((r) => r.status === "pending" || (r.status === "approved" && r.end_date >= today)).sort((a, b) => a.start_date.localeCompare(b.start_date));
    const past = rows.filter((r) => !live.includes(r));
    return [...live, ...past];
  }, [mine.data, today]);
  const shown = all ? list : list.slice(0, 4);

  return (
    <div className="glass card leave-card">
      <div className="card-head">
        <h2 className="tone-teal">
          <TreePalm /> My leave
        </h2>
        <button className="btn small primary" onClick={() => setAsking(true)} type="button">
          <Plus /> Request leave
        </button>
      </div>

      <div className="leave-balance" aria-label="Annual leave this year">
        <div>
          <span className="label">Days left</span>
          <span className={clsx("value", mineBal && mineBal.remaining < 0 && "neg")}>{mineBal ? mineBal.remaining : "–"}</span>
          <span className="hint">of {mineBal?.allowance ?? me.annual_leave_days ?? 21} annual</span>
        </div>
        <div>
          <span className="label">Taken</span>
          <span className="value">{mineBal ? mineBal.used : "–"}</span>
          <span className="hint">working days</span>
        </div>
        <div>
          <span className="label">Waiting</span>
          <span className="value">{mineBal ? mineBal.pending : "–"}</span>
          <span className="hint">for approval</span>
        </div>
      </div>

      {annualLeaveLocked(me) && (
        <div className="leave-locked small">
          <Lock size={14} /> {annualLeaveLocked(me)}
        </div>
      )}

      {mine.isLoading ? (
        <Loading rows={2} />
      ) : list.length === 0 ? (
        <Empty icon={<TreePalm />} title="No leave booked">
          {leaveRouteText(me.id, signoff, managers, (id) => people.get(id)?.short_name)} Annual leave counts against your days for the year.
        </Empty>
      ) : (
        <div className="list">
          {shown.map((r) => (
            <LeaveRow key={r.id} r={r} onOpen={() => setOpen(r)} />
          ))}
          {list.length > 4 && (
            <button className="btn small ghost leave-more" onClick={() => setAll(!all)} type="button">
              {all ? "Show fewer" : `Show all ${list.length}`}
            </button>
          )}
        </div>
      )}

      <LeaveForm open={asking} onClose={() => setAsking(false)} balance={mineBal} />
      {open && <LeaveDetail id={open.id} initial={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** One request in a list. With `person`, the name and photo lead. */
function LeaveRow({ r, onOpen, person }: { r: LeaveRequest; onOpen: () => void; person?: boolean }) {
  const { me, signoff, people, managers } = useLeaveContext();
  const p = people.get(r.user_id);
  const turn = leaveTurnLabel(r, signoff, me.id, managers, people);
  const mineToDo = r.status === "pending" && leaveApprovers(r.stage, r.user_id, signoff, managers).includes(me.id);
  const tone = r.status === "pending" ? (mineToDo ? "purple" : "orange") : LEAVE_STATUS[r.status].tone;
  return (
    <button className="list-item leave-row" onClick={onOpen} type="button">
      {person ? (
        <Avatar person={p} size={34} />
      ) : (
        <span className={clsx("leave-date", r.status === "cancelled" || r.status === "declined" ? "off" : undefined)} aria-hidden>
          <b>{Number(r.start_date.slice(8, 10))}</b>
          <small>{fmtLeaveDay(r.start_date).split(" ")[2]}</small>
        </span>
      )}
      <span className="grow">
        <span className="title">{person ? `${p?.short_name ?? "Someone"} · ${leaveKindLabel(r.kind)}` : leaveKindLabel(r.kind)}</span>
        <span className="meta">
          <span>{fmtLeaveDates(r.start_date, r.end_date)}</span>
          <span>{daysText(r.days)}</span>
        </span>
      </span>
      <Pill tone={tone}>{turn}</Pill>
    </button>
  );
}

/* ---------------------------------------------------------------- approvals */

/** Requests waiting on me. Shows nothing when there are none (on Home), or an empty note (`always`). */
export function LeaveToApproveCard({ always }: { always?: boolean }) {
  const { toApprove, team, signoff, me } = useLeaveContext();
  const [open, setOpen] = useState<LeaveRequest | null>(null);
  if (!always && (team.isLoading || toApprove.length === 0)) return null;
  const finalOk = toApprove.length > 0 && toApprove.every((r) => r.stage === "final" && signoff.final?.id === me.id);
  return (
    <div className="glass card leave-card">
      <div className="card-head">
        <h2 className="tone-purple">
          <ClipboardCheck /> {finalOk ? "Leave for your final OK" : "Leave to approve"}
        </h2>
        {toApprove.length > 0 && <Pill tone="purple">{toApprove.length}</Pill>}
      </div>
      {team.isLoading ? (
        <Loading rows={2} />
      ) : toApprove.length === 0 ? (
        <Empty icon={<ClipboardCheck />} title="No leave waiting for you">
          When someone asks for leave and it's your turn to approve it, it shows up here.
        </Empty>
      ) : (
        <div className="list">
          {toApprove.map((r) => (
            <LeaveRow key={r.id} r={r} person onOpen={() => setOpen(r)} />
          ))}
        </div>
      )}
      {open && <LeaveDetail id={open.id} initial={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- team */

type TeamView = "upcoming" | "balances";

/** For managers and seniors: who is away or asking, and everyone's annual leave. */
export function TeamLeaveCard() {
  const { team, people } = useLeaveContext();
  const [view, setView] = useState<TeamView>("upcoming");
  const [year, setYear] = useState(thisYear());
  const balances = useLeaveBalances(year, view === "balances");
  const [open, setOpen] = useState<LeaveRequest | null>(null);
  const today = todayISO();
  const upcoming = (team.data ?? []).filter((r) => r.status === "pending" || r.end_date >= today);
  const awayToday = upcoming.filter((r) => r.status === "approved" && r.start_date <= today && r.end_date >= today);

  return (
    <div className="glass card leave-card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <h2 className="tone-teal">
          <CalendarRange /> Team leave
        </h2>
        <Segmented<TeamView>
          value={view}
          onChange={setView}
          options={[
            { value: "upcoming", label: "Coming up", count: upcoming.length || undefined },
            { value: "balances", label: "Balances" },
          ]}
        />
      </div>

      {view === "upcoming" ? (
        team.isLoading ? (
          <Loading rows={2} />
        ) : upcoming.length === 0 ? (
          <Empty icon={<CalendarRange />} title="Nobody is on leave or asking">
            Approved and waiting requests from today on show here.
          </Empty>
        ) : (
          <>
            {awayToday.length > 0 && (
              <div className="muted small" style={{ marginBottom: 6 }}>
                Away today: {awayToday.map((r) => people.get(r.user_id)?.short_name ?? "Someone").join(", ")}
              </div>
            )}
            <div className="list">
              {upcoming.map((r) => (
                <LeaveRow key={r.id} r={r} person onOpen={() => setOpen(r)} />
              ))}
            </div>
          </>
        )
      ) : (
        <>
          <div className="row leave-year">
            <button className="icon-btn small" onClick={() => setYear(year - 1)} aria-label="Previous year" type="button">
              <ChevronLeft />
            </button>
            <b className="num">{year}</b>
            <button className="icon-btn small" onClick={() => setYear(year + 1)} disabled={year >= thisYear() + 1} aria-label="Next year" type="button">
              <ChevronRight />
            </button>
            <span className="muted tiny grow">Annual leave in working days. Allowances are set in Settings, Team.</span>
          </div>
          {balances.isLoading ? (
            <Loading rows={3} />
          ) : (
            <div className="solid table-wrap">
              <table className="table leave-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th className="r">Allowance</th>
                    <th className="r">Taken</th>
                    <th className="r">Waiting</th>
                    <th className="r">Left</th>
                  </tr>
                </thead>
                <tbody>
                  {(balances.data ?? []).map((b) => {
                    const p = people.get(b.user_id);
                    return (
                      <tr key={b.user_id}>
                        <td>
                          <span className="row" style={{ gap: 8 }}>
                            <Avatar person={p} size={26} />
                            <span style={{ minWidth: 0 }}>
                              <span className="bold">{p?.short_name ?? "Someone"}</span>
                              {annualOpensOn(p) && (
                                <span className="faint tiny" style={{ display: "block" }}>
                                  Annual leave from {annualOpensOn(p)}
                                </span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="r num">{b.allowance}</td>
                        <td className="r num">{b.used}</td>
                        <td className="r num" style={{ color: b.pending ? "var(--orange)" : undefined }}>
                          {b.pending}
                        </td>
                        <td className="r num bold" style={{ color: b.remaining < 0 ? "var(--red)" : undefined }}>
                          {b.remaining}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {open && <LeaveDetail id={open.id} initial={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- asking */

function LeaveForm({ open, onClose, balance }: { open: boolean; onClose: () => void; balance?: LeaveBalance }) {
  const { me, signoff, people, managers, workDays } = useLeaveContext();
  const toast = useToast();
  const invalidate = useInvalidate();
  // Annual leave opens 3 months after someone joined; until then the form starts on sick leave.
  const locked = annualLeaveLocked(me);
  const [kind, setKind] = useState<LeaveKind>(locked ? "sick" : "annual");
  const [from, setFrom] = useState(nextWorkday(workDays));
  const [to, setTo] = useState(nextWorkday(workDays));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // Files go up right after the request is sent (they need its id).
  const [files, setFiles] = useState<File[]>([]);
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const d = nextWorkday(workDays);
    setKind(annualLeaveLocked(me) ? "sick" : "annual");
    setFrom(d);
    setTo(d);
    setNote("");
    setFiles([]);
    setUploadNote(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = workingDays(from, to, workDays);
  const earliest = addDays(todayISO(), -60);
  const problem = !from || !to
    ? "Choose the first and last day."
    : to < from
      ? "The last day must be on or after the first day."
      : from < earliest
        ? "Leave can only be recorded up to two months back."
        : days === 0
          ? "Those dates are all weekend days. Pick at least one working day."
          : null;
  // What else stops it going: annual leave not open yet, or sick leave without its certificate.
  const missing = kind === "annual" && locked ? locked : needsFile(kind) && files.length === 0 ? "Attach your medical certificate to send sick leave." : null;
  const blocker = problem ?? missing;
  const sameYear = !from || Number(from.slice(0, 4)) === thisYear();
  const bal = kind === "annual" && sameYear ? balanceLine(balance, days, null) : null;
  const waitingOver = kind === "annual" && sameYear && balance && bal?.tone !== "red" && balance.pending > 0 && days > balance.remaining - balance.pending;
  const route = leaveRouteText(me.id, signoff, managers, (id) => people.get(id)?.short_name);
  const firstApprovers = leaveApprovers(firstStageFor(me.id, signoff), me.id, signoff, managers).filter((id) => id !== me.id);
  const sentTo = firstApprovers.length === 1 ? people.get(firstApprovers[0])?.short_name : undefined;

  async function send() {
    if (blocker) {
      toast(blocker, "error");
      return;
    }
    setBusy(true);
    try {
      const made = await requestLeave({ kind, start_date: from, end_date: to, note: note.trim() || null });
      // The request stands even if a file doesn't go up; it can be added again from the request.
      const failed: string[] = [];
      for (const [i, f] of files.entries()) {
        setUploadNote(`Uploading ${f.name}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ""}...`);
        try {
          await uploadFile(f, { leaveId: made.id, userId: me.id });
        } catch {
          failed.push(f.name);
        }
      }
      setUploadNote(null);
      await invalidate("leave_requests", "attachments");
      if (failed.length) toast(`Request sent, but ${failed.join(", ")} didn't upload. Open the request and add ${failed.length === 1 ? "it" : "them"} again.`, "error");
      else toast(sentTo ? `Leave request sent to ${sentTo}` : "Leave request sent");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Request leave"
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" onClick={send} disabled={busy || !!blocker} type="button">
            {busy ? uploadNote ?? "Sending..." : "Send request"}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        <Field label="Type of leave" group>
          <div className="leave-kinds" role="radiogroup" aria-label="Type of leave">
            {LEAVE_KINDS.map((k) => {
              const off = k.value === "annual" && !!locked;
              return (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.value}
                  aria-disabled={off}
                  disabled={off}
                  title={off ? locked! : undefined}
                  className={clsx("leave-kind", kind === k.value && "on", off && "locked")}
                  onClick={() => setKind(k.value)}
                >
                  {off && <Lock size={12} />} {k.short}
                </button>
              );
            })}
          </div>
          {locked && (
            <small className="muted tiny leave-locked-note">
              <Lock size={12} /> {locked}
            </small>
          )}
        </Field>
        <div className="leave-dates">
          <Field label="First day">
            <input
              className="input"
              type="date"
              value={from}
              min={earliest}
              onChange={(e) => {
                const v = e.target.value;
                setFrom(v);
                if (v && (!to || to < v)) setTo(v);
              }}
            />
          </Field>
          <Field label="Last day">
            <input className="input" type="date" value={to} min={from || earliest} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        <div className={clsx("leave-summary solid", problem && "warn")} aria-live="polite">
          {problem ? (
            <span className="row" style={{ gap: 8 }}>
              <TriangleAlert size={16} /> {problem}
            </span>
          ) : (
            <>
              <b>{daysText(days)}</b>
              <span className="muted"> · {fmtLeaveDates(from, to)}</span>
              {bal && <div className={clsx("small", bal.tone === "red" ? "leave-over" : "muted")}>{bal.text}{bal.tone === "red" ? " You can still send it; it will say so when it's checked." : ""}</div>}
              {waitingOver && (
                <div className="small leave-over">
                  With the {balance!.pending} {balance!.pending === 1 ? "day" : "days"} already waiting for approval, this would be more than you have left.
                </div>
              )}
              {kind !== "annual" && <div className="small muted">{leaveKindLabel(kind)} doesn't count against your annual leave.</div>}
              {missing && (
                <div className="small leave-missing">
                  <Paperclip size={13} /> {missing}
                </div>
              )}
            </>
          )}
        </div>

        <Field
          label={needsFile(kind) ? "Medical certificate" : "Files (optional)"}
          group
          hint={needsFile(kind) ? "Sick leave needs a medical certificate. Only you and the people who approve leave can see it." : "A ticket, a letter or anything that goes with it. Only you and the people who approve leave can see them."}
        >
          <div className="stack" style={{ gap: 8 }}>
            {files.length > 0 && (
              <div className="row wrap" style={{ gap: 6 }}>
                {files.map((f, i) => (
                  <span className="pill blue" key={`${f.name}-${i}`}>
                    <Paperclip />
                    <span className="ellipsis" style={{ maxWidth: 180 }}>
                      {f.name}
                    </span>
                    <span className="faint">{fileSize(f.size)}</span>
                    <button type="button" className="leave-file-x" onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))} aria-label={`Take ${f.name} off`}>
                      <X size={13} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <button type="button" className={clsx("btn small", needsFile(kind) && files.length === 0 && "primary")} style={{ alignSelf: "flex-start" }} onClick={() => fileInput.current?.click()}>
              <Paperclip /> {files.length ? "Add another file" : needsFile(kind) ? "Attach medical certificate" : "Add files"}
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept="image/*,application/pdf,.doc,.docx"
              aria-label="Choose files for the leave request"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((xs) => [...xs, ...picked]);
                e.target.value = "";
              }}
            />
          </div>
        </Field>
        <Field label="Note (optional)">
          <textarea className="textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything they should know" />
        </Field>
        <div className="muted small">{route}</div>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- one request */

export function LeaveDetail({ id, initial, onClose }: { id: string; initial?: LeaveRequest; onClose: () => void }) {
  const { me, signoff, people, managers } = useLeaveContext();
  const { isManager } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const q = useLeaveRequest(id);
  const r = q.data ?? initial ?? null;
  const year = Number((r?.start_date ?? todayISO()).slice(0, 4));
  const balances = useLeaveBalances(year, !!r && r.kind === "annual");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!r) {
    return (
      <Sheet open onClose={onClose} title="Leave request">
        {q.isLoading ? <Loading rows={2} /> : <Empty icon={<TreePalm />} title="This request isn't available">It may have been removed, or it isn't one you can see.</Empty>}
      </Sheet>
    );
  }

  const person = people.get(r.user_id);
  const mine = r.user_id === me.id;
  const approvers = leaveApprovers(r.stage, r.user_id, signoff, managers);
  const myTurn = r.status === "pending" && approvers.includes(me.id);
  const checker = signoff.first?.id === me.id || signoff.final?.id === me.id;
  const canDecline = r.status === "pending" && !mine && (myTurn || checker);
  const today = todayISO();
  const canCancelMine = mine && (r.status === "pending" || (r.status === "approved" && r.start_date > today));
  const canCancelTheirs = !mine && r.status === "approved" && (isManager || checker);
  const passes = myTurn && leavePassesOn(r, me.id, signoff);
  const bal = r.kind === "annual" && (r.status === "pending" || r.status === "approved")
    ? (balances.data ?? []).find((b) => b.user_id === r.user_id)
    : undefined;
  // For a request already approved, the balance has taken it off; show what's left.
  const balText = bal
    ? r.status === "pending"
      ? balanceLine(bal, r.days, mine ? null : person?.short_name ?? "They")
      : { tone: "gray" as const, text: `${mine ? "You have" : `${person?.short_name ?? "They"} has`} ${bal.remaining} of ${bal.allowance} annual leave days left this year.` }
    : null;
  const name = (pid: string | null) => (pid ? people.get(pid)?.short_name ?? "Someone" : "Someone");
  const when = (ts: string | null) => (ts ? fmtLeaveDay(dateOf(ts)) : "");

  async function act(status: "approved" | "declined" | "cancelled", ask?: { title: string; message: string; label: string; danger?: boolean }) {
    if (ask && !(await confirm({ title: ask.title, message: ask.message, confirmLabel: ask.label, danger: ask.danger }))) return;
    setBusy(true);
    try {
      // A note goes with a decline, a final approval, or a manager's cancel; an OK that passes it on carries none.
      const withNote = status === "declined" || (status === "approved" && !passes) || (status === "cancelled" && !mine);
      const after = await setLeaveStatus(r!.id, status, withNote ? note : undefined);
      await invalidate("leave_requests");
      if (status === "approved") {
        toast(after.status === "pending" ? `Approved. It's now with ${signoff.final?.short_name ?? "the final checker"} for the final OK.` : `${person ? `${person.short_name}'s` : "Their"} leave is approved`);
      } else if (status === "declined") {
        toast("Leave request declined");
      } else {
        toast(mine ? "Your request is cancelled" : "Leave cancelled");
      }
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const approveLabel = passes ? `Approve, send to ${signoff.final?.short_name ?? "final OK"}` : r.stage === "final" ? "Give final OK" : "Approve";
  const footer =
    myTurn || canDecline || canCancelMine || canCancelTheirs ? (
      <>
        {canCancelMine && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() =>
              act("cancelled", {
                title: r.status === "pending" ? "Cancel this request?" : "Cancel this leave?",
                message: r.status === "pending" ? "It's taken off the approval list." : "Whoever approved it will be told, and the days go back on your balance.",
                label: r.status === "pending" ? "Cancel request" : "Cancel leave",
                danger: true,
              })
            }
            type="button"
          >
            {r.status === "pending" ? "Cancel request" : "Cancel leave"}
          </button>
        )}
        {canCancelTheirs && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => act("cancelled", { title: `Cancel ${person ? `${person.short_name}'s` : "their"} leave?`, message: `${person?.short_name ?? "They"} will be told, with your note if you add one.`, label: "Cancel leave", danger: true })}
            type="button"
          >
            Cancel leave
          </button>
        )}
        {canDecline && (
          <button className="btn danger" disabled={busy} onClick={() => act("declined")} type="button">
            Decline
          </button>
        )}
        {myTurn && (
          <button className="btn primary" disabled={busy} onClick={() => act("approved")} type="button">
            {approveLabel}
          </button>
        )}
      </>
    ) : undefined;

  return (
    <Sheet open onClose={onClose} title={mine ? leaveKindLabel(r.kind) : `${person?.short_name ?? "Someone"}'s leave`} footer={footer}>
      <div className="stack" style={{ gap: 14 }}>
        {!mine && (
          <div className="row">
            <Avatar person={person} size={44} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="bold">{person?.full_name ?? "Someone"}</div>
              <div className="muted small">{leaveKindLabel(r.kind)}</div>
            </div>
          </div>
        )}
        <div className="leave-summary solid">
          <b>{fmtLeaveDates(r.start_date, r.end_date)}</b>
          <div className="muted small">{daysText(r.days)}</div>
          <div style={{ marginTop: 8 }}>
            <Pill tone={myTurn ? "purple" : r.status === "pending" ? "orange" : LEAVE_STATUS[r.status].tone}>{leaveTurnLabel(r, signoff, me.id, managers, people)}</Pill>
          </div>
        </div>

        {balText && (
          <div className={clsx("small", balText.tone === "red" ? "leave-over" : "muted")}>
            {balText.tone === "red" && <TriangleAlert size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />}
            {balText.text}
          </div>
        )}

        {r.note && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="section-title">Note</span>
            <div className="leave-note">{r.note}</div>
          </div>
        )}

        <LeaveFiles r={r} mine={mine} />

        <div className="stack" style={{ gap: 4 }}>
          <span className="section-title">History</span>
          <ul className="leave-steps">
            <li>Asked {when(r.created_at)}</li>
            {r.first_ok_by && <li>Approved by {name(r.first_ok_by)}, {when(r.first_ok_at)}</li>}
            {r.status === "approved" && r.decided_by && <li>{r.first_ok_by ? "Final OK from" : "Approved by"} {name(r.decided_by)}, {when(r.decided_at)}</li>}
            {r.status === "declined" && <li>Declined by {name(r.decided_by)}, {when(r.decided_at)}</li>}
            {r.status === "cancelled" && <li>Cancelled by {r.cancelled_by === r.user_id ? (mine ? "you" : name(r.cancelled_by)) : name(r.cancelled_by)}, {when(r.cancelled_at)}</li>}
            {r.status === "pending" && !myTurn && <li className="muted">{leaveTurnLabel(r, signoff, me.id, managers, people)}</li>}
          </ul>
          {r.decision_note && (r.status === "declined" || r.status === "cancelled" || r.status === "approved") && (
            <div className="leave-note">"{r.decision_note}"</div>
          )}
        </div>

        {(canDecline || canCancelTheirs || (myTurn && !passes)) && (
          <Field
            label={canCancelTheirs ? "Note to them (optional)" : canDecline && (passes || !myTurn) ? "Reason if you decline (optional)" : "Note (optional)"}
            hint={canDecline ? "Sent with your answer, so they know why." : undefined}
          >
            <textarea className="textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={canCancelTheirs ? "Why it's cancelled" : "A word for them"} />
          </Field>
        )}
        {mine && r.status === "approved" && r.start_date <= today && (
          <div className="muted small">This leave has started. To change it, ask {signoff.first?.short_name ?? "your manager"}.</div>
        )}
        {!mine && r.status === "pending" && !myTurn && checker && (
          <div className="muted small">It's not your turn to approve yet, but you can decline it if it can't go ahead.</div>
        )}
      </div>
    </Sheet>
  );
}

/** Files on a request: the person adds them while it's waiting; approvers and managers see them. */
function LeaveFiles({ r, mine }: { r: LeaveRequest; mine: boolean }) {
  const canAdd = mine && r.status === "pending";
  return (
    <div className="stack leave-files" style={{ gap: 6 }}>
      <span className="section-title">{r.kind === "sick" ? "Medical certificate" : "Files"}</span>
      <Attachments leaveId={r.id} canUpload={canAdd} compact emptyText={r.kind === "sick" ? "No certificate attached" : "No files attached"} />
    </div>
  );
}

/** Opens the request in `?leave=` (from a notification) and clears it on close. */
export function LeaveFromLink() {
  const [params, setParams] = useSearchParams();
  const id = params.get("leave");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (
    <LeaveDetail
      id={id}
      onClose={() => {
        const next = new URLSearchParams(params);
        next.delete("leave");
        setParams(next, { replace: true });
      }}
    />
  );
}
