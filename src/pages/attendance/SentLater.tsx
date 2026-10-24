import { CloudUpload } from "lucide-react";
import { fmtDate, fmtTime12, todayISO, dateOf } from "@/lib/time";

/**
 * A check-in or check-out made with no signal and sent later. The time shown is the phone's own
 * time, so managers get a small mark, with when it actually arrived on hover or tap.
 */
export function SentLater({ receivedAt, compact }: { receivedAt: string | null | undefined; compact?: boolean }) {
  const arrived = receivedAt
    ? `${dateOf(receivedAt) === todayISO() ? "" : `${fmtDate(dateOf(receivedAt), { day: "numeric", month: "short" })}, `}${fmtTime12(receivedAt)}`
    : null;
  const title = arrived ? `Made with no signal and sent later. It arrived at ${arrived}.` : "Made with no signal and sent later.";
  return (
    <button
      type="button"
      className="pill gray sent-later"
      title={title}
      aria-label={title}
      onClick={(e) => {
        // On a phone there's no hover: a tap shows when it arrived.
        e.stopPropagation();
        const el = e.currentTarget;
        el.classList.toggle("open");
      }}
    >
      <CloudUpload />
      {compact ? "Later" : "Sent later"}
      {arrived && <span className="sent-later-when">, arrived {arrived}</span>}
    </button>
  );
}

/** For the monthly export: "Yes, arrived 24 Oct 10:41" or empty. */
export function sentLaterText(flag: boolean | null | undefined, receivedAt: string | null | undefined): string {
  if (!flag) return "";
  if (!receivedAt) return "Yes";
  return `Yes, arrived ${fmtDate(dateOf(receivedAt), { day: "numeric", month: "short" })} ${fmtTime12(receivedAt)}`;
}
