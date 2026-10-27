// A project's Files tab:
//   * Project folder: files and links added to the project itself, in folders anyone on the team
//     makes (folders inside folders too). Files and links can be moved between folders. Whoever made
//     a folder, or Hassan or a senior, renames or removes it; removing moves what's in it up a level.
//   * From tasks and VOs: files and links added on the project's tasks, VOs, announcements and
//     chat, each saying where it came from.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronRight, Folder, FolderMinus, FolderOpen, FolderPlus, Layers, Link2, Pencil, Upload } from "lucide-react";
import clsx from "clsx";
import { usePeople, useSettings, useTasks, useInvalidate } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useDriveLinks, type DriveLink } from "@/lib/drivelinks";
import {
  createFolder,
  isProjectLevelFile,
  isProjectLevelLink,
  moveFileToFolder,
  moveLinkToFolder,
  nameTaken,
  removeFolder,
  renameFolder,
  useProjectFolders,
} from "@/lib/projectFolders";
import { errorMessage } from "@/lib/supabase";
import { timeAgo } from "@/lib/time";
import type { Attachment, Project, ProjectFolder } from "@/lib/types";
import { Attachments, useAttachmentList } from "@/components/Attachments";
import { DriveLinks } from "@/components/DriveLinks";
import { DropZone } from "@/components/DropZone";
import { Empty, Field, Sheet, useConfirm, useToast } from "@/components/ui";
import { useVariations } from "./api";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}...` : s);
const voLabel = (n: string) => (/vo/i.test(n) ? n : `VO ${n}`);

type Moving = { kind: "file"; item: Attachment } | { kind: "link"; item: DriveLink };

export function ProjectFiles({ project }: { project: Project }) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const driveOn = !!useSettings().data?.drive_connected_at;
  const [params, setParams] = useSearchParams();
  const folders = useProjectFolders(project.id);
  const files = useAttachmentList({ projectId: project.id });
  const links = useDriveLinks({ projectId: project.id });
  const tasks = useTasks({ projectId: project.id });
  const variations = useVariations(project.id);

  // Where we are: ?folder=<id>, or the top of the Project folder.
  const wanted = params.get("folder");
  const current = wanted ? folders.byId.get(wanted) ?? null : null;
  const currentId = current?.id ?? null;
  // Someone removed the folder we're in: back to the top.
  useEffect(() => {
    if (wanted && !folders.loading && !folders.byId.has(wanted)) setParams({}, { replace: true });
  }, [wanted, folders.loading, folders.byId, setParams]);
  const go = (id: string | null) => setParams(id ? { folder: id } : {});

  // A file or link whose folder isn't there (it can't normally happen) shows at the top. While the
  // folders load, files in folders stay where they are, so they don't flash up at the top.
  const folderOf = (id: string | null | undefined) => (id && (folders.loading || folders.byId.has(id)) ? id : null);
  const allFiles = files.data?.rows ?? [];
  const allLinks = links.data ?? [];
  const projectFiles = allFiles.filter(isProjectLevelFile);
  const projectLinks = allLinks.filter(isProjectLevelLink);
  const inFolder = (folderId: string | null) => ({
    folders: folders.children(folderId),
    files: projectFiles.filter((a) => folderOf(a.project_folder_id) === folderId),
    links: projectLinks.filter((l) => folderOf(l.project_folder_id) === folderId),
  });
  const here = inFolder(currentId);
  const loading = folders.loading || files.isLoading || links.isLoading;

  const countText = (folderId: string) => {
    const c = inFolder(folderId);
    const parts = [
      c.folders.length ? plural(c.folders.length, "folder") : "",
      c.files.length ? plural(c.files.length, "file") : "",
      c.links.length ? plural(c.links.length, "link") : "",
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : "Empty";
  };

  // "Task: BOQ check", "VO 02", "Announcement", "Project chat".
  const taskTitle = useMemo(() => new Map((tasks.data ?? []).map((t) => [t.id, t.title])), [tasks.data]);
  const voNumber = useMemo(() => new Map((variations.data ?? []).map((v) => [v.id, v.vo_number])), [variations.data]);
  const fromLabel = (x: { task_id: string | null; recurring_id?: string | null; variation_id?: string | null; announcement_id?: string | null; comment_id?: string | null }) => {
    if (x.task_id) {
      const t = taskTitle.get(x.task_id);
      return t ? `Task: ${short(t)}` : "Task";
    }
    if (x.variation_id) {
      const v = voNumber.get(x.variation_id);
      return v ? voLabel(v) : "VO";
    }
    if (x.announcement_id) return "Announcement";
    if (x.recurring_id) return "Repeating task";
    if (x.comment_id) return "Project chat";
    return null;
  };

  const uploadRef = useRef<((files: File[]) => void) | null>(null);
  const addLinkRef = useRef<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [naming, setNaming] = useState<{ mode: "new" } | { mode: "rename"; folder: ProjectFolder } | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);

  const canManage = (f: ProjectFolder) => f.created_by === me.id || canAssign;
  const folderName = (id: string | null) => (id ? folders.byId.get(id)?.name ?? "Project folder" : "Project folder");

  async function saveName(name: string) {
    if (!naming) return;
    if (naming.mode === "new") {
      await createFolder(project.id, currentId, name, me.id);
      toast(`"${name.trim()}" made`);
    } else {
      await renameFolder(naming.folder.id, name);
      toast(`Renamed to "${name.trim()}"`);
    }
    await invalidate("project_folders");
    setNaming(null);
  }

  async function remove(f: ProjectFolder) {
    const c = inFolder(f.id);
    const what = [
      c.files.length ? plural(c.files.length, "file") : "",
      c.links.length ? plural(c.links.length, "link") : "",
      c.folders.length ? plural(c.folders.length, "folder") : "",
    ].filter(Boolean);
    const to = folderName(f.parent_id);
    const ok = await confirm({
      title: `Remove "${f.name}"?`,
      message: what.length
        ? `Its ${what.join(", ")} move to ${to}. Nothing is deleted from Google Drive.`
        : "It's empty. Nothing is deleted from Google Drive.",
      confirmLabel: "Remove folder",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeFolder(f.id);
      await invalidate("project_folders", "attachments", "drive_links");
      toast(what.length ? `"${f.name}" removed. What was in it is now in ${to}.` : `"${f.name}" removed`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function moveTo(folderId: string | null) {
    if (!moving) return;
    try {
      if (moving.kind === "file") await moveFileToFolder(moving.item.id, folderId);
      else await moveLinkToFolder(moving.item.id, folderId);
      await invalidate(moving.kind === "file" ? "attachments" : "drive_links");
      toast(`Moved to ${folderName(folderId)}`);
      setMoving(null);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const path = folders.path(currentId);
  const empty = !loading && here.folders.length === 0 && here.files.length === 0 && here.links.length === 0;
  const linkedFiles = allFiles.filter((a) => !isProjectLevelFile(a));
  const linkedLinks = allLinks.filter((l) => !isProjectLevelLink(l));

  return (
    <>
      <DropZone className="glass card stack project-folder" onFiles={(fs) => uploadRef.current?.(fs)} label={`Drop to add to ${current ? current.name : "the Project folder"}`}>
        <div className="card-head">
          <h3>
            <FolderOpen /> Project folder
          </h3>
        </div>
        <div className="row wrap pf-toolbar">
          <button className="btn small" type="button" onClick={() => setNaming({ mode: "new" })}>
            <FolderPlus /> New folder
          </button>
          <button className="btn small" type="button" onClick={() => fileInput.current?.click()}>
            <Upload /> Add files
          </button>
          <button className="btn small" type="button" onClick={() => addLinkRef.current?.()}>
            <Link2 /> Add link
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Choose files"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (list.length) uploadRef.current?.(list);
            }}
          />
        </div>
        <span className="faint tiny">
          Contracts, drawings, specs, quotations: anything for the whole project. {driveOn ? "Files are saved to the team's Google Drive." : "Up to 50 MB each."}{" "}
          On a computer you can drop files here.
        </span>

        {current && (
          <nav className="pf-path" aria-label="Where you are">
            <button type="button" onClick={() => go(null)}>
              <FolderOpen /> Project folder
            </button>
            {path.map((f) => (
              <span key={f.id} className="pf-crumb">
                <ChevronRight aria-hidden />
                <button type="button" onClick={() => go(f.id)} aria-current={f.id === currentId ? "location" : undefined} className={clsx(f.id === currentId && "here")}>
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        {here.folders.length > 0 && (
          <div className="files">
            {here.folders.map((f) => (
              <div key={f.id} className="file folder-row">
                <button type="button" className="file-main" onClick={() => go(f.id)} aria-label={`Open folder ${f.name}`}>
                  <span className="icon folder-icon">
                    <Folder />
                  </span>
                  <span className="file-text">
                    <span className="file-name">{f.name}</span>
                    <span className="file-meta">
                      {countText(f.id)} · {people.get(f.created_by)?.short_name ?? "Someone"} · {timeAgo(f.created_at)}
                    </span>
                  </span>
                </button>
                {canManage(f) && (
                  <>
                    <button type="button" className="icon-btn small plain" onClick={() => setNaming({ mode: "rename", folder: f })} aria-label={`Rename ${f.name}`} title="Rename">
                      <Pencil />
                    </button>
                    <button type="button" className="icon-btn small plain" onClick={() => void remove(f)} aria-label={`Remove folder ${f.name}`} title="Remove folder">
                      <FolderMinus />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <Attachments
          projectId={project.id}
          filter={(a) => isProjectLevelFile(a) && folderOf(a.project_folder_id) === currentId}
          projectFolderId={currentId}
          toolbar={false}
          uploadRef={uploadRef}
          hideWhenEmpty
          sortByName
          onMove={(a) => setMoving({ kind: "file", item: a })}
        />
        <DriveLinks
          projectId={project.id}
          filter={(l) => isProjectLevelLink(l) && folderOf(l.project_folder_id) === currentId}
          projectFolderId={currentId}
          showAdd={false}
          addRef={addLinkRef}
          hint={false}
          onMove={(l) => setMoving({ kind: "link", item: l })}
        />
        {empty && (
          <Empty icon={<FolderOpen />} title={current ? `${current.name} is empty` : "Nothing in the Project folder yet"}>
            Add files or links, or make a folder.
          </Empty>
        )}
      </DropZone>

      <div className="glass card stack project-linked-files">
        <div className="card-head">
          <h3>
            <Layers /> From tasks and VOs
          </h3>
        </div>
        <span className="faint tiny">Files and links added on this project's tasks, VOs, announcements and chat. To change one, open it where it was added.</span>
        <Attachments projectId={project.id} canUpload={false} filter={(a) => !isProjectLevelFile(a)} fromLabel={fromLabel} hideWhenEmpty />
        <DriveLinks projectId={project.id} canAdd={false} filter={(l) => !isProjectLevelLink(l)} fromLabel={fromLabel} />
        {!loading && linkedFiles.length === 0 && linkedLinks.length === 0 && <span className="small muted">Nothing yet.</span>}
      </div>

      <FolderNameSheet
        key={naming ? (naming.mode === "new" ? "new" : naming.folder.id) : "closed"}
        open={!!naming}
        onClose={() => setNaming(null)}
        title={naming?.mode === "rename" ? `Rename "${naming.folder.name}"` : current ? `New folder in ${current.name}` : "New folder"}
        initial={naming?.mode === "rename" ? naming.folder.name : ""}
        saveLabel={naming?.mode === "rename" ? "Rename" : "Make folder"}
        siblings={naming?.mode === "rename" ? folders.children(naming.folder.parent_id) : here.folders}
        exceptId={naming?.mode === "rename" ? naming.folder.id : undefined}
        onSave={saveName}
      />
      <MoveSheet
        open={!!moving}
        onClose={() => setMoving(null)}
        name={moving ? (moving.kind === "file" ? moving.item.name : moving.item.title) : ""}
        from={moving ? folderOf(moving.item.project_folder_id) : null}
        foldersIn={folders.children}
        onPick={(id) => void moveTo(id)}
      />
    </>
  );
}

function FolderNameSheet({
  open,
  onClose,
  title,
  initial,
  saveLabel,
  siblings,
  exceptId,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  initial: string;
  saveLabel: string;
  siblings: ProjectFolder[];
  exceptId?: string;
  onSave: (name: string) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const problem = !trimmed
    ? null
    : trimmed.length > 120
      ? "Keep the name under 120 characters."
      : nameTaken(siblings, trimmed, exceptId)
        ? `There's already a folder called "${trimmed}" here.`
        : null;
  const unchanged = exceptId ? trimmed === initial.trim() : false;

  async function submit() {
    if (!trimmed || problem || unchanged || busy) return;
    setBusy(true);
    try {
      await onSave(trimmed);
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
      title={title}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={() => void submit()} disabled={!trimmed || !!problem || unchanged || busy}>
            {busy ? "Saving..." : saveLabel}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Folder name" hint={problem ?? "For example Drawings, Contract, Specifications or IFC Rev C."}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={140} placeholder="Drawings" />
        </Field>
      </form>
    </Sheet>
  );
}

