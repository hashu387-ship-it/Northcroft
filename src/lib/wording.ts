// "Check wording": sends what someone wrote to the `wording` function, which suggests the same text
// with AI-sounding words and patterns taken out, spelling fixed, and their voice and facts kept.
// Nothing is saved; the person chooses whether to use the suggestion.
import { looksOffline, supabase } from "./supabase";

export type WordingKind = "announcement" | "task" | "comment" | "chat" | "update" | "vo";
export type WordingResult = { text: string; changes: string[]; unchanged: boolean };

/** Shorter than this, there's nothing worth checking (the button stays greyed out). */
export const WORDING_MIN = 15;
export const WORDING_MAX = 6000;

export async function checkWording(text: string, kind: WordingKind): Promise<WordingResult> {
  if (looksOffline()) throw new Error("Checking wording needs signal. Try again when you're back online.");
  const { data, error } = await supabase.functions.invoke("wording", { body: { text, kind } });
  if (error) {
    let msg = "The wording check didn't answer. Try again in a moment.";
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
  const r = data as Partial<WordingResult> | null;
  return { text: typeof r?.text === "string" ? r.text : text, changes: Array.isArray(r?.changes) ? r!.changes : [], unchanged: !!r?.unchanged };
}
