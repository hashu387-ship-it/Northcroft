// Voice notes: record from the microphone, keep a small waveform, upload to the private files bucket.
// The database then asks the transcribe function to write the note out in English.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export const MAX_VOICE_SECONDS = 180;
const BUCKET = "files";
const PEAK_COUNT = 44;

/** Prefer MP4/AAC: it plays on iPhone and Android alike. WebM is the fallback (older Chrome, Firefox). */
export function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const options = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
}

export function extFor(mime: string) {
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

export function canRecord() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

/** 42 -> "0:42" */
export function fmtSeconds(s: number | null | undefined) {
  const t = Math.max(0, Math.round(s ?? 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** What a voice-only message says in notifications: "Voice note, 0:42". */
export function voiceLabel(s: number) {
  return `Voice note, ${fmtSeconds(s)}`;
}

/** Squash the level samples into a fixed number of waveform bars (6 to 100). */
function toPeaks(levels: number[], n = PEAK_COUNT): number[] {
  if (!levels.length) return Array(n).fill(10);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * levels.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
    out.push(Math.max(...levels.slice(a, b)));
  }
  const max = Math.max(...out, 0.01);
  return out.map((v) => Math.max(6, Math.round((v / max) * 100)));
}

export interface Recording {
  blob: Blob;
  mime: string;
  seconds: number;
  peaks: number[];
}

export async function uploadVoice(rec: Recording, userId: string): Promise<string> {
  const path = `voice/${userId}/${crypto.randomUUID()}.${extFor(rec.mime)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, rec.blob, { contentType: rec.mime, upsert: false });
  if (error) throw error;
  return path;
}

type RecState = "idle" | "starting" | "recording";

interface Internals {
  stream?: MediaStream;
  rec?: MediaRecorder;
  ctx?: AudioContext;
  raf?: number;
  timer?: number;
  chunks: Blob[];
  levels: number[];
  started: number;
  mime: string;
  cancelled: boolean;
}

/**
 * Microphone recorder. `onDone` gets the finished recording when you stop or when it reaches
 * the time limit; `cancel` throws the recording away.
 */
export function useRecorder({ onDone, maxSeconds = MAX_VOICE_SECONDS }: { onDone: (r: Recording) => void; maxSeconds?: number }) {
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const done = useRef(onDone);
  done.current = onDone;
  const r = useRef<Internals>({ chunks: [], levels: [], started: 0, mime: "", cancelled: false });

  const release = useCallback(() => {
    const x = r.current;
    if (x.raf) cancelAnimationFrame(x.raf);
    if (x.timer) window.clearInterval(x.timer);
    x.stream?.getTracks().forEach((t) => t.stop());
    x.ctx?.close().catch(() => {});
    x.raf = undefined;
    x.timer = undefined;
    x.stream = undefined;
    x.ctx = undefined;
    x.rec = undefined;
  }, []);

  // Stop the microphone if the screen is left mid-recording.
  useEffect(
    () => () => {
      r.current.cancelled = true;
      if (r.current.rec?.state === "recording") r.current.rec.stop();
      release();
    },
    [release],
  );

  const start = useCallback(async () => {
    if (!canRecord()) throw new Error("This browser can't record audio. Try Chrome or Safari.");
    if (state !== "idle") return;
    setState("starting");
    const x = r.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      x.stream = stream;
      x.rec = rec;
      x.chunks = [];
      x.levels = [];
      x.cancelled = false;
      x.mime = (rec.mimeType || mime || "audio/webm").split(";")[0];

      rec.ondataavailable = (e) => {
        if (e.data.size) x.chunks.push(e.data);
      };
      rec.onstop = () => {
        const seconds = Math.min(maxSeconds, (performance.now() - x.started) / 1000);
        const blob = new Blob(x.chunks, { type: x.mime });
        const keep = !x.cancelled && blob.size > 0 && seconds >= 0.6;
        const peaks = toPeaks(x.levels);
        release();
        setState("idle");
        setBars([]);
        if (keep) done.current({ blob, mime: x.mime, seconds, peaks });
      };

      // Live level meter (optional: recording works without it).
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        x.ctx = ctx;
        void ctx.resume?.();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        let last = 0;
        const tick = (now: number) => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const level = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
          if (now - last > 90) {
            last = now;
            x.levels.push(level);
            setBars((b) => [...b.slice(-35), level]);
          }
          x.raf = requestAnimationFrame(tick);
        };
        x.raf = requestAnimationFrame(tick);
      } catch {
        /* no meter on this device */
      }

      rec.start(250);
      x.started = performance.now();
      setElapsed(0);
      setBars([]);
      x.timer = window.setInterval(() => {
        const s = (performance.now() - x.started) / 1000;
        setElapsed(s);
        if (s >= maxSeconds && rec.state === "recording") rec.stop();
      }, 200);
      setState("recording");
    } catch (e) {
      release();
      setState("idle");
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new Error("Microphone access is blocked. Allow the microphone for this app in your phone or browser settings.");
      }
      if (name === "NotFoundError") throw new Error("No microphone was found on this device.");
      throw e;
    }
  }, [state, maxSeconds, release]);

  const stop = useCallback(() => {
    const rec = r.current.rec;
    if (rec && rec.state === "recording") rec.stop();
  }, []);

  const cancel = useCallback(() => {
    r.current.cancelled = true;
    const rec = r.current.rec;
    if (rec && rec.state === "recording") rec.stop();
    else {
      release();
      setState("idle");
    }
  }, [release]);

  return { state, elapsed, bars, maxSeconds, start, stop, cancel };
}
