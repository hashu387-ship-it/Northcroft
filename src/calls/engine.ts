// Northcroft voice calls, WhatsApp style, between two people in the team.
//
// How a call goes:
//   1. The caller taps Voice call. The app makes a row in public.calls ("ringing"); a database
//      trigger notifies the person called (their phone rings in the app if it's open, and a
//      notification "Saheeb is calling" reaches the phone otherwise).
//   2. They tap Answer: the row becomes "answered" and both phones meet on a Realtime channel
//      named after the call, swap connection details (WebRTC offer, answer and ICE candidates)
//      and from then on talk to each other directly. No audio goes through the server.
//   3. Either taps End: the row becomes "ended". Declined, cancelled, missed and busy are kept too,
//      for the Calls list and the "Missed call" notification.
// The connection helpers (STUN, and the Cloudflare TURN relay when it's set up) come from the
// call-ice Edge Function. Calls work in the iPhone app and in browsers.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isNativeApp } from "@/native/platform";
import { NorthcroftNative } from "@/native/plugin";

export type CallStatus = "ringing" | "answered" | "declined" | "missed" | "ended" | "cancelled" | "busy";

export interface CallRow {
  id: string;
  caller_id: string;
  callee_id: string;
  status: CallStatus;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
}

export type Phase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "ended";

export interface CallState {
  phase: Phase;
  call: CallRow | null;
  /** The other person. */
  peerId: string | null;
  direction: "out" | "in" | null;
  muted: boolean;
  speaker: boolean;
  /** When the two phones connected, for the timer. */
  connectedAt: number | null;
  /** Why it ended, shown for a moment: "Call ended", "Declined", "No answer", "Busy". */
  note: string | null;
  route: string | null;
  remote: MediaStream | null;
}

const IDLE: CallState = {
  phase: "idle",
  call: null,
  peerId: null,
  direction: null,
  muted: false,
  speaker: false,
  connectedAt: null,
  note: null,
  route: null,
  remote: null,
};

/** How long a call rings before it counts as missed. */
const RING_MS = 45_000;
const FALLBACK_ICE: RTCIceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];

type Signal =
  | { type: "ready"; from: string }
  | { type: "offer"; from: string; sdp: string }
  | { type: "answer"; from: string; sdp: string }
  | { type: "ice"; from: string; candidate: RTCIceCandidateInit }
  | { type: "bye"; from: string };

class CallEngine {
  private state: CallState = IDLE;
  private listeners = new Set<() => void>();
  private me: string | null = null;
  private watch: RealtimeChannel | null = null;
  private channel: RealtimeChannel | null = null;
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private ringTimer: number | undefined;
  private dropTimer: number | undefined;
  private clearTimer: number | undefined;
  private ice: { servers: RTCIceServer[]; at: number } | null = null;

