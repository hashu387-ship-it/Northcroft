// Forward a message to one or more chats you're in: team chat, project chats, groups and one-to-ones.
import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, FileText, Forward, Mic, Search } from "lucide-react";
import { useInvalidate, usePeople, useProjectMap } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { forwardMessage, useChats, type ChatItem } from "@/lib/chats";
import { errorMessage } from "@/lib/supabase";
import type { Attachment, Comment } from "@/lib/types";
import { Sheet, useToast } from "./ui";
import { ChatTile } from "./ChatTile";

export function ForwardSheet({ message, files, linkCount, onClose }: { message: Comment | null; files: Attachment[]; linkCount: number; onClose: () => void }) {
  const me = useMe();
  const people = usePeople();
  const projects = useProjectMap();
  const toast = useToast();
  const invalidate = useInvalidate();
  const chats = useChats(me.id, people);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const open = !!message;

  useEffect(() => {
    if (open) {
      setQ("");
      setPicked([]);
    }
  }, [open, message?.id]);

  // Every chat you're in, plus project chats nobody has written in yet.
  const items = useMemo(() => {
    const list: ChatItem[] = [...chats.items];
    for (const p of projects.list) {
      if (p.status === "completed" || list.some((c) => c.project_id === p.id)) continue;
      list.push({
        chat: `project:${p.id}`,
        kind: "project",
        conversation_id: null,
        project_id: p.id,
        name: p.name,
        members: null,
        is_admin: false,
        last_at: null,
        last_body: null,
        last_author: null,
        last_voice: false,
        last_event: null,
        unread: 0,
        title: p.name,
        other: null,
        to: `/chats/project/${p.id}`,
      });
    }
    const s = q.trim().toLowerCase();
    return s ? list.filter((c) => c.title.toLowerCase().includes(s)) : list;
  }, [chats.items, projects.list, q]);

  const toggle = (chat: string) => setPicked((xs) => (xs.includes(chat) ? xs.filter((x) => x !== chat) : xs.length >= 20 ? xs : [...xs, chat]));

  async function send() {
    if (!message || !picked.length) return;
    setBusy(true);
    try {
      const all = [...chats.items, ...items];
      const targets = picked.map((k) => all.find((c) => c.chat === k)).filter((c): c is ChatItem => !!c);
      const { count: n, failed } = await forwardMessage(message, files, targets, me.id);
      await invalidate("comments", "attachments", "chats", "drive_links");
      const where = n === 1 ? (targets[0]?.title ?? "the chat") : `${n} chats`;
      if (failed.length) toast(`Forwarded to ${where}, but ${failed.join(", ")} couldn't be copied. Attach it there again.`, "error");
      else toast(`Forwarded to ${where}`);
      onClose();
    } catch (e) {
      toast(`Not forwarded: ${errorMessage(e)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  const what = message?.voice_path
    ? "Voice note"
    : (message?.body ?? "").replace(/\s+/g, " ").trim();
  const extras = [files.length ? (files.length === 1 ? "1 file" : `${files.length} files`) : null, linkCount ? (linkCount === 1 ? "1 Drive link" : `${linkCount} Drive links`) : null].filter(Boolean);

  return (
    <Sheet
      open={open}
      onClose={() => !busy && onClose()}
      title="Forward to"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={send} disabled={busy || picked.length === 0}>
            <Forward /> {busy ? "Forwarding..." : picked.length > 1 ? `Forward to ${picked.length} chats` : "Forward"}
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <div className="fwd-preview">
          {message?.voice_path ? <Mic /> : files.length ? <FileText /> : <Forward />}
          <span className="grow">
            <span className="ellipsis">{what || "Message"}</span>
            {extras.length > 0 && <span className="faint tiny">With {extras.join(" and ")}</span>}
          </span>
        </div>
        <label className="search fwd-search">
          <Search />
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" />
        </label>
        <div className="pick-list" role="group" aria-label="Chats">
          {chats.loading && <div className="faint small" style={{ padding: 8 }}>Loading chats...</div>}
          {!chats.loading && items.length === 0 && <div className="faint small" style={{ padding: 8 }}>No chats match.</div>}
          {items.map((c) => {
            const on = picked.includes(c.chat);
            const sub =
              c.kind === "team" ? "Everyone on the team" : c.kind === "project" ? "Project chat" : c.kind === "group" ? `Group · ${(c.members ?? []).length} people` : people.get(c.other)?.title ?? "One-to-one";
            return (
              <button key={c.chat} type="button" className={clsx("pick-row", on && "on")} onClick={() => toggle(c.chat)} aria-pressed={on}>
                <ChatTile item={c} project={projects.get(c.project_id)} person={people.get(c.other)} small />
                <span className="grow">
                  <b>{c.title}</b>
                  <span>{sub}</span>
                </span>
                <span className="check">{on && <Check />}</span>
              </button>
            );
          })}
        </div>
        <p className="faint tiny" style={{ margin: 0 }}>
          The copy shows as forwarded. Only chats you're in are listed, so private chats stay private.
        </p>
      </div>
    </Sheet>
  );
}
