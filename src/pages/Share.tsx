// Share into the app: a PDF, photo, spreadsheet or link shared from WhatsApp, email or Files (on
// Android and computers) lands here. Pick a chat or one of your open tasks, add a message, send.
// It goes through the outbox, so it also works with no signal and finishes by itself.
import "@/styles/offline.css";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileText, FolderKanban, Link2, MessagesSquare, Search, SendHorizontal, Share2, SquareCheckBig, Users, X } from "lucide-react";
import clsx from "clsx";
import { unwrap, usePeople, useProjectMap } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { useChats, type ChatItem } from "@/lib/chats";
import { checkDriveLink, looksLikeDriveLink, type LinkInfo } from "@/lib/drivelinks";
import { checkOtherLink, describeLink, linkMeta, normalizeUrl } from "@/lib/links";
import { keepFiles, queueMessage, type OutboxRow } from "@/lib/outbox";
import { clearShare, driveLinkIn, pendingShare, sharedWords, type Shared } from "@/lib/share";
import { supabase } from "@/lib/supabase";
import { fileSize } from "@/lib/format";
import { fmtDue } from "@/lib/time";
import type { Task } from "@/lib/types";
import { PageHead } from "@/components/PageHead";
import { Avatar, Empty, Loading, Segmented, useToast } from "@/components/ui";

type Dest =
  | { kind: "chat"; chat: ChatItem }
  | { kind: "task"; task: Task };

