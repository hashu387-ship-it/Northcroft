// The file screen: opens a PDF or spreadsheet inside the app, full screen, with the right tool.
// It loads the file (from Google Drive or the app's storage), lists its versions, downloads it,
// and saves edits as a new version next to the original. The tools live in src/features/.
import "@/styles/files.css";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileText, History, X } from "lucide-react";
import { unwrap, useInvalidate, usePeople } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { fetchAttachmentData, fileKind, fileVersions, openAttachment, saveNewVersion } from "@/lib/files";
import { errorMessage, supabase } from "@/lib/supabase";
import { fileSize } from "@/lib/format";
import { timeAgo } from "@/lib/time";
import type { Attachment } from "@/lib/types";
import { Spinner, useConfirm, useToast } from "@/components/ui";
import type { EditorProps } from "@/features/files/editor";

const PdfEditor = lazy(() => import("@/features/pdf/PdfEditor"));
const SheetEditor = lazy(() => import("@/features/sheet/SheetEditor"));

function Loader({ label, fraction }: { label: string; fraction?: number | null }) {
  return (
    <div className="file-loader" role="status">
      <Spinner size={28} />
      <div className="muted small">{label}</div>
      {fraction != null && (
        <div className="file-progress" aria-hidden>
          <span style={{ width: `${Math.round(fraction * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export default function FileView() {
  const { id = "" } = useParams();
  const me = useMe();
  const people = usePeople();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const invalidate = useInvalidate();
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const [saving, setSaving] = useState<{ label: string; fraction: number | null } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const row = useQuery({
    queryKey: ["attachments", "one", id],
    queryFn: () => unwrap<Attachment | null>(supabase.from("attachments").select("*").eq("id", id).maybeSingle()),
    staleTime: 60_000,
  });
  const a = row.data ?? null;

  const versions = useQuery({
    queryKey: ["attachments", "versions", a?.version_of ?? a?.id],
    enabled: !!a,
    queryFn: () => fileVersions(a!),
  });

  // The contents, fetched once per version (switching versions fetches that one).
  const contents = useQuery({
    queryKey: ["file-data", id],
    enabled: !!a,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: 1,
    queryFn: async () => {
      setProgress(0);
      try {
        return await fetchAttachmentData(a!, setProgress);
      } finally {
        setProgress(null);
      }
    },
  });

  // Full screen: the page behind doesn't scroll.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  // Closing the tab or reloading with unsaved edits asks first.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  useEffect(() => {
    setDirty(false);
  }, [id]);

  async function leaveOk() {
    if (!dirtyRef.current) return true;
    return confirm({
      title: "Leave without saving?",
      message: "Your changes to this file haven't been saved.",
      confirmLabel: "Leave",
      danger: true,
    });
  }

  async function close() {
    if (!(await leaveOk())) return;
    setDirty(false);
    if (window.history.length > 1) navigate(-1);
    else navigate("/", { replace: true });
  }

  async function switchTo(versionId: string) {
    if (versionId === id || !(await leaveOk())) return;
    setDirty(false);
    navigate(`/files/${versionId}`, { replace: true });
  }

  function download() {
    if (!a) return;
    if (!contents.data) {
      openAttachment(a).catch((e) => toast(errorMessage(e), "error"));
      return;
    }
    const url = URL.createObjectURL(new Blob([contents.data], { type: a.mime || "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = a.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  const list = versions.data ?? (a ? [a] : []);
  const latest = list[0];
  const nextVersion = Math.max(1, ...list.map((v) => v.version ?? 1)) + 1;

  async function saveVersion(file: Blob): Promise<Attachment> {
    if (!a) throw new Error("The file isn't loaded yet.");
    setSaving({ label: `Saving version ${nextVersion}...`, fraction: null });
    try {
      const saved = await saveNewVersion(a, file, {
        userId: me.id,
        nextVersion,
        onProgress: (x) => setSaving({ label: `Saving version ${nextVersion} to Google Drive, ${Math.round(x * 100)}%`, fraction: x }),
      });
      setDirty(false);
      dirtyRef.current = false;
      await invalidate("attachments", "comments");
      toast(`Saved as version ${saved.version}. The original is kept as it was.`);
      navigate(`/files/${saved.id}`, { replace: true });
      return saved;
    } catch (e) {
      throw new Error(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  const kind = a ? fileKind(a) : "other";
  const editorProps: EditorProps | null = useMemo(
    () =>
      a && contents.data
        ? { attachment: a, data: contents.data, versions: list, me, saveVersion, setDirty }
        : null,
    // saveVersion reads the latest state through closures; the editor gets fresh props on each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a, contents.data, list, me, nextVersion],
  );

  const who = a ? people.get(a.uploaded_by)?.short_name ?? "Someone" : "";
  const Icon = kind === "sheet" ? FileSpreadsheet : FileText;

  return (
    <div className="file-screen" role="dialog" aria-label={a?.name ?? "File"}>
      <header className="file-head">
        <button className="icon-btn plain" type="button" onClick={close} aria-label="Close">
          <X />
        </button>
        <span className={`file-head-icon ${kind}`}>
          <Icon />
        </span>
        <div className="file-head-title">
          <b className="ellipsis">{a?.name ?? (row.isLoading ? "Opening..." : "File")}</b>
          {a && (
            <span className="ellipsis">
              {a.version > 1 ? `Version ${a.version} · edited by ${who}` : `Original · ${who}`} · {timeAgo(a.created_at)}
              {a.size ? ` · ${fileSize(a.size)}` : ""}
            </span>
          )}
        </div>
        {list.length > 1 && (
          <label className="file-versions" title="Versions">
            <History />
            <select value={id} onChange={(e) => switchTo(e.target.value)} aria-label="Version">
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.version > 1 ? `Version ${v.version}` : "Original"}
                  {v.id === latest?.id ? " (latest)" : ""} · {people.get(v.uploaded_by)?.short_name ?? "Someone"}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="icon-btn plain" type="button" onClick={download} disabled={!a} aria-label="Download" title="Download">
          <Download />
        </button>
      </header>

      <div className="file-body">
        {row.isLoading ? (
          <Loader label="Opening..." />
        ) : !a ? (
          <div className="file-loader">
            <b>This file isn't available</b>
            <div className="muted small">It may have been taken down, or it's in a chat you're not part of.</div>
            <button className="btn" type="button" onClick={close}>
              Go back
            </button>
          </div>
        ) : contents.isError ? (
          <div className="file-loader">
            <b>The file didn't open</b>
            <div className="muted small">{errorMessage(contents.error)}</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" type="button" onClick={() => contents.refetch()}>
                Try again
              </button>
              <button className="btn ghost" type="button" onClick={download}>
                Download instead
              </button>
            </div>
          </div>
        ) : !editorProps ? (
          <Loader label={progress != null && progress > 0 ? `Loading ${Math.round(progress * 100)}%` : "Loading the file..."} fraction={progress} />
        ) : kind === "other" ? (
          <div className="file-loader">
            <b>This kind of file can't be shown in the app</b>
            <button className="btn" type="button" onClick={download}>
              <Download /> Download
            </button>
          </div>
        ) : (
          <Suspense fallback={<Loader label={kind === "pdf" ? "Opening the PDF tools..." : "Opening the spreadsheet..."} />}>
            {kind === "pdf" ? <PdfEditor key={a.id} {...editorProps} /> : <SheetEditor key={a.id} {...editorProps} />}
          </Suspense>
        )}
      </div>

      {saving && (
        <div className="file-saving">
          <Loader label={saving.label} fraction={saving.fraction} />
        </div>
      )}
    </div>
  );
}
