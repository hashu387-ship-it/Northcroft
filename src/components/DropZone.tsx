// Drag files from the computer onto anything that takes attachments. While files are dragged over
// it, the area lights up with "Drop to attach"; dropping hands the files over like the file picker.
import { useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Upload } from "lucide-react";

/** True when what's being dragged includes files (not text or a link from the page). */
export function dragHasFiles(e: { dataTransfer: DataTransfer | null }) {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes("Files");
}

export function DropZone({
  onFiles,
  disabled,
  label = "Drop to attach",
  className,
  children,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  // dragenter and dragleave fire for every child; count them so the highlight doesn't flicker.
  const depth = useRef(0);

  if (disabled) return <div className={className}>{children}</div>;
  return (
    <div
      className={clsx("drop-zone", over && "dragging", className)}
      onDragEnter={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        const files = Array.from(e.dataTransfer.files ?? []).filter((f) => f.size > 0 || f.type);
        if (files.length) onFiles(files);
      }}
    >
      {children}
      {over && (
        <div className="drop-hint" aria-hidden>
          <Upload />
          <span>{label}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Stops a file dropped anywhere else from opening in the browser (and losing what's on screen).
 * Call once, in the app shell.
 */
export function blockStrayDrops() {
  const stop = (e: DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    if (e.type === "dragover" && e.dataTransfer) e.dataTransfer.dropEffect = "none";
  };
  window.addEventListener("dragover", stop);
  window.addEventListener("drop", stop);
  return () => {
    window.removeEventListener("dragover", stop);
    window.removeEventListener("drop", stop);
  };
}
