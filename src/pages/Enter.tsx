// One-tap sign-in. A manager makes a link (Settings, Team, a person, Make a sign-in link) and sends
// it on; the person taps it and lands here. We swap the one-time token for their own session and go
// straight to the page the link points at (the weekly update, unless it says otherwise). The token
// is single-use and expires; but if they're already signed in (a second tap, or they came back
// later), we send them straight in anyway, so a used or old link only shows the friendly "ask for a
// new one" notice when there's no session at all.
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CircleAlert } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PhotoBackground } from "@/layout/AppShell";
import { TeamBadge } from "@/components/Brand";
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
    (async () => {
      // Already signed in (a second tap, or the app already knows them)? Just open the page.
      const { data: current } = await supabase.auth.getSession();
      if (current.session) {
        navigate(to, { replace: true });
        return;
      }
      if (!token) {
        setFailed(true);
        return;
      }
      const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "magiclink" });
      // Signed in as themselves now; drop the token from history and open the page.
      if (!error) {
        navigate(to, { replace: true });
        return;
      }
      // The token didn't work, but a session may have landed anyway; otherwise show the notice.
      const { data: after } = await supabase.auth.getSession();
      if (after.session) navigate(to, { replace: true });
      else setFailed(true);
    })();
  }, [params, navigate]);

  return (
    <PhotoBackground>
      <div className="auth-wrap">
        <div className="auth-card glass-strong" style={{ textAlign: "center" }}>
          <div className="auth-brand">
            <TeamBadge size={132} className="logo-badge" />
            <h1 className="sr-only">Northcroft QS Team</h1>
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
