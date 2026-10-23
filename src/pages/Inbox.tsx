import "@/styles/comms.css";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  Archive,
  ArchiveRestore,
  AtSign,
  Bell,
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  CircleCheck,
  ClipboardList,
  Clock,
  FileText,
  Inbox as InboxIcon,
  Layers,
  ListChecks,
  Mail,
  MailOpen,
  Megaphone,
  MessageCircle,
  MessagesSquare,
  RotateCcw,
  Send,
  SquareCheckBig,
  TriangleAlert,
  type LucideIcon,
  LogIn,
  LogOut,
} from "lucide-react";
import { PageHead } from "@/components/PageHead";
import { Avatar, Empty, Loading, Segmented, useToast } from "@/components/ui";
import { useInvalidate, usePeople, useTasks } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { errorMessage, supabase } from "@/lib/supabase";
import { dateOf, diffDays, timeAgo, todayISO } from "@/lib/time";
import type { Notification } from "@/lib/types";
import { useNotifications } from "./home/data";

type View = "all" | "unread" | "mentions" | "assigned" | "by_me" | "archived";

const TYPE_META: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  task_assigned: { icon: SquareCheckBig, color: "#0A84FF", label: "New task" },
  task_submitted: { icon: Send, color: "#BF5AF2", label: "Submitted for review" },
  task_approved: { icon: CircleCheck, color: "#30D158", label: "Approved" },
  task_changes: { icon: RotateCcw, color: "#FF9F0A", label: "Changes requested" },
  task_reopened: { icon: RotateCcw, color: "#FF9F0A", label: "Reopened" },
  task_updated: { icon: CalendarClock, color: "#5AC8FA", label: "Task updated" },
  checklist_assigned: { icon: ListChecks, color: "#0A84FF", label: "Checklist step" },
  mention: { icon: AtSign, color: "#FF375F", label: "Mention" },
  comment: { icon: MessageCircle, color: "#30B0C7", label: "Comment" },
  chat: { icon: MessagesSquare, color: "#30D158", label: "Message" },
  group_added: { icon: MessagesSquare, color: "#30D158", label: "Group" },
  announcement: { icon: Megaphone, color: "#FF9F0A", label: "Announcement" },
  ack_nudge: { icon: BellRing, color: "#FF9F0A", label: "Reminder" },
  due_soon: { icon: Clock, color: "#FF9F0A", label: "Due soon" },
  due_today: { icon: Clock, color: "#FF9F0A", label: "Due today" },
  overdue: { icon: TriangleAlert, color: "#FF3B30", label: "Overdue" },
  review_digest: { icon: ClipboardList, color: "#BF5AF2", label: "Review" },
  event: { icon: CalendarDays, color: "#0A84FF", label: "Calendar" },
  event_today: { icon: CalendarDays, color: "#0A84FF", label: "Today" },
  vo_assigned: { icon: FileText, color: "#BF5AF2", label: "Variation" },
  vo_update: { icon: FileText, color: "#BF5AF2", label: "Variation" },
  vo_due: { icon: FileText, color: "#FF3B30", label: "Variation" },
  boq_assigned: { icon: Layers, color: "#30B0C7", label: "BOQ" },
  boq_update: { icon: Layers, color: "#30B0C7", label: "BOQ" },
  boq_due: { icon: Layers, color: "#FF3B30", label: "BOQ" },
  checkin_reminder: { icon: LogIn, color: "#0A84FF", label: "Check in" },
  checkout_reminder: { icon: LogOut, color: "#FF9F0A", label: "Check out" },
  test: { icon: Bell, color: "#8E8E93", label: "Test" },
};
const ASSIGNED = new Set(["task_assigned", "checklist_assigned", "vo_assigned", "boq_assigned"]);

function meta(type: string) {
  return TYPE_META[type] ?? { icon: Bell, color: "#8E8E93", label: "Update" };
}

