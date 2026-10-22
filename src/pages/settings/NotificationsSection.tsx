import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellOff, BellRing, CircleCheck, Send, Share, SquarePlus, Smartphone } from "lucide-react";
import { useMe } from "@/lib/auth";
import { disablePush, enablePush, isIOS, pushState, type PushState } from "@/lib/push";
import { errorMessage, supabase } from "@/lib/supabase";
import { Pill, useToast } from "@/components/ui";
import { Section } from "./common";

const TRIGGERS = [
  "Someone assigns you a task or a checklist step",
  "Work is submitted for your review",
  "Your work is approved, or changes are requested",
  "New messages in team chat and project chats, with the sender's name and photo",
  "Someone @mentions you in a task",
  "New comments on tasks you follow",
  "New announcements, and a reminder if you haven't acknowledged one",
  "Calendar events you're added to",
  "8:00 am reminders, Sunday to Thursday, for work due today, due next and overdue",
];

export function NotificationsSection() {
  const me = useMe();
  const toast = useToast();
  const [state, setState] = useState<PushState>(() => pushState());
  const [busy, setBusy] = useState(false);

  const devices = useQuery({
    queryKey: ["push_subscriptions", me.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("push_subscriptions").select("id, user_agent, last_seen_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  async function turnOn() {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "granted") toast("Notifications are on for this device");
      else if (s === "denied") toast("Notifications were blocked. See the steps below to allow them.", "error");
      devices.refetch();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await disablePush();
      toast("Notifications are off for this device", "info");
      devices.refetch();
      setState(pushState());
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc("send_test_push");
      if (error) throw error;
      toast("Test sent. It should arrive in a few seconds.", "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const count = devices.data?.length ?? 0;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Section title="Notifications" sub="Get tasks, mentions and announcements on your phone the moment they happen.">
        {state === "granted" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row status-row">
              <CircleCheck className="success-text" size={22} />
              <div className="grow">
                <b>On for this device</b>
                <div className="muted small">
                  {count > 1 ? `You'll get notifications on ${count} devices.` : "You'll get notifications here."}
                </div>
              </div>
            </div>
            <div className="row wrap">
              <button className="btn primary" onClick={test} disabled={busy} type="button">
                <Send /> Send a test notification
              </button>
              <button className="btn" onClick={turnOff} disabled={busy} type="button">
                <BellOff /> Turn off for this device
              </button>
            </div>
          </div>
        )}

        {state === "default" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row status-row">
              <BellRing className="muted" size={22} />
              <div className="grow">
                <b>Notifications are off on this device</b>
                <div className="muted small">Your phone will ask for permission. Tap Allow.</div>
              </div>
            </div>
            <button className="btn primary large" onClick={turnOn} disabled={busy} type="button" style={{ alignSelf: "flex-start" }}>
              <BellRing /> {busy ? "Turning on..." : "Turn on notifications"}
            </button>
          </div>
        )}

        {state === "needs-install" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row status-row">
              <Smartphone className="muted" size={22} />
              <div className="grow">
                <b>Add Northcroft to your Home Screen first</b>
                <div className="muted small">On iPhone, notifications only work for apps opened from the Home Screen.</div>
              </div>
            </div>
            <ol className="steps small">
              <li>Open this page in <b>Safari</b>.</li>
              <li>
                Tap the <b>Share</b> button <Share size={15} style={{ verticalAlign: "-2px" }} /> at the bottom of the screen.
              </li>
              <li>
                Scroll down and tap <b>Add to Home Screen</b> <SquarePlus size={15} style={{ verticalAlign: "-2px" }} />, then tap <b>Add</b>.
              </li>
              <li>Open Northcroft from your Home Screen, sign in, and come back to Settings, then Notifications.</li>
              <li>
                Tap <b>Turn on notifications</b> and choose <b>Allow</b>.
              </li>
            </ol>
            <div className="muted tiny">Needs iOS 16.4 or newer.</div>
          </div>
        )}

        {state === "denied" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row status-row">
              <BellOff className="danger-text" size={22} />
              <div className="grow">
                <b>Notifications are blocked</b>
                <div className="muted small">They were turned down on this device. Here's how to allow them again:</div>
              </div>
            </div>
            <ul className="steps small">
              {isIOS() ? (
                <li>
                  iPhone: open <b>Settings</b>, then <b>Notifications</b>, find <b>Northcroft</b> and switch on <b>Allow Notifications</b>.
                </li>
              ) : (
                <>
                  <li>
                    Android: tap the icon to the left of the web address, then <b>Permissions</b>, then <b>Notifications</b> and choose <b>Allow</b>. For the installed app, long-press its icon, tap <b>App info</b>, then <b>Notifications</b>.
                  </li>
                  <li>
                    Computer: click the icon to the left of the web address and set <b>Notifications</b> to <b>Allow</b>.
                  </li>
                </>
              )}
              <li>Then reload this page.</li>
            </ul>
          </div>
        )}

        {state === "unsupported" && (
          <div className="row status-row">
            <BellOff className="muted" size={22} />
            <div className="grow">
              <b>This browser can't receive notifications</b>
              <div className="muted small">Use Safari on iPhone (added to the Home Screen), or Chrome or Edge on Android and computers.</div>
            </div>
          </div>
        )}
      </Section>

      <Section title="What you'll be told about" sub="Everything also lands in your Inbox, so nothing gets lost if a notification is missed.">
        <div className="list">
          {TRIGGERS.map((t) => (
            <div className="list-item small" key={t}>
              <BellRing size={16} className="muted" style={{ flexShrink: 0 }} />
              <span>{t}</span>
            </div>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 6 }}>
          <Pill tone="blue">Reminders only on working days</Pill>
          <Pill>Riyadh time</Pill>
        </div>
      </Section>
    </div>
  );
}
