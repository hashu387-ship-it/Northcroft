// Search everything: one box (and Ctrl+K / Cmd+K) that finds tasks, messages, files, projects,
// variations, BOQ packages, people, announcements and calendar entries.
// The database does the searching as the signed-in person (search_everything), so it only ever
// finds what that person can open: private chats stay private.
import { useEffect, useState, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type SearchKind = "task" | "message" | "file" | "project" | "vo" | "boq" | "person" | "announcement" | "event";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  snippet: string | null;
  project_id: string | null;
  project_name: string | null;
  /** Where it opens (people open their profile card instead). */
  link: string | null;
  at: string | null;
  meta: Record<string, unknown>;
}

/** How the groups are named and ordered, and the filter chips. */
export const SEARCH_GROUPS: { kind: SearchKind; label: string; chip: string }[] = [
  { kind: "person", label: "People", chip: "People" },
  { kind: "task", label: "Tasks", chip: "Tasks" },
  { kind: "message", label: "Messages", chip: "Messages" },
  { kind: "file", label: "Files", chip: "Files" },
  { kind: "vo", label: "Variations", chip: "Variations" },
  { kind: "project", label: "Projects", chip: "Projects" },
  { kind: "boq", label: "BOQ packages", chip: "BOQ" },
  { kind: "announcement", label: "Announcements", chip: "Announcements" },
  { kind: "event", label: "Calendar", chip: "Calendar" },
];

/** How many of each kind show when searching everything; a filter shows up to 50. */
export const PER_GROUP = 6;

export function useSearch(q: string, kind: SearchKind | null) {
  const term = q.trim();
  return useQuery({
    queryKey: ["search", term.toLowerCase(), kind],
    enabled: term.length >= 2,
    staleTime: 20_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_everything", {
        p_q: term,
        p_kind: kind,
        p_limit: kind ? 50 : PER_GROUP + 1,
      });
      if (error) throw error;
      return (data ?? []) as SearchHit[];
    },
  });
}

/** The value, once it has stopped changing for a moment. */
export function useDebounced<T>(value: T, ms = 180): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The words typed, for highlighting. */
export function searchWords(q: string): string[] {
  return Array.from(new Set(q.toLowerCase().split(/\s+/).filter((w) => w.length > 0))).sort((a, b) => b.length - a.length);
}

/* ---------------------------------------------------------------- open / close from anywhere */

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openSearch() {
  open = true;
  emit();
}
export function closeSearch() {
  open = false;
  emit();
}
export function useSearchOpen() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => open,
  );
}

/* ---------------------------------------------------------------- recent searches (this phone) */

const RECENT_KEY = "nc-recent-searches";

export function recentSearches(userId: string): string[] {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}") as Record<string, string[]>;
    return Array.isArray(all[userId]) ? all[userId].slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(userId: string, q: string) {
  const term = q.trim();
  if (term.length < 2) return;
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}") as Record<string, string[]>;
    const list = [term, ...(all[userId] ?? []).filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify({ ...all, [userId]: list }));
  } catch {
    // Private browsing or storage full: recent searches just aren't kept.
  }
}

export function forgetSearches(userId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) || "{}") as Record<string, string[]>;
    delete all[userId];
    localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  } catch {
    // Nothing to clear.
  }
}
