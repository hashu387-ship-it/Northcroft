// The slim bar at the top of a chat with its pinned messages (up to 3). Tapping it goes to the message
// shown and moves on to the next one, like WhatsApp.
import { useEffect, useState } from "react";
import clsx from "clsx";
import { Mic, Pin, PinOff } from "lucide-react";
import { usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import type { ChatPin, Comment } from "@/lib/types";

export function PinnedBar({
  pins,
  canUnpin,
  onJump,
  onUnpin,
}: {
  pins: { pin: ChatPin; comment: Comment }[];
  canUnpin: boolean;
  onJump: (id: string) => void;
  onUnpin: (id: string) => void;
}) {
  const me = useMe();
  const people = usePeople();
  const [idx, setIdx] = useState(0);
  const n = pins.length;
  const key = pins.map((p) => p.pin.comment_id).join(",");
  // A new pin shows first.
  useEffect(() => setIdx(0), [key]);
  if (!n) return null;
  const cur = pins[Math.min(idx, n - 1)];
  const by = cur.pin.pinned_by === me.id ? "you" : people.get(cur.pin.pinned_by)?.short_name ?? "someone";
  const text = cur.comment.voice_path ? cur.comment.transcript || "Voice note" : cur.comment.body.replace(/\s+/g, " ").trim();

  return (
    <div className="pin-bar glass-strong">
      {n > 1 && (
        <span className="pin-ticks" aria-hidden>
          {pins.map((p, i) => (
            <i key={p.pin.comment_id} className={clsx(i === idx && "on")} />
          ))}
        </span>
      )}
      <button
        type="button"
        className="pin-main"
        onClick={() => {
          onJump(cur.comment.id);
          setIdx((i) => (i + 1) % n);
        }}
        aria-label={`Pinned message${n > 1 ? ` ${idx + 1} of ${n}` : ""}, pinned by ${by}: ${text}. Go to it`}
      >
        <Pin className="pin-icon" aria-hidden />
        <span className="grow">
          <b>
            Pinned by {by}
            {n > 1 ? ` · ${idx + 1} of ${n}` : ""}
          </b>
          <span className="pin-text">
            {cur.comment.voice_path && <Mic aria-hidden />}
            {text}
          </span>
        </span>
      </button>
      {canUnpin && (
        <button type="button" className="icon-btn small plain" onClick={() => onUnpin(cur.comment.id)} aria-label="Unpin this message" title="Unpin">
          <PinOff />
        </button>
      )}
    </div>
  );
}
