// Scan a document with the iPhone's scanner (Northcroft iPhone app only). The pages become one PDF,
// which opens the Share screen like a file shared in from another app: pick a chat or one of your
// tasks, add a message, send. Going through the outbox means it also finishes with no signal.
import { saveShare } from "@/lib/share";
import { errorMessage } from "@/lib/supabase";
import { NorthcroftNative } from "./plugin";

type Toast = (message: string, tone?: "error") => void;

export async function scanToShare(navigate: (to: string) => void, toast: Toast): Promise<void> {
  try {
    const r = await NorthcroftNative.scanDocument();
    if (!r.supported) {
      toast("This iPhone can't scan documents.", "error");
      return;
    }
    if (r.cancelled || !r.data) return;
    const blob = await (await fetch(`data:application/pdf;base64,${r.data}`)).blob();
    const name = r.name || "Scan.pdf";
    await saveShare({
      id: "current",
      at: new Date().toISOString(),
      title: "",
      text: "",
      url: "",
      files: [{ blob, name, type: "application/pdf" }],
    });
    navigate("/share");
  } catch (e) {
    const msg = errorMessage(e);
    // An iPhone app from before scanning was added.
    if (/not implemented|unimplemented/i.test(msg)) toast("Update the Northcroft app to scan documents.", "error");
    else toast(`Couldn't scan: ${msg}`, "error");
  }
}
