// The Catch up panel: a short summary of a chat, the inbox or a task, made by Claude when opened.
// Shows a shimmer while it's writing, then the headline, what happened, and what's waiting on you.
import { useEffect, useState } from "react";
import { CircleAlert, RotateCcw, Sparkles } from "lucide-react";
import { Sheet } from "./Sheet";
import { catchUp, type CatchUpResult, type CatchUpTarget } from "@/lib/catchup";
import { timeAgo } from "@/lib/time";

export function CatchUpSheet({ target, onClose }: { target: CatchUpTarget | null; onClose: () => void }) {
  const [state, setState] = useState<{ result?: CatchUpResult; error?: string; loading: boolean }>({ loading: false });
  const [attempt, setAttempt] = useState(0);
  const key = target ? (target.kind === "chat" ? target.chat : target.kind === "task" ? target.id : "inbox") : null;

  useEffect(() => {
    if (!target) return;
    let live = true;
    setState({ loading: true });
    catchUp(target)
      .then((result) => live && setState({ result, loading: false }))
      .catch((e: Error) => live && setState({ error: e.message, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const title = !target ? "" : target.kind === "inbox" ? "Your inbox" : target.title;
  const r = state.result;
  return (
    <Sheet open={!!target} onClose={onClose} title={<span className="cu-title"><Sparkles /> Catch up</span>}>
      <div className="catchup">
        <div className="cu-what">{title}</div>
        {state.loading && (
          <div className="cu-loading" aria-label="Writing the summary">
            <span className="skeleton" style={{ width: "92%" }} />
            <span className="skeleton" style={{ width: "78%" }} />
            <span className="skeleton" style={{ width: "85%" }} />
            <span className="skeleton" style={{ width: "60%" }} />
            <small>Reading {target?.kind === "inbox" ? "your notifications" : "the messages"}…</small>
          </div>
        )}
        {state.error && (
          <div className="cu-error">
            <CircleAlert />
            <p>{state.error}</p>
            <button type="button" className="btn small" onClick={() => setAttempt((n) => n + 1)}>
              <RotateCcw /> Try again
            </button>
          </div>
        )}
        {r && (
          <>
            <p className="cu-headline">{r.headline}</p>
            {r.forYou.length > 0 && (
              <div className="group cu-for-you">
                <div className="cu-label">For you</div>
                <ul>
                  {r.forYou.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {r.points.length > 0 && (
              <ul className="cu-points">
                {r.points.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            )}
            <div className="cu-foot">
              {r.since ? `${r.count} new since you last looked, ${timeAgo(r.since)}.` : r.count ? `From the latest ${r.count}.` : ""} Written by Claude, so check anything important.
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
