// Helpers for showing file previews (PDF, drawing, spreadsheet, Word, PowerPoint, video) in file
// lists and chats (see src/lib/previews.ts).
import { useEffect, useReducer, useRef } from "react";
import { DraftingCompass, FileSpreadsheet, FileText, Film, Play, Presentation } from "lucide-react";
import { useInvalidate } from "@/lib/api";
import { onPreviewChange, onPreviewSaved, requestPreview, type PreviewKind } from "@/lib/previews";
import type { Attachment } from "@/lib/types";

/**
 * Re-render when a preview starts or finishes being made on this device, and reload the file
 * lists when one is saved (other phones get it through the live updates).
 */
export function usePreviewUpdates() {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const invalidate = useInvalidate();
  useEffect(() => onPreviewChange(bump), []);
  useEffect(() => onPreviewSaved(() => void invalidate("attachments")), [invalidate]);
}

/**
 * Put inside a file's line: once the line is on screen (or nearly), the file's preview is asked
 * for. Files further down a long folder aren't downloaded until someone scrolls to them.
 */
export function AskPreviewWhenSeen({ a }: { a: Attachment }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      requestPreview(a);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          requestPreview(a);
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // The same file only needs asking once; a new record (preview changed) asks again if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, a.preview]);
  return <span ref={ref} aria-hidden style={{ width: 1, height: 1, flex: "none" }} />;
}

/** The tag on a preview: the file's type, like PDF, DWG, XLSX, DOCX, PPTX or MP4. */
export function docTag(a: Pick<Attachment, "name">, kind: PreviewKind | null) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(a.name)?.[1];
  if (ext) return ext.toUpperCase();
  return kind === "video" ? "VIDEO" : kind === "sheet" ? "SHEET" : "FILE";
}

/** The class for a preview's kind (k-pdf, k-sheet...), prefixed so it can't clash with other styles. */
export const kindClass = (kind: PreviewKind | null) => (kind ? `k-${kind}` : "");

/** The icon on the placeholder while a preview is being made. */
export function DocIcon({ kind }: { kind: PreviewKind | null }) {
  if (kind === "drawing") return <DraftingCompass />;
  if (kind === "sheet") return <FileSpreadsheet />;
  if (kind === "slides") return <Presentation />;
  if (kind === "video") return <Film />;
  return <FileText />;
}

/** The round play sign on a video's preview. */
export function PlayBadge() {
  return (
    <span className="doc-play" aria-hidden>
      <Play />
    </span>
  );
}