export default function Share() {
  const me = useMe();
  const people = usePeople();
  const projects = useProjectMap();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [shared, setShared] = useState<Shared | null | undefined>(undefined);
  const [tab, setTab] = useState<"chats" | "tasks">("chats");
  const [q, setQ] = useState("");
  const [dest, setDest] = useState<Dest | null>(null);
  const [message, setMessage] = useState("");
  const [drive, setDrive] = useState<{ url: string; info: LinkInfo | null; checking: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const chats = useChats(me.id, people);

  useEffect(() => {
    let alive = true;
    pendingShare().then((s) => {
      if (!alive) return;
      setShared(s);
      if (!s) return;
      const link = driveLinkIn(s);
      setMessage(sharedWords(s, link));
      // A Google Drive link is checked with Google; any other link becomes a card that opens it.
      const url = link ? normalizeUrl(link) : null;
      if (url) {
        setDrive({ url, info: null, checking: navigator.onLine !== false });
        if (navigator.onLine !== false) {
          (looksLikeDriveLink(url) ? checkDriveLink(url) : checkOtherLink(url))
            .then((info) => alive && setDrive({ url, info, checking: false }))
            .catch(() => alive && setDrive({ url, info: null, checking: false }));
        }
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Open tasks you're on, gave out, or check.
  const tasks = useQuery({
    queryKey: ["tasks", "share", me.id],
    queryFn: () =>
      unwrap<Task[]>(
        supabase
          .from("tasks")
          .select("*")
          .neq("status", "done")
          // Not tasks still waiting for approval: they aren't work yet.
          .is("approval", null)
          .or(`assignees.cs.{${me.id}},created_by.eq.${me.id},reviewer_id.eq.${me.id}`)
          .order("due_date", { ascending: true, nullsFirst: false })
          .limit(300),
      ),
  });

  const previews = useMemo(
    () => (shared?.files ?? []).map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f.blob) : null)),
    [shared],
  );
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const needle = q.trim().toLowerCase();
  const chatList = chats.items.filter((c) => !needle || c.title.toLowerCase().includes(needle));
  const taskList = (tasks.data ?? []).filter(
    (t) => !needle || t.title.toLowerCase().includes(needle) || (projects.get(t.project_id)?.name ?? "").toLowerCase().includes(needle),
  );

  async function cancel() {
    await clearShare();
    navigate("/", { replace: true });
  }

  async function send() {
    if (!shared || !dest || sending) return;
    setSending(true);
    try {
      const files = shared.files;
      const link = drive?.info ? [{ ...drive.info, url: drive.url }] : [];
      // Without a checked Drive link, the link simply goes in the message text.
      let text = message.trim();
      if (drive && !drive.info && !text.includes(drive.url)) text = `${text}\n${drive.url}`.trim();
      const where: Pick<OutboxRow, "task_id" | "project_id" | "conversation_id"> =
        dest.kind === "task"
          ? { task_id: dest.task.id, project_id: dest.task.project_id, conversation_id: null }
          : dest.chat.kind === "project"
            ? { task_id: null, project_id: dest.chat.project_id, conversation_id: null }
            : dest.chat.kind === "team"
              ? { task_id: null, project_id: null, conversation_id: null }
              : { task_id: null, project_id: null, conversation_id: dest.chat.conversation_id };
      const chat =
        dest.kind === "task"
          ? `task:${dest.task.id}`
          : dest.chat.kind === "team"
            ? "team"
            : dest.chat.kind === "project"
              ? `project:${dest.chat.project_id}`
              : `conv:${dest.chat.conversation_id}`;
      await queueMessage({
        userId: me.id,
        chat,
        row: { body: text || sharedBody(files.map((f) => f.name), link.length), mentions: [], author_id: me.id, reply_to: null, ...where },
        links: link,
        files: keepFiles(files.map((f) => new File([f.blob], f.name, { type: f.type }))),
      });
      await clearShare();
      if (navigator.onLine === false) toast("There's no signal, so it's saved on this phone and goes out when you're back online.", "info");
      navigate(dest.kind === "task" ? `/tasks/${dest.task.id}` : dest.chat.to, { replace: true });
    } catch {
      toast("That couldn't be saved on this phone. Try sharing it again.", "error");
      setSending(false);
    }
  }

  if (shared === undefined) {
    return (
      <div className="page">
        <Loading />
      </div>
    );
  }

  if (!shared) {
    return (
      <div className="page">
        <PageHead title="Share" />
        <div className="glass card">
          <Empty icon={<Share2 />} title={params.get("error") ? "That share didn't come through" : "Nothing to share"}>
            {params.get("error")
              ? "Something went wrong receiving it. Try sharing it again from the other app."
              : "In WhatsApp, email or Files, tap Share on a PDF, photo or spreadsheet and pick Northcroft. It comes here, and you choose the chat or task it goes to."}
          </Empty>
        </div>
      </div>
    );
  }

  const count = shared.files.length;
  return (
    <div className="page share-page">
      <PageHead
        title="Share"
        sub={count ? `${count === 1 ? "1 file" : `${count} files`}${drive ? " and a link" : ""}. Pick where it goes.` : "Pick where it goes."}
        actions={
          <button className="btn ghost" type="button" onClick={cancel}>
            <X /> Cancel
          </button>
        }
      />

      <div className="stack" style={{ gap: 16 }}>
        {(count > 0 || drive) && (
          <div className="glass card stack" style={{ gap: 8 }}>
            <div className="share-files">
              {shared.files.map((f, i) => (
                <div key={i} className="solid share-file">
                  {previews[i] ? (
                    <img src={previews[i]!} alt="" />
                  ) : (
                    <span className="icon">
                      <FileText size={20} />
                    </span>
                  )}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis bold small">{f.name}</div>
                    <div className="faint tiny">{fileSize(f.blob.size)}</div>
                  </div>
                </div>
              ))}
              {drive && (
                <div className="solid share-file">
                  <span className="icon" style={{ background: "rgba(48, 209, 88, 0.14)", color: "#1f9d55" }}>
                    <Link2 size={20} />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis bold small">{drive.info?.title ?? (looksLikeDriveLink(drive.url) ? "Google Drive link" : describeLink(drive.url).name)}</div>
                    <div className="faint tiny">
                      {drive.checking
                        ? "Checking the link..."
                        : drive.info
                          ? drive.info.provider && drive.info.provider !== "google"
                            ? `${linkMeta({ kind: drive.info.kind, site: drive.info.site, title: drive.info.title, url: drive.url })}: it opens from the message`
                            : drive.info.kind === "folder"
                              ? "Folder: its files show in the message"
                              : "File: it opens from the message"
                          : "It goes in the message as a link"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="glass card stack" style={{ gap: 12 }}>
          <div className="row wrap" style={{ gap: 10, justifyContent: "space-between" }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Send to</h2>
            <Segmented
              value={tab}
              onChange={(v) => {
                setTab(v);
                setQ("");
              }}
              options={[
                { value: "chats", label: "Chats" },
                { value: "tasks", label: "My open tasks" },
              ]}
            />
          </div>
          <label className="input-with-icon" style={{ position: "relative", display: "block" }}>
            <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
            <input
              className="input"
              style={{ paddingLeft: 36 }}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tab === "chats" ? "Find a chat" : "Find a task or project"}
              aria-label={tab === "chats" ? "Find a chat" : "Find a task"}
            />
          </label>
          <div className="share-list" role="listbox" aria-label={tab === "chats" ? "Chats" : "Tasks"}>
            {tab === "chats" ? (
              chats.loading ? (
                <Loading rows={4} />
              ) : chatList.length === 0 ? (
                <div className="muted small" style={{ padding: 10 }}>
                  No chats match.
                </div>
              ) : (
                chatList.map((c) => {
                  const active = dest?.kind === "chat" && dest.chat.chat === c.chat;
                  const other = c.kind === "direct" ? people.get(c.other) : undefined;
                  return (
                    <button key={c.chat} type="button" role="option" aria-selected={active} className={clsx("share-dest", active && "active")} onClick={() => setDest({ kind: "chat", chat: c })}>
                      {other ? (
                        <Avatar person={other} size={36} />
                      ) : (
                        <span className="dest-icon" style={{ background: c.kind === "team" ? "var(--brand)" : c.kind === "project" ? "#0A84FF" : "#30D158" }}>
                          {c.kind === "team" ? <MessagesSquare /> : c.kind === "project" ? <FolderKanban /> : <Users />}
                        </span>
                      )}
                      <span className="grow">
                        <b className="ellipsis">{c.title}</b>
                        <small>{c.kind === "team" ? "Everyone on the team" : c.kind === "project" ? "Project chat" : c.kind === "group" ? "Group" : "One-to-one chat"}</small>
                      </span>
                    </button>
                  );
                })
              )
            ) : tasks.isLoading ? (
              <Loading rows={4} />
            ) : taskList.length === 0 ? (
              <div className="muted small" style={{ padding: 10 }}>
                {needle ? "No tasks match." : "You have no open tasks."}
              </div>
            ) : (
              taskList.map((t) => {
                const active = dest?.kind === "task" && dest.task.id === t.id;
                const project = projects.get(t.project_id);
                return (
                  <button key={t.id} type="button" role="option" aria-selected={active} className={clsx("share-dest", active && "active")} onClick={() => setDest({ kind: "task", task: t })}>
                    <span className="dest-icon" style={{ background: "#BF5AF2" }}>
                      <SquareCheckBig />
                    </span>
                    <span className="grow">
                      <b className="ellipsis">{t.title}</b>
                      <small className="ellipsis">
                        {[project?.name, t.due_date ? `Due ${fmtDue(t.due_date)}` : null].filter(Boolean).join(" · ") || "No project"}
                      </small>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="glass card stack" style={{ gap: 10 }}>
          <label className="stack" style={{ gap: 6 }}>
            <span className="small bold">Message (optional)</span>
            <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a message" />
          </label>
          <button className="btn primary large block" type="button" onClick={send} disabled={!dest || sending}>
            <SendHorizontal />
            {dest ? `Send to ${dest.kind === "task" ? dest.task.title : dest.chat.title}` : "Pick a chat or task"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The message text when only files or a link are shared. */
function sharedBody(names: string[], links: number): string {
  if (names.length === 1 && !links) return `Shared ${names[0]}`;
  if (!names.length && links) return "Shared a link";
  const parts = [names.length ? (names.length === 1 ? "1 file" : `${names.length} files`) : null, links ? "a link" : null].filter(Boolean);
  return `Shared ${parts.join(" and ")}`;
}
