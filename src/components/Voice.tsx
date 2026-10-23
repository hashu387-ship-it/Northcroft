// Voice note pieces: the recording bar, the player (waveform, play/pause, time) and the
// English text underneath, which arrives a few seconds after the note is sent.
import "@/styles/voice.css";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Pause, Pencil, Play, RotateCcw, SendHorizontal, Square, Trash2 } from "lucide-react";
import { signedUrl } from "@/lib/files";
import { errorMessage, supabase } from "@/lib/supabase";
import type { TranscriptStatus } from "@/lib/types";
import { fmtSeconds } from "@/lib/voice";
import { useToast } from "./ui";

/* ---------------------------------------------------------------- recording bar */
export function RecorderBar({
  elapsed,
  maxSeconds,
  bars,
  onCancel,
  onFinish,
  finishLabel = "Send voice note",
  finishIcon = "send",
}: {
  elapsed: number;
  maxSeconds: number;
  bars: number[];
  onCancel: () => void;
  onFinish: () => void;
  finishLabel?: string;
  finishIcon?: "send" | "stop";
}) {
  const left = maxSeconds - elapsed;
  return (
    <div className="rec-bar" role="status" aria-live="polite">
      <button type="button" className="icon-btn plain rec-cancel" onClick={onCancel} aria-label="Cancel recording">
        <Trash2 />
      </button>
      <span className="rec-dot" aria-hidden />
      <span className="rec-time num">{fmtSeconds(elapsed)}</span>
      <span className="rec-live" aria-hidden>
        {Array.from({ length: 36 }, (_, i) => {
          const v = bars[bars.length - 36 + i] ?? 0;
          return <i key={i} style={{ height: `${Math.max(10, Math.round(v * 100))}%` }} />;
        })}
      </span>
      {left <= 30 && <span className="rec-left num">{fmtSeconds(left)} left</span>}
      <button type="button" className="icon-btn rec-send" onClick={onFinish} aria-label={finishLabel} title={finishLabel}>
        {finishIcon === "send" ? <SendHorizontal /> : <Square fill="currentColor" />}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- waveform player */
function fallbackPeaks(seed: string, n = 44) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) | 0;
    return 18 + Math.abs(h % 70) * (0.55 + 0.45 * Math.sin((i / n) * Math.PI));
  });
}

/**
 * Plays a voice note. `src` is a ready URL (a fresh recording); `path` is a stored note,
 * fetched with a short-lived signed link on first play.
 */
