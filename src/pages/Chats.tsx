// Chats, like WhatsApp: Team chat pinned on top, then project chats, groups and one-to-one chats,
// newest first, with unread counts. On a computer the list and the open chat sit side by side;
// on a phone they're separate screens.
import "@/styles/comms.css";
import "@/styles/chats.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import {
  Check,
  FolderKanban,
  Info,
  LockKeyhole,
  LogOut,
  MessageSquarePlus,
  Mic,
  Pencil,
  Search,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { useInvalidate, usePeople, useProjectMap } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useOnlineLine } from "@/lib/online";
import {
  addGroupMembers,
  createGroup,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  setGroupAdmin,
  startDirectChat,
  typingLine,
  useChats,
  useConversation,
  useTyping,
  type ChatItem,
} from "@/lib/chats";
import { errorMessage } from "@/lib/supabase";
import { dateOf, fmtDate, fmtTime12, todayISO, addDays } from "@/lib/time";
import type { Profile, Project } from "@/lib/types";
import { PageHead } from "@/components/PageHead";
import { CommentThread, chatKeyOf, type Scope } from "@/components/CommentThread";
import { Avatar, AvatarStack, Empty, Field, Loading, Pill, Sheet, useConfirm, useToast } from "@/components/ui";
import { openPersonCard } from "@/components/People";
import { LogoMark } from "@/components/Brand";
import { ChatTile } from "@/components/ChatTile";

type Selection = { kind: "team" } | { kind: "project"; projectId: string } | { kind: "conversation"; id: string } | null;

function useWide() {
  const q = "(min-width: 900px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

function when(ts: string | null) {
  if (!ts) return "";
  const d = dateOf(ts);
  if (d === todayISO()) return fmtTime12(ts);
  if (d === addDays(todayISO(), -1)) return "Yesterday";
  return fmtDate(d, { day: "numeric", month: "short" });
}

export default function Chats() {
  const me = useMe();
  const people = usePeople();
  const projects = useProjectMap();
  const location = useLocation();
  const navigate = useNavigate();
  const { id, projectId } = useParams();
  const wide = useWide();
  const chats = useChats(me.id, people);
  const [search, setSearch] = useState("");
  const [newChat, setNewChat] = useState(false);
  const [newGroup, setNewGroup] = useState(false);

  const selected: Selection =
    location.pathname === "/chat" ? { kind: "team" } : projectId ? { kind: "project", projectId } : id ? { kind: "conversation", id } : null;
  // Nothing opens by itself: opening a chat marks it read and shows others you've seen their messages.
  const shown: Selection = selected;
  const chatOpen = !wide && !!selected;

  // A phone with a chat open: hide the tab bar so the chat has the whole screen.
  useEffect(() => {
    document.documentElement.dataset.chatOpen = chatOpen ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.chatOpen;
    };
  }, [chatOpen]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? chats.items.filter((c) => c.title.toLowerCase().includes(q)) : chats.items;
  }, [chats.items, search]);

  const isActive = (c: ChatItem) =>
    !!shown &&
    ((shown.kind === "team" && c.kind === "team") ||
      (shown.kind === "project" && c.project_id === shown.projectId) ||
      (shown.kind === "conversation" && c.conversation_id === shown.id));

  const list = (
    <aside className="chat-list glass">
      <div className="chat-list-head">
        <label className="search">
          <Search />
          <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        </label>
      </div>
      <div className="chat-list-items">
        {chats.loading ? (
          <Loading rows={5} />
        ) : items.length === 0 ? (
          <Empty icon={<Search />} title="No chats match" />
        ) : (
          items.map((c) => <ChatRow key={c.chat} c={c} active={isActive(c)} meId={me.id} onOpen={() => navigate(c.to)} />)
        )}
      </div>
    </aside>
  );

  return (
    <div className={clsx("page chats-page", chatOpen && "chat-open")}>
      {!chatOpen && (
        <PageHead
          title="Chats"
          sub="Team chat, project chats, groups and one-to-one messages."
          actions={
            <>
              <button className="btn" type="button" onClick={() => setNewGroup(true)}>
                <Users /> New group
              </button>
              <button className="btn primary" type="button" onClick={() => setNewChat(true)}>
                <MessageSquarePlus /> New chat
              </button>
            </>
          }
        />
      )}
      <div className="chats-layout">
        {(wide || !selected) && list}
        {shown ? (
          <ChatPane key={JSON.stringify(shown)} sel={shown} projects={projects.byId} />
        ) : (
          wide && (
            <section className="chat-pane glass">
              <div className="chat-pane-empty">
                <Empty icon={<MessageSquarePlus />} title="Pick a chat">
                  Choose a chat on the left, or start a new one. Group and one-to-one chats are private to the people in them.
                </Empty>
              </div>
            </section>
          )
        )}
      </div>

      <NewChatSheet open={newChat} onClose={() => setNewChat(false)} />
      <NewGroupSheet open={newGroup} onClose={() => setNewGroup(false)} />
    </div>
  );
}

