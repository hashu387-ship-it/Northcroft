import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Rocket, Sparkles, Trophy } from "lucide-react";
import clsx from "clsx";
import { usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { buzz, celebrate, chime, daysText, earlyDays, extrasOn, onCelebrate, type Celebration } from "@/lib/celebrate";
import { nameList } from "@/lib/people";
import { supabase } from "@/lib/supabase";
import type { Task } from "@/lib/types";

/* ---------------------------------------------------------------- confetti */
const COLOURS = ["#0b1d46", "#1b3570", "#2f6fe0", "#e8343e", "#f35a62", "#f2b705", "#ffd84d", "#ffffff"];

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  flip: number;
  vflip: number;
  colour: string;
  round: boolean;
}

/** Two bursts from the bottom corners and a shower from the top. Stops by itself after about 3 seconds. */
function runConfetti(canvas: HTMLCanvasElement, amount: number): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  const bits: Bit[] = [];
  const make = (x: number, y: number, angle: number, speed: number): Bit => ({
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rot: rand(0, Math.PI * 2),
    vr: rand(-0.25, 0.25),
    w: rand(6, 11),
    h: rand(9, 16),
    flip: rand(0, Math.PI * 2),
    vflip: rand(0.08, 0.2),
    colour: COLOURS[Math.floor(Math.random() * COLOURS.length)],
    round: Math.random() < 0.25,
  });
  const side = Math.round(amount * 0.38);
  const speedScale = Math.min(1.25, Math.max(0.8, H / 800));
  for (let i = 0; i < side; i++) {
    bits.push(make(rand(-10, 20), H + 10, rand(-1.25, -0.95), rand(13, 21) * speedScale));
    bits.push(make(W + rand(-20, 10), H + 10, rand(-2.2, -1.9), rand(13, 21) * speedScale));
  }
  for (let i = 0; i < amount - side * 2; i++) bits.push(make(rand(0, W), rand(-H * 0.5, -10), rand(1.3, 1.85), rand(1, 4)));

  let raf = 0;
  const started = performance.now();
  const tick = (now: number) => {
    ctx.clearRect(0, 0, W, H);
    const fade = Math.max(0, Math.min(1, (3400 - (now - started)) / 700));
    let alive = 0;
    for (const b of bits) {
      b.vy += 0.32;
      b.vx *= 0.985;
      b.vy *= 0.985;
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      b.flip += b.vflip;
      if (b.y < H + 30) alive++;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.scale(1, Math.cos(b.flip));
      ctx.fillStyle = b.colour;
      if (b.round) {
        ctx.beginPath();
        ctx.arc(0, 0, b.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      }
      ctx.restore();
    }
    if (alive > 0 && fade > 0) raf = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/* ---------------------------------------------------------------- the card */
const ICON = { approved: Trophy, early: Rocket, on_time: CalendarCheck } as const;

function Overlay({ c, onDone }: { c: Celebration; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const big = c.kind !== "on_time";
  const Icon = ICON[c.kind];

  useEffect(() => {
    const stop = canvas.current && !reducedMotion() ? runConfetti(canvas.current, big ? 170 : 60) : () => {};
    if (extrasOn()) {
      chime(big);
      buzz(big);
    }
    const timer = window.setTimeout(onDone, big ? 3400 : 2400);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    document.addEventListener("keydown", onKey);
    return () => {
      stop();
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  return (
    <div className={clsx("celebrate", c.kind, !big && "small")} onClick={onDone} role="status" aria-live="polite">
      <canvas ref={canvas} className="confetti" aria-hidden />
      <div className="celebrate-card">
        <span className="celebrate-icon" aria-hidden>
          <Icon />
        </span>
        <b className="celebrate-headline">{c.headline}</b>
        <span className="celebrate-line">{c.line}</span>
        {c.detail && <span className="celebrate-detail">{c.detail}</span>}
        {c.chip && (
          <span className="early-badge">
            <Sparkles aria-hidden />
            {c.chip}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- work approved while you were away */
/**
 * People on a task see the celebration once, the next time they open the app (or straight away if
 * it's open), when someone else approves their work or marks it done.
 */
function useApprovedForMe() {
  const me = useMe();
  const people = usePeople();
  const key = `nc-celebrated-${me.id}`;
  const [since, setSince] = useState<string | null>(() => {
    try {
      let v = localStorage.getItem(key);
      // First time on this phone: start from now, so old approvals don't all go off at once.
      if (!v) {
        v = new Date().toISOString();
        localStorage.setItem(key, v);
      }
      return v;
    } catch {
      return null;
    }
  });

  const q = useQuery({
    queryKey: ["tasks", "approved-for-me", me.id, since],
    enabled: !!since,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, completed_at, approved_by, submitted_at, due_date")
        .contains("assignees", [me.id])
        .eq("status", "done")
        .gt("completed_at", since!)
        .neq("approved_by", me.id)
        .order("completed_at", { ascending: true })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as Pick<Task, "id" | "title" | "status" | "completed_at" | "approved_by" | "submitted_at" | "due_date">[];
    },
  });

  // Check again whenever the app comes back to the front.
  const refetch = q.refetch;
  useEffect(() => {
    const onShow = () => document.visibilityState === "visible" && void refetch();
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [refetch]);

  useEffect(() => {
    const rows = q.data;
    if (!rows?.length) return;
    const latest = rows[rows.length - 1].completed_at!;
    try {
      localStorage.setItem(key, latest);
    } catch {
      /* it may show again on this phone, that's all */
    }
    setSince(latest);
    const by = nameList([...new Set(rows.map((r) => people.get(r.approved_by)?.short_name ?? "Your reviewer"))]);
    if (rows.length === 1) {
      const t = rows[0];
      const early = earlyDays(t);
      celebrate({
        kind: "approved",
        headline: "Approved",
        line: `${by} approved your work. Great job, ${me.short_name}.`,
        detail: t.title,
        chip: early ? `Finished ${daysText(early)} early` : undefined,
      });
    } else {
      const titles = rows.slice(-3).map((r) => r.title);
      celebrate({
        kind: "approved",
        headline: `${rows.length} tasks approved`,
        line: `${by} approved your work. Great job, ${me.short_name}.`,
        detail: titles.join(" · ") + (rows.length > 3 ? ` and ${rows.length - 3} more` : ""),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
}

/** Shows celebrations one at a time, wherever in the app they were started. */
let nextId = 1;

export function CelebrationHost() {
  const [queue, setQueue] = useState<{ id: number; c: Celebration }[]>([]);
  useEffect(() => onCelebrate((c) => setQueue((q) => (q.length > 3 ? q : [...q, { id: nextId++, c }]))), []);
  useApprovedForMe();
  const current = queue[0];
  if (!current) return null;
  return <Overlay key={current.id} c={current.c} onDone={() => setQueue((q) => q.filter((x) => x.id !== current.id))} />;
}
