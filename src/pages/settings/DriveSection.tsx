import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Copy, ExternalLink, HardDrive, RefreshCw, Unplug } from "lucide-react";
import { useInvalidate, useSettings } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SUPABASE_URL } from "@/lib/config";
import { driveCall, driveFolderUrl } from "@/lib/drive";
import { errorMessage } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/time";
import { Field, Pill, useConfirm, useToast } from "@/components/ui";
import { Section, copyText } from "./common";

/** Where Google sends you back after you allow access. Goes in the Google Cloud key. */
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/drive/callback`;

const REASONS: Record<string, string> = {
  access_denied: "Access wasn't allowed on the Google screen. Try again and press Allow (or Continue).",
  expired: "That took longer than 15 minutes. Press Connect again.",
  not_manager: "Only a manager can connect Google Drive.",
  invalid_client: "Google didn't accept the Client ID or Client secret. Check both and connect again.",
  invalid_grant: "Google's sign-in code had already been used or expired. Press Connect again.",
  no_refresh_token: "Google didn't give lasting access. Press Connect again and allow access.",
  scope: "Drive access wasn't ticked on the Google screen. Connect again and allow access to files created by Northcroft.",
};

export function DriveSection() {
  const { isManager } = useAuth();
  const settings = useSettings();
  const s = settings.data;
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [params, setParams] = useSearchParams();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const connected = !!s?.drive_connected_at;

  // Back from Google: say how it went.
  useEffect(() => {
    const result = params.get("drive");
    if (!result) return;
    if (result === "connected") {
      toast("Google Drive connected. Files over 50 MB now go to your Drive.");
      void invalidate("app_settings");
    } else {
      toast(REASONS[params.get("reason") ?? ""] ?? `Google Drive didn't connect (${params.get("reason") ?? "unknown reason"}). Try again.`, "error");
    }
    params.delete("drive");
    params.delete("reason");
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setBusy(true);
    try {
      const { url } = await driveCall<{ url: string }>("configure", { client_id: clientId, client_secret: clientSecret });
      window.location.href = url;
    } catch (e) {
      toast(errorMessage(e), "error");
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirm({
      title: "Disconnect Google Drive?",
      message: "Files already in Drive stay there, but the team can't open or add Drive files until it's connected again. Files under 50 MB aren't affected.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await driveCall("disconnect");
      await invalidate("app_settings");
      toast("Google Drive disconnected");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyRedirect() {
    toast((await copyText(REDIRECT_URI)) ? "Copied" : "Couldn't copy. Select the address instead.", "info");
  }

  return (
    <Section
      title="Google Drive"
      sub="Files up to 50 MB stay in the app. Anything bigger goes straight to a Northcroft folder in Google Drive, with a folder for each project."
    >
      <div className="solid stack" style={{ padding: 16, gap: 10, borderRadius: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="settings-icon" style={{ background: connected ? "var(--green)" : "var(--gray)" }}>
            <HardDrive />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold row" style={{ gap: 8 }}>
              {connected ? "Connected" : "Not connected"}
              {connected && <CheckCircle2 size={16} style={{ color: "var(--green)" }} />}
            </div>
            <div className="muted small ellipsis">
              {connected
                ? `${s?.drive_account ?? "Google Drive"} · since ${fmtDateTime(s!.drive_connected_at!)}`
                : isManager
                  ? "Set it up once below, then big files just work for everyone."
                  : "Files over 50 MB can't be added until a manager connects Google Drive."}
            </div>
          </div>
          {connected && <Pill tone="green">On</Pill>}
        </div>
        {connected && (
          <p className="muted small" style={{ margin: 0 }}>
            Drive files stay private. Only signed-in team members can open them, through the app. Deleting one in the app moves it to the Drive bin, where it
            can be recovered for 30 days.
          </p>
        )}
        {connected && isManager && (
          <div className="row wrap" style={{ gap: 8 }}>
            {s?.drive_root_id && (
              <a className="btn small" href={driveFolderUrl(s.drive_root_id)} target="_blank" rel="noopener noreferrer">
                <ExternalLink /> Open the folder in Drive
              </a>
            )}
            <button className="btn small ghost" type="button" onClick={() => setShowSetup((v) => !v)} disabled={busy}>
              <RefreshCw /> Reconnect
            </button>
            <button className="btn small ghost" type="button" onClick={disconnect} disabled={busy}>
              <Unplug /> Disconnect
            </button>
          </div>
        )}
      </div>

      {isManager && (!connected || showSetup) && (
        <div className="stack" style={{ gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>One-time set-up (about 10 minutes, on a computer)</h3>
          <ol className="steps small">
            <li>
              Sign in to{" "}
              <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">
                Google Cloud
              </a>{" "}
              with the Google account whose Drive should keep the files, and create a project called <b>Northcroft</b>. It's free.
            </li>
            <li>
              Open{" "}
              <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">
                Google Drive API
              </a>{" "}
              and press <b>Enable</b>.
            </li>
            <li>
              Open{" "}
              <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">
                Google Auth Platform
              </a>{" "}
              and press <b>Get started</b>: app name <b>Northcroft</b>, your email, audience <b>External</b>. Then on the <b>Audience</b> page press{" "}
              <b>Publish app</b>, so the connection doesn't expire after 7 days.
            </li>
            <li>
              Open{" "}
              <a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noopener noreferrer">
                Create client
              </a>
              : type <b>Web application</b>, name <b>Northcroft</b>. Under <b>Authorised redirect URIs</b> press Add URI and paste:
              <div className="cred-box" style={{ marginTop: 8 }}>
                <code style={{ wordBreak: "break-all" }}>{REDIRECT_URI}</code>
                <button className="icon-btn small" type="button" onClick={copyRedirect} aria-label="Copy the redirect address">
                  <Copy />
                </button>
              </div>
              Press <b>Create</b>. Google shows a Client ID and a Client secret.
            </li>
            <li>
              Paste both here and press <b>Connect Google Drive</b>. Sign in with the same Google account and allow access. Northcroft can only see the files and
              folders it creates, nothing else in your Drive.
            </li>
          </ol>
          <div className="form-grid">
            <Field label="Client ID" className="full">
              <input
                className="input"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={connected ? "Leave empty to keep the current one" : "123456789-abc.apps.googleusercontent.com"}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Client secret" className="full">
              <input
                className="input"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={connected ? "Leave empty to keep the current one" : "GOCSPX-..."}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <button className="btn primary" type="button" onClick={connect} disabled={busy || (!connected && (!clientId.trim() || !clientSecret.trim()))}>
              <HardDrive /> {busy ? "Opening Google..." : connected ? "Reconnect Google Drive" : "Connect Google Drive"}
            </button>
            <span className="faint tiny">The Client secret is stored encrypted and never shown again.</span>
          </div>
        </div>
      )}
    </Section>
  );
}
