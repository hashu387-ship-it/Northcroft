// Polls in chats (as a message) and under announcements. Votes are named, can be changed until the
// poll is closed, and send no notifications. The database checks who can see, vote and close.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import type { Poll, PollVote } from "./types";

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export interface PollWithVotes {
  poll: Poll;
  votes: PollVote[];
}

/**
 * Polls on these messages (`on: "comment"`) or announcements (`on: "announcement"`), with their votes,
 * keyed by the message or announcement id. Live: votes and closing come in as they happen.
 */
export function usePolls(on: "comment" | "announcement", ids: string[]) {
  const key = ids.join(",");
  const column = on === "comment" ? "comment_id" : "announcement_id";
  const polls = useQuery({
    queryKey: ["polls", on, key],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("polls").select("*").in(column, ids);
      if (error) throw error;
      return (data ?? []) as Poll[];
    },
  });
  const pollIds = (polls.data ?? []).map((p) => p.id);
  const votes = useQuery({
    queryKey: ["poll_votes", pollIds.join(",")],
    enabled: pollIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("poll_votes").select("*").in("poll_id", pollIds);
      if (error) throw error;
      return (data ?? []) as PollVote[];
    },
  });
  return useMemo(() => {
    const m = new Map<string, PollWithVotes>();
    for (const p of polls.data ?? []) {
      const owner = on === "comment" ? p.comment_id : p.announcement_id;
      if (owner) m.set(owner, { poll: p, votes: (votes.data ?? []).filter((v) => v.poll_id === p.id) });
    }
    return m;
  }, [polls.data, votes.data, on]);
}

/** Start a poll in a chat ("team", "project:<id>", "conv:<id>"). It goes out as a message. */
export const createChatPoll = (chat: string, question: string, options: string[], multi: boolean) =>
  rpc<string>("create_chat_poll", { p_chat: chat, p_question: question, p_options: options, p_multi: multi });

/** Add a poll under an announcement. */
export const addAnnouncementPoll = (announcementId: string, question: string, options: string[], multi: boolean) =>
  rpc<string>("add_announcement_poll", { p_announcement: announcementId, p_question: question, p_options: options, p_multi: multi });

/** Vote, change your vote, or take it back (no answers). Answers are numbered from 0. */
export const votePoll = (pollId: string, choices: number[]) => rpc<void>("vote_poll", { p_poll: pollId, p_choices: choices });

/** Close a poll: no more votes, the results stay. */
export const closePoll = (pollId: string) => rpc<void>("close_poll", { p_poll: pollId });

/** Tidy what's typed in the poll form (trimmed, no blanks). Returns a reason it can't go yet, or null. */
export function pollProblem(question: string, options: string[]): string | null {
  if (!question.trim()) return "Add a question";
  const opts = options.map((o) => o.trim()).filter(Boolean);
  if (opts.length < 2) return "Add at least 2 answers";
  const seen = new Set<string>();
  for (const o of opts) {
    const k = o.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(k)) return "Each answer needs to be different";
    seen.add(k);
  }
  return null;
}

export const MAX_POLL_OPTIONS = 10;
