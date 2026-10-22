import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { FileText, MessageCircle, Paperclip, SendHorizontal, Trash2, X } from "lucide-react";
import { unwrap, useInvalidate, usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { isImage, signedUrl, signedUrls, uploadFile } from "@/lib/files";
import { useMarkSeen } from "@/lib/seen";
import { errorMessage, supabase } from "@/lib/supabase";
import { fmtDue, dateOf, fmtTime12, todayISO } from "@/lib/time";
import { fileSize } from "@/lib/format";
import type { Attachment, Comment, Profile } from "@/lib/types";
import { Avatar, Empty, Loading, useConfirm, useToast } from "./ui";
import { PersonAvatar, openPersonCard } from "./People";

type Scope = { kind: "task"; taskId: string; projectId: string | null } | { kind: "project"; projectId: string } | { kind: "team" };

function scopeKey(s: Scope) {
  return s.kind === "task" ? ["task", s.taskId] : s.kind === "project" ? ["project", s.projectId] : ["team"];
}

/** Find @Name mentions in text. "@all" or "@everyone" mentions the whole team. */
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

export function CommentThread({ scope, placeholder, height }: { scope: Scope; placeholder?: string; height?: number | string }) {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const listRef = useRef<HTMLDivElement>(null);
  const isChat = scope.kind !== "task";

  // Reading a chat clears its notifications (task pages do this for the whole task).
  useMarkSeen(scope.kind === "team" ? { link: "/chat" } : scope.kind === "project" ? { link: `/projects/${scope.projectId}/chat` } : null);

  const comments = useQuery({
    queryKey: ["comments", ...scopeKey(scope)],
    queryFn: async () => {
      let q = supabase.from("comments").select("*");
      if (scope.kind === "task") q = q.eq("task_id", scope.taskId);
      else if (scope.kind === "project") q = q.eq("project_id", scope.projectId).is("task_id", null);
      else q = q.is("task_id", null).is("project_id", null);
      const rows = await unwrap<Comment[]>(q.order("created_at", { ascending: false }).limit(300));
      return rows.reverse();
    },
  });

  const ids = (comments.data ?? []).map((c) => c.id);
  const files = useQuery({
    queryKey: ["attachments", "comments", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = await unwrap<Attachment[]>(supabase.from("attachments").select("*").in("comment_id", ids));
      const urls = await signedUrls(rows.filter(isImage).map((r) => r.path));
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

  useEffect(() => {
    if (isChat && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.data?.length, isChat]);

  async function remove(c: Comment) {
    const ok = await confirm({ title: "Delete message?", message: "It will be removed for everyone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const { error } = await supabase.from("comments").delete().eq("id", c.id);
    if (error) toast(errorMessage(error), "error");
    else invalidate("comments");
  }

  async function open(a: Attachment) {
    try {
      window.open(await signedUrl(a.path), "_blank", "noopener");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const list = comments.data ?? [];
  let lastDay = "";

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div ref={listRef} className="thread" style={height ? { maxHeight: height, overflowY: "auto", paddingRight: 4 } : undefined}>
        {comments.isLoading && <Loading />}
        {!comments.isLoading && list.length === 0 && (
          <Empty icon={<MessageCircle />} title={isChat ? "No messages yet" : "No comments yet"}>
            {isChat
              ? "Everyone on the team gets a notification when you post here."
              : "Type @ to mention someone. They get a notification on their phone."}
          </Empty>
        )}
        {list.map((c) => {
          const author = people.get(c.author_id);
          const mine = c.author_id === me.id;
          const day = dateOf(c.created_at);
          const showDay = isChat && day !== lastDay;
          lastDay = day;
          const atts = filesByComment.get(c.id) ?? [];
          return (
            <Fragment key={c.id}>
              {showDay && (
                <div className="faint tiny" style={{ textAlign: "center", fontWeight: 600 }}>
                  {day === todayISO() ? "Today" : fmtDue(day)}
                </div>
              )}
              <div className={clsx("msg", mine && "mine")}>
                {/* Tap a photo to see that person's card, with WhatsApp and call buttons. */}
                {!mine && <PersonAvatar person={author} size={28} />}
                <div className="bubble">
                  {!mine && (
                    <button type="button" className="who who-btn" onClick={() => author && openPersonCard(author.id)}>
                      {author?.short_name ?? "Someone"}
                    </button>
                  )}
                  <div>{renderBody(c.body, people.active)}</div>
                  {atts.length > 0 && (
                    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                      {atts.map((a) =>
                        isImage(a) && files.data?.urls[a.path] ? (
                          <button key={a.id} onClick={() => open(a)} style={{ border: 0, padding: 0, background: "none" }} type="button">
                            <img src={files.data.urls[a.path]} alt={a.name} style={{ borderRadius: 12, maxHeight: 220, objectFit: "cover" }} />
                          </button>
                        ) : (
                          <button key={a.id} className="file" onClick={() => open(a)} type="button">
                            <span className="icon">
                              <FileText />
                            </span>
                            <span className="ellipsis small">
                              {a.name}
                              <br />
                              <span className="faint">{fileSize(a.size)}</span>
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  )}
                  <div className="when row" style={{ gap: 8 }}>
                    <span>
                      {!isChat && dateOf(c.created_at) !== todayISO() ? `${fmtDue(dateOf(c.created_at))}, ` : ""}
                      {fmtTime12(c.created_at)}
                    </span>
                    {mine && (
                      <button className="icon-btn small plain" style={{ width: 22, height: 22, color: "inherit" }} onClick={() => remove(c)} aria-label="Delete message" type="button">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      <Composer scope={scope} placeholder={placeholder ?? (isChat ? "Message the team" : "Add a comment")} />
    </div>
  );
}

function Composer({ scope, placeholder }: { scope: Scope; placeholder: string }) {
  const me = useMe();
  const people = usePeople();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const options = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    // First names that start with what was typed come first, then other name matches.
    const rank = (p: Profile) =>
      p.short_name.toLowerCase().startsWith(q) ? 0 : p.full_name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2;
    const list: { id: string; label: string; person?: Profile }[] = people.active
      .filter((p) => p.id !== me.id && rank(p) < 2)
      .sort((a, b) => rank(a) - rank(b) || a.short_name.localeCompare(b.short_name))
      .map((p) => ({ id: p.id, label: p.short_name, person: p }));
    if ("all".startsWith(q)) list.push({ id: "all", label: "all" });
    return list.slice(0, 7);
  }, [query, people.active, me.id]);

  function onChange(v: string) {
    setBody(v);
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
    if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      send();
    }
  }

  async function send() {
    const text = body.trim();
    if ((!text && !files.length) || sending) return;
    setSending(true);
    try {
      const mentions = findMentions(text, people.active, me.id);
      const row = {
        body: text || (files.length === 1 ? `Shared ${files[0].name}` : `Shared ${files.length} files`),
        mentions,
        author_id: me.id,
        task_id: scope.kind === "task" ? scope.taskId : null,
        project_id: scope.kind === "task" ? scope.projectId : scope.kind === "project" ? scope.projectId : null,
      };
      const { data, error } = await supabase.from("comments").insert(row).select().single();
      if (error) throw error;
      for (const f of files) {
        await uploadFile(f, { taskId: row.task_id, projectId: row.project_id, commentId: data.id, userId: me.id });
      }
      setBody("");
      setFiles([]);
      if (ref.current) ref.current.style.height = "auto";
      // In chats everyone is notified anyway, so only confirm mentions on task comments.
      if (mentions.length && scope.kind === "task") {
        const names = mentions.map((id) => people.get(id)?.short_name).filter(Boolean);
        toast(names.length > 3 ? `Notified ${names.length} people` : `Notified ${names.join(", ")}`, "info");
      }
      invalidate("comments", "attachments");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      {files.length > 0 && (
        <div className="row wrap">
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
              <button key={o.id} type="button" className={clsx(i === active && "active")} onMouseDown={(e) => { e.preventDefault(); pick(o.label); }}>
                {o.person ? <Avatar person={o.person} size={26} /> : <span className="avatar" style={{ ["--size" as string]: "26px", background: "var(--accent)" }}>@</span>}
                <span>
                  {o.person ? o.person.short_name : "Everyone"}
                  <span className="faint tiny" style={{ display: "block" }}>
                    {o.person ? o.person.title : "Notify the whole team"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <button className="icon-btn plain" type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a file">
          <Paperclip />
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
        <button className="icon-btn" style={{ background: "var(--accent)", color: "#fff" }} type="button" onClick={send} disabled={sending} aria-label="Send">
          <SendHorizontal />
        </button>
      </div>
    </div>
  );
}
