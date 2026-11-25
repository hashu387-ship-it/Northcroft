// "Catch up": asks the `catchup` function for a short summary of a chat, the inbox or a task's
// conversation (what happened, and what's waiting on you). Nothing is saved.
import { looksOffline, supabase } from "./supabase";

export type CatchUpTarget = { kind: "chat"; chat: string; title: string } | { kind: "inbox" } | { kind: "task"; id: string; title: string };
export interface CatchUpResult {
  headline: string;
  points: string[];
  forYou: string[];
  /** How many messages or notifications it read. */
  count: number;
  /** Set when it summarised only what's new since this time. */
  since: string | null;
}

export async function catchUp(t: CatchUpTarget): Promise<CatchUpResult> {
  if (looksOffline()) throw new Error("Catch up needs signal. Try again when you're back online.");
  const body = t.kind === "chat" ? { kind: "chat", chat: t.chat } : t.kind === "task" ? { kind: "task", id: t.id } : { kind: "inbox" };
  const { data, error } = await supabase.functions.invoke("catchup", { body });
  if (error) {
    let msg = "Catch up didn't answer. Try again in a moment.";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      } else if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) {
        msg = "No connection. Check your internet and try again.";
      }
    } catch {
      /* keep the friendly default */
    }
    throw new Error(msg);
  }
  const r = (data ?? {}) as Partial<CatchUpResult>;
  return {
    headline: typeof r.headline === "string" ? r.headline : "",
    points: Array.isArray(r.points) ? r.points : [],
    forYou: Array.isArray(r.forYou) ? r.forYou : [],
    count: typeof r.count === "number" ? r.count : 0,
    since: typeof r.since === "string" ? r.since : null,
  };
}
