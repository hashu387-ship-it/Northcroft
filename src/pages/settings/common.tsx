import type { ReactNode } from "react";
import { supabase } from "@/lib/supabase";

export function Section({ title, sub, children, actions }: { title: string; sub?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="glass card stack" style={{ gap: 14 }}>
      <div className="card-head" style={{ marginBottom: 0, alignItems: "flex-start" }}>
        <div>
          <h2>{title}</h2>
          {sub && <div className="muted small" style={{ marginTop: 4 }}>{sub}</div>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Call the manager-only admin Edge Function and surface its error message. */
export async function adminCall<T = { ok: boolean }>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      }
    } catch {
      /* keep the generic message */
    }
    throw new Error(msg);
  }
  if (data && typeof data === "object" && "error" in data && data.error) throw new Error(String(data.error));
  return data as T;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
