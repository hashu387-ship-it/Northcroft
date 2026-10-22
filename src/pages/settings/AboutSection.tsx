import { LogOut, Share, SquarePlus, EllipsisVertical } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { isStandalone } from "@/lib/push";
import { useConfirm } from "@/components/ui";
import { Section } from "./common";

export function AboutSection() {
  const { signOut } = useAuth();
  const confirm = useConfirm();
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Section title="Installing on your phone" sub={isStandalone() ? "You're using the installed app. Nice." : "Install Northcroft so it opens full screen and can send notifications."}>
        <div className="grid-2">
          <div className="solid stack" style={{ padding: 16, gap: 10 }}>
            <b>iPhone</b>
            <ol className="steps small">
              <li>Open the Northcroft link in <b>Safari</b>.</li>
              <li>
                Tap <b>Share</b> <Share size={14} style={{ verticalAlign: "-2px" }} />.
              </li>
              <li>
                Tap <b>Add to Home Screen</b> <SquarePlus size={14} style={{ verticalAlign: "-2px" }} />, then <b>Add</b>.
              </li>
              <li>Open it from the Home Screen and turn on notifications in Settings.</li>
            </ol>
          </div>
          <div className="solid stack" style={{ padding: 16, gap: 10 }}>
            <b>Android</b>
            <ol className="steps small">
              <li>Open the Northcroft link in <b>Chrome</b>.</li>
              <li>
                Tap the menu <EllipsisVertical size={14} style={{ verticalAlign: "-2px" }} /> at the top right.
              </li>
              <li>
                Tap <b>Add to Home screen</b> or <b>Install app</b>.
              </li>
              <li>Open it from the Home screen and turn on notifications in Settings.</li>
            </ol>
          </div>
        </div>
      </Section>
      <Section title="About">
        <div className="setting-row">
          <div className="grow">
            <b>Northcroft QS Workspace</b>
            <small>Version 1.0 · Times shown in Riyadh time</small>
          </div>
        </div>
        <div className="setting-row">
          <div className="grow">
            <b>Need help?</b>
            <small>Forgotten passwords and access are handled by Hassan from Settings, then Team.</small>
          </div>
        </div>
        <button
          className="btn danger"
          style={{ alignSelf: "flex-start" }}
          onClick={async () => {
            if (await confirm({ title: "Sign out?", message: "You'll need your email and password to sign back in.", confirmLabel: "Sign out", danger: true })) signOut();
          }}
          type="button"
        >
          <LogOut /> Sign out
        </button>
      </Section>
    </div>
  );
}
