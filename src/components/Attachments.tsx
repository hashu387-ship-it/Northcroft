import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, DraftingCompass, FileSpreadsheet, FileText, Film, Folder, FolderInput, FolderOpen, FolderUp, HardDrive, Image as ImageIcon, Paperclip, Presentation, Repeat, Trash2, Upload } from "lucide-react";
import { unwrap, useInvalidate, usePeople, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { deleteAttachment, isDrawing, isImage, isOnDrive, previewUrls, uploadFile } from "@/lib/files";
import { isVideo, needsPreview, previewKind, previewPending } from "@/lib/previews";
import { errorMessage, supabase } from "@/lib/supabase";
import { fileSize } from "@/lib/format";
import { timeAgo } from "@/lib/time";
import type { Attachment } from "@/lib/types";
import { Empty, Loading, useConfirm, useToast } from "./ui";
import { useOpenFile } from "./useOpenFile";
import { DropZone } from "./DropZone";
import { canPickFolder, folderParts, relPath, withoutJunk } from "@/lib/folderUpload";
import { createFolder } from "@/lib/projectFolders";
import { AskPreviewWhenSeen, DocIcon, docTag, kindClass, PlayBadge, usePreviewUpdates } from "./FilePreview";

function FileIcon({ a }: { a: Attachment }) {
  if (/\.(xlsx?|xlsm|csv)$/i.test(a.name)) return <FileSpreadsheet />;
  if (isDrawing(a)) return <DraftingCompass />;
  if (/\.(pptx?|pptm|ppsx?|odp)$/i.test(a.name)) return <Presentation />;
  if (isVideo(a)) return <Film />;
  return <FileText />;
}

/** A file's own name, without the folder it was added in ("Drawings/A-101.pdf" is "A-101.pdf"). */
export const baseName = (name: string) => name.split("/").filter(Boolean).pop() || name;

/** Files added as a folder keep their folder path in their name; this groups them back into folders. */
type FileTree = { folders: Map<string, FileTree>; files: Attachment[]; count: number };
function buildTree(rows: Attachment[]): FileTree {
  const root: FileTree = { folders: new Map(), files: [], count: 0 };
  for (const a of rows) {
    const parts = a.name.split("/").filter(Boolean);
    let node = root;
    node.count++;
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part);
      if (!next) {
        next = { folders: new Map(), files: [], count: 0 };
        node.folders.set(part, next);
      }
      next.count++;
      node = next;
    }
    node.files.push(a);
  }
  return root;
}

export interface AttachmentsWhere {
  taskId?: string | null;
  projectId?: string | null;
  repeatOf?: string | null;
  variationId?: string | null;
  voRound?: string | null;
  voSide?: "sent" | "assessment" | null;
  knownRounds?: string[];
  announcementId?: string | null;
  leaveId?: string | null;
  /** Files on a submission (its own, and those posted in its conversation). */
  submissionId?: string | null;
}

/**
 * The files on a task, a variation, an announcement, a leave request, or every file in a project
 * (projectId only), with photo previews. The project's list is shared by everything that shows it
 * (the Project folder, its folders and "From tasks and VOs"), so it's loaded once.
 */
export function useAttachmentList(w: AttachmentsWhere) {
  const { taskId, projectId, repeatOf, variationId, voRound, voSide, knownRounds, announcementId, leaveId, submissionId } = w;
  return useQuery({
    queryKey: [
      "attachments",
      taskId ? "task" : variationId ? "vo" : announcementId ? "announcement" : leaveId ? "leave" : submissionId ? "submission" : "project",
      taskId ?? variationId ?? announcementId ?? leaveId ?? submissionId ?? projectId,
      repeatOf ?? null,
      voRound ?? null,
      voSide ?? null,
      (knownRounds ?? []).join(","),
    ],
    enabled: !!(taskId || variationId || announcementId || leaveId || submissionId || projectId),
    queryFn: async () => {
      let query = supabase.from("attachments").select("*");
      if (taskId && repeatOf) query = query.or(`task_id.eq.${taskId},recurring_id.eq.${repeatOf}`);
      else if (variationId) {
        query = query.eq("variation_id", variationId);
        if (voRound) query = query.eq("vo_round", voRound).eq("vo_side", voSide ?? "sent");
      } else if (announcementId) query = query.eq("announcement_id", announcementId);
      else if (leaveId) query = query.eq("leave_id", leaveId);
      else if (submissionId) query = query.eq("submission_id", submissionId);
      else query = taskId ? query.eq("task_id", taskId) : query.eq("project_id", projectId!);
      let rows = await unwrap<Attachment[]>(query.order("created_at", { ascending: false }).limit(500));
      // Supporting files: no revision, or one that has been taken off.
      if (variationId && !voRound) rows = rows.filter((r) => !r.vo_round || !(knownRounds ?? []).includes(r.vo_round));
      const urls = await previewUrls(rows);
      return { rows, urls };
    },
  });
}

