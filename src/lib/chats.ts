// Chats: the team chat, project chats, groups and one-to-one chats.
// Group and one-to-one chats are private to the people in them (the database enforces this).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { CircleCheckBig, Frown, Handshake, Heart, Laugh, ThumbsUp, type LucideIcon } from "lucide-react";
import { supabase } from "./supabase";
import type { Attachment, ChatPin, ChatRead, ChatSummary, Comment, Conversation, ConversationMember, Profile, Reaction, ReactionKind } from "./types";
import { copyStoredFile, copyVoiceNote, isOnDrive, removeStored } from "./files";
import { isDriveLinkFile } from "./drivelinks";

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/* ---------------------------------------------------------------- the Chats list */

export interface ChatItem extends ChatSummary {
  /** What to show: the group's name, the other person's name, the project, or Team chat. */
  title: string;
  /** For one-to-one chats: the other person. */
  other: string | null;
  /** Where it opens. */
  to: string;
}

export function chatPath(c: Pick<ChatSummary, "kind" | "conversation_id" | "project_id">): string {
  if (c.kind === "team") return "/chat";
  if (c.kind === "project") return `/chats/project/${c.project_id}`;
  return `/chats/${c.conversation_id}`;
}

export function useChats(meId: string, people: { get: (id: string | null | undefined) => Profile | undefined }) {
  const q = useQuery({
    queryKey: ["chats"],
    queryFn: () => rpc<ChatSummary[]>("my_chats"),
    staleTime: 10_000,
  });
  return useMemo(() => {
    const items: ChatItem[] = (q.data ?? []).map((c) => {
      const other = c.kind === "direct" ? (c.members ?? []).find((m) => m !== meId) ?? null : null;
      const title = c.kind === "direct" ? people.get(other)?.short_name ?? "Former team member" : c.name;
      return { ...c, title, other, to: chatPath(c) };
    });
    // Team chat stays on top; the rest newest first.
    items.sort((a, b) => (a.kind === "team" ? -1 : b.kind === "team" ? 1 : (b.last_at ?? "").localeCompare(a.last_at ?? "")));
    const unread = items.reduce((n, c) => n + (c.unread || 0), 0);
    return { items, unread, loading: q.isLoading, error: q.error };
  }, [q.data, q.isLoading, q.error, meId, people]);
}

/* ---------------------------------------------------------------- one group or one-to-one chat */

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: ["conversations", id],
    enabled: !!id,
    queryFn: async () => {
      const [conv, members] = await Promise.all([
        supabase.from("conversations").select("*").eq("id", id!).maybeSingle(),
        supabase.from("conversation_members").select("*").eq("conversation_id", id!).order("joined_at"),
      ]);
      if (conv.error) throw conv.error;
      if (members.error) throw members.error;
      const all = (members.data ?? []) as ConversationMember[];
      return { conv: conv.data as Conversation | null, members: all.filter((m) => !m.left_at), all };
    },
  });
}

export const startDirectChat = (userId: string) => rpc<string>("start_direct_chat", { p_user: userId });
export const createGroup = (name: string, members: string[]) => rpc<string>("create_group", { p_name: name, p_members: members });
export const renameGroup = (id: string, name: string) => rpc<void>("rename_group", { p_conversation: id, p_name: name });
export const addGroupMembers = (id: string, users: string[]) => rpc<number>("add_group_members", { p_conversation: id, p_users: users });
export const removeGroupMember = (id: string, user: string) => rpc<void>("remove_group_member", { p_conversation: id, p_user: user });
export const setGroupAdmin = (id: string, user: string, admin: boolean) =>
  rpc<void>("set_group_admin", { p_conversation: id, p_user: user, p_admin: admin });
export const leaveGroup = (id: string) => rpc<void>("leave_group", { p_conversation: id });

/* ---------------------------------------------------------------- seen ticks */

/** Mark a chat read up to now (for everyone's seen ticks and the unread counts). */
export const markChatRead = (chat: string) => rpc<void>("mark_chat_read", { p_chat: chat });

