import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, FolderInput, HardDrive, Image as ImageIcon, Paperclip, Repeat, Trash2, Upload } from "lucide-react";
import { unwrap, useInvalidate, usePeople, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { deleteAttachment, isImage, isOnDrive, previewUrls, uploadFile } from "@/lib/files";
import { errorMessage, supabase } from "@/lib/supabase";
import { fileSize } from "@/lib/format";
import { timeAgo } from "@/lib/time";
import type { Attachment } from "@/lib/types";
import { Empty, Loading, useConfirm, useToast } from "./ui";
import { useOpenFile } from "./useOpenFile";
import { DropZone } from "./DropZone";

function FileIcon({ a }: { a: Attachment }) {
  if (/\.(xlsx?|csv)$/i.test(a.name)) return <FileSpreadsheet />;
  return <FileText />;
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
}

/**
 * The files on a task, a variation, an announcement, a leave request, or every file in a project
 * (projectId only), with photo previews. The project's list is shared by everything that shows it
 * (the Project folder, its folders and "From tasks and VOs"), so it's loaded once.
 */
export function useAttachmentList(w: AttachmentsWhere) {
  const { taskId, projectId, repeatOf, variationId, voRound, voSide, knownRounds, announcementId, leaveId } = w;
  return useQuery({
    queryKey: ["attachments", taskId ? "task" : variationId ? "vo" : announcementId ? "announcement" : leaveId ? "leave" : "project", taskId ?? variationId ?? announcementId ?? leaveId ?? projectId, repeatOf ?? null, voRound ?? null, voSide ?? null, (knownRounds ?? []).join(",")],
    enabled: !!(taskId || variationId || announcementId || leaveId || projectId),
    queryFn: async () => {
      let query = supabase.from("attachments").select("*");
      if (taskId && repeatOf) query = query.or(`task_id.eq.${taskId},recurring_id.eq.${repeatOf}`);
      else if (variationId) {
        query = query.eq("variation_id", variationId);
        if (voRound) query = query.eq("vo_round", voRound).eq("vo_side", voSide ?? "sent");
      } else if (announcementId) query = query.eq("announcement_id", announcementId);
      else if (leaveId) query = query.eq("leave_id", leaveId);
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
}) {
  const me = useMe();
  const { canAssign } = useAuth();
  const people = usePeople();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // "Uploading plans.pdf to Google Drive, 40%" while a big file goes up.
  const [progress, setProgress] = useState<string | null>(null);
  const driveOn = !!useSettings().data?.drive_connected_at;

  const q = useAttachmentList({ taskId, projectId, repeatOf, variationId, voRound, voSide, knownRounds, announcementId, leaveId });

  async function onFiles(list: FileList | File[] | null) {
    if (!list?.length || busy) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) {
        setProgress(`Uploading ${f.name}...`);
        await uploadFile(f, {
          taskId: taskId ?? null,
          projectId: projectId ?? null,
          variationId: variationId ?? null,
          voRound: voRound ?? null,
          voSide: voRound ? voSide ?? "sent" : null,
          announcementId: announcementId ?? null,
          leaveId: leaveId ?? null,
          projectFolderId: projectFolderId ?? null,
          userId: me.id,
          onProgress: (x) => setProgress(`Saving ${f.name} to Google Drive, ${Math.round(x * 100)}%`),
        });
      }
      toast(list.length === 1 ? "File added" : `${list.length} files added`);
      invalidate("attachments");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
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
  return (
    <DropZone className="stack" onFiles={(fs) => void onFiles(fs)} disabled={!canUpload || busy || !!uploadRef}>
      {canUpload && toolbar && (
        <div className="row wrap">
          <button className="btn small" onClick={() => inputRef.current?.click()} disabled={busy} type="button">
            <Upload /> {busy ? "Uploading..." : "Add files"}
          </button>
          {(!compact || progress) && (
            <span className="faint tiny">
              {progress ?? (driveOn ? "Drawings, BOQs, PDFs, photos. Saved to the team's Google Drive." : "Drawings, BOQs, PDFs, photos. Up to 50 MB each.")}
            </span>
          )}
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} aria-label="Choose files" />
        </div>
      )}
      {!toolbar && progress && <span className="faint tiny upload-progress">{progress}</span>}
      {q.isLoading ? (
        compact || hideWhenEmpty ? null : <Loading />
      ) : rows.length === 0 ? (
        hideWhenEmpty ? null : compact ? <span className="faint tiny">{emptyText}</span> : <Empty icon={<Paperclip />} title={emptyText} />
      ) : (
        <div className={compact ? "files compact" : "files"}>
          {rows.map((a) => {
            const from = fromLabel?.(a) ?? null;
            const photo = isImage(a) ? q.data?.urls[a.path] : undefined;
            const openIt = () => open(a, isImage(a) ? rows.filter(isImage) : undefined);
            const text = (
              <span className="file-text">
                <span className="file-name">{a.name}</span>
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
                  {a.version > 1 ? `Version ${a.version} · ` : ""}
                  {a.size != null ? `${fileSize(a.size)} · ` : ""}
                  {people.get(a.uploaded_by)?.short_name ?? "Someone"} · {timeAgo(a.created_at)}
                </span>
              </span>
            );
            const tools = (
              <>
                {onMove && (
                  <button className="icon-btn small plain" onClick={() => onMove(a)} aria-label={`Move ${a.name}`} title="Move to a folder" type="button">
                    <FolderInput />
                  </button>
                )}
                {(a.uploaded_by === me.id || canAssign) && (
                  <button className="icon-btn small plain" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} title="Delete" type="button">
                    <Trash2 />
                  </button>
                )}
              </>
            );
            // A photo shows big, full width, with its name and details underneath. Tap it to open
            // it full screen (swipe through the others, mark it up).
            if (photo) {
              return (
                <div key={a.id} className="file photo">
                  <button onClick={openIt} className="photo-view" type="button" aria-label={`Open ${a.name}`}>
                    <img src={photo} alt="" loading="lazy" decoding="async" />
                  </button>
                  <div className="photo-foot">
                    <button onClick={openIt} className="file-main" type="button">
                      {text}
                    </button>
                    {tools}
                  </div>
                </div>
              );
            }
            return (
              <div key={a.id} className="file">
                <button onClick={openIt} className="file-main" type="button">
                  <span className="icon">{isImage(a) ? <ImageIcon /> : <FileIcon a={a} />}</span>
                  {text}
                </button>
                {tools}
              </div>
            );
          })}
        </div>
      )}
    </DropZone>
  );
}
