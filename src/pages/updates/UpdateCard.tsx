// One daily update: each task from where it was to where it is now, what was done, other work and
// anything blocking. Shown in someone's history and on the team's day. Managers and seniors can
// tick a task done or change its % and note in someone else's update, and everyone who can see a
// blocker can reply under it.
import "@/styles/updates.css";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, CircleAlert, CircleCheck, Pencil } from "lucide-react";
import { useInvalidate, usePeople, useProjectMap } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { editUpdateItem, progressTone, type UpdateWithItems } from "@/lib/dailyUpdates";
import { errorMessage } from "@/lib/supabase";
import { fmtLongDate, fmtTime12, timeAgo } from "@/lib/time";
import type { DailyUpdateItem } from "@/lib/types";
import { Avatar, Pill, ProjectTag, useConfirm, useToast } from "@/components/ui";
import { openPersonCard } from "@/components/People";
import { BlockerThread } from "./BlockerThread";

const QUICK = [0, 25, 50, 75, 100];
const rowsFor = (text: string) => Math.min(8, Math.max(2, Math.ceil(text.length / 70) + text.split("\n").length - 1));

export function UpdateCard({ update, who, actions }: { update: UpdateWithItems; who?: boolean; actions?: ReactNode }) {
  const people = usePeople();
  const me = useMe();
  const { canAssign } = useAuth();
  const person = people.get(update.user_id);
  const handed = update.items.filter((i) => i.handed_in).length;
  // Managers and seniors change someone else's update (their own goes through the form).
  const canEdit = canAssign && update.user_id !== me.id;
  return (
    <div className="glass card du-card">
      <div className="du-card-head">
        {who ? (
          <button type="button" className="row du-who" onClick={() => person && openPersonCard(person.id)}>
            <Avatar person={person} size={34} />
            <span>
              <b>{person?.short_name ?? "Former team member"}</b>
              <span className="faint tiny" style={{ display: "block" }}>
                Sent {fmtTime12(update.submitted_at)}
              </span>
            </span>
          </button>
        ) : (
          <span>
            <b>{fmtLongDate(update.work_date)}</b>
            <span className="faint tiny" style={{ display: "block" }}>
              Sent {fmtTime12(update.submitted_at)}
            </span>
          </span>
        )}
        <span className="spacer" />
        <span className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
          {update.items.length > 0 && <Pill tone="blue">{update.items.length === 1 ? "1 task" : `${update.items.length} tasks`}</Pill>}
          {handed > 0 && <Pill tone="green">{handed} handed in</Pill>}
          {update.blockers && <Pill tone="orange">Blocked</Pill>}
        </span>
      </div>

      {update.items.length > 0 && (
        <div className="du-items">
          {update.items.map((i) => (
            <ItemLine key={i.id} item={i} canEdit={canEdit} ownerName={person?.short_name} />
          ))}
        </div>
      )}

      {update.other_work && (
        <div className="du-block">
          <span className="field-label">Other work</span>
          <p className="du-note">{update.other_work}</p>
        </div>
      )}
      {update.blockers && (
        <div className="du-block du-blocked">
          <span className="field-label">
            <CircleAlert size={14} /> Blocking
          </span>
          <p className="du-note">{update.blockers}</p>
          <BlockerThread update={update} />
        </div>
      )}
      {actions}
    </div>
  );
}

/** One task in an update; for a manager or senior, with a tick for done and a way to change it. */
function ItemLine({ item: i, canEdit, ownerName }: { item: DailyUpdateItem; canEdit: boolean; ownerName?: string }) {
  const projects = useProjectMap();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [pct, setPct] = useState(i.progress);
  const [note, setNote] = useState(i.note ?? "");
  const [busy, setBusy] = useState(false);
  const moved = i.progress - i.progress_before;
  const done = i.handed_in || i.progress >= 100;
  const editor = i.edited_by ? people.get(i.edited_by) : undefined;

  async function save(nextPct: number, nextNote: string) {
    setBusy(true);
    try {
      const out = await editUpdateItem(i.id, nextPct, nextNote);
      toast(
        out.handed_in && !i.handed_in
          ? `Done. ${i.task_title} went in for review and ${ownerName ?? "they"} has been told.`
          : `Changed. ${ownerName ?? "They"} has been told.`,
      );
      setEditing(false);
      await invalidate("daily_updates", "tasks");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function tick() {
    const ok = await confirm({
      title: "Mark this task done?",
      message: `${i.task_title} goes to 100% and in for review, the same as when ${ownerName ?? "they"} hand it in.`,
      confirmLabel: "Mark done",
    });
    if (ok) await save(100, i.note ?? "");
  }

  return (
    <div className="du-item">
      <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
        {canEdit && (
          <button
            type="button"
            className={`du-tick${done ? " on" : ""}`}
            onClick={() => void tick()}
            disabled={busy || done}
            aria-label={done ? `${i.task_title} is done` : `Mark ${i.task_title} done`}
            title={done ? "Done" : "Mark done"}
          >
            {done && <Check />}
          </button>
        )}
        <div className="grow" style={{ minWidth: 0 }}>
          <Link to={`/tasks/${i.task_id}`} className="du-task-title">
            {i.task_title}
          </Link>
          {i.project_id && (
            <div className="du-task-meta">
              <ProjectTag project={projects.get(i.project_id)} />
            </div>
          )}
        </div>
        <span className="du-item-pct">
          {moved !== 0 && <span className="faint">{i.progress_before}% to </span>}
          <b style={{ color: progressTone(i.progress) }}>{i.progress}%</b>
        </span>
      </div>
      <div className="du-bar" aria-hidden>
        <i className="before" style={{ width: `${Math.min(i.progress_before, i.progress)}%` }} />
        {moved > 0 && <i className="gain" style={{ left: `${i.progress_before}%`, width: `${moved}%`, background: progressTone(i.progress) }} />}
        {moved < 0 && <i className="before" style={{ width: `${i.progress}%` }} />}
      </div>
      {i.handed_in && (
        <div className="du-hand-in small">
          <CircleCheck size={15} /> Handed in for review
        </div>
      )}

      {editing ? (
        <div className="du-edit stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            <input
              className="range du-range grow"
              type="range"
              min={0}
              max={100}
              step={5}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              aria-label={`How far ${i.task_title} has got`}
              style={{ ["--pct" as string]: `${pct}%` }}
            />
            <b className="du-pct" style={{ color: progressTone(pct) }}>
              {pct}%
            </b>
          </div>
          <div className="du-quick">
            {QUICK.map((q) => (
              <button key={q} type="button" className={q === pct ? "on" : ""} onClick={() => setPct(q)}>
                {q === 100 ? "Done" : `${q}%`}
              </button>
            ))}
          </div>
          {pct === 100 && !i.handed_in && (
            <div className="du-hand-in small">
              <CircleCheck size={15} /> Goes in for review when you save.
            </div>
          )}
          <textarea
            className="textarea"
            rows={rowsFor(note)}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was done on it"
            maxLength={1000}
            aria-label="Note"
          />
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setPct(i.progress);
                setNote(i.note ?? "");
                setEditing(false);
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="button" className="btn small primary" onClick={() => void save(pct, note)} disabled={busy}>
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {i.note && <p className="du-note">{i.note}</p>}
          {(canEdit || editor) && (
            <div className="du-item-foot">
              {editor && i.edited_at && (
                <span className="faint tiny">
                  Changed by {editor.short_name}, {timeAgo(i.edited_at)}
                </span>
              )}
              <span className="spacer" />
              {canEdit && (
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => {
                    setPct(i.progress);
                    setNote(i.note ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil /> Change
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
