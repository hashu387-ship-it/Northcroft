// The outbox: messages, voice notes, files and check-ins made with no signal.
//
// Each one is kept on the phone (IndexedDB) and shown straight away with a clock. When the phone
// is back online they go out by themselves, oldest first. A message keeps the id it was given on
// the phone, so if the connection drops halfway it's never posted twice. Something the server
// refuses (rather than couldn't reach) is marked "Not sent", to try again or remove.
import { useEffect, useMemo, useState } from "react";
import { addDriveLinks, type LinkInfo } from "./drivelinks";
import { uploadFile } from "./files";
import { reverseGeocode } from "./geo";
import { errorMessage, isNetworkError, supabase } from "./supabase";
import { uploadVoice } from "./voice";

const DB_NAME = "northcroft-outbox";
const STORE = "items";

export interface OutboxRow {
  body: string;
  mentions: string[];
  author_id: string;
  reply_to: string | null;
  task_id: string | null;
  project_id: string | null;
  conversation_id: string | null;
}

interface Base {
  id: string;
  userId: string;
  createdAt: string;
  status: "waiting" | "sending" | "failed";
  error?: string;
}

export interface OutboxMessage extends Base {
  kind: "message";
  /** The thread: "team", "project:<id>", "conv:<id>" or "task:<id>". */
  chat: string;
  row: OutboxRow;
  /** Posted already; only its files or links are still to go. */
  inserted: boolean;
  voice?: { blob: Blob; mime: string; seconds: number; peaks: number[]; path?: string };
  links?: (LinkInfo & { url: string })[];
  linksDone?: boolean;
  /** Files still to upload. */
  files?: { blob: Blob; name: string; type: string }[];
}

export interface OutboxAttendance extends Base {
  kind: "attendance";
  entry: "in" | "out";
  /** When it happened, by the phone's clock. */
  at: string;
  workDate: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  address: string | null;
  note: string | null;
}

export type OutboxItem = OutboxMessage | OutboxAttendance;

/* ---------------------------------------------------------------- storage */

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

