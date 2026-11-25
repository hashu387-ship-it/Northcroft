// Everything the iPhone app does that the website doesn't, wired to the app (loaded only inside the
// app, see AppShell):
//   Notifications: registers the phone with Apple, and acts on the buttons: Approve or Decline a
//     missed check-in or leave request, Reply to a chat. Tapping a notification opens its page.
//   Check-in at the office: tells the phone where the offices are, and when someone opens the app
//     after the "You're at the office" notice, checks them in (the office-only rule still applies).
//   Share into Northcroft: files shared from other apps open the Share screen.
//   Siri, Shortcuts, the app icon's press-and-hold menu and the widget: Check in, Scan a document,
//     My tasks, Chats (the phone keeps the action until this takes it, see LaunchActions.swift).
//   The home screen widget: keeps its copy of today's check-in and tasks due up to date.
//   The status bar follows the look (light text on dark looks).
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { App } from "@capacitor/app";
import { PushNotifications, type ActionPerformed } from "@capacitor/push-notifications";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { useInvalidate, useProjectMap, useSettings, useTasks } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { decideCheckinFix } from "@/lib/checkinFix";
import { getPosition } from "@/lib/geo";
import { setLeaveStatus } from "@/lib/leave";
import { saveShare, type SharedFile } from "@/lib/share";
import { errorMessage, supabase } from "@/lib/supabase";
import { fmtDue, fmtTime12, todayISO } from "@/lib/time";
import type { Attendance } from "@/lib/types";
import { useToast } from "@/components/ui";
import { useAttendanceOn } from "@/pages/home/data";
import { usePlaces } from "@/pages/attendance/shared";
import { NorthcroftNative, type LaunchAction, type WidgetSnapshot } from "./plugin";
import { PREF, usePref } from "./prefs";
import { refreshNativePushState, saveNativeToken, enableNativePush } from "./push";
import { scanToShare } from "./scan";

const ASKED_KEY = "nc-native-push-asked";

/** Where a chat notification's reply goes, from its link. */
function chatTarget(url: string): { task_id: null; project_id: string | null; conversation_id: string | null } | null {
  const path = url.split("?")[0];
  if (path === "/chat") return { task_id: null, project_id: null, conversation_id: null };
  const project = /^\/projects\/([0-9a-f-]{36})\/chat$/.exec(path);
  if (project) return { task_id: null, project_id: project[1], conversation_id: null };
  const conv = /^\/chats\/([0-9a-f-]{36})$/.exec(path);
  if (conv) return { task_id: null, project_id: null, conversation_id: conv[1] };
  return null;
}

