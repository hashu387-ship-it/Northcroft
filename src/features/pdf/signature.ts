// Each person's saved signature and initials. Kept in the database (only they can see their own),
// with a copy on this device so it still works when the connection drops.
import { supabase } from "@/lib/supabase";

export interface Signatures {
  signature: string | null;
  initials: string | null;
}

const local = (userId: string) => `nc-signature-${userId}`;

function readLocal(userId: string): Signatures {
  try {
    const v = JSON.parse(localStorage.getItem(local(userId)) ?? "null");
    if (v && typeof v === "object") return { signature: v.signature ?? null, initials: v.initials ?? null };
  } catch {
    /* storage blocked */
  }
  return { signature: null, initials: null };
}

function writeLocal(userId: string, s: Signatures) {
  try {
    localStorage.setItem(local(userId), JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
}

async function signedIn(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return !!data.session;
  } catch {
    return false;
  }
}

export async function loadSignatures(userId: string): Promise<Signatures> {
  const mine = readLocal(userId);
  if (!(await signedIn())) return mine;
  try {
    const { data, error } = await supabase.from("user_signatures").select("signature, initials").eq("user_id", userId).maybeSingle();
    if (error || !data) return mine;
    const out = { signature: data.signature ?? mine.signature, initials: data.initials ?? mine.initials };
    writeLocal(userId, out);
    return out;
  } catch {
    return mine;
  }
}

/** Save one of them. Resolves to true when it's stored for every device, false when only on this one. */
export async function saveSignature(userId: string, kind: "signature" | "initials", png: string | null, current: Signatures): Promise<boolean> {
  const next = { ...current, [kind]: png };
  writeLocal(userId, next);
  if (!(await signedIn())) return false;
  try {
    const { error } = await supabase.from("user_signatures").upsert({ user_id: userId, [kind]: png }, { onConflict: "user_id" });
    return !error;
  } catch {
    return false;
  }
}
