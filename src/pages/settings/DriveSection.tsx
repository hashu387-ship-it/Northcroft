import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Copy, ExternalLink, HardDrive, KeyRound, Link2, RefreshCw, Trash2, Unplug } from "lucide-react";
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
  // The Google key that reads shared Drive links pasted on tasks and projects.
  const keySet = !!s?.drive_key_added_at;
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);

  async function saveKey() {
    setKeyBusy(true);
    try {
      await driveCall("save_api_key", { key: apiKey.trim() });
      setApiKey("");
      setShowKey(false);
      await invalidate("app_settings");
      toast("Google key saved. Drive links on tasks and projects now show their files.");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setKeyBusy(false);
    }
  }

  async function removeKey() {
    const ok = await confirm({
      title: "Remove the Google key?",
      message: "Drive links stay on tasks and projects, but their files won't show in the app until a key is added again.",
      confirmLabel: "Remove key",
      danger: true,
    });
    if (!ok) return;
    setKeyBusy(true);
    try {
      await driveCall("save_api_key", { key: "" });
      await invalidate("app_settings");
      toast("Google key removed", "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setKeyBusy(false);
    }
  }

  // Back from Google: say how it went.
  useEffect(() => {
    const result = params.get("drive");
    if (!result) return;
    if (result === "connected") {
      toast("Google Drive connected. Every file the team attaches now goes to this Drive.");
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
      message: "Files already in Drive stay there, but the team can't open them until it's connected again. Meanwhile new files up to 50 MB are kept in the app.",
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
      sub="Every file the team attaches, whoever uploads it, is saved straight to a Northcroft folder in this Google Drive, with a folder for each project."
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
                  ? "Set it up once below, then every attachment is saved to Drive for everyone."
                  : "Until a manager connects it, files up to 50 MB are kept in the app."}
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

      <div className="solid stack" style={{ padding: 16, gap: 10, borderRadius: 12 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="settings-icon" style={{ background: keySet ? "var(--green)" : "var(--gray)" }}>
            <Link2 />
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="bold row" style={{ gap: 8 }}>
              Shared Drive links
              {keySet && <CheckCircle2 size={16} style={{ color: "var(--green)" }} />}
            </div>
            <div className="muted small">
              {keySet
                ? `Ready · Google key added ${fmtDateTime(s!.drive_key_added_at!)}. Paste a Drive folder link on any task or project to show its files.`
                : isManager
                  ? "Add a Google key once, and anyone can paste a Google Drive folder or file link on a task or project and see its files there, ready to open or download."
                  : "A manager adds a one-time Google key here, then Drive links on tasks and projects show their files."}
            </div>
          </div>
          {keySet && <Pill tone="green">On</Pill>}
        </div>
        {isManager && keySet && !showKey && (
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn small ghost" type="button" onClick={() => setShowKey(true)} disabled={keyBusy}>
              <KeyRound /> Change key
            </button>
            <button className="btn small ghost" type="button" onClick={removeKey} disabled={keyBusy}>
              <Trash2 /> Remove key
            </button>
          </div>
        )}
        {isManager && (!keySet || showKey) && (
          <div className="stack" style={{ gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Get a Google key (about 5 minutes, on a computer)</h3>
            <ol className="steps small">
              <li>
                Open{" "}
                <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer">
                  Google Drive API
                </a>{" "}
                in Google Cloud and press <b>Enable</b> (if it says Manage, it's already on). Any Google account works; the Northcroft project from the Drive set-up
                above is fine. If Google asks, create a project called <b>Northcroft</b>.
              </li>
              <li>
                Open{" "}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">
                  Credentials
                </a>
                , press <b>Create credentials</b>, then <b>API key</b>. Google shows the new key.
              </li>
              <li>
                Press <b>Edit API key</b>. Under <b>API restrictions</b> choose <b>Restrict key</b>, tick <b>Google Drive API</b> and press <b>Save</b>.
              </li>
              <li>
                Copy the key (it starts with <b>AIza</b>), paste it here and press <b>Save key</b>.
              </li>
            </ol>
            <p className="faint tiny" style={{ margin: 0 }}>
              The key can only read folders and files shared as "Anyone with the link". It's stored encrypted and never shown again.
            </p>
            <div className="row wrap" style={{ gap: 10 }}>
              <input
                className="input"
                style={{ flex: "1 1 260px" }}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIza..."
                autoComplete="off"
                spellCheck={false}
                aria-label="Google API key"
              />
              <button className="btn primary" type="button" onClick={saveKey} disabled={keyBusy || !apiKey.trim()}>
                <KeyRound /> {keyBusy ? "Checking..." : "Save key"}
              </button>
              {showKey && (
                <button className="btn ghost" type="button" onClick={() => setShowKey(false)} disabled={keyBusy}>
                  Cancel
                </button>
              )}
            </div>
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
                placeholder={connected ? "Leave empty to keep the current one" : undefined}
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
                placeholder={connected ? "Leave empty to keep the current one" : undefined}
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