function ChatRow({ c, active, meId, onOpen }: { c: ChatItem; active: boolean; meId: string; onOpen: () => void }) {
  const people = usePeople();
  const projects = useProjectMap();
  const author = c.last_author === meId ? "You" : people.get(c.last_author)?.short_name;
  let preview: ReactNode = <span className="faint">No messages yet</span>;
  if (c.last_event) preview = c.last_body;
  else if (c.last_at && c.last_body) {
    const who = author && (c.kind !== "direct" || c.last_author === meId) ? `${author}: ` : "";
    preview = c.last_voice ? (
      <>
        {who}
        <Mic /> Voice note
      </>
    ) : (
      `${who}${c.last_body}`
    );
  } else if (c.kind === "team") preview = "Everyone on the team";
  return (
    <button type="button" className={clsx("chat-item", active && "active", c.unread > 0 && "unread")} onClick={onOpen}>
      <ChatTile item={c} project={projects.get(c.project_id)} person={people.get(c.other)} />
      <span className="grow">
        <span className="top">
          <span className="name">{c.title}</span>
          <span className="time">{when(c.last_at)}</span>
        </span>
        <span className="bottom">
          <span className={clsx("preview", c.last_event && "event")}>{preview}</span>
          {c.unread > 0 && <span className="badge">{c.unread > 99 ? "99+" : c.unread}</span>}
        </span>
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------- an open chat */

function ChatPane({ sel, projects }: { sel: NonNullable<Selection>; projects: Map<string, Project> }) {
  const me = useMe();
  const people = usePeople();
  const conv = useConversation(sel.kind === "conversation" ? sel.id : undefined);
  const [info, setInfo] = useState(false);

  let scope: Scope | null = null;
  let head: ReactNode = null;
  let placeholder = "Message the team";
  let priv = false;

  if (sel.kind === "team") {
    scope = { kind: "team" };
    head = (
      <>
        <LogoMark variant="tile" size={38} />
        <span className="grow">
          <b>Team chat</b>
          <TypingOr chat="team" fallback={`Everyone · ${people.active.length} people`} />
        </span>
        <AvatarStack people={people.active} size={26} max={4} />
      </>
    );
  } else if (sel.kind === "project") {
    const p = projects.get(sel.projectId);
    scope = { kind: "project", projectId: sel.projectId };
    placeholder = `Message about ${p?.code ?? p?.name ?? "this project"}`;
    head = (
      <>
        <ChatTile item={{ kind: "project", conversation_id: null, title: p?.name ?? "Project" }} project={p} small />
        <span className="grow">
          <b>{p?.name ?? "Project chat"}</b>
          <TypingOr chat={`project:${sel.projectId}`} fallback="Project chat · everyone on the team" />
        </span>
        <Link className="btn small" to={`/projects/${sel.projectId}`}>
          <FolderKanban /> Open project
        </Link>
      </>
    );
  } else if (conv.isLoading) {
    return (
      <section className="chat-pane glass">
        <Loading />
      </section>
    );
  } else if (!conv.data?.conv || !conv.data.members.some((m) => m.user_id === me.id)) {
    return (
      <section className="chat-pane glass">
        <div className="chat-pane-empty">
          <div>
            <b>This chat isn't available</b>
            <p className="small">You may have left it, or you were never part of it.</p>
            <Link className="btn" to="/chats">
              Back to chats
            </Link>
          </div>
        </div>
      </section>
    );
  } else {
    const c = conv.data.conv;
    const members = conv.data.members.map((m) => m.user_id);
    const direct = c.kind === "direct";
    const other = direct ? people.get(members.find((x) => x !== me.id)) : undefined;
    const title = direct ? other?.short_name ?? "Former team member" : c.name ?? "Group";
    priv = true;
    scope = { kind: "conversation", conversationId: c.id, direct, members };
    placeholder = direct ? `Message ${title}` : `Message ${title}`;
    const names = members
      .map((x) => (x === me.id ? null : people.get(x)?.short_name))
      .filter(Boolean)
      .join(", ");
    head = (
      <button type="button" className="who" onClick={() => (direct && other ? openPersonCard(other.id) : setInfo(true))}>
        <ChatTile item={{ kind: c.kind, conversation_id: c.id, title }} person={other} small />
        <span className="grow">
          <b>{title}</b>
          <TypingOr chat={`conv:${c.id}`} fallback={direct ? other?.title ?? "" : `${names}${names ? ", " : ""}You`} person={direct ? other?.id : undefined} />
        </span>
        <Info className="faint" size={18} />
      </button>
    );
  }

  return (
    <section className="chat-pane glass">
      <div className="chat-pane-head">{head}</div>
      <div className="chat-pane-body">
        {priv && (
          <div className="chat-private">
            <LockKeyhole /> Private: only the people in this chat can see it
          </div>
        )}
        {scope && <CommentThread key={chatKeyOf(scope) ?? "x"} scope={scope} placeholder={placeholder} fill />}
      </div>
      {sel.kind === "conversation" && conv.data?.conv?.kind === "group" && (
        <GroupInfoSheet open={info} onClose={() => setInfo(false)} conversationId={sel.id} />
      )}
    </section>
  );
}

/**
 * The chat's subtitle, replaced by "Saheeb is typing..." while someone types. In a one-to-one chat
 * it says "Online" or when they were last on, like WhatsApp.
 */
function TypingOr({ chat, fallback, person }: { chat: string; fallback: string; person?: string }) {
  const me = useMe();
  const people = usePeople();
  const { typers } = useTyping(chat, me.id);
  const seen = useOnlineLine(person);
  const line = typingLine(typers.map((id) => people.get(id)?.short_name).filter((n): n is string => !!n));
  return <span className={clsx("sub", line && "typing", !line && seen.online && "online")}>{line ?? seen.text ?? fallback}</span>;
}

/* ---------------------------------------------------------------- starting chats */

function PeoplePicker({
  people,
  picked,
  onToggle,
  single,
}: {
  people: Profile[];
  picked: string[];
  onToggle: (id: string) => void;
  single?: boolean;
}) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => !q.trim() || `${p.full_name} ${p.short_name} ${p.title}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="stack" style={{ gap: 10 }}>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" />
      <div className="pick-list">
        {list.length === 0 && <div className="faint small" style={{ padding: 8 }}>Nobody matches.</div>}
        {list.map((p) => {
          const on = picked.includes(p.id);
          return (
            <button key={p.id} type="button" className={clsx("pick-row", on && "on")} onClick={() => onToggle(p.id)} aria-pressed={single ? undefined : on}>
              <Avatar person={p} size={38} />
              <span className="grow">
                <b>{p.short_name}</b>
                <span>{p.title}</span>
              </span>
              {!single && <span className="check">{on && <Check />}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewChatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const people = usePeople();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  async function start(userId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const id = await startDirectChat(userId);
      await invalidate("chats", "conversations");
      onClose();
      navigate(`/chats/${id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="New chat">
      <p className="muted small" style={{ marginTop: 0 }}>
        A one-to-one chat. Only the two of you can see it.
      </p>
      <PeoplePicker people={people.active.filter((p) => p.id !== me.id)} picked={[]} onToggle={start} single />
    </Sheet>
  );
}

function NewGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const people = usePeople();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      setName("");
      setPicked([]);
    }
  }, [open]);
  async function create() {
    setBusy(true);
    try {
      const id = await createGroup(name.trim(), picked);
      await invalidate("chats", "conversations");
      onClose();
      navigate(`/chats/${id}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New group"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={create} disabled={busy || !name.trim() || picked.length === 0}>
            <Users /> {busy ? "Creating..." : `Create group${picked.length ? ` (${picked.length + 1})` : ""}`}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Group name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </Field>
        {picked.length > 0 && (
          <div className="picked">
            {picked.map((id) => (
              <Pill key={id} tone="blue">
                {people.get(id)?.short_name}
              </Pill>
            ))}
          </div>
        )}
        <div>
          <div className="seen-head" style={{ marginBottom: 8 }}>
            Who's in it
          </div>
          <PeoplePicker
            people={people.active.filter((p) => p.id !== me.id)}
            picked={picked}
            onToggle={(id) => setPicked((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))}
          />
        </div>
        <p className="faint tiny" style={{ margin: 0 }}>
          You'll be the group's admin. Only the people in the group can see its messages and files.
        </p>
      </div>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- group info */

function GroupInfoSheet({ open, onClose, conversationId }: { open: boolean; onClose: () => void; conversationId: string }) {
  const me = useMe();
  const people = usePeople();
  const conv = useConversation(conversationId);
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const c = conv.data?.conv;
  const members = conv.data?.members ?? [];
  const amAdmin = members.some((m) => m.user_id === me.id && m.is_admin);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      await invalidate("conversations", "chats", "comments");
      if (done) toast(done);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    const ok = await confirm({
      title: `Leave ${c?.name ?? "this group"}?`,
      message: "You'll stop getting its messages and won't be able to read it any more. An admin can add you back.",
      confirmLabel: "Leave group",
      danger: true,
    });
    if (!ok) return;
    await run(() => leaveGroup(conversationId));
    onClose();
    navigate("/chats");
  }

  async function remove(userId: string) {
    const ok = await confirm({
      title: `Remove ${people.get(userId)?.short_name ?? "them"}?`,
      message: "They'll stop getting this group's messages and won't be able to read it.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) await run(() => removeGroupMember(conversationId, userId));
  }

  const others = people.active.filter((p) => p.id !== me.id && !members.some((m) => m.user_id === p.id));

  return (
    <Sheet open={open} onClose={onClose} title={adding ? "Add people" : "Group info"}>
      {!c ? (
        <Loading />
      ) : adding ? (
        <div className="stack" style={{ gap: 12 }}>
          <PeoplePicker people={others} picked={adding} onToggle={(id) => setAdding((xs) => (xs!.includes(id) ? xs!.filter((x) => x !== id) : [...xs!, id]))} />
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" type="button" onClick={() => setAdding(null)}>
              Back
            </button>
            <button
              className="btn primary"
              type="button"
              disabled={busy || adding.length === 0}
              onClick={() => run(() => addGroupMembers(conversationId, adding), adding.length === 1 ? "Added" : `Added ${adding.length} people`).then(() => setAdding(null))}
            >
              <UserPlus /> Add {adding.length || ""}
            </button>
          </div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 12 }}>
            <ChatTile item={{ kind: "group", conversation_id: c.id, title: c.name ?? "Group" }} />
            {renaming !== null ? (
              <form
                className="row grow"
                style={{ gap: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => renameGroup(conversationId, renaming), "Group renamed").then(() => setRenaming(null));
                }}
              >
                <input className="input" value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={80} autoFocus aria-label="Group name" />
                <button className="btn primary small" type="submit" disabled={busy || !renaming.trim()}>
                  Save
                </button>
              </form>
            ) : (
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="bold ellipsis" style={{ fontSize: 17 }}>
                  {c.name}
                </div>
                <div className="muted small">
                  Group · {members.length} {members.length === 1 ? "person" : "people"}
                </div>
              </div>
            )}
            {amAdmin && renaming === null && (
              <button className="icon-btn small" type="button" onClick={() => setRenaming(c.name ?? "")} aria-label="Rename the group">
                <Pencil />
              </button>
            )}
          </div>

          <div>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
              <div className="seen-head">People</div>
              {amAdmin && others.length > 0 && (
                <button className="btn small" type="button" onClick={() => setAdding([])}>
                  <UserPlus /> Add people
                </button>
              )}
            </div>
            {members.map((m) => {
              const p = people.get(m.user_id);
              const isMe = m.user_id === me.id;
              return (
                <div className="member-row" key={m.user_id}>
                  <button type="button" className="avatar-btn" onClick={() => p && openPersonCard(p.id)} aria-label={`${p?.full_name ?? "Someone"}'s profile`}>
                    <Avatar person={p} size={36} />
                  </button>
                  <div className="grow">
                    <b>
                      {isMe ? "You" : p?.short_name ?? "Former team member"} {m.is_admin && <Pill tone="blue">Admin</Pill>}
                    </b>
                    <span>{p?.title}</span>
                  </div>
                  {amAdmin && !isMe && (
                    <div className="acts">
                      <button
                        className="btn small ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => setGroupAdmin(conversationId, m.user_id, !m.is_admin))}
                        title={m.is_admin ? "Make them a member (not an admin)" : "Make them an admin"}
                      >
                        <ShieldCheck /> {m.is_admin ? "Make member" : "Make admin"}
                      </button>
                      <button className="btn small ghost" type="button" disabled={busy} onClick={() => remove(m.user_id)} aria-label={`Remove ${p?.short_name ?? "them"}`} title="Remove">
                        <UserMinus />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button className="btn danger" type="button" onClick={leave} disabled={busy}>
            <LogOut /> Leave group
          </button>
          {!amAdmin && <p className="faint tiny" style={{ margin: 0 }}>Only the group's admins can rename it and add or remove people.</p>}
        </div>
      )}
    </Sheet>
  );
}