  /* ---------------------------------------------------------------- store */
  get = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private set(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /* ---------------------------------------------------------------- incoming calls */
  /** Listens for calls to and from this person (set up once after sign-in). */
  start(meId: string) {
    if (this.me === meId && this.watch) return;
    this.stop();
    this.me = meId;
    this.watch = supabase
      .channel(`calls-${meId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `callee_id=eq.${meId}` }, (p) => this.onRow(p.new as CallRow))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `caller_id=eq.${meId}` }, (p) => this.onRow(p.new as CallRow))
      .subscribe();
  }

  stop() {
    if (this.watch) void supabase.removeChannel(this.watch);
    this.watch = null;
    this.me = null;
    this.cleanup();
    this.state = IDLE;
  }

  /** A call opened from its notification (/call/:id). */
  async openFromLink(id: string) {
    const { data } = await supabase.from("calls").select("*").eq("id", id).maybeSingle<CallRow>();
    if (data) this.onRow(data);
    return data;
  }

  private onRow(row: CallRow | undefined) {
    if (!row?.id || !this.me) return;
    const s = this.state;
    // A new call for me.
    if (row.status === "ringing" && row.callee_id === this.me) {
      if (s.call?.id === row.id) return;
      if (Date.now() - Date.parse(row.created_at) > RING_MS) return;
      if (s.phase !== "idle" && s.phase !== "ended") {
        // Already on a call: tell the caller.
        void supabase.from("calls").update({ status: "busy", ended_at: new Date().toISOString() }).eq("id", row.id).eq("status", "ringing");
        return;
      }
      window.clearTimeout(this.clearTimer);
      this.set({ ...IDLE, phase: "incoming", call: row, peerId: row.caller_id, direction: "in" });
      ring.start("incoming");
      haptic("warning");
      window.clearTimeout(this.ringTimer);
      this.ringTimer = window.setTimeout(() => {
        if (this.state.call?.id === row.id && this.state.phase === "incoming") this.finish("Missed call");
      }, RING_MS - (Date.now() - Date.parse(row.created_at)));
      return;
    }
    // The call I'm on changed.
    if (s.call?.id !== row.id) return;
    this.set({ call: row });
    if (row.status === "declined") this.finish("Declined");
    else if (row.status === "busy") this.finish("Busy on another call");
    else if (row.status === "missed") this.finish(s.direction === "out" ? "No answer" : "Missed call");
    else if (row.status === "cancelled") this.finish(s.direction === "in" ? "Missed call" : "Call cancelled");
    else if (row.status === "ended") this.finish("Call ended");
    else if (row.status === "answered" && s.direction === "in" && s.phase === "incoming") {
      // Answered on another of my devices.
      this.finish("Answered on another device");
    }
  }

  /* ---------------------------------------------------------------- calling someone */
  async call(peerId: string): Promise<void> {
    if (!this.me) throw new Error("Please sign in again.");
    if (peerId === this.me) throw new Error("You can't call yourself.");
    if (this.state.phase !== "idle" && this.state.phase !== "ended") throw new Error("You're already on a call.");
    window.clearTimeout(this.clearTimer);
    const id = crypto.randomUUID();
    this.set({ ...IDLE, phase: "outgoing", peerId, direction: "out", call: { id, caller_id: this.me, callee_id: peerId, status: "ringing", created_at: new Date().toISOString(), answered_at: null, ended_at: null } });
    try {
      this.local = await getMic();
      await this.join(id);
      const { error } = await supabase.from("calls").insert({ id, caller_id: this.me, callee_id: peerId, status: "ringing" });
      if (error) throw error;
      ring.start("outgoing");
      void audio(true, false).then((route) => this.set({ route }));
      this.ringTimer = window.setTimeout(() => {
        if (this.state.call?.id === id && this.state.phase === "outgoing") {
          void supabase.from("calls").update({ status: "missed", ended_at: new Date().toISOString() }).eq("id", id).eq("status", "ringing");
          this.finish("No answer");
        }
      }, RING_MS);
    } catch (e) {
      this.finish(null);
      throw e;
    }
  }

  /* ---------------------------------------------------------------- answering */
  async answer() {
    const s = this.state;
    if (s.phase !== "incoming" || !s.call) return;
    ring.stop();
    window.clearTimeout(this.ringTimer);
    this.set({ phase: "connecting" });
    try {
      this.local = await getMic();
      const { data, error } = await supabase
        .from("calls")
        .update({ status: "answered", answered_at: new Date().toISOString() })
        .eq("id", s.call.id)
        .eq("status", "ringing")
        .select()
        .maybeSingle<CallRow>();
      if (error) throw error;
      if (!data) {
        this.finish("The call has ended");
        return;
      }
      this.set({ call: data });
      await this.join(s.call.id);
      await this.makePeer();
      void audio(true, false).then((route) => this.set({ route }));
      this.send({ type: "ready", from: this.me! });
    } catch (e) {
      this.finish("Couldn't answer");
      throw e;
    }
  }

  async decline() {
    const s = this.state;
    if (!s.call) return;
    await supabase.from("calls").update({ status: "declined", ended_at: new Date().toISOString() }).eq("id", s.call.id).eq("status", "ringing");
    this.finish(null);
  }

  /** End: hangs up, or cancels a call that's still ringing. */
  async hangUp() {
    const s = this.state;
    if (!s.call) return this.finish(null);
    const ringing = s.phase === "outgoing";
    this.send({ type: "bye", from: this.me ?? "" });
    await supabase
      .from("calls")
      .update({ status: ringing ? "cancelled" : "ended", ended_at: new Date().toISOString() })
      .eq("id", s.call.id)
      .in("status", ringing ? ["ringing"] : ["answered", "ringing"]);
    this.finish(ringing ? "Call cancelled" : "Call ended");
  }

  toggleMute() {
    const muted = !this.state.muted;
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.set({ muted });
    haptic("light");
  }

  async toggleSpeaker() {
    const speaker = !this.state.speaker;
    this.set({ speaker });
    haptic("light");
    const route = await audio(true, speaker);
    this.set({ route });
  }

  /** Clears the "Call ended" screen. */
  dismiss() {
    if (this.state.phase === "ended") this.set(IDLE);
  }

  /* ---------------------------------------------------------------- the connection */
  private async join(id: string) {
    const ch = supabase.channel(`call:${id}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "signal" }, ({ payload }) => void this.onSignal(payload as Signal));
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("Couldn't reach the call service. Check your connection.")), 10_000);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(t);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          window.clearTimeout(t);
          reject(new Error("Couldn't reach the call service. Check your connection."));
        }
      });
    });
    this.channel = ch;
  }

  private send(signal: Signal) {
    void this.channel?.send({ type: "broadcast", event: "signal", payload: signal });
  }

  private async iceServers(): Promise<RTCIceServer[]> {
    if (this.ice && Date.now() - this.ice.at < 60 * 60_000) return this.ice.servers;
    try {
      const { data, error } = await supabase.functions.invoke("call-ice", { body: {} });
      if (error) throw error;
      const servers = (data as { iceServers?: RTCIceServer[] })?.iceServers;
      if (Array.isArray(servers) && servers.length) {
        this.ice = { servers, at: Date.now() };
        return servers;
      }
    } catch {
      /* fall back to STUN */
    }
    return FALLBACK_ICE;
  }

  private async makePeer() {
    const pc = new RTCPeerConnection({ iceServers: await this.iceServers() });
    this.pc = pc;
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: "ice", from: this.me!, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.set({ remote: stream });
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        window.clearTimeout(this.dropTimer);
        ring.stop();
        if (this.state.phase !== "active") {
          this.set({ phase: "active", connectedAt: this.state.connectedAt ?? Date.now() });
          haptic("success");
          void audio(true, this.state.speaker).then((route) => this.set({ route }));
        }
      } else if (st === "disconnected") {
        // Often comes back by itself (a tunnel, switching to Wi-Fi).
        window.clearTimeout(this.dropTimer);
        this.dropTimer = window.setTimeout(() => {
          if (this.pc === pc && pc.connectionState !== "connected") void this.lost();
        }, 10_000);
      } else if (st === "failed") {
        void this.lost();
      }
    };
    return pc;
  }

  private async lost() {
    const s = this.state;
    if (s.call) await supabase.from("calls").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", s.call.id).in("status", ["answered"]);
    this.finish(s.phase === "active" ? "Call dropped" : "Couldn't connect. One of you may be on a network that blocks calls.");
  }

  private async onSignal(sig: Signal) {
    if (!sig || sig.from === this.me) return;
    try {
      if (sig.type === "ready" && this.state.direction === "out") {
        // They answered: send the offer.
        ring.stop();
        window.clearTimeout(this.ringTimer);
        this.set({ phase: "connecting" });
        const pc = await this.makePeer();
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        this.send({ type: "offer", from: this.me!, sdp: offer.sdp ?? "" });
      } else if (sig.type === "offer" && this.pc) {
        await this.pc.setRemoteDescription({ type: "offer", sdp: sig.sdp });
        await this.flushIce();
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.send({ type: "answer", from: this.me!, sdp: answer.sdp ?? "" });
      } else if (sig.type === "answer" && this.pc) {
        await this.pc.setRemoteDescription({ type: "answer", sdp: sig.sdp });
        await this.flushIce();
      } else if (sig.type === "ice") {
        if (this.pc?.remoteDescription) await this.pc.addIceCandidate(sig.candidate).catch(() => undefined);
        else this.pendingIce.push(sig.candidate);
      } else if (sig.type === "bye") {
        this.finish("Call ended");
      }
    } catch (e) {
      console.warn("Call signal", e);
    }
  }

  private async flushIce() {
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => undefined);
  }

  /* ---------------------------------------------------------------- the end */
  private finish(note: string | null) {
    this.cleanup();
    if (!note) {
      this.state = IDLE;
      this.listeners.forEach((fn) => fn());
      return;
    }
    this.set({ phase: "ended", note, remote: null });
    haptic("light");
    window.clearTimeout(this.clearTimer);
    this.clearTimer = window.setTimeout(() => this.dismiss(), 2500);
  }

  private cleanup() {
    ring.stop();
    window.clearTimeout(this.ringTimer);
    window.clearTimeout(this.dropTimer);
    this.pendingIce = [];
    try {
      this.pc?.close();
    } catch {
      /* already closed */
    }
    this.pc = null;
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    if (this.channel) void supabase.removeChannel(this.channel);
    this.channel = null;
    void audio(false, false);
  }
}

