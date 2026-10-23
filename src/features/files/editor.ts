// What the in-app file tools (PDF and spreadsheet) are given by the file screen (src/pages/FileView.tsx).
// Each tool owns the area below the file screen's header: its own toolbar, the document, and its
// panels. The file screen does the loading, the version list, downloading and saving.
import type { Attachment, Profile } from "@/lib/types";

export interface SaveOptions {
  /** Save under a different file type, for example ".xlsx" when an old .xls file is saved. */
  extension?: string;
}

export interface EditorProps {
  /** The file being shown (one version of it). */
  attachment: Attachment;
  /** Its contents. Treat as read-only: copy before handing to a library that may detach or change it. */
  data: ArrayBuffer;
  /** Every version of this file, newest first (includes `attachment`). */
  versions: Attachment[];
  /** The signed-in person, for names on stamps, signatures and "edited by". */
  me: Profile;
  /**
   * Save the edited file as a new version next to the original (the original is never changed).
   * Shows progress and moves the screen to the new version when done. Rejects with a readable
   * message if it couldn't be saved; the tool should keep the person's edits in that case.
   */
  saveVersion: (file: Blob, opts?: SaveOptions) => Promise<Attachment>;
  /** Tell the file screen whether there are unsaved changes, so closing asks first. */
  setDirty: (dirty: boolean) => void;
}

/** Height reserved at the top of the screen by the file screen's header (px). */
export const FILE_HEAD_HEIGHT = 56;