async function allItems(): Promise<OutboxItem[]> {
  try {
    return ((await tx<OutboxItem[]>("readonly", (s) => s.getAll())) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}
const putItem = (it: OutboxItem) => tx("readwrite", (s) => s.put(it));
const removeRaw = (id: string) => tx("readwrite", (s) => s.delete(id));

/* ---------------------------------------------------------------- change events */

type Delivered = { item: OutboxItem; result?: unknown };
const changeListeners = new Set<() => void>();
const deliveredListeners = new Set<(d: Delivered) => void>();
function changed() {
  changeListeners.forEach((f) => f());
  try {
    // Other tabs of the app on this phone.
    channel?.postMessage("changed");
  } catch {
    /* fine */
  }
}
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("nc-outbox") : null;
channel?.addEventListener("message", () => changeListeners.forEach((f) => f()));

export function onOutboxChange(f: () => void) {
  changeListeners.add(f);
  return () => void changeListeners.delete(f);
}
export function onDelivered(f: (d: Delivered) => void) {
  deliveredListeners.add(f);
  return () => void deliveredListeners.delete(f);
}

/* ---------------------------------------------------------------- adding */

export async function queueMessage(m: Omit<OutboxMessage, "kind" | "status" | "createdAt" | "inserted" | "id"> & { id?: string; inserted?: boolean }) {
  const item: OutboxMessage = {
    ...m,
    id: m.id ?? crypto.randomUUID(),
    kind: "message",
    status: "waiting",
    createdAt: new Date().toISOString(),
    inserted: m.inserted ?? false,
  };
  await putItem(item);
  changed();
  void runOutbox(item.userId);
  return item;
}

export async function queueAttendance(a: Omit<OutboxAttendance, "kind" | "status" | "createdAt" | "id">) {
  const item: OutboxAttendance = { ...a, id: crypto.randomUUID(), kind: "attendance", status: "waiting", createdAt: new Date().toISOString() };
  await putItem(item);
  changed();
  void runOutbox(item.userId);
  return item;
}

/** Turn files picked in the app into something the phone can keep. */
export const keepFiles = (files: File[]) => files.map((f) => ({ blob: f as Blob, name: f.name, type: f.type || "application/octet-stream" }));

export async function retryItem(id: string) {
  const it = (await allItems()).find((x) => x.id === id);
  if (!it) return;
  await putItem({ ...it, status: "waiting", error: undefined });
  changed();
  void runOutbox(it.userId);
}

export async function removeItem(id: string) {
  const it = (await allItems()).find((x) => x.id === id);
  await removeRaw(id);
  // A voice note already stored but never posted: tidy it away.
  if (it?.kind === "message" && it.voice?.path && !it.inserted) await supabase.storage.from("files").remove([it.voice.path]).catch(() => {});
  changed();
}

/** Signing out: what's still waiting for this person is removed from the phone. */
export async function clearOutbox(userId: string) {
  const mine = (await allItems()).filter((x) => x.userId === userId);
  for (const it of mine) await removeRaw(it.id);
  if (mine.length) changed();
}

export async function outboxCount(userId: string) {
  return (await allItems()).filter((x) => x.userId === userId).length;
}

/** For the sign-out question: what would be lost, or an empty string. */
export async function signOutWarning(userId: string): Promise<string> {
  const mine = (await allItems()).filter((x) => x.userId === userId);
  if (!mine.length) return "";
  const msgs = mine.filter((x) => x.kind === "message").length;
  const att = mine.length - msgs;
  const parts = [
    msgs ? (msgs === 1 ? "1 message" : `${msgs} messages`) : null,
    att ? (att === 1 ? "1 check-in or check-out" : `${att} check-ins or check-outs`) : null,
  ].filter(Boolean);
  return `${parts.join(" and ")} ${mine.length === 1 ? "is" : "are"} still waiting to send. Signing out now removes ${mine.length === 1 ? "it" : "them"} from this phone. `;
}

/* ---------------------------------------------------------------- sending */

let running = false;
let again = false;

/** Send what's waiting, oldest first. Stops at the first sign there's still no signal. */
export async function runOutbox(userId: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    const work = async () => {
      do {
        again = false;
        const items = (await allItems()).filter((i) => i.userId === userId && i.status !== "failed");
        for (const start of items) {
          let it: OutboxItem = { ...start, status: "sending" };
          await putItem(it);
          changed();
          const save = async (patch: Partial<OutboxItem>) => {
            it = { ...it, ...patch } as OutboxItem;
            await putItem(it);
          };
          try {
            const result = it.kind === "message" ? await deliverMessage(it, save) : await deliverAttendance(it);
            await removeRaw(it.id);
            changed();
            deliveredListeners.forEach((f) => f({ item: it, result }));
          } catch (e) {
            if (isNetworkError(e)) {
              await putItem({ ...it, status: "waiting" });
              changed();
              return;
            }
            await putItem({ ...it, status: "failed", error: errorMessage(e) });
            changed();
          }
        }
      } while (again);
    };
    const locks = (navigator as Navigator & { locks?: { request: (n: string, f: () => Promise<void>) => Promise<void> } }).locks;
    // Only one tab sends at a time.
    if (locks) await locks.request("nc-outbox", work);
    else await work();
  } finally {
    running = false;
  }
}

/** Anything left "sending" when the app was closed goes back to waiting. */
export async function resetStuck(userId: string) {
  for (const it of await allItems()) if (it.userId === userId && it.status === "sending") await putItem({ ...it, status: "waiting" });
}

async function deliverMessage(it: OutboxMessage, save: (p: Partial<OutboxMessage>) => Promise<void>) {
  const row = it.row;
  let voicePath = it.voice?.path ?? null;
  if (it.voice && !voicePath) {
    voicePath = await uploadVoice({ blob: it.voice.blob, mime: it.voice.mime, seconds: it.voice.seconds, peaks: it.voice.peaks }, it.userId, row.conversation_id);
    await save({ voice: { ...it.voice, path: voicePath } });
  }
  if (!it.inserted) {
    const insert = {
      id: it.id,
      ...row,
      ...(it.voice
        ? { voice_path: voicePath, voice_seconds: Math.round(it.voice.seconds * 10) / 10, voice_peaks: it.voice.peaks }
        : {}),
    };
    const { error } = await supabase.from("comments").insert(insert);
    // Already there: it got through last time, only the answer was lost.
    if (error && (error as { code?: string }).code !== "23505") throw error;
    await save({ inserted: true });
  }
  if (it.links?.length && !it.linksDone) {
    await addDriveLinks(it.links, { projectId: null, commentId: it.id });
    await save({ linksDone: true });
  }
  let files = it.files ?? [];
  while (files.length) {
    const f = files[0];
    await uploadFile(new File([f.blob], f.name, { type: f.type }), {
      taskId: row.task_id,
      projectId: row.project_id,
      conversationId: row.conversation_id,
      commentId: it.id,
      userId: it.userId,
    });
    files = files.slice(1);
    await save({ files });
  }
}

async function deliverAttendance(it: OutboxAttendance) {
  let address = it.address;
  if (!address && it.lat != null && it.lng != null) {
    address = await Promise.race([reverseGeocode(it.lat, it.lng).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
  }
  const { data, error } = await supabase.rpc("record_attendance_later", {
    p_kind: it.entry,
    p_at: it.at,
    p_work_date: it.workDate,
    p_lat: it.lat,
    p_lng: it.lng,
    p_accuracy: it.accuracy,
    p_address: address,
    p_note: it.note,
  });
  if (error) throw error;
  return data;
}

/* ---------------------------------------------------------------- reading, for screens */

/** What's waiting for this person, kept up to date. */
export function useOutbox(userId: string | undefined): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = () => allItems().then((all) => alive && setItems(all.filter((i) => i.userId === userId)));
    load();
    const off = onOutboxChange(load);
    return () => {
      alive = false;
      off();
    };
  }, [userId]);
  return items;
}

/** Messages waiting in one thread. */
export function usePendingMessages(userId: string, chat: string): OutboxMessage[] {
  const all = useOutbox(userId);
  return useMemo(() => all.filter((i): i is OutboxMessage => i.kind === "message" && i.chat === chat), [all, chat]);
}

/** Check-ins and check-outs waiting to go. */
export function usePendingAttendance(userId: string): OutboxAttendance[] {
  const all = useOutbox(userId);
  return useMemo(() => all.filter((i): i is OutboxAttendance => i.kind === "attendance"), [all]);
}