function MoveSheet({
  open,
  onClose,
  name,
  from,
  foldersIn,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  /** The folder it's in now (null: the top). */
  from: string | null;
  foldersIn: (parentId: string | null) => ProjectFolder[];
  onPick: (folderId: string | null) => void;
}) {
  // Every folder, top down, indented under the folder it's in.
  const rows: { folder: ProjectFolder | null; depth: number }[] = [{ folder: null, depth: 0 }];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of foldersIn(parentId)) {
      rows.push({ folder: f, depth });
      if (depth < 12) walk(f.id, depth + 1);
    }
  };
  walk(null, 1);
  let body: ReactNode = (
    <div className="list move-folders">
      {rows.map(({ folder, depth }) => {
        const id = folder?.id ?? null;
        const isHere = id === from;
        return (
          <button
            key={id ?? "top"}
            type="button"
            className={clsx("list-item move-folder", isHere && "here")}
            style={{ paddingLeft: 12 + depth * 18 }}
            disabled={isHere}
            onClick={() => onPick(id)}
          >
            {folder ? <Folder /> : <FolderOpen />}
            <span className="grow">{folder ? folder.name : "Project folder"}</span>
            {isHere && <span className="small muted">Here now</span>}
          </button>
        );
      })}
    </div>
  );
  if (rows.length === 1) body = <p className="small muted">There are no folders yet. Make one with New folder first.</p>;
  return (
    <Sheet open={open} onClose={onClose} title={`Move "${name}"`}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Pick the folder it goes in.
      </p>
      {body}
    </Sheet>
  );
}
