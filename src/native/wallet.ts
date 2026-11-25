// The staff pass in Apple Wallet: asks the `wallet-pass` function for a signed pass and hands it to
// Wallet's "Add" screen. Before the Apple Developer Program certificate is in place the function
// says so, and this passes that on.
import { supabase } from "@/lib/supabase";
import { NorthcroftNative } from "./plugin";

export async function addStaffPass(): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await supabase.functions.invoke("wallet-pass", { body: {} });
  if (error) {
    let msg = "The staff pass couldn't be made just now. Try again later.";
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.code === "not_set_up") msg = "The Wallet staff pass arrives once Northcroft joins the Apple Developer Program.";
        else if (j?.error) msg = j.error;
      }
    } catch {
      /* keep the friendly default */
    }
    return { ok: false, message: msg };
  }
  const pass = (data as { pass?: string } | null)?.pass;
  if (!pass) return { ok: false, message: "The staff pass didn't come back. Try again." };
  const r = await NorthcroftNative.addWalletPass({ data: pass }).catch(() => ({ added: false, reason: "Wallet couldn't open." }));
  if (!r.added) return { ok: false, message: r.reason ?? "Wallet couldn't open." };
  return { ok: true, message: "already" in r && r.already ? "Your staff pass is already in Wallet." : "" };
}
