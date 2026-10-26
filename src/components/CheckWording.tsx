// The "Check wording" button. It suggests the same text with AI-sounding words and patterns taken
// out (leverage, seamless, "it's worth noting", "not X, it's Y", padded openers, long dashes) and
// spelling fixed, keeping the writer's voice, names, amounts, dates and references. The suggestion
// opens in a sheet with what changed; "Use this" puts it in the box, "Keep mine" leaves it as it was.
import { useState } from "react";
import clsx from "clsx";
import { SpellCheck } from "lucide-react";
import { checkWording, WORDING_MAX, WORDING_MIN, type WordingKind, type WordingResult } from "@/lib/wording";
import { Sheet, useToast } from "./ui";

export function CheckWording({
  value,
  onUse,
  kind,
  compact,
  className,
}: {
  value: string;
  onUse: (text: string) => void;
  kind: WordingKind;
  /** Icon only, for the message box in chats and comments. */
  compact?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(WordingResult & { from: string }) | null>(null);
  const ready = value.trim().length >= WORDING_MIN;

  async function run() {
    if (busy || !ready) return;
    if (value.length > WORDING_MAX) {
      toast(`That's too long to check in one go (over ${WORDING_MAX.toLocaleString("en-US")} characters). Try a shorter part.`, "error");
      return;
    }
    setBusy(true);
    try {
      const r = await checkWording(value, kind);
      if (r.unchanged || r.text.trim() === value.trim()) toast("Reads well. Nothing to change.");
      else setResult({ ...r, from: value });
    } catch (e) {
      toast(e instanceof Error ? e.message : "The wording check didn't answer. Try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  const label = busy ? "Checking..." : "Check wording";
  return (
    <>
      {compact ? (
        <button
          type="button"
          className={clsx("icon-btn plain check-wording", busy && "busy", className)}
          onClick={(e) => {
            e.preventDefault();
            void run();
          }}
          disabled={busy || !ready}
          aria-label={label}
          title={label}
        >
          {busy ? <span className="wording-spin" /> : <SpellCheck />}
        </button>
      ) : (
        <div className={clsx("check-wording-row", className)}>
          <button
            type="button"
            className="btn small ghost check-wording"
            onClick={(e) => {
              e.preventDefault();
              void run();
            }}
            disabled={busy || !ready}
            title={ready ? "Tidy the wording so it reads plainly" : "Write a little more first"}
          >
            {busy ? <span className="wording-spin" /> : <SpellCheck />} {label}
          </button>
        </div>
      )}

      <Sheet
        open={!!result}
        onClose={() => setResult(null)}
        title="Suggested wording"
        footer={
          <>
            <button className="btn" type="button" onClick={() => setResult(null)}>
              Keep mine
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                if (result) onUse(result.text);
                setResult(null);
              }}
            >
              Use this
            </button>
          </>
        }
      >
        {result && (
          <div className="stack wording-result" style={{ gap: 12 }}>
            <div className="wording-text solid">{result.text}</div>
            {result.changes.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <b className="small">What changed</b>
                <ul className="wording-changes small muted">
                  {result.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.from !== value && <p className="tiny faint">You changed your text while it was being checked. Use this replaces it with the suggestion.</p>}
          </div>
        )}
      </Sheet>
    </>
  );
}