export default function NativeBridge() {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const settings = useSettings().data;
  const places = usePlaces();
  const today = todayISO();
  const todayRow = useAttendanceOn(today, me.id);
  const officeOn = usePref(PREF.officeWatch);
  const myOpen = useTasks({ assigneeId: me.id, openOnly: true });
  const projects = useProjectMap();
  const busy = useRef(false);

  // Latest values for the listeners, which are set up once.
  const todayRec = (todayRow.data ?? [])[0] as Attendance | undefined;
  const live = useRef({ me, navigate, toast, invalidate, today, checkedIn: false, checkInAt: null as string | null });
  live.current = { me, navigate, toast, invalidate, today, checkedIn: !!todayRec, checkInAt: todayRec?.check_in_at ?? null };

  /* -------------------------------------------------------------- look */
  useEffect(() => {
    void SplashScreen.hide().catch(() => undefined);
    const apply = () => {
      const dark = document.documentElement.dataset.theme !== "light";
      void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);

  /* -------------------------------------------------------------- notifications */
  const onAction = useCallback(async (a: ActionPerformed) => {
    const { me, navigate, toast, invalidate } = live.current;
    const data = (a.notification.data ?? {}) as { url?: string; id?: string; type?: string; ref?: string };
    const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/inbox";
    if (data.id) void supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", data.id).is("read_at", null);
    try {
      if ((a.actionId === "approve" || a.actionId === "decline") && data.ref) {
        const approve = a.actionId === "approve";
        if (data.type === "checkin_request") {
          await decideCheckinFix(data.ref, approve);
          toast(approve ? "Approved. The day is recorded." : "Declined. They'll be told.");
          await invalidate("checkin_requests", "attendance");
          navigate("/attendance");
          return;
        }
        if (data.type === "leave_request") {
          await setLeaveStatus(data.ref, approve ? "approved" : "declined");
          toast(approve ? "Leave approved" : "Leave declined");
          await invalidate("leave_requests");
          navigate(`/attendance?leave=${data.ref}`);
          return;
        }
      }
      if (a.actionId === "reply" && a.inputValue?.trim()) {
        const where = chatTarget(url);
        if (where) {
          const { error } = await supabase.from("comments").insert({
            id: crypto.randomUUID(),
            body: a.inputValue.trim(),
            mentions: [],
            author_id: me.id,
            ...where,
            reply_to: null,
          });
          if (error) throw error;
          toast("Reply sent");
          await invalidate("comments", "chats");
        }
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    }
    navigate(url);
  }, []);

  useEffect(() => {
    const subs = [
      PushNotifications.addListener("registration", (t) => {
        void saveNativeToken(t.value).catch((e) => console.warn("Couldn't save the phone for notifications", e));
      }),
      PushNotifications.addListener("registrationError", (e) => console.warn("Notifications registration failed", e)),
      // While the app is open: refresh the inbox and counts (iOS also shows the banner).
      PushNotifications.addListener("pushNotificationReceived", () => {
        void live.current.invalidate("notifications");
      }),
      PushNotifications.addListener("pushNotificationActionPerformed", (a) => void onAction(a)),
    ];
    void (async () => {
      const state = await refreshNativePushState().catch(() => "default" as const);
      if (state === "granted") {
        await PushNotifications.register().catch(() => undefined);
      } else if (state === "default") {
        // Ask once, a moment after the app first opens.
        let asked = false;
        try {
          asked = localStorage.getItem(ASKED_KEY) === "1";
          localStorage.setItem(ASKED_KEY, "1");
        } catch {
          /* private mode */
        }
        if (!asked) window.setTimeout(() => void enableNativePush().catch(() => undefined), 2500);
      }
    })();
    return () => {
      subs.forEach((p) => void p.then((h) => h.remove()));
    };
  }, [onAction]);

  /* -------------------------------------------------------------- check-in at the office */
  // Tell the phone where the offices are (or stop watching).
  useEffect(() => {
    if (me.attendance_exempt || !officeOn) {
      void NorthcroftNative.officeStop().catch(() => undefined);
      return;
    }
    const offices = (places.data ?? [])
      .filter((p) => p.active && p.kind === "office")
      .map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, radius: p.radius_m }));
    if (!offices.length) return;
    void NorthcroftNative.officeWatch({ offices, workDays: settings?.work_days ?? [0, 1, 2, 3, 4] }).catch(() => undefined);
  }, [me.attendance_exempt, officeOn, places.data, settings?.work_days]);

  // Checked in today (here or on another device): no arrival notice today.
  useEffect(() => {
    if ((todayRow.data ?? []).length > 0) void NorthcroftNative.officeMarkCheckedIn({ day: today }).catch(() => undefined);
  }, [todayRow.data, today]);

  /* -------------------------------------------------------------- check in now */
  // From an arrival at the office, Siri, the app icon or the widget. The office-only rule still
  // applies (the server checks where the phone is).
  const checkInNow = useCallback(async () => {
    const { navigate, toast, invalidate, today } = live.current;
    try {
      const fix = await getPosition();
      const { data, error } = await supabase.rpc("check_in", {
        p_lat: fix.lat,
        p_lng: fix.lng,
        p_accuracy: fix.accuracy,
        p_address: null,
        p_note: null,
      });
      if (error) throw error;
      const rec = data as Attendance;
      toast(`Checked in at ${fmtTime12(rec.check_in_at)}${rec.in_place_name ? `, ${rec.in_place_name}` : ""}`);
      await NorthcroftNative.officeMarkCheckedIn({ day: today });
      await invalidate("attendance");
    } catch (e) {
      const msg = errorMessage(e);
      if (/already checked in/i.test(msg)) {
        await NorthcroftNative.officeMarkCheckedIn({ day: today });
      } else {
        toast(`Couldn't check you in: ${msg}`, "error");
        navigate("/attendance");
      }
    }
  }, []);

  /* -------------------------------------------------------------- Siri, app icon and widget actions */
  const runAction = useCallback(
    async (action: LaunchAction) => {
      const { me, navigate, toast, checkedIn, checkInAt } = live.current;
      switch (action) {
        case "checkin":
          if (me.attendance_exempt) {
            navigate("/attendance");
          } else if (checkedIn) {
            toast(checkInAt ? `You checked in at ${fmtTime12(checkInAt)}` : "You've already checked in today");
          } else {
            await checkInNow();
          }
          return;
        case "scan":
          await scanToShare(navigate, toast);
          return;
        case "tasks":
          navigate("/my-tasks");
          return;
        case "chats":
          navigate("/chats");
          return;
      }
    },
    [checkInNow],
  );

  /* -------------------------------------------------------------- on opening the app */
  const onOpen = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const { navigate } = live.current;
    try {
      // 0. Opened from Siri, Shortcuts, the app icon's menu or the widget.
      const { action } = await NorthcroftNative.takeLaunchAction().catch(() => ({}) as { action?: LaunchAction });
      if (action) {
        await runAction(action);
        return;
      }

      // 1. Files shared in from another app.
      const { batch } = await NorthcroftNative.shareInbox().catch(() => ({ batch: undefined }));
      if (batch) {
        const files: SharedFile[] = [];
        for (const f of batch.files ?? []) {
          try {
            const { data } = await NorthcroftNative.readShared({ path: `${batch.dir}/${f.file}` });
            const blob = await (await fetch(`data:${f.type || "application/octet-stream"};base64,${data}`)).blob();
            files.push({ blob, name: f.name, type: f.type || blob.type });
          } catch {
            /* a file that can't be read is left out */
          }
        }
        await saveShare({ id: "current", at: batch.at, title: batch.title ?? "", text: batch.text ?? "", url: batch.url ?? "", files });
        await NorthcroftNative.clearShared({ id: batch.id });
        navigate("/share");
        return;
      }

      // 2. Arrived at the office: check in.
      const arrival = await NorthcroftNative.officePending().catch(() => ({}) as { kind?: "in" });
      if (arrival.kind === "in" && !live.current.checkedIn && !live.current.me.attendance_exempt) {
        await checkInNow();
      }
    } finally {
      busy.current = false;
    }
  }, [runAction, checkInNow]);

  useEffect(() => {
    // Give the first data a moment, so "already checked in today" is known.
    const first = window.setTimeout(() => void onOpen(), 1800);
    const sub = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) window.setTimeout(() => void onOpen(), 400);
    });
    // An action while the app is already open (Siri, the app icon or the widget).
    const action = NorthcroftNative.addListener("launchAction", () => {
      window.setTimeout(() => void onOpen(), 300);
    }).catch(() => undefined);
    return () => {
      window.clearTimeout(first);
      void sub.then((h) => h.remove());
      void action.then((h) => h?.remove());
    };
  }, [onOpen]);

  /* -------------------------------------------------------------- the home screen widget */
  // Today's check-in and the open tasks due today or late, for the widget to show.
  const widget = useMemo<WidgetSnapshot | null>(() => {
    if (!todayRow.data || !myOpen.data) return null;
    const due = myOpen.data
      .filter((t) => (t.status === "todo" || t.status === "in_progress") && t.hold !== "on" && !!t.due_date && t.due_date <= today)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : 0));
    return {
      day: today,
      firstName: me.full_name.split(" ")[0],
      exempt: !!me.attendance_exempt,
      checkedIn: !!todayRec,
      checkInAt: todayRec ? fmtTime12(todayRec.check_in_at) : undefined,
      checkedOut: !!todayRec?.check_out_at,
      checkOutAt: todayRec?.check_out_at ? fmtTime12(todayRec.check_out_at) : undefined,
      place: todayRec?.in_place_name ?? undefined,
      dueToday: due.filter((t) => t.due_date === today).length,
      late: due.filter((t) => t.due_date! < today).length,
      tasks: due.slice(0, 5).map((t) => ({
        id: t.id,
        title: t.title,
        due: fmtDue(t.due_date),
        project: projects.get(t.project_id)?.name,
        late: t.due_date! < today,
      })),
    };
  }, [todayRow.data, todayRec, myOpen.data, projects, today, me.full_name, me.attendance_exempt]);

  const widgetKey = widget ? JSON.stringify(widget) : "";
  useEffect(() => {
    if (!widget) return;
    void NorthcroftNative.updateWidget(widget).catch(() => undefined);
    // Only when something it shows has changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetKey]);

  return null;
}
