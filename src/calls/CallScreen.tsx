// The call screen, shown over everything while a call rings, connects or runs, and for a moment
// after it ends. Also starts the listener for incoming calls (CallHost, in the app shell).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import clsx from "clsx";
import { Bluetooth, Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react";
import { usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/supabase";
import { isNativeApp } from "@/native/platform";
import { Avatar, useToast } from "@/components/ui";
import { calls, type CallState } from "./engine";
import "@/styles/calls.css";

export function useCall(): CallState {
  return useSyncExternalStore(calls.subscribe, calls.get, calls.get);
}

/** Starts a voice call, with a message if it can't. */
export function useStartCall() {
  const toast = useToast();
  return async (peerId: string) => {
    try {
      await calls.call(peerId);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function CallHost() {
  const me = useMe();
  useEffect(() => {
    calls.start(me.id);
    return () => calls.stop();
  }, [me.id]);
  return <CallScreen />;
}

function CallScreen() {
  const s = useCall();
  const people = usePeople();
  const toast = useToast();
  const peer = people.get(s.peerId);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (s.phase !== "active") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [s.phase]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.srcObject !== s.remote) el.srcObject = s.remote;
    if (s.remote) void el.play().catch(() => undefined);
  }, [s.remote]);

  if (s.phase === "idle") return null;

  const name = peer?.short_name ?? "Team member";
  const status =
    s.phase === "incoming"
      ? "Northcroft voice call"
      : s.phase === "outgoing"
        ? "Calling…"
        : s.phase === "connecting"
          ? "Connecting…"
          : s.phase === "active"
            ? clock(now - (s.connectedAt ?? now))
            : s.note ?? "Call ended";

  const run = (fn: () => Promise<unknown> | void) => async () => {
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  return (
    <div className={clsx("call-screen", `call-${s.phase}`)} role="dialog" aria-modal="true" aria-label={`Voice call with ${name}`}>
      <audio ref={audioRef} autoPlay playsInline />
      <div className="call-glow" aria-hidden="true" />
      <div className="call-top">
        <div className={clsx("call-avatar", (s.phase === "incoming" || s.phase === "outgoing") && "ringing")}>
          <Avatar person={peer} size={112} />
        </div>
        <div className="call-name">{name}</div>
        {peer?.title && s.phase !== "ended" && <div className="call-title">{peer.title}</div>}
        <div className="call-status num" aria-live="polite">
          {status}
        </div>
        {s.phase === "active" && s.route === "bluetooth" && (
          <div className="call-route">
            <Bluetooth size={14} /> Bluetooth
          </div>
        )}
      </div>

      {s.phase === "incoming" ? (
        <div className="call-actions two">
          <button type="button" className="call-btn end" onClick={run(() => calls.decline())} aria-label="Decline">
            <PhoneOff />
            <span>Decline</span>
          </button>
          <button type="button" className="call-btn answer" onClick={run(() => calls.answer())} aria-label="Answer">
            <Phone />
            <span>Answer</span>
          </button>
        </div>
      ) : s.phase === "ended" ? (
        <div className="call-actions one">
          <button type="button" className="call-btn plain" onClick={() => calls.dismiss()}>
            <span>Close</span>
          </button>
        </div>
      ) : (
        <div className="call-actions three">
          <button type="button" className={clsx("call-btn", s.muted && "on")} onClick={() => calls.toggleMute()} aria-pressed={s.muted} aria-label={s.muted ? "Unmute" : "Mute"}>
            {s.muted ? <MicOff /> : <Mic />}
            <span>{s.muted ? "Unmute" : "Mute"}</span>
          </button>
          <button type="button" className="call-btn end" onClick={run(() => calls.hangUp())} aria-label="End call">
            <PhoneOff />
            <span>End</span>
          </button>
          {isNativeApp() ? (
            <button type="button" className={clsx("call-btn", s.speaker && "on")} onClick={run(() => calls.toggleSpeaker())} aria-pressed={s.speaker} aria-label="Speaker">
              <Volume2 />
              <span>Speaker</span>
            </button>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
