// Draw a signature or initials with a finger, pen or mouse.
import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Sheet } from "@/components/ui";

const INK = "#0b1d46";

/** Trim the drawing to its edges and return a PNG data URL (null if nothing was drawn). */
function trimmed(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  let x1 = width, y1 = height, x2 = -1, y2 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] > 10) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return null;
  const pad = 6;
  x1 = Math.max(0, x1 - pad);
  y1 = Math.max(0, y1 - pad);
  x2 = Math.min(width - 1, x2 + pad);
  y2 = Math.min(height - 1, y2 + pad);
  // At most 900 px across, and small enough to keep in the account (under 300,000 characters).
  let k = Math.min(1, 900 / (x2 - x1 + 1));
  for (;;) {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round((x2 - x1 + 1) * k));
    out.height = Math.max(1, Math.round((y2 - y1 + 1) * k));
    out.getContext("2d")!.drawImage(canvas, x1, y1, x2 - x1 + 1, y2 - y1 + 1, 0, 0, out.width, out.height);
    const url = out.toDataURL("image/png");
    if (url.length < 300_000 || k < 0.15) return url;
    k *= 0.7;
  }
}

export function SignaturePad({
  open,
  kind,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: "signature" | "initials";
  onClose: () => void;
  onDone: (png: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    if (!open) return;
    setEmpty(true);
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = kind === "signature" ? 2.6 : 3.2;
  }, [open, kind]);

  const at = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = at(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(drawing.current.x, drawing.current.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    setEmpty(false);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    const r = canvasRef.current!.getBoundingClientRect();
    for (const ev of events) {
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      const q = drawing.current;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.quadraticCurveTo(q.x, q.y, (q.x + p.x) / 2, (q.y + p.y) / 2);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      drawing.current = p;
    }
  }

  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  }

  function done() {
    const png = canvasRef.current ? trimmed(canvasRef.current) : null;
    if (png) onDone(png);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={kind === "signature" ? "Draw your signature" : "Draw your initials"}
      footer={
        <>
          <button className="btn" type="button" onClick={clear} disabled={empty}>
            <Eraser /> Clear
          </button>
          <button className="btn primary" type="button" onClick={done} disabled={empty}>
            Save and use
          </button>
        </>
      }
    >
      <div className="stack" style={{ gap: 10 }}>
        <div className="pdf-sigpad">
          <canvas
            ref={canvasRef}
            style={{ height: kind === "signature" ? 190 : 150 }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={() => (drawing.current = null)}
            onPointerCancel={() => (drawing.current = null)}
            aria-label={kind === "signature" ? "Signature drawing area" : "Initials drawing area"}
          />
          <span className="pdf-sigpad-line" aria-hidden />
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          It's saved to your account, so next time you just tap to place it. Only you can use it.
        </p>
      </div>
    </Sheet>
  );
}
