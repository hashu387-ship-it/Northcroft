import "@/styles/chats.css";
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowDown,
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  EllipsisVertical,
  FileText,
  Info,
  Link2,
  MessageCircle,
  Mic,
  Paperclip,
  SendHorizontal,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { unwrap, useInvalidate, usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { REACTIONS, reactionInfo, setReaction, typingLine, useChatReads, useKeepRead, useReactions, useTyping } from "@/lib/chats";
import { deleteAttachment, isImage, isOnDrive, previewUrls, uploadFile } from "@/lib/files";
import { addDriveLinks, useMessageDriveLinks, type LinkInfo } from "@/lib/drivelinks";
import { useMarkSeen } from "@/lib/seen";
import { errorMessage, isNetworkError, supabase } from "@/lib/supabase";
import { keepFiles, queueMessage } from "@/lib/outbox";
import { PendingMessages, outboxChat } from "./Offline";
import { fmtDue, dateOf, fmtTime12, todayISO } from "@/lib/time";
import { fileSize } from "@/lib/format";
import type { Attachment, Comment, Profile, ReactionKind } from "@/lib/types";
import { Avatar, Empty, Loading, Sheet, useConfirm, useToast } from "./ui";
import { PersonAvatar, openPersonCard } from "./People";
import { RecorderBar, VoiceNote } from "./Voice";
import { useOpenFile } from "./useOpenFile";
import { AddDriveLinkSheet, LinkCard } from "./DriveLinks";
import { canRecord, uploadVoice, useRecorder, voiceLabel, type Recording } from "@/lib/voice";

export type Scope =
  | { kind: "task"; taskId: string; projectId: string | null }
  | { kind: "project"; projectId: string }
  | { kind: "team" }
  /** A private group or one-to-one chat. `members` are the people in it now. */
  | { kind: "conversation"; conversationId: string; direct: boolean; members: string[] };

function scopeKey(s: Scope) {
  return s.kind === "task"
    ? ["task", s.taskId]
    : s.kind === "project"
      ? ["project", s.projectId]
      : s.kind === "conversation"
        ? ["conversation", s.conversationId]
        : ["team"];
}

/** The chat's key for seen ticks and unread counts ("team", "project:<id>", "conv:<id>"); none for task comments. */
export function chatKeyOf(s: Scope): string | null {
  if (s.kind === "team") return "team";
  if (s.kind === "project") return `project:${s.projectId}`;
  if (s.kind === "conversation") return `conv:${s.conversationId}`;
  return null;
}

/** The address notifications for this chat point at, so opening it clears them. */
function seenLink(s: Scope): string | null {
  if (s.kind === "team") return "/chat";
  if (s.kind === "project") return `/projects/${s.projectId}/chat`;
  if (s.kind === "conversation") return `/chats/${s.conversationId}`;
  return null;
}

/** Find @Name mentions in text. "@all" or "@everyone" mentions everyone who can be mentioned. */
export function findMentions(body: string, people: Profile[], meId: string): string[] {
  const ids = new Set<string>();
  if (/@(all|everyone|team)\b/i.test(body)) people.forEach((p) => p.id !== meId && ids.add(p.id));
  for (const p of people) {
    const esc = p.short_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`@${esc}\\b`, "i").test(body) && p.id !== meId) ids.add(p.id);
  }
  return [...ids];
}

