import { useNavigate } from "react-router-dom";
import { fileKind, openAttachment } from "@/lib/files";
import { errorMessage } from "@/lib/supabase";
import type { Attachment } from "@/lib/types";
import { useToast } from "./ui";

/**
 * Open a file the way it reads best: PDFs and spreadsheets in the app's own viewer and editor,
 * everything else (photos, Word files, videos) in a new tab as before.
 */
export function useOpenFile() {
  const navigate = useNavigate();
  const toast = useToast();
  return async (a: Attachment) => {
    if (fileKind(a) !== "other") {
      navigate(`/files/${a.id}`);
      return;
    }
    try {
      await openAttachment(a);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
}
