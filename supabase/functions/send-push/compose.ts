// How a notification looks on the phone, WhatsApp style:
//   title: the person who did it ("Saheeb")
//   body:  what they did, then any detail, then "3 new messages" when several are waiting.
// Notifications with no person behind them (8 am reminders, tests) keep their own title.

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  actor_id: string | null;
  task_id: string | null;
  project_id: string | null;
  announcement_id: string | null;
};

export type Actor = {
  short_name: string;
  full_name: string;
  avatar_url: string | null;
  color: string | null;
};

/** "Imthath Sahulameed" -> "IS", the same rule the app uses for avatars. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function slug(link: string): string {
  return link.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Team chat, project chat, group and one-to-one messages (not task comments). */
export function isChat(n: Pick<NotificationRow, "task_id" | "link" | "type">): boolean {
  if (n.task_id || !n.link || n.type === "group_added") return false;
  return /\/chat$/.test(n.link) || /^\/chats\/[0-9a-f-]{36}$/.test(n.link);
}

/**
 * One notification per conversation: a new one replaces the last one with the same tag.
 * The app uses the same rule to clear a conversation's notifications when you open it.
 */
export function tagFor(n: Pick<NotificationRow, "id" | "task_id" | "announcement_id" | "link" | "actor_id" | "type">): string {
  // The daily update reminders (every 30 minutes until it's sent) replace each other on the phone.
  if (n.type === "daily_update" && !n.actor_id) return "daily-update";
  if (n.task_id) return `task-${n.task_id}`;
  if (n.announcement_id) return `ann-${n.announcement_id}`;
  if (n.link && n.actor_id) return `l-${slug(n.link)}`;
  return `n-${n.id}`;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function startsWithName(text: string, name: string) {
  return text.toLowerCase().startsWith(`${name.toLowerCase()} `);
}

export function compose(
  n: NotificationRow,
  actor: Actor | null,
  opts: { place?: string | null; count?: number; direct?: boolean } = {},
): { title: string; body: string } {
  if (!actor) return { title: n.title, body: n.body ?? "" };

  const name = actor.short_name;
  const count = opts.count ?? 1;
  const lines: string[] = [];

  if (isChat(n) && opts.direct) {
    // One-to-one: the sender's name is the title, so the message stands on its own.
    lines.push((n.body ?? "").trim());
  } else if (isChat(n)) {
    // "Team chat: can you send the L14 drawings?" or "Site team: ..." for a group.
    const place = opts.place?.trim() || "Team chat";
    lines.push(`${cap(place)}: ${(n.body ?? "").trim()}`);
  } else {
    // The stored title reads "Saheeb assigned you: X". The name moves to the title,
    // so the first line becomes "Assigned you a task: X".
    let action = n.title.trim();
    if (startsWithName(action, name)) action = action.slice(name.length + 1);
    action = action.replace(/^assigned you: /i, "assigned you a task: ");
    if (n.type === "announcement") {
      action = /^important: /i.test(action) ? `Important announcement: ${action.slice(11)}` : `Announcement: ${action}`;
    }
    lines.push(cap(action));

    // Skip detail lines like "Hassan marked it done": the name is already the title.
    const detail = (n.body ?? "").trim();
    if (detail && !startsWithName(detail, name)) lines.push(detail);
  }

  if (count > 1) lines.push(isChat(n) ? `${count} new messages` : `${count} new updates`);

  return { title: name, body: lines.join("\n") };
}
