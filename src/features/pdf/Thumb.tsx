// A small picture of a page, drawn only when it scrolls into view.
import { memo, useEffect, useRef, useState } from "react";
import { makeView } from "./geom";
import type { PDFPage } from "./pdfjs";

function ThumbImpl({ page, meta, rotate, width }: { page: PDFPage | null; meta: { view: number[]; rotate: number }; rotate: number; width: number }) {
  const v = makeView(meta.view, 1, meta.rotate + rotate);
  const height = Math.round((width * v.height) / v.width);
  const host = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!seen || !page) return;
    let cancelled = false;
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    (async () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: (width / v.width) * dpr, rotation: (meta.rotate + rotate) % 360 });
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.floor(vp.width));
      c.height = Math.max(1, Math.floor(vp.height));
      try {
        task = page.render({ canvas: c, viewport: vp, annotationMode: 1 }) as unknown as typeof task;
        await task!.promise;
      } catch {
        return;
      }
      if (!cancelled && host.current) host.current.replaceChildren(c);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [seen, page, width, v.width, meta.rotate, rotate]);

  return <div ref={host} className="pdf-thumb-img" style={{ width, height }} />;
}

export const Thumb = memo(ThumbImpl);