/* -------------------------------------------------------------- helpers */
async function getMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't make calls.");
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NotAllowedError" || name === "SecurityError")
      throw new Error(isNativeApp() ? "Northcroft needs the microphone for calls. Turn it on in Settings > Northcroft." : "Allow the microphone for this site to make calls.");
    if (name === "NotFoundError") throw new Error("No microphone found.");
    throw e;
  }
}

async function audio(active: boolean, speaker: boolean): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const r = await NorthcroftNative.callAudio({ active, speaker });
    return r.route;
  } catch {
    return null;
  }
}

function haptic(style: "light" | "success" | "warning") {
  if (isNativeApp()) void NorthcroftNative.haptic({ style }).catch(() => undefined);
  else if (style === "warning") navigator.vibrate?.([300, 200, 300]);
}

/** The ringing sound: a phone ring for an incoming call, a ringback tone while calling. */
const ring = (() => {
  let ctx: AudioContext | null = null;
  let timer: number | undefined;
  let gain: GainNode | null = null;
  const beep = (kind: "incoming" | "outgoing") => {
    if (!ctx || !gain) return;
    const t = ctx.currentTime;
    const tones = kind === "incoming" ? [880, 660] : [440, 480];
    for (const f of tones) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(gain);
      o.start(t);
      o.stop(t + (kind === "incoming" ? 0.9 : 1.6));
    }
  };
  return {
    start(kind: "incoming" | "outgoing") {
      this.stop();
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        gain = ctx.createGain();
        gain.gain.value = kind === "incoming" ? 0.08 : 0.04;
        gain.connect(ctx.destination);
        void ctx.resume().catch(() => undefined);
        beep(kind);
        timer = window.setInterval(() => {
          beep(kind);
          if (kind === "incoming") haptic("warning");
        }, kind === "incoming" ? 2000 : 4000);
      } catch {
        /* no sound: the screen still shows the call */
      }
    },
    stop() {
      window.clearInterval(timer);
      timer = undefined;
      void ctx?.close().catch(() => undefined);
      ctx = null;
      gain = null;
    },
  };
})();

export const calls = new CallEngine();
