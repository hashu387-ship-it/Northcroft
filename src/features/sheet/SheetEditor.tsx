// Spreadsheet (Excel and CSV) viewer and editor. Placeholder until the full tool lands.
import type { EditorProps } from "@/features/files/editor";

export default function SheetEditor({ attachment }: EditorProps) {
  return (
    <div className="file-placeholder">
      <p className="muted">{attachment.name}</p>
    </div>
  );
}