/** When each person last read this chat: { userId: read_at }. */
export function useChatReads(chat: string | null) {
  return useQuery({
    queryKey: ["chat_reads", chat],
    enabled: !!chat,
    queryFn: async () => {
      const { data, error } = await supabase.from("chat_reads").select("user_id, chat, read_at").eq("chat", chat!);
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const r of (data ?? []) as ChatRead[]) out[r.user_id] = r.read_at;
      return out;
    },
    staleTime: 5_000,
  });
}

/** Keeps a chat marked as read while it's open and on screen. */
export function useKeepRead(chat: string | null, latest: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!chat) return;
    let timer = 0;
    const run = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        markChatRead(chat)
          .then(() => qc.invalidateQueries({ queryKey: ["chats"] }))
          .catch(() => {
            /* a chat you've just left; nothing to mark */
          });
      }, 400);
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [chat, latest, qc]);
}

/* ---------------------------------------------------------------- reactions */

export const REACTIONS: { key: ReactionKind; label: string; icon: LucideIcon; color: string }[] = [
  { key: "like", label: "Like", icon: ThumbsUp, color: "#0a84ff" },
  { key: "done", label: "Done", icon: CircleCheckBig, color: "#28a745" },
  { key: "love", label: "Love", icon: Heart, color: "#e8343e" },
  { key: "haha", label: "Haha", icon: Laugh, color: "#e67e00" },
  { key: "thanks", label: "Thanks", icon: Handshake, color: "#a24fd4" },
  { key: "sad", label: "Sad", icon: Frown, color: "#6b7280" },
];
export const reactionInfo = (k: ReactionKind) => REACTIONS.find((r) => r.key === k)!;

export function useReactions(commentIds: string[]) {
  const key = commentIds.join(",");
  return useQuery({
    queryKey: ["comment_reactions", key],
    enabled: commentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("comment_reactions")
        .select("comment_id, user_id, reaction, updated_at")
        .in("comment_id", commentIds)
        .not("reaction", "is", null);
      if (error) throw error;
      const byComment = new Map<string, Reaction[]>();
      for (const r of (data ?? []) as Reaction[]) byComment.set(r.comment_id, [...(byComment.get(r.comment_id) ?? []), r]);
      return byComment;
    },
  });
}

/** React to a message, change your reaction, or take it back (null). */
export async function setReaction(commentId: string, userId: string, reaction: ReactionKind | null) {
  const { error } = await supabase
    .from("comment_reactions")
    .upsert({ comment_id: commentId, user_id: userId, reaction }, { onConflict: "comment_id,user_id" });
  if (error) throw error;
}

/* ---------------------------------------------------------------- "Saheeb is typing..." */

// One live connection per open chat, shared by everything on screen that shows or sends typing
// (the chat's header and its message box). Nothing is stored.
type TypingRoom = {
  channel: RealtimeChannel;
  users: number;
  until: Record<string, number>;
  listeners: Set<() => void>;
  lastSent: number;
  timer: number;
};
const rooms = new Map<string, TypingRoom>();

function joinRoom(chat: string, meId: string): TypingRoom {
  let room = rooms.get(chat);
  if (room) {
    room.users++;
    return room;
  }
  const channel = supabase.channel(`typing:${chat}`, { config: { broadcast: { self: false } } });
  const r: TypingRoom = { channel, users: 1, until: {}, listeners: new Set(), lastSent: 0, timer: 0 };
  const changed = () => r.listeners.forEach((fn) => fn());
  channel.on("broadcast", { event: "typing" }, ({ payload }) => {
    const who = payload?.user as string | undefined;
    if (!who || who === meId) return;
    r.until = { ...r.until, [who]: payload?.stop ? 0 : Date.now() + 5000 };
    changed();
  });
  channel.subscribe();
  // Forget people who stopped typing without saying so (closed the app, lost signal).
  r.timer = window.setInterval(() => {
    const now = Date.now();
    const live = Object.entries(r.until).filter(([, t]) => t > now);
    if (live.length !== Object.keys(r.until).length) {
      r.until = Object.fromEntries(live);
      changed();
    }
  }, 1000);
  rooms.set(chat, r);
  return r;
}

function leaveRoom(chat: string) {
  const r = rooms.get(chat);
  if (!r) return;
  r.users--;
  if (r.users > 0) return;
  window.clearInterval(r.timer);
  rooms.delete(chat);
  void supabase.removeChannel(r.channel);
}

