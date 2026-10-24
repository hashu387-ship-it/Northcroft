import "@/styles/search.css";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  CalendarDays,
  Clock3,
  FileDiff,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Layers,
  Megaphone,
  Mic,
  Search as SearchIcon,
  SquareCheckBig,
  X,
} from "lucide-react";
import { usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { BOQ_STATUS, EVENT_KIND, TASK_STATUS, VO_STATUS } from "@/lib/constants";
import { fileSize, sar } from "@/lib/format";
import { fmtClock, fmtDate, fmtDue, timeAgo } from "@/lib/time";
import type { BoqStatus, EventKind, TaskStatus, VoStatus } from "@/lib/types";
import {
  PER_GROUP,
  SEARCH_GROUPS,
  closeSearch,
  forgetSearches,
  openSearch,
  recentSearches,
  rememberSearch,
  searchWords,
  useDebounced,
  useSearch,
  useSearchOpen,
  type SearchHit,
  type SearchKind,
} from "@/lib/search";
import { openPersonCard } from "./People";
import { Avatar, Spinner } from "./ui";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SEARCH_SHORTCUT = isMac ? "⌘K" : "Ctrl K";

function typingIn(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/** Rendered once in the app shell: the search screen, and its keyboard shortcuts. */
export function SearchHost() {
  const open = useSearchOpen();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) closeSearch();
        else openSearch();
      } else if (e.key === "/" && !open && !e.metaKey && !e.ctrlKey && !typingIn(e.target)) {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return createPortal(<SearchPanel />, document.body);
}

function SearchPanel() {
  const me = useMe();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<SearchKind | null>(null);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState(() => recentSearches(me.id));
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dq = useDebounced(q);
  const search = useSearch(dq, kind);
  const ready = dq.trim().length >= 2;
  const words = useMemo(() => searchWords(dq), [dq]);

  // Keep the page behind still while searching.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, []);

  // Results by kind, in a fixed order. Searching everything shows a few of each.
  const groups = useMemo(() => {
    const hits = ready ? search.data ?? [] : [];
    return SEARCH_GROUPS.map((g) => {
      const all = hits.filter((h) => h.kind === g.kind);
      return { ...g, hits: kind ? all : all.slice(0, PER_GROUP), more: !kind && all.length > PER_GROUP };
    }).filter((g) => g.hits.length > 0);
  }, [search.data, ready, kind]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  useEffect(() => setActive(0), [dq, kind]);
  useEffect(() => {
    bodyRef.current?.querySelector<HTMLElement>(`[data-hit="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(hit: SearchHit) {
    rememberSearch(me.id, q);
    closeSearch();
    if (hit.kind === "person") openPersonCard(hit.id);
    else if (hit.link) navigate(hit.link);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (q) setQ("");
      else closeSearch();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  }

  let index = -1;
  const searching = ready && (search.isFetching || dq !== q);

  return (
    <div className="search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeSearch()}>
      <div className="search-panel glass-strong" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKeyDown}>
        <div className="search-bar">
          <SearchIcon className="search-glass" aria-hidden />
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Search tasks, messages, files, people"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
            aria-controls="search-results"
            aria-activedescendant={flat[active] ? `hit-${active}` : undefined}
          />
          {searching ? (
            <Spinner size={16} />
          ) : q ? (
            <button className="icon-btn small plain" type="button" onClick={() => { setQ(""); inputRef.current?.focus(); }} aria-label="Clear">
              <X />
            </button>
          ) : null}
          <button className="search-cancel" type="button" onClick={closeSearch}>
            Cancel
          </button>
          <kbd className="search-esc" aria-hidden>Esc</kbd>
        </div>

        <div className="search-chips" role="tablist" aria-label="What to search">
          <button type="button" role="tab" aria-selected={kind === null} className={clsx(kind === null && "on")} onClick={() => setKind(null)}>
            Everything
          </button>
          {SEARCH_GROUPS.map((g) => (
            <button key={g.kind} type="button" role="tab" aria-selected={kind === g.kind} className={clsx(kind === g.kind && "on")} onClick={() => setKind(kind === g.kind ? null : g.kind)}>
              {g.chip}
            </button>
          ))}
        </div>

        <div className="search-body" ref={bodyRef} id="search-results" role="listbox">
          {!ready ? (
            <div className="search-start">
              {recent.length > 0 && (
                <div className="search-recent">
                  <div className="search-group-head">
                    <span>Recent</span>
                    <button type="button" className="link-btn" onClick={() => { forgetSearches(me.id); setRecent([]); }}>
                      Clear
                    </button>
                  </div>
                  {recent.map((r) => (
                    <button key={r} type="button" className="search-recent-row" onClick={() => { setQ(r); inputRef.current?.focus(); }}>
                      <Clock3 aria-hidden />
                      <span className="ellipsis">{r}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="search-hint">
                Find tasks and their steps, chat messages and voice notes, files, projects, variations, BOQ packages, people,
                announcements and meetings. Every word you type has to match, in any order.
              </p>
              <p className="search-hint desktop-only">Press {SEARCH_SHORTCUT} to search from anywhere.</p>
            </div>
          ) : search.isError ? (
            <p className="search-empty">Search isn't working right now. Check your connection and try again.</p>
          ) : !groups.length ? (
            search.isFetching || dq !== q ? null : (
              <div className="search-empty">
                <b>Nothing found for "{dq.trim()}"</b>
                <span>Try fewer words, or check the spelling{kind ? ", or search everything" : ""}.</span>
                {kind && (
                  <button className="btn small" type="button" onClick={() => setKind(null)}>
                    Search everything
                  </button>
                )}
              </div>
            )
          ) : (
            groups.map((g) => (
              <section key={g.kind} className="search-group" aria-label={g.label}>
                <div className="search-group-head">
                  <span>{g.label}</span>
                  {g.more && (
                    <button type="button" className="link-btn" onClick={() => setKind(g.kind)}>
                      See all
                    </button>
                  )}
                </div>
                {g.hits.map((h) => {
                  index += 1;
                  const i = index;
                  return <HitRow key={`${h.kind}-${h.id}`} hit={h} words={words} index={i} active={i === active} onHover={() => setActive(i)} onOpen={() => go(h)} />;
                })}
              </section>
            ))
          )}
          {ready && kind && (search.data?.length ?? 0) >= 50 && <p className="search-hint">Showing the first 50. Add another word to narrow it down.</p>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- one result */

function HitRow({ hit, words, index, active, onHover, onOpen }: { hit: SearchHit; words: string[]; index: number; active: boolean; onHover: () => void; onOpen: () => void }) {
  const people = usePeople();
  const m = hit.meta as Record<string, any>;
  const lead = leadFor(hit, people.get);
  const { sub, snippet } = describe(hit, (id) => people.get(id)?.short_name);
  return (
    <button
      type="button"
      id={`hit-${index}`}
      data-hit={index}
      role="option"
      aria-selected={active}
      className={clsx("search-row", active && "active")}
      onMouseMove={onHover}
      onClick={onOpen}
    >
      <span className="search-lead">{lead}</span>
      <span className="search-text">
        <span className="search-title">
          <Highlight text={hit.title} words={words} />
          {hit.kind === "message" && m.voice ? <Mic className="search-mini" aria-label="Voice note" /> : null}
        </span>
        {sub && <span className="search-sub">{sub}</span>}
        {snippet && (
          <span className="search-snippet">
            <Highlight text={snippet} words={words} />
          </span>
        )}
      </span>
      {hit.kind !== "person" && hit.kind !== "project" && hit.at && <span className="search-when">{hit.kind === "event" ? fmtDate(String(m.date)) : timeAgo(hit.at)}</span>}
    </button>
  );
}

function Tile({ tone, children, color }: { tone?: string; children: ReactNode; color?: string }) {
  return (
    <span className={clsx("search-tile", tone && `tone-${tone}`)} style={color ? ({ "--tile-bg": `${color}22`, "--tile-fg": color } as React.CSSProperties) : undefined}>
      {children}
    </span>
  );
}

function leadFor(hit: SearchHit, get: (id: string | null | undefined) => any): ReactNode {
  const m = hit.meta as Record<string, any>;
  switch (hit.kind) {
    case "person":
      return <Avatar person={get(hit.id)} size={36} />;
    case "message":
      return <Avatar person={get(m.author)} size={36} />;
    case "task":
      return <Tile tone="blue"><SquareCheckBig /></Tile>;
    case "file": {
      const mime = String(m.mime ?? "");
      const name = hit.title.toLowerCase();
      if (mime.startsWith("image/")) return <Tile tone="teal"><ImageIcon /></Tile>;
      if (/sheet|excel|csv/.test(mime) || /\.(xlsx?|csv)$/.test(name)) return <Tile tone="green"><FileSpreadsheet /></Tile>;
      return <Tile tone="red"><FileText /></Tile>;
    }
    case "project":
      return <Tile color={typeof m.color === "string" ? m.color : undefined}><FolderKanban /></Tile>;
    case "vo":
      return <Tile tone="purple"><FileDiff /></Tile>;
    case "boq":
      return <Tile tone="orange"><Layers /></Tile>;
    case "announcement":
      return <Tile tone="red"><Megaphone /></Tile>;
    case "event":
      return <Tile color={EVENT_KIND[m.kind as EventKind]?.color}><CalendarDays /></Tile>;
  }
}

const PROJECT_STATUS: Record<string, string> = { active: "Active", on_hold: "On hold", completed: "Completed" };

function describe(hit: SearchHit, name: (id: string) => string | undefined): { sub: string; snippet: string | null } {
  const m = hit.meta as Record<string, any>;
  const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");
  switch (hit.kind) {
    case "task": {
      const who = ((m.assignees as string[] | null) ?? []).map(name).filter(Boolean) as string[];
      return {
        sub: join(
          hit.project_name,
          TASK_STATUS[m.status as TaskStatus]?.label,
          m.due && m.status !== "done" ? `Due ${fmtDue(m.due)}` : null,
          who.length > 2 ? `${who.slice(0, 2).join(", ")} and ${who.length - 2} more` : who.join(", "),
        ),
        snippet: hit.snippet,
      };
    }
    case "message": {
      const where =
        m.where_kind === "task" ? `On the task ${m.where ?? ""}` : m.where_kind === "direct" ? `Chat with ${m.where ?? "a former team member"}` : m.where_kind === "project" ? `${m.where ?? "Project"} chat` : (m.where ?? "Team chat");
      return { sub: join(where, m.voice ? "Voice note" : null), snippet: hit.snippet };
    }
    case "file":
      return { sub: join(hit.project_name, m.task ? `Task: ${m.task}` : m.chat ? "Shared in a chat" : null, fileSize(m.size as number), m.version > 1 ? `Version ${m.version}` : null), snippet: null };
    case "project":
      return { sub: join(hit.snippet, PROJECT_STATUS[m.status as string]), snippet: null };
    case "vo":
      return { sub: join(hit.project_name, VO_STATUS[m.status as VoStatus]?.label, m.value ? sar(Number(m.value)) : null), snippet: hit.snippet };
    case "boq":
      return { sub: join(hit.project_name, BOQ_STATUS[m.status as BoqStatus]?.label, m.due ? `Due ${fmtDue(m.due)}` : null), snippet: hit.snippet };
    case "person":
      return { sub: hit.snippet ?? "", snippet: null };
    case "announcement":
      return { sub: join(name(m.author) ? `From ${name(m.author)}` : null, hit.project_name), snippet: hit.snippet };
    case "event":
      return {
        sub: join(EVENT_KIND[m.kind as EventKind]?.label, fmtDate(String(m.date), { weekday: "short", day: "numeric", month: "short" }), m.start ? fmtClock(m.start) : null, hit.project_name),
        snippet: hit.snippet,
      };
  }
}

/** The text with the words typed marked. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  if (!words.length || !text) return <>{text}</>;
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  );
}
