// What's blocking someone in their daily update, and the replies under it. The person and managers
// and seniors see them and can reply; a reply tells the person, and the person's reply tells whoever
// replied. A reply from a manager or senior clears the block: the Blocked tag goes and the blocker
// stays, marked "Sorted by Hassan". The person's own reply doesn't clear it.
import { useState } from "react";
import { CircleAlert, CircleCheck, SendHorizontal } from "lucide-react";
import { useInvalidate, usePeople } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { isBlocked, replyToBlocker, type UpdateWithItems } from "@/lib/dailyUpdates";
import { errorMessage } from "@/lib/supabase";
import { timeAgo } from "@/lib/time";
import { Avatar, useToast } from "@/components/ui";

/** The "Blocking" box: orange while it's blocking, green once a manager or senior has replied. */
export function BlockerBlock({ update }: { update: UpdateWithItems }) {
  const me = useMe();
  const people = usePeople();
  if (!update.blockers) return null;
  const sorted = !isBlocked(update);
  const by = update.blocker_cleared_by ? people.get(update.blocker_cleared_by) : undefined;
  return (
    <div className={`du-block ${sorted ? "du-sorted" : "du-blocked"}`}>
      <span className="field-label">
        {sorted ? (
          <>
            <CircleCheck size={14} /> Was blocking
          </>
        ) : (
          <>
            <CircleAlert size={14} /> Blocking
          </>
        )}
      </span>
      <p className="du-note">{update.blockers}</p>
      {sorted && update.blocker_cleared_at && (
        <span className="du-sorted-by small">
          Sorted by {by?.id === me.id ? "you" : by?.short_name ?? "a manager"}, {timeAgo(update.blocker_cleared_at)}
        </span>
      )}
      <BlockerThread update={update} />
    </div>
  );
}

export function BlockerThread({ update }: { update: UpdateWithItems }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const replies = update.replies ?? [];
  const mine = update.user_id === me.id;
  const canReply = mine || canAssign;
  const owner = people.get(update.user_id);
  // A reply from a manager or senior to a blocker nobody has cleared yet clears it.
  const clears = !mine && isBlocked(update);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await replyToBlocker(update.id, me.id, body);
      setText("");
      toast(
        mine
          ? "Reply sent"
          : clears
            ? `Reply sent and the block is cleared. ${owner?.short_name ?? "They"} has been told.`
            : `Reply sent. ${owner?.short_name ?? "They"} has been told.`,
      );
      await invalidate("daily_updates");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (!replies.length && !canReply) return null;
  return (
    <div className="du-replies">
      {replies.map((r) => {
        const who = people.get(r.author_id);
        return (
          <div className="du-reply" key={r.id}>
            <Avatar person={who} size={24} />
            <div className="du-reply-body">
              <span className="small">
                <b>{r.author_id === me.id ? "You" : who?.short_name ?? "Former team member"}</b>
                <span className="faint"> · {timeAgo(r.created_at)}</span>
              </span>
              <p className="du-note">{r.body}</p>
            </div>
          </div>
        );
      })}
      {canReply && (
        <form
          className="du-reply-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            className="textarea"
            rows={text.length > 70 || text.includes("\n") ? 3 : 1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={mine ? "Reply" : clears ? `Reply to ${owner?.short_name ?? "them"} (clears the block)` : `Reply to ${owner?.short_name ?? "them"}`}
            maxLength={2000}
            aria-label="Reply to what's blocking"
          />
          <button className="btn small primary" type="submit" disabled={busy || !text.trim()} aria-label="Send reply">
            <SendHorizontal /> Reply
          </button>
        </form>
      )}
    </div>
  );
}
