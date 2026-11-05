// Adding a whole folder (no zip): picked with the folder button or dragged in. Every file keeps
// its place in the folder ("Drawings/Level 1/A-101.pdf"), so it can be shown grouped under the
// folder's name, or put into real folders in a project's Files.

// The path of a dropped file inside its folder, for files read from a dropped folder (those have
// no webkitRelativePath of their own).
const dropped = new WeakMap<File, string>();

// Files a computer makes on its own inside folders; never worth uploading.
const JUNK = /^(\.ds_store|thumbs\.db|desktop\.ini|\._.*|~\$.*)$/i;

/** True where the browser can pick a whole folder (computers, Android). iPhones and iPads can't. */
export function canPickFolder(): boolean {
  if (typeof document === "undefined" || typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return false;
  return "webkitdirectory" in document.createElement("input");
}

/** "Drawings/Level 1/A-101.pdf" for a file from a folder, or "" for a single file. */
export function relPath(f: File): string {
  const p = dropped.get(f) || (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
  return p.includes("/") ? p.replace(/^\/+/, "") : "";
}

/** The folders a file sits in, top first: ["Drawings", "Level 1"]. Empty for a single file. */
export function folderParts(f: File): string[] {
  const p = relPath(f);
  if (!p) return [];
  return p.split("/").slice(0, -1).map((s) => s.trim()).filter(Boolean);
}

/** Leaves out the files computers make by themselves (.DS_Store, Thumbs.db and the like). */
export function withoutJunk(files: File[]): File[] {
  return files.filter((f) => !JUNK.test(f.name));
}

type Entry = FileSystemEntry & { isFile: boolean; isDirectory: boolean };

function readAll(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    // Browsers hand entries over in batches; keep asking until an empty batch comes back.
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

async function walk(entry: Entry, prefix: string, out: File[]) {
  if (entry.isFile) {
    const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    if (prefix) dropped.set(f, prefix + f.name);
    out.push(f);
  } else if (entry.isDirectory) {
    const kids = await readAll(entry as FileSystemDirectoryEntry);
    for (const k of kids) await walk(k as Entry, `${prefix}${entry.name}/`, out);
  }
}

/**
 * Pull the dropped things out of a drop event straight away (the browser only allows it during the
 * event), then read them: single files as they are, and every file inside any dropped folder.
 */
export function takeDrop(dt: DataTransfer): () => Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => (typeof i.webkitGetAsEntry === "function" ? (i.webkitGetAsEntry() as Entry | null) : null));
  const plain = Array.from(dt.files ?? []);
  const hasFolder = entries.some((e) => e?.isDirectory);
  return async () => {
    if (!hasFolder) return withoutJunk(plain.filter((f) => f.size > 0 || f.type));
    const out: File[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e) await walk(e, "", out);
      else if (plain[i]) out.push(plain[i]);
    }
    return withoutJunk(out);
  };
}