export function VoicePlayer({
  path,
  src,
  seconds,
  peaks,
  seed,
}: {
  path?: string | null;
  src?: string | null;
  seconds: number | null;
  peaks: number[] | null;
  seed: string;
}) {
  const toast = useToast();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(seconds ?? 0);
  const bars = useMemo(() => (peaks?.length ? peaks : fallbackPeaks(seed)), [peaks, seed]);

  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );

  async function ensureAudio() {
    if (audio.current) return audio.current;
    const url = src ?? (path ? await signedUrl(path) : null);
    if (!url) throw new Error("This voice note isn't available.");
    const a = new Audio(url);
    a.preload = "auto";
    a.ontimeupdate = () => setPos(a.currentTime);
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) setDur(a.duration);
    };
    a.onended = () => {
      setPlaying(false);
      setPos(0);
    };
    a.onpause = () => setPlaying(false);
    a.onplay = () => setPlaying(true);
    audio.current = a;
    return a;
  }

  async function toggle() {
    try {
      setLoading(true);
      const a = await ensureAudio();
      if (a.paused) {
        // Only one voice note plays at a time.
        document.dispatchEvent(new CustomEvent("voice-play", { detail: a }));
        await a.play();
      } else a.pause();
    } catch (e) {
      toast(errorMessage(e) || "Couldn't play this voice note", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onOther = (e: Event) => {
      const other = (e as CustomEvent<HTMLAudioElement>).detail;
      if (audio.current && other !== audio.current) audio.current.pause();
    };
    document.addEventListener("voice-play", onOther);
    return () => document.removeEventListener("voice-play", onOther);
  }, []);

  async function seek(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    try {
      const a = await ensureAudio();
      const total = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : dur;
      a.currentTime = f * total;
      setPos(a.currentTime);
    } catch {
      /* ignore */
    }
  }

  const progress = dur ? Math.min(1, pos / dur) : 0;
  return (
    <div className={clsx("voice", playing && "is-playing")}>
      <button type="button" className="vplay" onClick={toggle} aria-label={playing ? "Pause voice note" : "Play voice note"} disabled={loading}>
        {loading ? <span className="vspin" /> : playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
      <div className="vwave" onClick={seek} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)} tabIndex={-1}>
        {bars.map((h, i) => (
          <i key={i} className={i / bars.length < progress ? "on" : undefined} style={{ height: `${Math.max(12, h)}%` }} />
        ))}
      </div>
      <span className="vtime num">{fmtSeconds(playing || pos > 0 ? pos : dur)}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- the English text */
export function Transcript({
  kind,
  id,
  text,
  status,
  canEdit,
}: {
  kind: "comment" | "announcement";
  id: string;
  text: string | null;
  status: TranscriptStatus | null;
  canEdit: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [busy, setBusy] = useState(false);
  const table = kind === "comment" ? "comments" : "announcements";

  useEffect(() => setDraft(text ?? ""), [text]);

  async function save() {
    setBusy(true);
    try {
      const { error } = await supabase.from(table).update({ transcript: draft.trim() || null, transcript_status: "done" }).eq("id", id);
      if (error) throw error;
      setEditing(false);
      await qc.invalidateQueries({ queryKey: [table] });
      toast("Text updated");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("retry_transcript", { p_kind: kind, p_id: id });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: [table] });
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="vtext editing">
        <textarea className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus aria-label="Voice note text" />
        <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
          <button type="button" className="btn small" onClick={() => (setEditing(false), setDraft(text ?? ""))}>
            Cancel
          </button>
          <button type="button" className="btn small primary" onClick={save} disabled={busy}>
            Save text
          </button>
        </div>
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div className="vtext pending" aria-live="polite">
        <span className="vdots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        Writing it out...
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="vtext muted">
        Couldn't write this one out.
        {canEdit && (
          <button type="button" className="vlink" onClick={retry} disabled={busy}>
            <RotateCcw size={12} /> Try again
          </button>
        )}
      </div>
    );
  }
  if (status === "off") {
    return (
      <div className="vtext muted">
        Voice-to-text isn't switched on yet.
        {canEdit && (
          <button type="button" className="vlink" onClick={retry} disabled={busy}>
            <RotateCcw size={12} /> Try now
          </button>
        )}
      </div>
    );
  }
  if (status === "done") {
    return (
      <div className="vtext">
        {text ? <span className="vwords">{text}</span> : <span className="muted">No words picked up.</span>}
        {canEdit && (
          <button type="button" className="vlink" onClick={() => setEditing(true)} aria-label="Correct the text">
            <Pencil size={12} /> Edit
          </button>
        )}
      </div>
    );
  }
  return null;
}

/** A stored voice note with its text: used in chats, comments and announcements. */
export function VoiceNote({
  kind,
  id,
  path,
  seconds,
  peaks,
  transcript,
  status,
  canEdit,
}: {
  kind: "comment" | "announcement";
  id: string;
  path: string;
  seconds: number | null;
  peaks: number[] | null;
  transcript: string | null;
  status: TranscriptStatus | null;
  canEdit: boolean;
}) {
  return (
    <div className="voice-note">
      <VoicePlayer path={path} seconds={seconds} peaks={peaks} seed={id} />
      <Transcript kind={kind} id={id} text={transcript} status={status} canEdit={canEdit} />
    </div>
  );
}