/**
 * Who else is typing in this chat. Call `typing()` as the person types and `stopped()` when they
 * send or clear the box.
 */
export function useTyping(chat: string | null, meId: string) {
  const [, setTick] = useState(0);
  const room = useRef<TypingRoom | null>(null);

  useEffect(() => {
    if (!chat) return;
    const r = joinRoom(chat, meId);
    room.current = r;
    const rerender = () => setTick((n) => n + 1);
    r.listeners.add(rerender);
    rerender();
    return () => {
      r.listeners.delete(rerender);
      room.current = null;
      leaveRoom(chat);
    };
  }, [chat, meId]);

  const send = useCallback(
    (stop: boolean) => {
      const r = room.current;
      if (!r) return;
      const now = Date.now();
      if (!stop && now - r.lastSent < 2500) return;
      r.lastSent = stop ? 0 : now;
      void r.channel.send({ type: "broadcast", event: "typing", payload: { user: meId, stop } });
    },
    [meId],
  );

  const now = Date.now();
  const until = (chat && rooms.get(chat)?.until) || {};
  return {
    typers: Object.entries(until)
      .filter(([, t]) => t > now)
      .map(([id]) => id),
    typing: useCallback(() => send(false), [send]),
    stopped: useCallback(() => send(true), [send]),
  };
}

/** "Saheeb is typing...", "Saheeb and Imthath are typing...", "3 people are typing..." */
export function typingLine(names: string[]): string | null {
  if (!names.length) return null;
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names.length} people are typing...`;
}

/* ---------------------------------------------------------------- pinned messages */

/** The messages pinned in a chat, newest first (up to 3). */
export function usePins(chat: string | null) {
  return useQuery({
    queryKey: ["chat_pins", chat],
    enabled: !!chat,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_pins")
        .select("*")
        .eq("chat", chat!)
        .is("unpinned_at", null)
        .order("pinned_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return (data ?? []) as ChatPin[];
    },
  });
}

/** Pin a message to the top of its chat, or unpin it. The database checks who may. */
export const pinMessage = (commentId: string, pin: boolean) => rpc<void>("pin_message", { p_comment: commentId, p_pin: pin });

/* ---------------------------------------------------------------- forwarding */

/** Where a forwarded copy goes: a chat from the Chats list. */
export type ForwardTarget = Pick<ChatSummary, "chat" | "project_id" | "conversation_id">;

/**
 * Forward a message into one or more chats. Voice notes and files kept in the app's storage are
 * copied into each chat's own folder first (inside storage, nothing is uploaded again); the database
 * then makes the copies, with Google Drive files and Drive links on them. Returns how many chats it
 * went to, and the names of any stored files that couldn't be copied across (the message still went).
 */
export async function forwardMessage(
  src: Comment,
  files: Attachment[],
  targets: ForwardTarget[],
  meId: string,
): Promise<{ count: number; failed: string[] }> {
  if (!targets.length) return { count: 0, failed: [] };
  const copiedVoices: string[] = [];
  try {
    let voicePaths: string[] | null = null;
    if (src.voice_path) {
      voicePaths = [];
      for (const t of targets) {
        const p = await copyVoiceNote(src.voice_path, { conversationId: t.conversation_id, userId: meId });
        copiedVoices.push(p);
        voicePaths.push(p);
      }
    }
    const made = await rpc<{ chat: string; comment_id: string }[]>("forward_message", {
      p_comment: src.id,
      p_chats: targets.map((t) => t.chat),
      p_voice_paths: voicePaths,
    });
    copiedVoices.length = 0;
    // Files in the app's own storage (Drive files are already on the copies).
    const stored = files.filter((a) => !isOnDrive(a) && !isDriveLinkFile(a));
    const failed = new Set<string>();
    for (const m of made ?? []) {
      const t = targets.find((x) => x.chat === m.chat);
      if (!t) continue;
      for (const a of stored) {
        try {
          await copyStoredFile(a, { commentId: m.comment_id, projectId: t.project_id, conversationId: t.conversation_id, userId: meId });
        } catch {
          failed.add(a.name);
        }
      }
    }
    return { count: (made ?? []).length, failed: [...failed] };
  } finally {
    // Something failed before the copies were made: tidy up the voice notes copied for them.
    await removeStored(copiedVoices);
  }
}
