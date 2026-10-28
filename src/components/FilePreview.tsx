// Helpers for showing PDF and drawing previews in file lists and chats (see src/lib/previews.ts).
import { useEffect, useReducer, useRef } from "react";
import { useInvalidate } from "@/lib/api";
import { onPreviewChange, onPreviewSaved, requestPreview } from "@/lib/previews";
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

/** The tag on a preview: PDF, DWG or DXF. */
export const docTag = (a: Pick<Attachment, "name">) => (/\.dwg$/i.test(a.name) ? "DWG" : /\.dxf$/i.test(a.name) ? "DXF" : "PDF");
