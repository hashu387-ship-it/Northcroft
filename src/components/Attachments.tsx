import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, FileText, HardDrive, Paperclip, Trash2, Upload } from "lucide-react";
import { unwrap, useInvalidate, usePeople, useSettings } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { deleteAttachment, isImage, isOnDrive, previewUrls, uploadFile } from "@/lib/files";
import { errorMessage, supabase } from "@/lib/supabase";
import { fileSize } from "@/lib/format";
import { timeAgo } from "@/lib/time";
import type { Attachment } from "@/lib/types";
import { Empty, Loading, useConfirm, useToast } from "./ui";
import { useOpenFile } from "./useOpenFile";

function FileIcon({ a }: { a: Attachment }) {
  if (/\.(xlsx?|csv)$/i.test(a.name)) return <FileSpreadsheet />;
  return <FileText />;
}

/** Files on a task (taskId) or every file in a project (projectId only). */
export function Attachments({ taskId, projectId, canUpload = true }: { taskId?: string | null; projectId?: string | null; canUpload?: boolean }) {
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
    queryKey: ["attachments", taskId ? "task" : "project", taskId ?? projectId],
    queryFn: async () => {
      let query = supabase.from("attachments").select("*");
      query = taskId ? query.eq("task_id", taskId) : query.eq("project_id", projectId!);
      const rows = await unwrap<Attachment[]>(query.order("created_at", { ascending: false }).limit(300));
      const urls = await previewUrls(rows);
      return { rows, urls };
    },
  });

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    try {
      for (const f of Array.from(list)) {
        setProgress(`Uploading ${f.name}...`);
        await uploadFile(f, {
          taskId: taskId ?? null,
          projectId: projectId ?? null,
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

  const open = useOpenFile();

  async function remove(a: Attachment) {
    if (!(await confirm({ title: `Delete ${a.name}?`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await deleteAttachment(a);
      invalidate("attachments");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const rows = q.data?.rows ?? [];
  return (
    <div className="stack">
      {canUpload && (
        <div className="row">
          <button className="btn small" onClick={() => inputRef.current?.click()} disabled={busy} type="button">
            <Upload /> {busy ? "Uploading..." : "Add files"}
          </button>
          <span className="faint tiny">
            {progress ?? (driveOn ? "Drawings, BOQs, PDFs, photos. Saved to the team's Google Drive." : "Drawings, BOQs, PDFs, photos. Up to 50 MB each.")}
          </span>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon={<Paperclip />} title="No files yet" />
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
    </div>
  );
}
