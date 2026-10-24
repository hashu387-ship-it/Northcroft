import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Link2,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import { useInvalidate, usePeople, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { DriveError } from "@/lib/drive";
import {
  addDriveLinks,
  checkDriveLink,
  driveFileScreenId,
  driveItemUrl,
  driveWebUrl,
  listDriveLink,
  looksLikeDriveLink,
  useDriveLinks,
  type DriveItem,
  type DriveLink,
  type LinkInfo,
} from "@/lib/drivelinks";
import { fileKind } from "@/lib/files";
import { fileSize } from "@/lib/format";
import { isIOS } from "@/lib/push";
import { errorMessage, supabase } from "@/lib/supabase";
import { fmtDate, timeAgo } from "@/lib/time";
import { Field, Sheet, Spinner, useConfirm, useToast } from "./ui";
import type { OpenFileState } from "./useOpenFile";

function ItemIcon({ item }: { item: Pick<DriveItem, "folder" | "mime" | "name"> }) {
  if (item.folder) return <Folder />;
  const k = fileKind({ mime: item.mime, name: item.name });
  if (k === "sheet") return <FileSpreadsheet />;
  if (k === "image") return <ImageIcon />;
  return <FileText />;
}

/** Download a file from a linked folder. iPhones open it in a new tab, where it can be saved or shared. */
async function downloadItem(linkId: string, item: DriveItem) {
  if (isIOS()) {
    const tab = window.open("", "_blank");
    try {
      const url = await driveItemUrl(linkId, item.id, item.resource_key, true);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
    } catch (e) {
      tab?.close();
      throw e;
    }
    return;
  }
  const url = await driveItemUrl(linkId, item.id, item.resource_key, true);
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The files in a linked folder, with subfolders you can step into. */
function FolderList({ link }: { link: DriveLink }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { isManager } = useAuth();
  // The folders opened so far, from the linked one down.
  const [path, setPath] = useState<{ id: string; name: string; resource_key: string | null }[]>([]);
  const here = path[path.length - 1];
  const q = useQuery({
    queryKey: ["drive_list", link.id, here?.id ?? "top"],
    queryFn: () => listDriveLink(link.id, here),
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof DriveError && ["no_key", "bad_key", "api_off", "not_shared"].includes(e.code)) && n < 1,
  });
  const files = q.data ?? [];
  const photos = files.filter((f) => !f.folder && f.viewable && fileKind(f) === "image");

  function open(item: DriveItem) {
    if (item.folder) {
      setPath((p) => [...p, { id: item.id, name: item.name, resource_key: item.resource_key }]);
      return;
    }
    if (!item.viewable) {
      window.open(`https://drive.google.com/open?id=${item.id}`, "_blank", "noopener");
      return;
    }
    if (fileKind(item) !== "other") {
      const ids = fileKind(item) === "image" ? photos.map((p) => driveFileScreenId(link.id, p)) : [];
      const state: OpenFileState | undefined = ids.length > 1 ? { siblings: ids } : undefined;
      navigate(`/files/${driveFileScreenId(link.id, item)}`, state ? { state } : undefined);
      return;
    }
    // Word files, videos and the like open in a new tab.
    const tab = window.open("", "_blank");
    driveItemUrl(link.id, item.id, item.resource_key)
      .then((url) => {
        if (tab) tab.location.href = url;
        else window.open(url, "_blank", "noopener");
      })
      .catch((e) => {
        tab?.close();
        toast(errorMessage(e), "error");
      });
  }

  return (
    <div className="dl-folder">
      {path.length > 0 && (
        <div className="dl-crumbs">
          <button type="button" onClick={() => setPath([])}>
            {link.title}
          </button>
          {path.map((p, i) => (
            <span key={p.id}>
              <ChevronRight size={13} aria-hidden />
              <button type="button" onClick={() => setPath((x) => x.slice(0, i + 1))} disabled={i === path.length - 1}>
                {p.name}
              </button>
            </span>
          ))}
        </div>
      )}
      {q.isLoading ? (
        <div className="dl-note">
          <Spinner size={16} /> Opening the folder in Google Drive...
        </div>
      ) : q.error ? (
        <div className="dl-note error">
          <span className="grow">{errorMessage(q.error)}</span>
          {q.error instanceof DriveError && q.error.code === "no_key" && isManager ? (
            <button className="btn small" type="button" onClick={() => navigate("/settings/drive")}>
              <Settings /> Add the key
            </button>
          ) : (
            <button className="btn small ghost" type="button" onClick={() => q.refetch()}>
              <RefreshCw /> Try again
            </button>
          )}
        </div>
      ) : files.length === 0 ? (
        <div className="dl-note">This folder is empty.</div>
      ) : (
        <div className="dl-items">
          {files.map((f) => (
            <div key={f.id + (f.folder ? "/" : "")} className={clsx("dl-item", f.folder && "folder")}>
              <button type="button" className="dl-item-main" onClick={() => open(f)} aria-label={f.folder ? `Open folder ${f.name}` : `Open ${f.name}`}>
                <span className="dl-icon">
                  <ItemIcon item={f} />
                </span>
                <span className="dl-name">
                  <b className="ellipsis">{f.name}</b>
                  <span className="faint tiny">
                    {f.folder ? "Folder" : [f.size != null ? fileSize(f.size) : null, f.modified ? fmtDate(f.modified.slice(0, 10)) : null].filter(Boolean).join(" · ")}
                    {!f.folder && !f.viewable ? " · Opens in Google Drive" : ""}
                  </span>
                </span>
                {f.folder && <ChevronRight className="dl-chev" aria-hidden />}
              </button>
              {!f.folder && f.viewable && (
                <button
                  type="button"
                  className="icon-btn small plain"
                  aria-label={`Download ${f.name}`}
                  title="Download"
                  onClick={() => downloadItem(link.id, f).catch((e) => toast(errorMessage(e), "error"))}
                >
                  <Download />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One Drive link: a folder that opens into its file list, or a single file. `compact` is the
 *  smaller card inside a chat message (folders start closed). */
export function LinkCard({ link, showTaskNote, compact }: { link: DriveLink; showTaskNote?: boolean; compact?: boolean }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [openList, setOpenList] = useState(!compact);
  const canRemove = link.added_by === me.id || canAssign;
  const file: DriveItem = {
    id: link.drive_id,
    name: link.title,
    mime: link.mime ?? "",
    size: null,
    modified: null,
    resource_key: link.resource_key,
    folder: false,
    viewable: true,
  };

  async function remove() {
    const ok = await confirm({
      title: `Take "${link.title}" off?`,
      message: link.comment_id
        ? "It goes from this message for everyone. Nothing changes in Google Drive."
        : link.recurring_id && !link.task_id
          ? "It comes with every copy of this repeating task, so it goes from all of them. Nothing changes in Google Drive."
          : "Nothing changes in Google Drive.",
      confirmLabel: "Take it off",
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("drive_links").update({ removed_at: new Date().toISOString() }).eq("id", link.id);
    if (error) toast(errorMessage(error), "error");
    else toast("Drive link taken off");
    invalidate("drive_links");
  }

  // In a message, who shared it and when is already on the message.
  const meta = compact
    ? link.kind === "folder"
      ? openList
        ? "Google Drive folder"
        : "Google Drive folder · tap to see the files"
      : "Google Drive file"
    : [link.kind === "folder" ? "Google Drive folder" : "Google Drive file", `added by ${people.get(link.added_by)?.short_name ?? "someone"} ${timeAgo(link.created_at)}`].join(" · ");

  return (
    <div className={clsx("dl-card", compact && "compact")}>
      <div className="dl-head">
        {link.kind === "folder" ? (
          <button type="button" className="dl-head-main" onClick={() => setOpenList((v) => !v)} aria-expanded={openList}>
            <span className="dl-drive">{openList ? <FolderOpen /> : <Folder />}</span>
            <span className="dl-name">
              <b className="ellipsis">{link.title}</b>
              <span className="faint tiny">
                {meta}
                {showTaskNote && link.task_id ? " · on a task" : ""}
                {link.recurring_id && !link.task_id ? " · every repeat" : ""}
              </span>
            </span>
            {openList ? <ChevronDown className="dl-chev" aria-hidden /> : <ChevronRight className="dl-chev" aria-hidden />}
          </button>
        ) : (
          <FileHead link={link} file={file} meta={meta} />
        )}
        <a className="icon-btn small plain" href={driveWebUrl(link)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${link.title} in Google Drive`} title="Open in Google Drive">
          <ExternalLink />
        </a>
        {canRemove && (
          <button type="button" className="icon-btn small plain" onClick={remove} aria-label={`Take ${link.title} off`} title="Take off">
            <Trash2 />
          </button>
        )}
      </div>
      {link.kind === "folder" && openList && <FolderList link={link} />}
    </div>
  );
}

/** A link to a single file: opens like any file, with a Download button. */
function FileHead({ link, file, meta }: { link: DriveLink; file: DriveItem; meta: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const k = fileKind(file);
  function open() {
    if (k !== "other") {
      navigate(`/files/${driveFileScreenId(link.id, file)}`);
      return;
    }
    window.open(driveWebUrl(link), "_blank", "noopener");
  }
  return (
    <>
      <button type="button" className="dl-head-main" onClick={open} aria-label={`Open ${link.title}`}>
        <span className="dl-drive">
          <ItemIcon item={{ folder: false, mime: file.mime, name: file.name }} />
        </span>
        <span className="dl-name">
          <b className="ellipsis">{link.title}</b>
          <span className="faint tiny">{meta}</span>
        </span>
      </button>
      <button
        type="button"
        className="icon-btn small plain"
        aria-label={`Download ${link.title}`}
        title="Download"
        onClick={() => downloadItem(link.id, file).catch((e) => toast(errorMessage(e), "error"))}
      >
        <Download />
      </button>
    </>
  );
}

/** Paste a Drive link, check it with Google, then add it. */
export function AddDriveLinkSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  /** Gets the checked link; saves it (or keeps it for later, in the New task form). */
  onAdd: (link: LinkInfo & { url: string }) => Promise<void> | void;
}) {
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState<{ text: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setUrl("");
    setInfo(null);
    setError(null);
    setBusy(false);
  }
  function close() {
    reset();
    onClose();
  }

  async function check(value = url) {
    const v = value.trim();
    setInfo(null);
    setError(null);
    if (!v) return;
    if (!looksLikeDriveLink(v)) {
      setError({ text: "That isn't a Google Drive link. In Drive, use Share > Copy link, then paste it here.", code: "format" });
      return;
    }
    setBusy(true);
    try {
      setInfo(await checkDriveLink(v));
    } catch (e) {
      setError({ text: errorMessage(e), code: e instanceof DriveError ? e.code : "error" });
    } finally {
      setBusy(false);
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      void check(text);
    } catch {
      /* the browser didn't allow it; typing or long-press paste still works */
    }
  }

  async function add() {
    if (!info) return;
    setBusy(true);
    try {
      await onAdd({ ...info, url: url.trim() });
      close();
    } catch (e) {
      setError({ text: errorMessage(e), code: "error" });
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add a Google Drive link"
      footer={
        <>
          <button className="btn" type="button" onClick={close}>
            Cancel
          </button>
          {info ? (
            <button className="btn primary" type="button" onClick={add} disabled={busy}>
              <Link2 /> {busy ? "Adding..." : "Add link"}
            </button>
          ) : (
            <button className="btn primary" type="button" onClick={() => check()} disabled={busy || !url.trim()}>
              {busy ? "Checking..." : "Check link"}
            </button>
          )}
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Google Drive link" hint='Share the folder or file in Drive as "Anyone with the link", then copy the link.'>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setInfo(null);
                setError(null);
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text");
                if (text) setTimeout(() => void check(text), 0);
              }}
              onKeyDown={(e) => e.key === "Enter" && void check()}
              placeholder="https://drive.google.com/drive/folders/..."
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-label="Google Drive link"
            />
            {typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function" && (
              <button className="btn" type="button" onClick={paste} title="Paste">
                <ClipboardPaste /> Paste
              </button>
            )}
          </div>
        </Field>
        {busy && !info && (
          <div className="dl-note">
            <Spinner size={16} /> Checking with Google Drive...
          </div>
        )}
        {info && (
          <div className="dl-preview">
            <span className="dl-drive">{info.kind === "folder" ? <Folder /> : <ItemIcon item={{ folder: false, mime: info.mime ?? "", name: info.title }} />}</span>
            <span className="dl-name">
              <b className="ellipsis">{info.title}</b>
              <span className="faint tiny">
                {info.kind === "folder" ? "Folder: everyone will see the files in it" : `File${info.size != null ? ` · ${fileSize(info.size)}` : ""}`}
              </span>
            </span>
          </div>
        )}
        {error && (
          <div className="dl-note error">
            <span className="grow">{error.text}</span>
            {error.code === "no_key" && isManager && (
              <button className="btn small" type="button" onClick={() => navigate("/settings/drive")}>
                <Settings /> Add the key
              </button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Drive links on a task (with its repeating task's) or on a project. */
export function DriveLinks({
  taskId,
  projectId,
  repeatOf,
}: {
  taskId?: string | null;
  projectId?: string | null;
  repeatOf?: string | null;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const keySet = !!useSettings().data?.drive_key_added_at;
  const q = useDriveLinks({ taskId, projectId, repeatOf });
  const [adding, setAdding] = useState(false);
  const links = q.data ?? [];

  async function save(link: LinkInfo & { url: string }) {
    await addDriveLinks([link], { taskId: taskId ?? null, projectId: projectId ?? null });
    await invalidate("drive_links");
    toast(link.kind === "folder" ? `"${link.title}" added. Its files show here.` : `"${link.title}" added`);
  }

  return (
    <div className="dl-section">
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn small" type="button" onClick={() => setAdding(true)}>
          <Link2 /> Add Drive link
        </button>
        <span className="faint tiny">
          {keySet ? "Paste a Google Drive folder or file link; its files show here to open or download." : "Paste a Google Drive folder or file link (needs a one-time set-up in Settings > Google Drive)."}
        </span>
      </div>
      {links.map((l) => (
        <LinkCard key={l.id} link={l} showTaskNote={!taskId} />
      ))}
      <AddDriveLinkSheet open={adding} onClose={() => setAdding(false)} onAdd={save} />
    </div>
  );
}