function renderBody(body: string, people: Profile[]): ReactNode {
  const names = people.map((p) => p.short_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).concat(["all", "everyone", "team"]);
  if (!names.length) return body;
  const re = new RegExp(`(@(?:${names.join("|")})\\b)`, "gi");
  return body.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <span className="mention" key={i}>
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** A short line describing a message, for reply quotes. */
function snippet(c: Pick<Comment, "body" | "voice_path"> | undefined): string {
  if (!c) return "Message removed";
  const text = c.body.replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

const CONTINUE_MINUTES = 5;

export function CommentThread({
  scope,
  placeholder,
  height,
  fill,
}: {
  scope: Scope;
  placeholder?: string;
  /** Fixed scroll height for the messages (task and project pages). */
  height?: number | string;
  /** Fill the parent's height, with the box to write in pinned at the bottom (the Chats screen). */
  fill?: boolean;
}) {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const openFile = useOpenFile();
  const listRef = useRef<HTMLDivElement>(null);
  const isChat = scope.kind !== "task";
  const direct = scope.kind === "conversation" && scope.direct;
  const chatKey = chatKeyOf(scope);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [menuFor, setMenuFor] = useState<Comment | null>(null);
  const [seenFor, setSeenFor] = useState<Comment | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);
  const link = seenLink(scope);
  // Reading a chat clears its notifications (task pages do this for the whole task).
  useMarkSeen(link ? { link } : null);

  const comments = useQuery({
    queryKey: ["comments", ...scopeKey(scope)],
    queryFn: async () => {
      let q = supabase.from("comments").select("*");
      if (scope.kind === "task") q = q.eq("task_id", scope.taskId);
      else if (scope.kind === "project") q = q.eq("project_id", scope.projectId).is("task_id", null);
      else if (scope.kind === "conversation") q = q.eq("conversation_id", scope.conversationId);
      else q = q.is("task_id", null).is("project_id", null).is("conversation_id", null);
      const rows = await unwrap<Comment[]>(q.order("created_at", { ascending: false }).limit(300));
      return rows.reverse();
    },
  });
  const list = useMemo(() => comments.data ?? [], [comments.data]);
  const byId = useMemo(() => new Map(list.map((c) => [c.id, c])), [list]);
  const ids = list.map((c) => c.id);
  const latest = list[list.length - 1];

  // Messages quoted by replies that are older than what's loaded here.
  const missing = useMemo(() => [...new Set(list.map((c) => c.reply_to).filter((r): r is string => !!r && !byId.has(r)))], [list, byId]);
  const quoted = useQuery({
    queryKey: ["comments", "quoted", missing.join(",")],
    enabled: missing.length > 0,
    queryFn: () => unwrap<Comment[]>(supabase.from("comments").select("*").in("id", missing)),
  });
  const quote = (id: string) => byId.get(id) ?? quoted.data?.find((c) => c.id === id);

  const files = useQuery({
    queryKey: ["attachments", "comments", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = await unwrap<Attachment[]>(supabase.from("attachments").select("*").in("comment_id", ids));
      const urls = await previewUrls(rows);
      return { rows, urls };
    },
  });
  const filesByComment = useMemo(() => {
    const m = new Map<string, Attachment[]>();
    for (const a of files.data?.rows ?? []) {
      if (!a.comment_id) continue;
      m.set(a.comment_id, [...(m.get(a.comment_id) ?? []), a]);
    }
    return m;
  }, [files.data]);
  // Every photo in this thread, in the order shown, to swipe through when one is opened.
  const threadImages = useMemo(() => list.flatMap((c) => (filesByComment.get(c.id) ?? []).filter(isImage)), [list, filesByComment]);

  const reactions = useReactions(ids.filter((id) => !byId.get(id)?.event));
  // Google Drive links shared in these messages.
  const msgLinks = useMessageDriveLinks(ids.filter((id) => !byId.get(id)?.event));
  const reads = useChatReads(chatKey);
  useKeepRead(chatKey, latest?.id);
  const typing = useTyping(chatKey, me.id);

  // Who receives messages here (for seen ticks), not counting me.
  const audience = useMemo(() => {
    if (scope.kind === "conversation") return scope.members.filter((id) => id !== me.id);
    if (scope.kind === "task") return [];
    return people.active.filter((p) => p.id !== me.id).map((p) => p.id);
  }, [scope, people.active, me.id]);
  // Who can be @mentioned: the people in a group, nobody in a one-to-one chat, everyone elsewhere.
  const mentionable = useMemo(() => {
    if (scope.kind !== "conversation") return people.active;
    if (scope.direct) return [];
    return people.active.filter((p) => scope.members.includes(p.id));
  }, [scope, people.active]);

  function seenBy(c: Comment) {
    const r = reads.data ?? {};
    return audience.filter((id) => r[id] && r[id] >= c.created_at);
  }

  // Stay at the newest message, unless you've scrolled up to read older ones.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !isChat) return;
    if (atBottom || latest?.author_id === me.id) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id, isChat, list.length]);
  useEffect(() => {
    const el = listRef.current;
    if (el && isChat) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.isSuccess, chatKey]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  }

  function jumpTo(id: string) {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-msg="${id}"]`);
    if (!el) {
      toast("That message is too far back to show here.", "info");
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setFlash(id);
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
  }

  async function remove(c: Comment) {
    setMenuFor(null);
    const ok = await confirm({ title: "Delete message?", message: "It will be removed for everyone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      // Its files go too (Drive files move to the Drive bin).
      for (const a of filesByComment.get(c.id) ?? []) {
        if (a.uploaded_by === me.id) await deleteAttachment(a);
      }
      const { error } = await supabase.from("comments").delete().eq("id", c.id);
      if (error) throw error;
      if (c.voice_path) await supabase.storage.from("files").remove([c.voice_path]);
      invalidate("comments", "attachments", "chats");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function react(c: Comment, kind: ReactionKind) {
    setMenuFor(null);
    const mine = reactions.data?.get(c.id)?.find((r) => r.user_id === me.id)?.reaction ?? null;
    try {
      await setReaction(c.id, me.id, mine === kind ? null : kind);
      invalidate("comment_reactions");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function copy(c: Comment) {
    setMenuFor(null);
    try {
      await navigator.clipboard.writeText(c.transcript && c.voice_path ? c.transcript : c.body);
      toast("Copied", "info");
    } catch {
      toast("Couldn't copy on this device.", "error");
    }
  }

  function reply(c: Comment) {
    setMenuFor(null);
    setReplyTo(c);
  }

  const typers = typing.typers.map((id) => people.get(id)?.short_name).filter((n): n is string => !!n);
  const typingText = typingLine(typers);
  let lastDay = "";
  let prev: Comment | undefined;

  return (
    <div className={clsx("chat-thread", fill && "fill")}>
      <div
        ref={listRef}
        className="thread"
        onScroll={onScroll}
        style={!fill && height ? { maxHeight: height, overflowY: "auto", paddingRight: 4 } : undefined}
      >
        {comments.isLoading && <Loading />}
        {!comments.isLoading && list.length === 0 && (
          <Empty icon={<MessageCircle />} title={isChat ? "No messages yet" : "No comments yet"}>
            {direct
              ? "Say hello. Only the two of you can see this chat."
              : scope.kind === "conversation"
                ? "Only the people in this group can see it."
                : isChat
                  ? "Everyone on the team gets a notification when you post here."
                  : "Type @ to mention someone. They get a notification on their phone."}
          </Empty>
        )}
        {list.map((c) => {
          const day = dateOf(c.created_at);
          const showDay = isChat && day !== lastDay;
          lastDay = day;
          const before = prev;
          prev = c;
          if (c.event) {
            return (
              <Fragment key={c.id}>
                {showDay && <DayLine day={day} />}
                <div className="chat-event" data-msg={c.id}>
                  {c.body}
                </div>
              </Fragment>
            );
          }
          const author = people.get(c.author_id);
          const mine = c.author_id === me.id;
          // Messages from the same person a few minutes apart sit together, like WhatsApp.
          const cont =
            !showDay &&
            !!before &&
            !before.event &&
            before.author_id === c.author_id &&
            new Date(c.created_at).getTime() - new Date(before.created_at).getTime() < CONTINUE_MINUTES * 60_000;
          const atts = filesByComment.get(c.id) ?? [];
          const rx = reactions.data?.get(c.id) ?? [];
          const seen = isChat && mine ? seenBy(c) : [];
          const tick = !isChat || !mine ? null : audience.length > 0 && seen.length >= audience.length ? "all" : seen.length > 0 ? "some" : "sent";
          return (
            <Fragment key={c.id}>
              {showDay && <DayLine day={day} />}
              <Message
                c={c}
                mine={mine}
                cont={cont}
                showAuthor={!mine && !direct}
                author={author}
                flash={flash === c.id}
                onReply={() => reply(c)}
                onMenu={() => setMenuFor(c)}
              >
                {!mine && !direct && !cont && (
                  <button type="button" className="who who-btn" onClick={() => author && openPersonCard(author.id)}>
                    {author?.short_name ?? "Someone"}
                  </button>
                )}
                {c.reply_to && (
                  <button type="button" className="quote" onClick={() => jumpTo(c.reply_to!)}>
                    <b>{quote(c.reply_to) ? (quote(c.reply_to)!.author_id === me.id ? "You" : people.get(quote(c.reply_to)!.author_id)?.short_name ?? "Someone") : ""}</b>
                    <span>{snippet(quote(c.reply_to))}</span>
                  </button>
                )}
                {c.voice_path ? (
                  <VoiceNote
                    kind="comment"
                    id={c.id}
                    path={c.voice_path}
                    seconds={c.voice_seconds}
                    peaks={c.voice_peaks}
                    transcript={c.transcript}
                    status={c.transcript_status}
                    canEdit={mine}
                  />
                ) : (
                  <div>{renderBody(c.body, mentionable.length ? mentionable : people.active)}</div>
                )}
                {atts.length > 0 && (
                  <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                    {atts.map((a) =>
                      isImage(a) && files.data?.urls[a.path] ? (
                        <button key={a.id} onClick={() => openFile(a, threadImages)} style={{ border: 0, padding: 0, background: "none" }} type="button">
                          <img src={files.data.urls[a.path]} alt={a.name} style={{ borderRadius: 12, maxHeight: 220, objectFit: "cover" }} />
                        </button>
                      ) : (
                        <button key={a.id} className="file" onClick={() => openFile(a, isImage(a) ? threadImages : undefined)} type="button">
                          <span className="icon">
                            <FileText />
                          </span>
                          <span className="ellipsis small">
                            {a.name}
                            <br />
                            <span className="faint">
                              {isOnDrive(a) ? "Google Drive · " : ""}
                              {a.version > 1 ? `Version ${a.version} · ` : ""}
                              {fileSize(a.size)}
                            </span>
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                )}
                {(msgLinks.data?.get(c.id) ?? []).length > 0 && (
                  <div className="msg-links">
                    {msgLinks.data!.get(c.id)!.map((l) => (
                      <LinkCard key={l.id} link={l} compact />
                    ))}
                  </div>
                )}
                <div className="when row" style={{ gap: 6 }}>
                  <span>
                    {!isChat && dateOf(c.created_at) !== todayISO() ? `${fmtDue(dateOf(c.created_at))}, ` : ""}
                    {fmtTime12(c.created_at)}
                    {c.edited_at && !c.voice_path ? " · edited" : ""}
                  </span>
                  {tick && (
                    <button
                      type="button"
                      className={clsx("tick", tick)}
                      onClick={() => setSeenFor(c)}
                      aria-label={tick === "all" ? "Seen by everyone" : tick === "some" ? "Seen by some" : "Sent"}
                      title={tick === "all" ? "Seen" : tick === "some" ? "Seen by some" : "Sent"}
                    >
                      {tick === "sent" ? <Check size={14} /> : <CheckCheck size={14} />}
                    </button>
                  )}
                </div>
                {rx.length > 0 && <ReactionChips list={rx} meId={me.id} onToggle={(k) => react(c, k)} />}
              </Message>
            </Fragment>
          );
        })}
        {/* Sent with no signal: waiting on the phone, with a clock instead of the tick. */}
        <PendingMessages userId={me.id} chat={outboxChat(scope)} hide={ids} />
      </div>

      {isChat && !atBottom && (
        <button
          type="button"
          className="jump-down glass-strong"
          onClick={() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })}
          aria-label="Go to the newest message"
        >
          <ArrowDown />
        </button>
      )}

      {/* On the Chats screen the header shows who's typing; elsewhere it shows here. */}
      {!fill && isChat && (
      <div className="typing-line" aria-live="polite">
        {typingText && (
          <>
            <span className="dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {typingText}
          </>
        )}
      </div>
      )}

      <Composer
        scope={scope}
        mentionable={mentionable}
        placeholder={placeholder ?? (isChat ? "Message the team" : "Add a comment")}
        replyTo={replyTo}
        replyName={replyTo ? (replyTo.author_id === me.id ? "You" : people.get(replyTo.author_id)?.short_name ?? "Someone") : ""}
        onClearReply={() => setReplyTo(null)}
        onTyping={typing.typing}
        onStopTyping={typing.stopped}
      />

      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title="Message">
        {menuFor && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="react-row" role="group" aria-label="React">
              {REACTIONS.map((r) => {
                const on = reactions.data?.get(menuFor.id)?.some((x) => x.user_id === me.id && x.reaction === r.key);
                return (
                  <button key={r.key} type="button" className={clsx("react-btn", on && "on")} style={{ ["--rx" as string]: r.color }} onClick={() => react(menuFor, r.key)} aria-label={r.label} title={r.label}>
                    <r.icon />
                  </button>
                );
              })}
            </div>
            <div className="menu-list">
              <button type="button" onClick={() => reply(menuFor)}>
                <CornerUpLeft /> Reply
              </button>
              <button type="button" onClick={() => copy(menuFor)}>
                <Copy /> Copy text
              </button>
              {isChat && menuFor.author_id === me.id && (
                <button
                  type="button"
                  onClick={() => {
                    setSeenFor(menuFor);
                    setMenuFor(null);
                  }}
                >
                  <Info /> Seen by
                </button>
              )}
              {(menuFor.author_id === me.id || (scope.kind !== "conversation" && me.role === "manager")) && (
                <button type="button" className="danger" onClick={() => remove(menuFor)}>
                  <Trash2 /> Delete
                </button>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!seenFor} onClose={() => setSeenFor(null)} title="Seen by">
        {seenFor && <SeenList c={seenFor} audience={audience} reads={reads.data ?? {}} />}
      </Sheet>
    </div>
  );
}

function DayLine({ day }: { day: string }) {
  return <div className="chat-day">{day === todayISO() ? "Today" : fmtDue(day)}</div>;
}

/** One message: the bubble, plus swipe-to-reply on phones and a menu button. */
function Message({
  c,
  mine,
  cont,
  showAuthor,
  author,
  flash,
  onReply,
  onMenu,
  children,
}: {
  c: Comment;
  mine: boolean;
  cont: boolean;
  showAuthor: boolean;
  author: Profile | undefined;
  flash: boolean;
  onReply: () => void;
  onMenu: () => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const press = useRef<number>(0);

  function down(e: ReactPointerEvent) {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    // Hold to open the menu, like WhatsApp.
    press.current = window.setTimeout(() => {
      start.current = null;
      setDx(0);
      navigator.vibrate?.(10);
      onMenu();
    }, 520);
  }
  function move(e: ReactPointerEvent) {
    const s = start.current;
    if (!s) return;
    const x = e.clientX - s.x;
    const y = Math.abs(e.clientY - s.y);
    if (Math.abs(x) > 8 || y > 8) window.clearTimeout(press.current);
    if (y > 24) {
      start.current = null;
      setDx(0);
      return;
    }
    if (x > 0) setDx(Math.min(72, x));
  }
  function up() {
    window.clearTimeout(press.current);
    if (start.current && dx > 54) onReply();
    start.current = null;
    setDx(0);
  }

  return (
    <div
      className={clsx("msg", mine && "mine", cont && "cont", flash && "flash")}
      data-msg={c.id}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu();
      }}
    >
      {showAuthor && (cont ? <span className="avatar-gap" /> : <PersonAvatar person={author} size={28} />)}
      <div
        className="bubble"
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {dx > 0 && (
          <span className="swipe-reply" style={{ opacity: Math.min(1, dx / 54) }} aria-hidden>
            <CornerUpLeft size={16} />
          </span>
        )}
        {children}
      </div>
      <div className="msg-tools">
        <button type="button" className="icon-btn small plain" onClick={onReply} aria-label="Reply" title="Reply">
          <CornerUpLeft />
        </button>
        <button type="button" className="icon-btn small plain" onClick={onMenu} aria-label="React and more" title="React and more">
          <SmilePlus />
        </button>
        <button type="button" className="icon-btn small plain" onClick={onMenu} aria-label="More" title="More">
          <EllipsisVertical />
        </button>
      </div>
    </div>
  );
}

function ReactionChips({ list, meId, onToggle }: { list: { user_id: string; reaction: ReactionKind | null }[]; meId: string; onToggle: (k: ReactionKind) => void }) {
  const people = usePeople();
  const groups = new Map<ReactionKind, string[]>();
  for (const r of list) if (r.reaction) groups.set(r.reaction, [...(groups.get(r.reaction) ?? []), r.user_id]);
  return (
    <div className="rx-chips">
      {[...groups.entries()].map(([k, who]) => {
        const info = reactionInfo(k);
        const names = who.map((id) => (id === meId ? "You" : people.get(id)?.short_name ?? "Someone"));
        return (
          <button
            key={k}
            type="button"
            className={clsx("rx-chip", who.includes(meId) && "mine")}
            style={{ ["--rx" as string]: info.color }}
            onClick={() => onToggle(k)}
            title={`${info.label}: ${names.join(", ")}`}
            aria-label={`${info.label} from ${names.join(", ")}`}
          >
            <info.icon />
            {who.length > 1 && <span>{who.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

function SeenList({ c, audience, reads }: { c: Comment; audience: string[]; reads: Record<string, string> }) {
  const people = usePeople();
  const seen = audience.filter((id) => reads[id] && reads[id] >= c.created_at);
  const waiting = audience.filter((id) => !seen.includes(id));
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="muted small ellipsis">{snippet(c)}</div>
      <div>
        <div className="seen-head">Seen</div>
        {seen.length === 0 && <div className="faint small">Nobody yet.</div>}
        {seen.map((id) => (
          <div className="seen-row" key={id}>
            <Avatar person={people.get(id)} size={30} />
            <span className="grow">{people.get(id)?.short_name ?? "Someone"}</span>
            <span className="faint small">{fmtTime12(reads[id])}</span>
          </div>
        ))}
      </div>
      {waiting.length > 0 && (
        <div>
          <div className="seen-head">Not seen yet</div>
          {waiting.map((id) => (
            <div className="seen-row" key={id}>
              <Avatar person={people.get(id)} size={30} />
              <span className="grow">{people.get(id)?.short_name ?? "Someone"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({
  scope,
  mentionable,
  placeholder,
  replyTo,
  replyName,
  onClearReply,
  onTyping,
  onStopTyping,
}: {
  scope: Scope;
  mentionable: Profile[];
  placeholder: string;
  replyTo: Comment | null;
  replyName: string;
  onClearReply: () => void;
  onTyping: () => void;
  onStopTyping: () => void;
}) {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // Google Drive links checked and waiting to go with the message.
  const [links, setLinks] = useState<(LinkInfo & { url: string })[]>([]);
  const [addingLink, setAddingLink] = useState(false);
  const [sending, setSending] = useState(false);
  // Big files go to Google Drive and can take a while: show how far along they are.
  const [progress, setProgress] = useState<string | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sendingVoice, setSendingVoice] = useState(false);
  const recorder = useRecorder({ onDone: (r) => void sendVoice(r) });
  const recording = recorder.state !== "idle";
  // Like WhatsApp: the microphone shows while the box is empty, the send arrow once you type.
  const showMic = canRecord() && !body.trim() && files.length === 0 && links.length === 0;
  const conversationId = scope.kind === "conversation" ? scope.conversationId : null;

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  function where() {
    return {
      task_id: scope.kind === "task" ? scope.taskId : null,
      project_id: scope.kind === "task" ? scope.projectId : scope.kind === "project" ? scope.projectId : null,
      conversation_id: conversationId,
    };
  }

  async function startRecording() {
    try {
      await recorder.start();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function sendVoice(rec: Recording) {
    setSendingVoice(true);
    // Given an id here, so a voice note interrupted by the signal is finished later, never posted twice.
    const id = crypto.randomUUID();
    let path: string | null = null;
    try {
      if (navigator.onLine === false) throw new TypeError("Failed to fetch");
      path = await uploadVoice(rec, me.id, conversationId);
      const { error } = await supabase.from("comments").insert({
        id,
        body: voiceLabel(rec.seconds),
        mentions: [],
        author_id: me.id,
        ...where(),
        reply_to: replyTo?.id ?? null,
        voice_path: path,
        voice_seconds: Math.round(rec.seconds * 10) / 10,
        voice_peaks: rec.peaks,
      });
      if (error) {
        if (!isNetworkError(error)) await supabase.storage.from("files").remove([path]);
        throw error;
      }
      onClearReply();
      invalidate("comments", "chats");
    } catch (e) {
      if (isNetworkError(e)) {
        // No signal: kept on the phone, shown with a clock, and sent by itself when the signal is back.
        await queueMessage({
          id,
          userId: me.id,
          chat: outboxChat(scope),
          row: { body: voiceLabel(rec.seconds), mentions: [], author_id: me.id, reply_to: replyTo?.id ?? null, ...where() },
          voice: { blob: rec.blob, mime: rec.mime, seconds: rec.seconds, peaks: rec.peaks, path: path ?? undefined },
        }).catch(() => toast("Voice note not sent: no signal, and it couldn't be saved on this phone.", "error"));
        onClearReply();
      } else toast(`Voice note not sent: ${errorMessage(e)}`, "error");
    } finally {
      setSendingVoice(false);
    }
  }

  const options = useMemo(() => {
    if (query === null || !mentionable.length) return [];
    const q = query.toLowerCase();
    // First names that start with what was typed come first, then other name matches.
    const rank = (p: Profile) =>
      p.short_name.toLowerCase().startsWith(q) ? 0 : p.full_name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2;
    const list: { id: string; label: string; person?: Profile }[] = mentionable
      .filter((p) => p.id !== me.id && rank(p) < 2)
      .sort((a, b) => rank(a) - rank(b) || a.short_name.localeCompare(b.short_name))
      .map((p) => ({ id: p.id, label: p.short_name, person: p }));
    if ("all".startsWith(q)) list.push({ id: "all", label: "all" });
    return list.slice(0, 7);
  }, [query, mentionable, me.id]);

  function onChange(v: string) {
    setBody(v);
    if (v.trim()) onTyping();
    else onStopTyping();
    const el = ref.current;
    const caret = el?.selectionStart ?? v.length;
    const m = /(^|\s)@([\w-]*)$/.exec(v.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(160, el.scrollHeight)}px`;
    }
  }

  function pick(label: string) {
    const el = ref.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([\w-]*)$/, `@${label} `);
    const next = before + body.slice(caret);
    setBody(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (options.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + options.length) % options.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(options[active].label);
        return;
      }
      if (e.key === "Escape") {
        setQuery(null);
        return;
      }
    }
    if (e.key === "Escape" && replyTo) {
      onClearReply();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      send();
    }
  }

  async function send() {
    const text = body.trim();
    if ((!text && !files.length && !links.length) || sending) return;
    setSending(true);
    onStopTyping();
    const mentions = findMentions(text, mentionable, me.id);
    const row = {
      body: text || sharedText(files, links),
      mentions,
      author_id: me.id,
      reply_to: replyTo?.id ?? null,
      ...where(),
    };
    // Given an id here, so a message interrupted by the signal is finished later, never posted twice.
    const id = crypto.randomUUID();
    const done = { posted: false, links: false, files: 0 };
    try {
      if (navigator.onLine === false) throw new TypeError("Failed to fetch");
      const { data, error } = await supabase.from("comments").insert({ id, ...row }).select().single();
      if (error) throw error;
      done.posted = true;
      setBody("");
      onClearReply();
      if (ref.current) ref.current.style.height = "auto";
      if (links.length) {
        await addDriveLinks(links, { projectId: null, commentId: data.id });
        done.links = true;
        setLinks([]);
      }
      for (const f of files) {
        setProgress(`Uploading ${f.name}...`);
        await uploadFile(f, {
          taskId: row.task_id,
          projectId: row.project_id,
          conversationId,
          commentId: data.id,
          userId: me.id,
          onProgress: (x) => setProgress(`Saving ${f.name} to Google Drive, ${Math.round(x * 100)}%`),
        });
        done.files++;
      }
      setFiles([]);
      // In chats everyone is notified anyway, so only confirm mentions on task comments.
      if (mentions.length && scope.kind === "task") {
        const names = mentions.map((id) => people.get(id)?.short_name).filter(Boolean);
        toast(names.length > 3 ? `Notified ${names.length} people` : `Notified ${names.join(", ")}`, "info");
      }
      invalidate("comments", "attachments", "chats", "drive_links");
    } catch (e) {
      if (isNetworkError(e)) {
        // No signal: kept on the phone, shown with a clock, and sent by itself when the signal is back.
        try {
          await queueMessage({
            id,
            userId: me.id,
            chat: outboxChat(scope),
            row,
            inserted: done.posted,
            links: done.links ? [] : links,
            linksDone: done.links,
            files: keepFiles(files.slice(done.files)),
          });
          setBody("");
          onClearReply();
          setLinks([]);
          setFiles([]);
          if (ref.current) ref.current.style.height = "auto";
          if (done.posted) invalidate("comments", "attachments", "chats", "drive_links");
        } catch {
          toast("No signal, and the message couldn't be saved on this phone. Try again when you're back online.", "error");
        }
      } else toast(errorMessage(e), "error");
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  return (
    <div className="stack composer-wrap" style={{ gap: 6 }}>
      {progress && (
        <div className="muted small row" role="status" style={{ gap: 8 }}>
          <span className="vspin" style={{ color: "var(--accent)" }} /> {progress}
        </div>
      )}
      {replyTo && (
        <div className="reply-bar">
          <CornerUpLeft />
          <div className="grow">
            <b>Replying to {replyName}</b>
            <span className="ellipsis">{snippet(replyTo)}</span>
          </div>
          <button type="button" className="icon-btn small plain" onClick={onClearReply} aria-label="Cancel reply">
            <X />
          </button>
        </div>
      )}
      {(files.length > 0 || links.length > 0) && (
        <div className="row wrap">
          {links.map((l, i) => (
            <span className="pill green link-chip" key={`link-${i}`}>
              <Link2 />
              <span className="ellipsis" style={{ maxWidth: 160 }}>
                {l.title}
              </span>
              <button type="button" onClick={() => setLinks((xs) => xs.filter((_, j) => j !== i))} style={{ border: 0, background: "none", padding: 0, color: "inherit", display: "grid" }} aria-label={`Remove ${l.title}`}>
                <X size={13} />
              </button>
            </span>
          ))}
          {files.map((f, i) => (
            <span className="pill blue" key={i}>
              <Paperclip />
              <span className="ellipsis" style={{ maxWidth: 160 }}>
                {f.name}
              </span>
              <button type="button" onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))} style={{ border: 0, background: "none", padding: 0, color: "inherit", display: "grid" }} aria-label="Remove file">
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer glass-strong">
        {options.length > 0 && (
          <div className="mention-menu glass-strong" role="listbox">
            {options.map((o, i) => (
              <button
                key={o.id}
                type="button"
                className={clsx(i === active && "active")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.label);
                }}
              >
                {o.person ? <Avatar person={o.person} size={26} /> : <span className="avatar" style={{ ["--size" as string]: "26px", background: "var(--accent)" }}>@</span>}
                <span>
                  {o.person ? o.person.short_name : "Everyone"}
                  <span className="faint tiny" style={{ display: "block" }}>
                    {o.person ? o.person.title : scope.kind === "conversation" ? "Notify everyone in this group" : "Notify the whole team"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {recording ? (
          <RecorderBar elapsed={recorder.elapsed} maxSeconds={recorder.maxSeconds} bars={recorder.bars} onCancel={recorder.cancel} onFinish={recorder.stop} />
        ) : sendingVoice ? (
          <div className="rec-bar muted small" role="status">
            <span className="vspin" style={{ color: "var(--accent)" }} /> Sending voice note...
          </div>
        ) : (
          <>
            <button className="icon-btn plain" type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a file">
              <Paperclip />
            </button>
            <button className="icon-btn plain" type="button" onClick={() => setAddingLink(true)} aria-label="Add a Google Drive link" title="Add a Google Drive link">
              <Link2 />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                setFiles((xs) => [...xs, ...Array.from(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <textarea ref={ref} rows={1} value={body} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} aria-label={placeholder} />
            {showMic ? (
              <button className="icon-btn plain mic-btn" type="button" onClick={startRecording} aria-label="Record a voice note" title="Record a voice note">
                <Mic />
              </button>
            ) : (
              <button className="icon-btn" style={{ background: "var(--accent)", color: "#fff" }} type="button" onClick={send} disabled={sending} aria-label="Send">
                <SendHorizontal />
              </button>
            )}
          </>
        )}
      </div>
      <AddDriveLinkSheet
        open={addingLink}
        onClose={() => setAddingLink(false)}
        onAdd={(l) => {
          setLinks((xs) => (xs.some((x) => x.drive_id === l.drive_id) ? xs : [...xs, l]));
          ref.current?.focus();
        }}
      />
    </div>
  );
}

/** The message text when only files or links are sent. */
function sharedText(files: File[], links: { title: string }[]): string {
  if (files.length + links.length === 1) return `Shared ${files.length ? files[0].name : links[0].title}`;
  const parts = [
    files.length ? (files.length === 1 ? "1 file" : `${files.length} files`) : null,
    links.length ? (links.length === 1 ? "1 Drive link" : `${links.length} Drive links`) : null,
  ].filter(Boolean);
  return `Shared ${parts.join(" and ")}`;
}
