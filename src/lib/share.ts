// Share into the app: files, a link or text shared from another app (Android and computers).
// The service worker keeps what was shared on the phone (see receiveShare in public/sw.js) and opens
// the Share screen. It stays until it's sent or cancelled.
const SHARE_DB = "northcroft-share";
const STORE = "shared";

export interface SharedFile {
  blob: Blob;
  name: string;
  type: string;
}

export interface Shared {
  id: "current";
  at: string;
  title: string;
  text: string;
  url: string;
  files: SharedFile[];
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(SHARE_DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** What's waiting to be shared, if anything (older than two days is let go). */
export async function pendingShare(): Promise<Shared | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await open();
    const item = await new Promise<Shared | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, "readonly");
      const r = t.objectStore(STORE).get("current");
      r.onsuccess = () => resolve(r.result as Shared | undefined);
      r.onerror = () => reject(r.error);
    });
    if (!item) return null;
    if (Date.now() - new Date(item.at).getTime() > 2 * 86400_000) {
      await clearShare();
      return null;
    }
    if (!item.files.length && !item.text.trim() && !item.url.trim() && !item.title.trim()) return null;
    return item;
  } catch {
    return null;
  }
}

export async function clearShare() {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(STORE, "readwrite");
      t.objectStore(STORE).delete("current");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } catch {
    /* nothing to clear */
  }
}

/** The link to make a card of: a Google Drive link if there is one, then the link that was shared,
 *  then a OneDrive, SharePoint, Dropbox or WeTransfer link in the text. */
export function driveLinkIn(s: Pick<Shared, "text" | "url" | "title">): string | null {
  const all = [s.url, s.text, s.title].join(" ");
  const tidy = (x: string) => x.replace(/[).,;]+$/, "");
  const google = /https?:\/\/(?:drive|docs)\.google\.com\/[^\s<>"']+/i.exec(all);
  if (google) return tidy(google[0]);
  if (/^https?:\/\/\S+$/i.test(s.url.trim())) return tidy(s.url.trim());
  const files = /https?:\/\/(?:1drv\.ms|onedrive\.live\.com|[\w-]+\.sharepoint\.com|(?:www\.)?dropbox\.com|db\.tt|(?:www\.)?wetransfer\.com|we\.tl)\/[^\s<>"']+/i.exec(all);
  return files ? tidy(files[0]) : null;
}

/** The words to go with the message: the shared text and link, without repeating a Drive link. */
export function sharedWords(s: Pick<Shared, "text" | "url" | "title">, drive: string | null): string {
  const parts: string[] = [];
  const text = s.text.trim();
  const url = s.url.trim();
  const title = s.title.trim();
  if (title && !text.includes(title) && !url) parts.push(title);
  if (text) parts.push(text);
  if (url && !text.includes(url)) parts.push(url);
  let out = parts.join("\n").trim();
  if (drive) out = out.replace(drive, "").replace(/\n{2,}/g, "\n").trim();
  return out;
}
