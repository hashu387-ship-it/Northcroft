// Polls: the card people vote on (in a chat message or under an announcement), the votes list, and
// the form to start one.
import "@/styles/polls.css";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Circle, CircleCheck, ListChecks, Lock, Plus, Square, SquareCheck, X } from "lucide-react";
import { useInvalidate, usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { closePoll, createChatPoll, MAX_POLL_OPTIONS, pollProblem, votePoll, type PollWithVotes } from "@/lib/polls";
import { errorMessage } from "@/lib/supabase";
import { Avatar, Field, Sheet, Switch, useConfirm, useToast } from "./ui";

/* ---------------------------------------------------------------- the card */

export function PollCard({ pw, onDark }: { pw: PollWithVotes; /** Sits on a coloured bubble (your own message). */ onDark?: boolean }) {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const { poll, votes } = pw;
  const closed = !!poll.closed_at;
  const saved = votes.find((v) => v.user_id === me.id)?.choices ?? [];
  // What you just tapped shows straight away; the saved vote takes over once it's back.
  const [pending, setPending] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [showVotes, setShowVotes] = useState(false);
  const mine = pending ?? saved;
  const savedKey = saved.join(",");
  useEffect(() => setPending(null), [savedKey]);

  // Everyone else's votes as saved, plus yours as it stands now.
  const tally = votes.filter((v) => v.user_id !== me.id && v.choices.length > 0).map((v) => v.choices);
  if (mine.length) tally.push(mine);
  const voters = tally.length;
  const counts = poll.options.map((_, i) => tally.filter((c) => c.includes(i)).length);
  const canClose = !closed && (poll.created_by === me.id || me.role === "manager");

  async function toggle(i: number) {
    if (closed || busy) return;
    const next = poll.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i].sort((a, b) => a - b)) : mine.includes(i) ? [] : [i];
    setPending(next);
    setBusy(true);
    try {
      await votePoll(poll.id, next);
      await invalidate("poll_votes");
    } catch (e) {
      setPending(null);
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    const ok = await confirm({
      title: "Close this poll?",
      message: "Nobody can vote or change their vote after this. The results stay for everyone to see.",
      confirmLabel: "Close poll",
    });
    if (!ok) return;
    try {
      await closePoll(poll.id);
      await invalidate("polls");
      toast("Poll closed");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const top = Math.max(0, ...counts);
  return (
    <div className={clsx("poll-card", onDark && "on-dark", closed && "closed")}>
      <div className="poll-head">
        <ListChecks aria-hidden />
        <span>Poll</span>
        {closed && (
          <span className="poll-closed">
            <Lock aria-hidden /> Closed
          </span>
        )}
      </div>
      <div className="poll-q">{poll.question}</div>
      <div className="poll-sub">{closed ? "Voting has closed" : poll.multi ? "Choose one or more" : "Choose one"}</div>
      <div className="poll-opts" role="group" aria-label={poll.question}>
        {poll.options.map((o, i) => {
          const on = mine.includes(i);
          const pct = voters ? Math.round((counts[i] / voters) * 100) : 0;
          const lead = closed && counts[i] > 0 && counts[i] === top;
          const Mark = poll.multi ? (on ? SquareCheck : Square) : on ? CircleCheck : Circle;
          return (
            <button
              key={i}
              type="button"
              className={clsx("poll-opt", on && "on", lead && "lead")}
              onClick={() => toggle(i)}
              disabled={closed}
              aria-pressed={on}
              aria-label={`${o}: ${counts[i]} ${counts[i] === 1 ? "vote" : "votes"}${on ? ", your answer" : ""}`}
            >
              <span className="poll-fill" style={{ width: `${pct}%` }} aria-hidden />
              <Mark className="poll-mark" aria-hidden />
              <span className="poll-text">{o}</span>
              <span className="poll-count" aria-hidden>
                {counts[i]}
              </span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        <button type="button" className="poll-link" onClick={() => setShowVotes(true)} disabled={!voters}>
          {voters === 0 ? "No votes yet" : `${voters} ${voters === 1 ? "person" : "people"} voted · See who`}
        </button>
        {canClose && (
          <button type="button" className="poll-link" onClick={close}>
            Close poll
          </button>
        )}
      </div>

      <Sheet open={showVotes} onClose={() => setShowVotes(false)} title="Votes">
        <div className="stack" style={{ gap: 16 }}>
          <div className="bold">{poll.question}</div>
          {poll.options.map((o, i) => {
            const who = votes.filter((v) => v.choices.includes(i)).map((v) => v.user_id);
            return (
              <div key={i}>
                <div className="seen-head poll-votes-head">
                  <span className="ellipsis">{o}</span>
                  <span>
                    {who.length} {who.length === 1 ? "vote" : "votes"}
                  </span>
                </div>
                {who.length === 0 && <div className="faint small">Nobody yet.</div>}
                {who.map((id) => (
                  <div className="seen-row" key={id}>
                    <Avatar person={people.get(id)} size={30} />
                    <span className="grow">{id === me.id ? "You" : people.get(id)?.short_name ?? "Former team member"}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}

/* ---------------------------------------------------------------- the form */

export interface PollDraft {
  question: string;
  options: string[];
  multi: boolean;
}
export const emptyPoll = (): PollDraft => ({ question: "", options: ["", ""], multi: false });

/** The question, the answers (2 to 10) and "allow more than one answer". */
export function PollFields({ value, onChange, autoFocus }: { value: PollDraft; onChange: (v: PollDraft) => void; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusNext, setFocusNext] = useState<number | null>(null);
  useEffect(() => {
    if (focusNext === null) return;
    refs.current[focusNext]?.focus();
    setFocusNext(null);
  }, [focusNext]);
  const set = (patch: Partial<PollDraft>) => onChange({ ...value, ...patch });
  const setOption = (i: number, text: string) => set({ options: value.options.map((o, j) => (j === i ? text : o)) });
  const add = () => {
    if (value.options.length >= MAX_POLL_OPTIONS) return;
    set({ options: [...value.options, ""] });
    setFocusNext(value.options.length);
  };
  return (
    <div className="stack poll-fields" style={{ gap: 14 }}>
      <Field label="Question">
        <input
          className="input"
          value={value.question}
          onChange={(e) => set({ question: e.target.value })}
          maxLength={300}
          autoFocus={autoFocus}
          placeholder="What do you want to ask?"
        />
      </Field>
      <Field label="Answers" group>
        <div className="stack" style={{ gap: 8 }}>
          {value.options.map((o, i) => (
            <div className="row poll-answer" key={i}>
              <input
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="input"
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (i === value.options.length - 1) add();
                    else refs.current[i + 1]?.focus();
                  }
                }}
                maxLength={120}
                aria-label={`Answer ${i + 1}`}
                placeholder={`Answer ${i + 1}`}
              />
              {value.options.length > 2 && (
                <button
                  type="button"
                  className="icon-btn small plain"
                  onClick={() => set({ options: value.options.filter((_, j) => j !== i) })}
                  aria-label={`Remove answer ${i + 1}`}
                  title="Remove"
                >
                  <X />
                </button>
              )}
            </div>
          ))}
        </div>
        {value.options.length < MAX_POLL_OPTIONS ? (
          <button type="button" className="btn small" style={{ marginTop: 8, alignSelf: "flex-start" }} onClick={add}>
            <Plus /> Add an answer
          </button>
        ) : (
          <div className="faint tiny" style={{ marginTop: 6 }}>
            That's the most a poll can have.
          </div>
        )}
      </Field>
      <div className="row poll-multi">
        <div className="grow">
          <div className="bold">Allow more than one answer</div>
          <div className="muted small">People can pick several.</div>
        </div>
        <Switch checked={value.multi} onChange={(v) => set({ multi: v })} label="Allow more than one answer" />
      </div>
    </div>
  );
}

/** Start a poll in a chat. It goes out as a message, so everyone gets the usual notification. */
export function PollSheet({ open, onClose, chat }: { open: boolean; onClose: () => void; chat: string }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<PollDraft>(emptyPoll);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setDraft(emptyPoll());
  }, [open]);

  async function send() {
    const problem = pollProblem(draft.question, draft.options);
    if (problem) {
      toast(problem, "error");
      return;
    }
    setBusy(true);
    try {
      await createChatPoll(
        chat,
        draft.question.trim(),
        draft.options.map((o) => o.trim()).filter(Boolean),
        draft.multi,
      );
      await invalidate("comments", "polls", "chats");
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
      title="New poll"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={send} disabled={busy}>
            <ListChecks /> {busy ? "Sending..." : "Send poll"}
          </button>
        </>
      }
    >
      <PollFields value={draft} onChange={setDraft} autoFocus />
      <p className="faint tiny" style={{ margin: "14px 0 0" }}>
        Everyone in the chat can vote and see who voted for what. You can close the poll when you have your answer.
      </p>
    </Sheet>
  );
}
