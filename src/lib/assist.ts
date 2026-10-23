import { supabase } from "./supabase";
import type { Priority } from "./types";

/** An error from the Claude helper, with a code the screens can react to ("off" = no API key yet). */
export class AssistError extends Error {
  constructor(message: string, public code = "error") {
    super(message);
  }
}

/** Ask the `assist` Edge Function to do something with Claude. */
export async function assist<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("assist", { body: { action, ...payload } });
  if (error) {
    let msg = "Claude couldn't answer just now. Try again in a moment.";
    let code = "error";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
        if (j?.code) code = j.code;
      } else if (/Failed to fetch|NetworkError/i.test(error.message)) {
        msg = "No connection. Check your internet and try again.";
      }
    } catch {
      /* keep the friendly default */
    }
    throw new AssistError(msg, code);
  }
  return data as T;
}

export interface TaskDraft {
  title: string;
  description: string;
  assignee_id: string | null;
  due_date: string | null;
  project_id: string | null;
  priority: Priority;
  steps: string[];
}

export interface AnnouncementDraft {
  title: string;
  body: string;
  transcript: string | null;
}
