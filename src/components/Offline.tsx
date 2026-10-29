// Working without signal: the "No signal" bar, the background sender for the outbox, and the
// messages waiting to go in a chat.
import "@/styles/offline.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Clock3, FileText, Mic, RotateCcw, Trash2, Wifi, WifiOff } from "lucide-react";
import clsx from "clsx";
import { useOnline, warmScreens } from "@/lib/offline";
import { onDelivered, removeItem, resetStuck, retryItem, runOutbox, usePendingMessages, type OutboxMessage } from "@/lib/outbox";
import { pendingShare } from "@/lib/share";
import { supabase } from "@/lib/supabase";
import { fmtTime12 } from "@/lib/time";
import { voiceLabel } from "@/lib/voice";
import { useToast } from "./ui";

/** A slim bar under the top bar while there's no signal, and a moment of "Back online" after. */
export function OfflineBar() {
  const online = useOnline();
  const [shown, setShown] = useState<"off" | "back" | null>(online ? null : "off");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!online) {
      setShown("off");
      return;
    }
    setShown((s) => (s === "off" ? "back" : s));
    const t = window.setTimeout(() => setShown((s) => (s === "back" ? null : s)), 2600);
    return () => window.clearTimeout(t);
  }, [online]);

  // Full-height screens (Chats) make room for the bar.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!shown || !el) {
      root.classList.remove("nc-offline");
      root.style.removeProperty("--nc-offline-h");
      return;
    }
    root.classList.add("nc-offline");
    const set = () => root.style.setProperty("--nc-offline-h", `${el.offsetHeight + 8}px`);
    set();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.classList.remove("nc-offline");
      root.style.removeProperty("--nc-offline-h");
    };
  }, [shown]);

  if (!shown) return null;
  return (
    <div ref={ref} className={clsx("offline-bar", shown === "back" && "back")} role="status" aria-live="polite">
      {shown === "off" ? <WifiOff /> : <Wifi />}
      <span>{shown === "off" ? "No signal. You're seeing what was saved, and anything you send goes out when you're back online." : "Back online"}</span>
    </div>
  );
}

/**
 * Sends what's waiting in the outbox: when the app opens, when signal comes back, when the app
 * comes back to the front, and every 30 seconds while something is waiting. Also refreshes the
 * screens once the phone is back online, and picks up something shared into the app.
 */
export function OutboxRunner({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const run = () => void runOutbox(userId);
    resetStuck(userId).then(() => alive && run());

    const onOnline = async () => {
      // Renew the sign-in first (it may have run out while there was no signal), then send and refresh.
      await supabase.auth.getSession().catch(() => null);
      if (!alive) return;
      run();
      void qc.invalidateQueries();
    };
    const onShow = () => document.visibilityState === "visible" && run();
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onShow);
    const timer = window.setInterval(run, 30_000);

    const offDelivered = onDelivered(({ item }) => {
      if (item.kind === "message") void Promise.all(["comments", "attachments", "chats", "drive_links"].map((t) => qc.invalidateQueries({ queryKey: [t] })));
      else {
        void qc.invalidateQueries({ queryKey: ["attendance"] });
        toast(`Your ${item.entry === "in" ? "check-in" : "check-out"} from ${fmtTime12(item.at)} has been sent.`);
      }
    });

    // Fetch every screen's code once per version, so any screen opens with no signal.
    const idle = (window as Window & { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    const warm = () => void warmScreens();
    const warmTimer = window.setTimeout(() => (idle ? idle(warm) : warm()), 4000);

    return () => {
      alive = false;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onShow);
      window.clearInterval(timer);
      window.clearTimeout(warmTimer);
      offDelivered();
    };
  }, [userId, qc, toast]);

  // Something shared into the app before signing in: carry on with it.
  useEffect(() => {
    if (location.pathname === "/share") return;
    let alive = true;
    pendingShare().then((s) => alive && s && navigate("/share"));
    return () => {
      alive = false;
    };
    // Only when the app first opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/** Messages in this chat still waiting to go: shown at the end, with a clock instead of a tick. */
export function PendingMessages({ userId, chat, hide }: { userId: string; chat: string; hide: string[] }) {
  // Once a message is posted and has loaded in the chat, the real one shows instead (unless one of
  // its files still failed to go).
  const visible = usePendingMessages(userId, chat).filter((m) => m.status === "failed" || !m.inserted || !hide.includes(m.id));
  const ref = useRef<HTMLDivElement>(null);
  const count = visible.length;
  const last = useRef(0);
  // A new message waiting to go scrolls into view, like one that's sent.
  useEffect(() => {
    if (count > last.current) {
      const list = ref.current?.closest<HTMLElement>(".thread");
      if (list) list.scrollTop = list.scrollHeight;
    }
    last.current = count;
  }, [count]);
  if (!count) return null;
  return (
    <div ref={ref} style={{ display: "contents" }}>
      {visible.map((m) => (
        <PendingBubble key={m.id} m={m} />
      ))}
    </div>
  );
}

function PendingBubble({ m }: { m: OutboxMessage }) {
  const failed = m.status === "failed";
  const [open, setOpen] = useState(false);
  const files = m.files ?? [];
  return (
    <div className={clsx("msg mine pending-msg", failed && "failed")} data-pending={m.id}>
      <div className="bubble">
        {m.voice ? (
          <div className="pending-voice">
            <Mic size={16} /> {voiceLabel(m.voice.seconds)}
          </div>
        ) : (
          !m.inserted && <div className="pending-text">{m.row.body}</div>
        )}
        {files.length > 0 && (
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>
            {files.map((f, i) => (
              <div key={i} className="pending-file">
                <FileText size={14} /> <span className="ellipsis">{f.name}</span>
              </div>
            ))}
          </div>
        )}
        {(m.links ?? []).length > 0 && !m.linksDone && (
          <div className="pending-file">
            <FileText size={14} /> <span className="ellipsis">{m.links!.map((l) => l.title).join(", ")}</span>
          </div>
        )}
        <div className="when row" style={{ gap: 6 }}>
          <span>{fmtTime12(m.createdAt)}</span>
          {failed ? (
            <button type="button" className="pending-state failed" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              <CircleAlert size={14} /> Not sent
            </button>
          ) : (
            <span className="pending-state" title={m.status === "sending" ? "Sending" : "Waiting for signal"} aria-label={m.status === "sending" ? "Sending" : "Waiting for signal"}>
              <Clock3 size={13} />
            </span>
          )}
        </div>
        {failed && (
          <div className="pending-fail">
            <span>{m.error || "It couldn't be sent."}</span>
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn small" onClick={() => void retryItem(m.id)}>
                <RotateCcw /> Try again
              </button>
              <button type="button" className="btn small ghost" onClick={() => void removeItem(m.id)}>
                <Trash2 /> Remove
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The thread key the outbox files a message under. */
export function outboxChat(scope: { kind: string; taskId?: string; projectId?: string | null; conversationId?: string; submissionId?: string }): string {
  if (scope.kind === "task") return `task:${scope.taskId}`;
  if (scope.kind === "submission") return `submission:${scope.submissionId}`;
  if (scope.kind === "project") return `project:${scope.projectId}`;
  if (scope.kind === "conversation") return `conv:${scope.conversationId}`;
  return "team";
}
