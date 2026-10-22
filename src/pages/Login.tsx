import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/supabase";
import { Background } from "@/layout/AppShell";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Background>
      <div className="auth-wrap">
        <form className="auth-card glass-strong" onSubmit={submit}>
          <img className="logo" src="/icons/icon-192.png" alt="" />
          <h1>Northcroft</h1>
          <p className="lead">QS team workspace</p>
          <div className="stack" style={{ gap: 14 }}>
            <label className="field">
              <span>Work email</span>
              <input
                className="input"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@northcroftme.com"
                required
              />
            </label>
            <label className="field">
              <span>Password</span>
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ paddingRight: 48 }}
                />
                <button
                  type="button"
                  className="icon-btn small plain"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  style={{ position: "absolute", right: 6, top: 6 }}
                >
                  {show ? <EyeOff /> : <Eye />}
                </button>
              </div>
            </label>
            {error && (
              <div className="pill red lg" role="alert" style={{ height: "auto", padding: "8px 12px", whiteSpace: "normal" }}>
                {error}
              </div>
            )}
            <button className="btn primary large block" disabled={busy} type="submit">
              <LogIn /> {busy ? "Signing in..." : "Sign in"}
            </button>
            <p className="muted small" style={{ textAlign: "center" }}>
              Forgot your password? Ask Hassan to reset it for you.
            </p>
          </div>
        </form>
      </div>
    </Background>
  );
}