export default function Inbox() {
  const me = useMe();
  const people = usePeople();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [view, setView] = useState<View>("all");
  const q = useNotifications(me.id);
  const createdByMe = useTasks({ createdBy: me.id });
  const myTaskIds = useMemo(() => new Set((createdByMe.data ?? []).map((t) => t.id)), [createdByMe.data]);

  const all = q.data ?? [];
  const live = all.filter((n) => !n.archived_at);
  const unreadCount = live.filter((n) => !n.read_at).length;

  const list = useMemo(() => {
    switch (view) {
      case "unread":
        return live.filter((n) => !n.read_at);
      case "mentions":
        return live.filter((n) => n.type === "mention");
      case "assigned":
        return live.filter((n) => ASSIGNED.has(n.type));
      case "by_me":
        return live.filter((n) => n.task_id && myTaskIds.has(n.task_id));
      case "archived":
        return all.filter((n) => n.archived_at);
      default:
        return live;
    }
  }, [view, all, live, myTaskIds]);

  const groups = useMemo(() => {
    const today = todayISO();
    const out: { label: string; items: Notification[] }[] = [];
    for (const n of list) {
      const d = diffDays(today, dateOf(n.created_at));
      const label = d <= 0 ? "Today" : d === 1 ? "Yesterday" : d < 7 ? "This week" : "Earlier";
      const g = out.find((x) => x.label === label);
      if (g) g.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [list]);

  async function update(ids: string[], patch: Partial<Pick<Notification, "read_at" | "archived_at">>) {
    if (!ids.length) return;
    const { error } = await supabase.from("notifications").update(patch).in("id", ids);
    if (error) toast(errorMessage(error), "error");
    await invalidate("notifications");
  }

  async function open(n: Notification) {
    if (!n.read_at) update([n.id], { read_at: new Date().toISOString() });
    if (n.link) navigate(n.link);
  }

  async function markAllRead() {
    const ids = live.filter((n) => !n.read_at).map((n) => n.id);
    await update(ids, { read_at: new Date().toISOString() });
    toast("All caught up");
  }

  const options: { value: View; label: string; count?: number }[] = [
    { value: "all", label: "All" },
    { value: "unread", label: "Unread", count: unreadCount || undefined },
    { value: "mentions", label: "Mentions" },
    { value: "assigned", label: "Assigned to me" },
    { value: "by_me", label: "Assigned by me" },
    { value: "archived", label: "Archived" },
  ];

  return (
    <div className="page">
      <PageHead
        title="Inbox"
        sub={unreadCount ? `${unreadCount} unread` : "You're all caught up"}
        actions={
          unreadCount > 0 && (
            <button className="btn glassy" onClick={markAllRead}>
              <CheckCheck /> Mark all read
            </button>
          )
        }
      />
      <div className="inbox-toolbar">
        <Segmented value={view} onChange={setView} options={options} />
      </div>

      <div className="glass card" style={{ padding: 8 }}>
        {q.isLoading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={<InboxIcon />} title={view === "archived" ? "Nothing archived" : view === "unread" ? "No unread notifications" : "Nothing here yet"}>
            {view === "all"
              ? "New tasks, mentions, reviews and announcements will show up here, and on your phone if notifications are on."
              : view === "by_me"
                ? "Updates on tasks you've assigned, like submissions and comments, land here."
                : null}
          </Empty>
        ) : (
          groups.map((g) => (
            <div key={g.label}>
              <div className="section-title" style={{ margin: "10px 10px 4px" }}>
                {g.label}
              </div>
              {g.items.map((n) => {
                const m = meta(n.type);
                const Icon = m.icon;
                const actor = people.get(n.actor_id);
                return (
                  <div
                    key={n.id}
                    className={clsx("notif", !n.read_at && !n.archived_at && "unread")}
                    role="button"
                    tabIndex={0}
                    onClick={() => open(n)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(n))}
                  >
                    <span className="lead">
                      {actor ? (
                        <>
                          <Avatar person={actor} size={38} />
                          <span className="type" style={{ background: m.color }}>
                            <Icon />
                          </span>
                        </>
                      ) : (
                        <span className="sys" style={{ background: `linear-gradient(145deg, ${m.color}, color-mix(in srgb, ${m.color} 70%, #000))` }}>
                          <Icon />
                        </span>
                      )}
                    </span>
                    <span className="content">
                      <span className="t" style={{ display: "block" }}>
                        {n.title}
                      </span>
                      {n.body && <span className="b">{n.body}</span>}
                    </span>
                    <span className="side">
                      <span className="row" style={{ gap: 6 }}>
                        <span className="when">{timeAgo(n.created_at)}</span>
                        {!n.read_at && !n.archived_at && <i className="notice-dot" aria-label="Unread" />}
                      </span>
                      <span className="acts" onClick={(e) => e.stopPropagation()}>
                        {!n.archived_at && (
                          <button
                            className="icon-btn small plain"
                            title={n.read_at ? "Mark as unread" : "Mark as read"}
                            aria-label={n.read_at ? "Mark as unread" : "Mark as read"}
                            onClick={() => update([n.id], { read_at: n.read_at ? null : new Date().toISOString() })}
                          >
                            {n.read_at ? <Mail /> : <MailOpen />}
                          </button>
                        )}
                        <button
                          className="icon-btn small plain"
                          title={n.archived_at ? "Move back to inbox" : "Archive"}
                          aria-label={n.archived_at ? "Move back to inbox" : "Archive"}
                          onClick={() =>
                            update(
                              [n.id],
                              n.archived_at ? { archived_at: null } : { archived_at: new Date().toISOString(), read_at: n.read_at ?? new Date().toISOString() },
                            )
                          }
                        >
                          {n.archived_at ? <ArchiveRestore /> : <Archive />}
                        </button>
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
