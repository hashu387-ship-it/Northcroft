import { useNavigate } from "react-router-dom";
import { fileKind, openAttachment } from "@/lib/files";
import { errorMessage } from "@/lib/supabase";
import type { Attachment } from "@/lib/types";
import { useToast } from "./ui";

/** What the file screen is told when a photo is opened from a list: the photos to swipe through. */
export interface OpenFileState {
  siblings?: string[];
}

/**
 * Open a file the way it reads best: PDFs, spreadsheets and photos in the app's own viewer and
 * editor, everything else (Word files, videos) in a new tab as before. `siblings` are the other
 * photos in the same list or chat, in order, so you can swipe from one to the next.
 */
export function useOpenFile() {
  const navigate = useNavigate();
  const toast = useToast();
  return async (a: Attachment, siblings?: Attachment[]) => {
    if (fileKind(a) !== "other") {
      const ids = siblings?.map((s) => s.id).filter((id, i, all) => all.indexOf(id) === i);
      const state: OpenFileState | undefined = ids && ids.length > 1 && ids.includes(a.id) ? { siblings: ids } : undefined;
      navigate(`/files/${a.id}`, state ? { state } : undefined);
      return;
    }
    try {
      await openAttachment(a);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
}
