// One-tap sign-in. A manager makes a link (Settings, Team, a person, Make a sign-in link) and sends
// it on; the person taps it and lands here. We swap the one-time token for their own session and go
// straight to the page the link points at (the weekly update, unless it says otherwise). The token
// is single-use and expires, so a used or old link shows a friendly "ask for a new one" instead.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CircleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PhotoBackground } from "@/layout/AppShell";
import { LogoMark, Wordmark } from "@/components/Brand";
import { Spinner } from "@/components/ui";

/** Only ever send someone to a page inside the app. */
function safeTo(v: string | null): string {
  const s = (v ?? "").trim();
  return /^\/(?!\/)/.test(s) ? s : "/updates?tab=week";
}

export default function Enter() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get("token");
    const to = safeTo(params.get("to"));
    if (!token) {
      setFailed(true);
      return;
    }
    (async () => {
      const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "magiclink" });
      if (error) {
        setFailed(true);
        return;
      }
      // Signed in as themselves now; drop the token from history and open the page.
      navigate(to, { replace: true });
    })();
  }, [params, navigate]);

  return (
    <PhotoBackground>
      <div className="auth-wrap">
        <div className="auth-card glass-strong" style={{ textAlign: "center" }}>
          <div className="auth-brand">
            <LogoMark variant="tile" size={68} className="logo-tile" />
            <h1 className="brand-word">
              <Wordmark height={30} />
            </h1>
          </div>
          {failed ? (
            <div className="stack" style={{ gap: 14, alignItems: "center" }}>
              <CircleAlert size={30} style={{ color: "var(--red)" }} />
              <p className="lead" style={{ margin: 0 }}>
                This sign-in link has expired or has already been used.
              </p>
              <p className="muted small" style={{ margin: 0 }}>
                Ask Hassan to send you a new one, or sign in with your email and password.
              </p>
              <Link className="btn primary large block" to="/login">
                Go to sign in
              </Link>
            </div>
          ) : (
            <div className="stack" style={{ gap: 14, alignItems: "center" }}>
              <Spinner size={26} />
              <p className="lead" style={{ margin: 0 }}>
                Signing you in...
              </p>
            </div>
          )}
        </div>
      </div>
    </PhotoBackground>
  );
}
