import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import { PhotoBackground } from "@/layout/AppShell";
import { LogoMark } from "@/components/Brand";
import { useToast } from "@/components/ui";

/** Change your own password. Shown full screen on first sign-in, and inside Settings later. */
export default function ChangePassword({ forced = false, onDone }: { forced?: boolean; onDone?: () => void }) {
  const me = useMe();
  const { refreshProfile, signOut } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 8) return setError("Use at least 8 characters.");
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      const { error: e1 } = await supabase.auth.updateUser({ password: pw });
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("profiles").update({ must_change_password: false }).eq("id", me.id);
      if (e2) throw e2;
      await refreshProfile();
      toast("Password changed");
      setPw("");
      setPw2("");
      onDone?.();
    } catch (err) {
      const msg = errorMessage(err);
      setError(/should be different/i.test(msg) ? "Choose a password that's different from the temporary one." : msg);
    } finally {
      setBusy(false);
    }
  }

  const form = (
    <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
      <label className="field">
        <span>New password</span>
        <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </label>
      <label className="field">
        <span>Type it again</span>
        <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </label>
      {error && (
        <div className="pill red lg" role="alert" style={{ height: "auto", padding: "8px 12px", whiteSpace: "normal" }}>
          {error}
        </div>
      )}
      <button className="btn primary large block" disabled={busy} type="submit">
        <KeyRound /> {busy ? "Saving..." : "Save password"}
      </button>
    </form>
  );

  if (!forced) return form;

  return (
    <PhotoBackground>
      <div className="auth-wrap">
        <div className="auth-card glass-strong">
          <div className="auth-brand">
            <LogoMark variant="tile" size={68} className="logo-tile" />
          </div>
          <h1>Welcome, {me.short_name}</h1>
          <p className="lead">You signed in with a temporary password. Choose your own to continue.</p>
          {form}
          <button className="btn ghost block" style={{ marginTop: 10 }} onClick={() => signOut()} type="button">
            Sign out
          </button>
        </div>
      </div>
    </PhotoBackground>
  );
}
