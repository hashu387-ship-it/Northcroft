import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, Share, Smartphone, X } from "lucide-react";
import { isIOS, isStandalone, pushState } from "@/lib/push";

type BeforeInstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BeforeInstallEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallEvent;
  });
}

/** Nudges people to install the app (needed for iPhone notifications) and switch on notifications. */
export function InstallBanner() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("nc-install-hidden") === new Date().toDateString();
    } catch {
      return false;
    }
  });
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => force((x) => x + 1), 800);
    return () => window.clearTimeout(t);
  }, []);

  if (hidden) return null;
  const hide = () => {
    try {
      localStorage.setItem("nc-install-hidden", new Date().toDateString());
    } catch {
      /* ignore */
    }
    setHidden(true);
  };

  const state = pushState();
  if (isIOS() && !isStandalone()) {
    return (
      <div className="banner glass">
        <Smartphone />
        <div className="grow small">
          <b>Add Northcroft to your Home Screen</b>
          <div className="muted">
            In Safari tap <Share size={14} style={{ verticalAlign: "-2px" }} /> Share, then <b>Add to Home Screen</b>. iPhone only sends notifications to apps on the Home Screen.
          </div>
        </div>
        <button className="icon-btn small plain" onClick={hide} aria-label="Hide">
          <X />
        </button>
      </div>
    );
  }
  if (!isStandalone() && deferred) {
    return (
      <div className="banner glass">
        <Smartphone />
        <div className="grow small">
          <b>Install the app</b>
          <div className="muted">Opens full screen and gets notifications like any other app.</div>
        </div>
        <button
          className="btn small primary"
          onClick={async () => {
            await deferred?.prompt();
            deferred = null;
            hide();
          }}
        >
          Install
        </button>
        <button className="icon-btn small plain" onClick={hide} aria-label="Hide">
          <X />
        </button>
      </div>
    );
  }
  if (state === "default") {
    return (
      <div className="banner glass">
        <BellRing />
        <div className="grow small">
          <b>Turn on notifications</b>
          <div className="muted">Get new tasks, mentions and announcements straight on this device.</div>
        </div>
        <Link className="btn small primary" to="/settings/notifications">
          Turn on
        </Link>
        <button className="icon-btn small plain" onClick={hide} aria-label="Hide">
          <X />
        </button>
      </div>
    );
  }
  return null;
}