/**
 * Files on a task (taskId), on a variation (variationId: one submission's side, or its supporting
 * files), or in a project (projectId only). For a copy of a repeating task, `repeatOf` also brings
 * in the files that come with every copy. Each file is a row with its full name; tap to open.
 */
export function Attachments({
  taskId,
  projectId,
  repeatOf,
  canUpload = true,
  variationId,
  voRound,
  voSide,
  compact,
  emptyText = "No files yet",
  knownRounds,
  announcementId,
  hideWhenEmpty,
  uploadRef,
  leaveId,
  filter,
  projectFolderId,
  fromLabel,
  onMove,
  toolbar = true,
  sortByName,
  submissionId,
}: {
  taskId?: string | null;
  projectId?: string | null;
  repeatOf?: string | null;
  canUpload?: boolean;
  variationId?: string | null;
  /** With variationId: this submission's files (null: the supporting ones). */
  voRound?: string | null;
  voSide?: "sent" | "assessment" | null;
  /** A smaller list without the big empty picture, for the variation form. */
  compact?: boolean;
  emptyText?: string;
  /** For a variation's supporting files: its revisions' keys. Files from a revision that was taken
   *  off show with the supporting files, so nothing goes missing. */
  knownRounds?: string[];
  /** Files on an announcement. */
  announcementId?: string | null;
  /** Show nothing at all when there are no files (and no upload button, or no toolbar). */
  hideWhenEmpty?: boolean;
  /** Lets a bigger area around this list take dropped files, or its own Add files button (it calls the same upload). */
  uploadRef?: MutableRefObject<((files: File[]) => void) | null>;
  /** Files on a leave request. */
  leaveId?: string | null;
  /** Show only some of the files (the project's list is loaded once and split). */
  filter?: (a: Attachment) => boolean;
  /** Files added here go in this folder of the Project folder (null: the top). */
  projectFolderId?: string | null;
  /** Where a file came from ("Task: BOQ check", "VO 02"), shown in its line. */
  fromLabel?: (a: Attachment) => string | null;
  /** Shows a Move button on each file. */
  onMove?: (a: Attachment) => void;
  /** False: no Add files row (the page has its own button and calls uploadRef). */
  toolbar?: boolean;
  /** A to Z instead of newest first. */
  sortByName?: boolean;
  /** Files on a submission. */
  submissionId?: string | null;
}) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const folderPick = canPickFolder();
  // Folders (added as a folder) that are open in the list.
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  // "Uploading plans.pdf to Google Drive, 40%" while a big file goes up.
  const [progress, setProgress] = useState<string | null>(null);
  const driveOn = !!useSettings().data?.drive_connected_at;

  const q = useAttachmentList({ taskId, projectId, repeatOf, variationId, voRound, voSide, knownRounds, announcementId, leaveId, submissionId });
  usePreviewUpdates();

  // In a project's Files (or an EI's folder) an added folder becomes real folders there, reusing a
  // folder that already has the same name. Path inside the added folder → folder id.
  async function folderFor(parts: string[], made: Map<string, string | null>): Promise<string | null> {
    let parent = projectFolderId ?? null;
    let key = "";
    for (const raw of parts) {
      const name = raw.slice(0, 120);
      key += `/${name}`;
      if (made.has(key)) {
        parent = made.get(key) ?? null;
        continue;
      }
      let q = supabase.from("project_folders").select("id").eq("project_id", projectId!).eq("name", name).is("removed_at", null);
      q = parent ? q.eq("parent_id", parent) : q.is("parent_id", null);
      const found = await unwrap<{ id: string }[]>(q.limit(1));
      const id = found[0]?.id ?? (await createFolder(projectId!, parent, name, me.id)).id;
      made.set(key, id);
      parent = id;
    }
    return parent;
  }

  async function onFiles(list: FileList | File[] | null) {
    if (!list?.length || busy) return;
    const all = withoutJunk(Array.from(list));
    if (!all.length) return;
    setBusy(true);
    // Anywhere else, files from a folder keep their folder path in their name and show grouped
    // under the folder.
    const realFolders = projectFolderId !== undefined && !!projectId;
    const made = new Map<string, string | null>();
    try {
      for (const [n, raw] of all.entries()) {
        const parts = folderParts(raw);
        let f = raw;
        let folderId = projectFolderId ?? null;
        if (parts.length && realFolders) folderId = await folderFor(parts, made);
        else if (parts.length) f = new File([raw], relPath(raw).slice(-240), { type: raw.type, lastModified: raw.lastModified });
        const label = all.length > 1 ? `${raw.name} (${n + 1} of ${all.length})` : raw.name;
        setProgress(`Uploading ${label}...`);
        await uploadFile(f, {
          taskId: taskId ?? null,
          projectId: projectId ?? null,
          variationId: variationId ?? null,
          voRound: voRound ?? null,
          voSide: voRound ? voSide ?? "sent" : null,
          announcementId: announcementId ?? null,
          leaveId: leaveId ?? null,
          projectFolderId: folderId,
          submissionId: submissionId ?? null,
          userId: me.id,
          onProgress: (x) => setProgress(`Saving ${label} to Google Drive, ${Math.round(x * 100)}%`),
        });
      }
      toast(all.length === 1 ? "File added" : `${all.length} files added`);
      if (made.size) invalidate("attachments", "project_folders");
      else invalidate("attachments");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
      if (folderRef.current) folderRef.current.value = "";
    }
  }

  // A bigger drop area (the VO revision box, the Project folder) hands its files to the same upload.
  useEffect(() => {
    if (!uploadRef) return;
    uploadRef.current = canUpload ? (fs) => void onFiles(fs) : null;
    return () => {
      uploadRef.current = null;
    };
  });

  const open = useOpenFile();

  async function remove(a: Attachment) {
    const everyCopy = !a.task_id && !!a.recurring_id;
    const ok = await confirm({
      title: `Delete ${a.name}?`,
      message: everyCopy ? "This file comes with every copy of this repeating task. Deleting it takes it off all of them." : undefined,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteAttachment(a);
      invalidate("attachments");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  let rows = q.data?.rows ?? [];
  if (filter) rows = rows.filter(filter);
  if (sortByName) rows = [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  if (hideWhenEmpty && (!canUpload || !toolbar) && rows.length === 0 && !progress) return null;

  // One small row per file: a little preview on the left (the photo, or a PDF's first page, a
  // drawing, a sheet...), its name and details, and the tools. Tap it to open it full size.
  function fileRow(a: Attachment, depth: number) {
    const from = fromLabel?.(a) ?? null;
    const photo = isImage(a) ? q.data?.urls[a.path] : undefined;
    const docKind = previewKind(a);
    const docPic = docKind ? q.data?.urls[a.path] : undefined;
    const making = !!docKind && !docPic && previewPending(a.id);
    const pic = photo ?? docPic;
    const openIt = () => open(a, isImage(a) ? rows.filter(isImage) : undefined);
    return (
      <div key={a.id} className="file" style={depth ? { paddingLeft: 10 + depth * 18 } : undefined}>
        <button onClick={openIt} className="file-main" type="button" title={a.name}>
          <span className={`file-thumb ${docKind ? kindClass(docKind) : ""}${pic && !photo ? " doc" : ""}${making ? " making" : ""}`}>
            {pic ? <img src={pic} alt="" loading="lazy" decoding="async" /> : docKind ? <DocIcon kind={docKind} /> : isImage(a) ? <ImageIcon /> : <FileIcon a={a} />}
            {pic && docKind === "video" && <PlayBadge />}
            {docKind && pic && <span className={`doc-tag ${kindClass(docKind)}`}>{docTag(a, docKind)}</span>}
          </span>
          <span className="file-text">
            <span className="file-name">{baseName(a.name)}</span>
            <span className="file-meta">
              {isOnDrive(a) && (
                <>
                  <span className="drive-tag">
                    <HardDrive size={11} /> Drive
                  </span>
                  {" · "}
                </>
              )}
              {from ? (
                <>
                  <span className="drive-tag repeat-tag">{from}</span>
                  {" · "}
                </>
              ) : (
                <>
                  {!announcementId && a.announcement_id && (
                    <>
                      <span className="drive-tag repeat-tag" title="On an announcement">
                        Announcement
                      </span>
                      {" · "}
                    </>
                  )}
                  {!variationId && a.variation_id && (
                    <>
                      <span className="drive-tag repeat-tag" title="On a variation">
                        VO
                      </span>
                      {" · "}
                    </>
                  )}
                </>
              )}
              {!a.task_id && a.recurring_id && (
                <>
                  <span className="drive-tag repeat-tag" title="Comes with every copy of this repeating task">
                    <Repeat size={11} /> Every repeat
                  </span>
                  {" · "}
                </>
              )}
              {making ? "Making a preview · " : ""}
              {a.version > 1 ? `Version ${a.version} · ` : ""}
              {a.size != null ? `${fileSize(a.size)} · ` : ""}
              {people.get(a.uploaded_by)?.short_name ?? "Someone"} · {timeAgo(a.created_at)}
            </span>
          </span>
        </button>
        {onMove && (
          <button className="icon-btn small plain" onClick={() => onMove(a)} aria-label={`Move ${baseName(a.name)}`} title="Move to a folder" type="button">
            <FolderInput />
          </button>
        )}
        {(a.uploaded_by === me.id || canAssign) && (
          <button className="icon-btn small plain" onClick={() => remove(a)} aria-label={`Delete ${baseName(a.name)}`} title="Delete" type="button">
            <Trash2 />
          </button>
        )}
        {needsPreview(a) && <AskPreviewWhenSeen a={a} />}
      </div>
    );
  }

  // A folder that was added as a folder: its name and how many files, tap to open or close it.
  function renderTree(node: FileTree, depth: number, key: string): ReactNode[] {
    const out: ReactNode[] = [];
    const names = [...node.folders.keys()].sort((x, y) => x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }));
    for (const name of names) {
      const child = node.folders.get(name)!;
      const k = `${key}/${name}`;
      const isOpen = openFolders.has(k);
      out.push(
        <div key={`folder:${k}`} className="file folder-row" style={depth ? { paddingLeft: 10 + depth * 18 } : undefined}>
          <button
            className="file-main"
            type="button"
            aria-expanded={isOpen}
            onClick={() =>
              setOpenFolders((s) => {
                const next = new Set(s);
                if (next.has(k)) next.delete(k);
                else next.add(k);
                return next;
              })
            }
          >
            <span className="file-thumb folder">{isOpen ? <FolderOpen /> : <Folder />}</span>
            <span className="file-text">
              <span className="file-name">{name}</span>
              <span className="file-meta">
                Folder · {child.count} {child.count === 1 ? "file" : "files"}
              </span>
            </span>
            <ChevronRight className={isOpen ? "folder-chev open" : "folder-chev"} />
          </button>
        </div>,
      );
      if (isOpen) out.push(...renderTree(child, depth + 1, k));
    }
    for (const a of node.files) out.push(fileRow(a, depth));
    return out;
  }

  return (
    <DropZone className="stack" onFiles={(fs) => void onFiles(fs)} disabled={!canUpload || busy || !!uploadRef}>
      {canUpload && toolbar && (
        <div className="row wrap">
          <button className="btn small" onClick={() => inputRef.current?.click()} disabled={busy} type="button">
            <Upload /> {busy ? "Uploading..." : "Add files"}
          </button>
          {folderPick && (
            <button className="btn small" onClick={() => folderRef.current?.click()} disabled={busy} type="button">
              <FolderUp /> Add folder
            </button>
          )}
          {(!compact || progress) && (
            <span className="faint tiny">
              {progress ?? (driveOn ? "Drawings, BOQs, PDFs, photos. Saved to the team's Google Drive." : "Drawings, BOQs, PDFs, photos. Up to 50 MB each.")}
            </span>
          )}
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} aria-label="Choose files" />
          {folderPick && (
            <input
              ref={(el) => {
                folderRef.current = el;
                el?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              hidden
              onChange={(e) => onFiles(e.target.files)}
              aria-label="Choose a folder"
            />
          )}
        </div>
      )}
      {!toolbar && progress && <span className="faint tiny upload-progress">{progress}</span>}
      {q.isLoading ? (
        compact || hideWhenEmpty ? null : <Loading />
      ) : rows.length === 0 ? (
        hideWhenEmpty ? null : compact ? <span className="faint tiny">{emptyText}</span> : <Empty icon={<Paperclip />} title={emptyText} />
      ) : (
        <div className={compact ? "files compact" : "files"}>{renderTree(buildTree(rows), 0, "")}</div>
      )}
    </DropZone>
  );
}
