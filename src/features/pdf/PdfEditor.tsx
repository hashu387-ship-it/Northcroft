// PDF viewer and editor. Placeholder until the full tool lands.
import type { EditorProps } from "@/features/files/editor";

export default function PdfEditor({ attachment }: EditorProps) {
  return (
    <div className="file-placeholder">
      <p className="muted">{attachment.name}</p>
    </div>
  );
}
