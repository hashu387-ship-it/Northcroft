import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, HardDrive, Paperclip, Repeat, Trash2, Upload } from "lucide-react";
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

/**
 * Files on a task (taskId), on a variation (variationId: one submission's side, or its supporting
 * files), or every file in a project (projectId only). For a copy of a repeating task, `repeatOf`
 * also brings in the files that come with every copy.
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
  /** Show nothing at all when there are no files (and no upload button). */
  hideWhenEmpty?: boolean;
  /** Lets a bigger area around this list take dropped files (it calls the same upload). */
  uploadRef?: MutableRefObject<((files: File[]) => void) | null>;
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

  const q = useQuery({
    queryKey: ["attachments", taskId ? "task" : variationId ? "vo" : announcementId ? "announcement" : "project", taskId ?? variationId ?? announcementId ?? projectId, repeatOf ?? null, voRound ?? null, voSide ?? null, (knownRounds ?? []).join(",")],
    queryFn: async () => {
      let query = supabase.from("attachments").select("*");
      if (taskId && repeatOf) query = query.or(`task_id.eq.${taskId},recurring_id.eq.${repeatOf}`);
      else if (variationId) {
        query = query.eq("variation_id", variationId);
        if (voRound) query = query.eq("vo_round", voRound).eq("vo_side", voSide ?? "sent");
      } else if (announcementId) query = query.eq("announcement_id", announcementId);
      else query = taskId ? query.eq("task_id", taskId) : query.eq("project_id", projectId!);
      let rows = await unwrap<Attachment[]>(query.order("created_at", { ascending: false }).limit(300));
      // Supporting files: no revision, or one that has been taken off.
      if (variationId && !voRound) rows = rows.filter((r) => !r.vo_round || !(knownRounds ?? []).includes(r.vo_round));
      const urls = await previewUrls(rows);
      return { rows, urls };
    },
  });

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

  // A bigger drop area (the VO revision box) hands its files to the same upload.
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

  const rows = q.data?.rows ?? [];
  if (hideWhenEmpty && !canUpload && rows.length === 0) return null;
  return (
    <DropZone className="stack" onFiles={(fs) => void onFiles(fs)} disabled={!canUpload || busy || !!uploadRef}>
      {canUpload && (
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
      {q.isLoading ? (
        compact ? null : <Loading />
      ) : rows.length === 0 ? (
        compact ? <span className="faint tiny">{emptyText}</span> : <Empty icon={<Paperclip />} title={emptyText} />
      ) : (
        <div className="files">
          {rows.map((a) => (
            <div key={a.id} className="file" style={{ position: "relative" }}>
              <button onClick={() => open(a, isImage(a) ? rows.filter(isImage) : undefined)} className="row" style={{ border: 0, background: "none", padding: 0, minWidth: 0, flex: 1, textAlign: "left", color: "inherit" }} type="button">
                <span className="icon">{isImage(a) && q.data?.urls[a.path] ? <img src={q.data.urls[a.path]} alt="" /> : <FileIcon a={a} />}</span>
                <span style={{ minWidth: 0 }}>
                  <span className="ellipsis small bold" style={{ display: "block" }}>
                    {a.name}
                  </span>
                  <span className="faint tiny">
                    {isOnDrive(a) && (
                      <>
                        <span className="drive-tag">
                          <HardDrive size={11} /> Drive
                        </span>
                        {" · "}
                      </>
                    )}
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
                    {!a.task_id && a.recurring_id && (
                      <>
                        <span className="drive-tag repeat-tag" title="Comes with every copy of this repeating task">
                          <Repeat size={11} /> Every repeat
                        </span>
                        {" · "}
                      </>
                    )}
                    {a.version > 1 ? `Version ${a.version} · ` : ""}
                    {fileSize(a.size)} · {people.get(a.uploaded_by)?.short_name ?? "Someone"} · {timeAgo(a.created_at)}
                  </span>
                </span>
              </button>
              {(a.uploaded_by === me.id || canAssign) && (
                <button className="icon-btn small plain" onClick={() => remove(a)} aria-label={`Delete ${a.name}`} type="button">
                  <Trash2 />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </DropZone>
  );
}
