import { createClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./config";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "northcroft-auth" },
  realtime: { params: { eventsPerSecond: 10 } },
});

/** Turn a Supabase/Postgres error into a sentence a person can act on. */
export function errorMessage(e: unknown): string {
  if (!e) return "Something went wrong";
  const msg = typeof e === "string" ? e : (e as { message?: string }).message || "Something went wrong";
  if (/Invalid login credentials/i.test(msg)) return "That email or password is not right.";
  if (/JWT expired|invalid JWT/i.test(msg)) return "Your session expired. Please sign in again.";
  if (/row-level security/i.test(msg)) return "You don't have permission to do that.";
  if (/duplicate key.*vo_number/i.test(msg)) return "That VO number already exists on this project.";
  if (/duplicate key/i.test(msg)) return "That already exists.";
  if (/Failed to fetch|NetworkError/i.test(msg)) return "No connection. Check your internet and try again.";
  return msg;
}
