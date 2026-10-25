// Google Drive for every file the team attaches (tasks, projects, chats), whoever uploads it.
//
// Files go to the one connected Drive, in a "Northcroft" folder with a subfolder per project (plus
// "General"). They stay private: team members open them through this function, which checks a
// short-lived signed link and streams the file from Drive. Nothing is shared publicly.
//
// The app only gets the drive.file permission, so it can see the files and folders it created and
// nothing else in the Drive.
//
// POST (signed-in team member, JSON {action}):
//   configure       manager: save the Google OAuth client and get the Google sign-in link
//   disconnect      manager: stop using Drive (files stay in Drive)
//   start_upload    start a resumable upload; the browser then sends the file straight to Google
//   finish_upload   check the upload in Drive and add it to the task, project or chat
//   link            a 1-hour link that opens a Drive file through this function (only files the
//                   person can see: private chat files are for the people in that chat)
//   links           the same for up to 100 files at once (photo previews)
//   delete          remove the attachment and move the file to the Drive bin
//   save_api_key    manager: save (or clear) the Google key used to read shared Drive links
//   link_info       check a pasted Drive link (shared as "Anyone with the link") and name it
//   link_list       the files in a linked Drive folder (or the one linked file)
//   link_file       one file from a linked folder, for the app's file screen
//   link_open       a 1-hour link that opens or downloads a file from a linked folder
//   web_info        the name of any other web page (OneDrive, Dropbox, a website) for its link card
// GET /drive/callback   Google sends the manager back here after they allow access
// GET ?f=<id>&e=<expiry>&s=<signature>[&d=1]   stream the file (d=1 downloads instead of opening)
// GET ?g=<drive file>&k=<resource key>&e=&s=[&d=1]   stream a file from a linked (shared) folder
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SELF_URL = `${SUPABASE_URL}/functions/v1/drive`;
const REDIRECT_URI = `${SELF_URL}/callback`;
// Google addresses (overridable only for local testing against a stand-in).
const GOOGLE_API = Deno.env.get("GOOGLE_API_ORIGIN") ?? "https://www.googleapis.com";
const GOOGLE_OAUTH = Deno.env.get("GOOGLE_OAUTH_ORIGIN") ?? "https://oauth2.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE = `${GOOGLE_API}/drive/v3`;
const FOLDER = "application/vnd.google-apps.folder";
const LINK_HOURS = 1;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-length, content-range, content-disposition",
};

class UserError extends Error {
  constructor(message: string, public status = 400, public code = "error") {
    super(message);
  }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Me = { id: string; short_name: string; role: string; can_assign: boolean; active: boolean };
type Config = { drive_client_id?: string; drive_client_secret?: string; drive_refresh_token?: string; drive_link_secret?: string; drive_api_key?: string };

/* ---------------------------------------------------------------- config and tokens */
async function config(): Promise<Config> {
  const { data, error } = await admin.rpc("get_drive_config");
  if (error) throw new Error(`Could not read Drive settings: ${error.message}`);
  return (data ?? {}) as Config;
}
async function setSecret(name: string, value: string) {
  const { error } = await admin.rpc("set_drive_secret", { p_name: name, p_value: value });
  if (error) throw new Error(`Could not save ${name}: ${error.message}`);
}
async function settings() {
  const { data } = await admin.from("app_settings").select("drive_account, drive_root_id, drive_general_id, drive_connected_at").eq("id", 1).single();
  return data as { drive_account: string | null; drive_root_id: string | null; drive_general_id: string | null; drive_connected_at: string | null };
}

let token: { value: string; until: number } | null = null;
/** A Drive access token, refreshed from the stored refresh token when needed. */
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.until) return token.value;
  const c = await config();
  if (!c.drive_refresh_token || !c.drive_client_id || !c.drive_client_secret) {
    throw new UserError("Google Drive isn't connected yet. A manager can connect it in Settings > Google Drive.", 503, "drive_off");
  }
  const res = await fetch(`${GOOGLE_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.drive_client_id,
      client_secret: c.drive_client_secret,
      refresh_token: c.drive_refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.access_token) {
    console.error("Token refresh failed", res.status, out.error);
    if (out.error === "invalid_grant") {
      throw new UserError("Google Drive access has expired or was removed. A manager needs to reconnect it in Settings > Google Drive.", 503, "drive_expired");
    }
    throw new UserError("Couldn't reach Google Drive. Try again in a moment.", 502);
  }
  token = { value: out.access_token, until: Date.now() + (Number(out.expires_in ?? 3600) - 120) * 1000 };
  return token.value;
}

async function drive(path: string, init: RequestInit = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${DRIVE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) },
  });
  return res;
}

async function createFolder(name: string, parent?: string | null): Promise<string> {
  const res = await drive("/files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(`Could not create folder ${name}: ${res.status} ${JSON.stringify(out).slice(0, 200)}`);
  return out.id as string;
}

/** True if the folder still exists and isn't in the bin. */
async function folderOk(id: string | null | undefined) {
  if (!id) return false;
  const res = await drive(`/files/${id}?fields=id,trashed`);
  if (!res.ok) return false;
  const f = await res.json();
  return !f.trashed;
}

/** The Northcroft folder, made if missing. */
async function rootFolder(): Promise<string> {
  const s = await settings();
  if (await folderOk(s.drive_root_id)) return s.drive_root_id!;
  const id = await createFolder("Northcroft");
  await admin.from("app_settings").update({ drive_root_id: id, drive_general_id: null }).eq("id", 1);
  await admin.from("projects").update({ drive_folder_id: null }).not("drive_folder_id", "is", null);
  return id;
}

/** The project's subfolder (or General), made if missing. */
async function folderFor(projectId: string | null): Promise<string> {
  const root = await rootFolder();
  if (!projectId) {
    const s = await settings();
    if (await folderOk(s.drive_general_id)) return s.drive_general_id!;
    const id = await createFolder("General", root);
    await admin.from("app_settings").update({ drive_general_id: id }).eq("id", 1);
    return id;
  }
  const { data: p } = await admin.from("projects").select("id, name, code, drive_folder_id").eq("id", projectId).maybeSingle();
  if (!p) throw new UserError("That project no longer exists.", 404);
  if (await folderOk(p.drive_folder_id)) return p.drive_folder_id!;
  const id = await createFolder(p.code ? `${p.name} (${p.code})` : p.name, root);
  await admin.from("projects").update({ drive_folder_id: id }).eq("id", p.id);
  return id;
}

/* ---------------------------------------------------------------- signing */
async function hmac(text: string): Promise<string> {
  const c = await config();
  if (!c.drive_link_secret) throw new Error("Drive link key missing");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(c.drive_link_secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------------------------------------------------------------- connect */
async function configure(body: { client_id?: string; client_secret?: string }, me: Me, origin: string) {
  if (me.role !== "manager") throw new UserError("Only a manager can connect Google Drive.", 403);
  const clientId = (body.client_id ?? "").trim();
  const clientSecret = (body.client_secret ?? "").trim();
  const c = await config();
  if (clientId) {
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new UserError("That Client ID doesn't look right. It ends in .apps.googleusercontent.com.");
    await setSecret("drive_client_id", clientId);
  } else if (!c.drive_client_id) {
    throw new UserError("Paste the Client ID from Google Cloud first.");
  }
  if (clientSecret) await setSecret("drive_client_secret", clientSecret);
  else if (!c.drive_client_secret) throw new UserError("Paste the Client secret from Google Cloud first.");

  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) && !/^http:\/\/localhost(:\d+)?$/.test(origin)) throw new UserError("Open the app from its normal web address and try again.");
  const payload = btoa(JSON.stringify({ u: me.id, o: origin, e: Date.now() + 15 * 60_000 }));
  const state = `${payload}.${await hmac(`state:${payload}`)}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId || c.drive_client_id!,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return { url: url.toString(), redirect_uri: REDIRECT_URI };
}

async function callback(url: URL): Promise<Response> {
  const back = (origin: string, q: string) => Response.redirect(`${origin}/settings/drive?${q}`, 302);
  const state = url.searchParams.get("state") ?? "";
  const [payload, sig] = state.split(".");
  if (!payload || !sig || !same(sig, await hmac(`state:${payload}`))) return new Response("This sign-in link isn't valid. Start again from Settings > Google Drive.", { status: 400 });
  const st = JSON.parse(atob(payload)) as { u: string; o: string; e: number };
  if (Date.now() > st.e) return back(st.o, "drive=error&reason=expired");
  if (url.searchParams.get("error")) return back(st.o, `drive=error&reason=${encodeURIComponent(url.searchParams.get("error")!)}`);
  const { data: who } = await admin.from("profiles").select("role, active").eq("id", st.u).maybeSingle();
  if (!who?.active || who.role !== "manager") return back(st.o, "drive=error&reason=not_manager");

  const c = await config();
  const res = await fetch(`${GOOGLE_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code") ?? "",
      client_id: c.drive_client_id ?? "",
      client_secret: c.drive_client_secret ?? "",
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.refresh_token) {
    console.error("Code exchange failed", res.status, out.error, out.error_description);
    return back(st.o, `drive=error&reason=${encodeURIComponent(out.error ?? "no_refresh_token")}`);
  }
  if (!String(out.scope ?? "").includes("drive.file")) return back(st.o, "drive=error&reason=scope");
  await setSecret("drive_refresh_token", out.refresh_token);
  token = { value: out.access_token, until: Date.now() + (Number(out.expires_in ?? 3600) - 120) * 1000 };

  // Whose Drive is it? A different account than before means new folders.
  const about = await (await drive("/about?fields=user(emailAddress,displayName)")).json().catch(() => ({}));
  const account = about?.user?.emailAddress ?? null;
  const s = await settings();
  if (s.drive_account && account && s.drive_account !== account) {
    await admin.from("app_settings").update({ drive_root_id: null, drive_general_id: null }).eq("id", 1);
    await admin.from("projects").update({ drive_folder_id: null }).not("drive_folder_id", "is", null);
  }
  await admin.from("app_settings").update({ drive_account: account, drive_connected_at: new Date().toISOString() }).eq("id", 1);

  // Make the folders now: Northcroft, General, and one per active project.
  try {
    await folderFor(null);
    const { data: projects } = await admin.from("projects").select("id").neq("status", "completed");
    for (const p of projects ?? []) await folderFor(p.id);
  } catch (e) {
    console.error("Folder set-up", e);
  }
  return back(st.o, "drive=connected");
}

async function disconnect(me: Me) {
  if (me.role !== "manager") throw new UserError("Only a manager can disconnect Google Drive.", 403);
  const c = await config();
  if (c.drive_refresh_token) {
    await fetch(`${GOOGLE_OAUTH}/revoke?token=${encodeURIComponent(c.drive_refresh_token)}`, { method: "POST" }).catch(() => null);
  }
  await setSecret("drive_refresh_token", "");
  token = null;
  await admin.from("app_settings").update({ drive_connected_at: null }).eq("id", 1);
  return { ok: true };
}

/** The database as the signed-in person, so the normal rules decide what they can see. */
function asUser(req: Request) {
  return createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ---------------------------------------------------------------- uploads */
type Target = {
  project_id?: string | null;
  task_id?: string | null;
  comment_id?: string | null;
  /** A private one-to-one or group chat. */
  conversation_id?: string | null;
  /** This upload is an edited copy (new version) of that attachment. */
  version_of?: string | null;
  /** A file set up with a repeating task: it comes with every copy of the task. */
  recurring_id?: string | null;
  /** A file on a variation: a submission round's ("sent" or "assessment"), or supporting (no round). */
  variation_id?: string | null;
  vo_round?: string | null;
  vo_side?: string | null;
  /** A file on an announcement (added by whoever posted it, or a manager or senior). */
  announcement_id?: string | null;
  /** A file on a leave request (the person who asked, or a manager or senior). Never in a project folder. */
  leave_id?: string | null;
};

async function checkTarget(t: Target, me: Me, req: Request): Promise<string | null> {
  let projectId = t.project_id ?? null;
  if (t.task_id) {
    const { data: task } = await admin.from("tasks").select("id, project_id").eq("id", t.task_id).maybeSingle();
    if (!task) throw new UserError("That task no longer exists.", 404);
    projectId = task.project_id;
  } else if (t.recurring_id) {
    const { data: rt } = await admin.from("recurring_tasks").select("id, project_id").eq("id", t.recurring_id).maybeSingle();
    if (!rt) throw new UserError("That repeating task no longer exists.", 404);
    projectId = rt.project_id;
  } else if (t.variation_id) {
    const { data: vo } = await admin.from("variations").select("id, project_id").eq("id", t.variation_id).maybeSingle();
    if (!vo) throw new UserError("That variation no longer exists.", 404);
    projectId = vo.project_id;
    if (t.vo_side && !["sent", "assessment"].includes(t.vo_side)) throw new UserError("Pick where the file goes on the variation.");
    if (t.vo_side && !t.vo_round) throw new UserError("Pick the submission the file belongs to.");
    if (t.vo_round && String(t.vo_round).length > 64) throw new UserError("Pick the submission the file belongs to.");
  } else if (t.announcement_id) {
    const { data: an } = await admin.from("announcements").select("id, project_id, author_id").eq("id", t.announcement_id).maybeSingle();
    if (!an) throw new UserError("That announcement no longer exists.", 404);
    if (an.author_id !== me.id && me.role !== "manager" && !me.can_assign) throw new UserError("Only whoever posted the announcement can add files to it.", 403);
    projectId = an.project_id;
  } else if (t.leave_id) {
    const { data: lr } = await admin.from("leave_requests").select("id, user_id").eq("id", t.leave_id).maybeSingle();
    if (!lr) throw new UserError("That leave request no longer exists.", 404);
    if (lr.user_id !== me.id && me.role !== "manager" && !me.can_assign) throw new UserError("Only the person who asked for the leave can add files to it.", 403);
    // Leave files go in the General folder, never a project's.
    projectId = null;
  }
  let conversation = t.conversation_id ?? null;
  if (t.comment_id) {
    const { data: c } = await admin.from("comments").select("author_id, conversation_id").eq("id", t.comment_id).maybeSingle();
    if (!c || c.author_id !== me.id) throw new UserError("That message isn't yours.", 403);
    conversation = c.conversation_id ?? conversation;
  }
  if (conversation) {
    const { data: m } = await admin
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", conversation)
      .eq("user_id", me.id)
      .is("left_at", null)
      .maybeSingle();
    if (!m) throw new UserError("You're not in that chat.", 403);
    // Private chat files go in the General folder, never a project folder.
    projectId = null;
  }
  if (t.version_of) {
    // Only a file this person can see can get a new version.
    const { data: o } = await asUser(req).from("attachments").select("id").eq("id", t.version_of).maybeSingle();
    if (!o) throw new UserError("The original file is no longer there.", 404);
  }
  return projectId;
}

async function startUpload(body: Target & { name?: string; mime?: string; size?: number }, me: Me, origin: string, req: Request) {
  const name = String(body.name ?? "").trim().slice(0, 240) || "file";
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) throw new UserError("That file is empty.");
  if (size > 5 * 1024 ** 4) throw new UserError("That file is too big for Google Drive.");
  const projectId = await checkTarget(body, me, req);
  const folder = await folderFor(projectId);
  const mime = body.mime || "application/octet-stream";
  // The Origin header lets the browser send the file straight to Google (CORS).
  const res = await drive(`${GOOGLE_API}/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType,parents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mime,
      "X-Upload-Content-Length": String(size),
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({
      name,
      parents: [folder],
      description: `Uploaded by ${me.short_name} through Northcroft`,
      appProperties: { northcroft: "1", uploadedBy: me.id },
    }),
  });
  const location = res.headers.get("location");
  if (!res.ok || !location) {
    console.error("Start upload failed", res.status, (await res.text()).slice(0, 300));
    throw new UserError("Couldn't start the upload to Google Drive. Try again.", 502);
  }
  return { upload_url: location, folder_id: folder };
}

async function finishUpload(body: Target & { file_id?: string }, me: Me, req: Request) {
  const id = String(body.file_id ?? "");
  if (!/^[\w-]{10,}$/.test(id)) throw new UserError("Upload not found.");
  const projectId = await checkTarget(body, me, req);
  const res = await drive(`/files/${id}?fields=id,name,size,mimeType,parents,trashed,appProperties`);
  if (!res.ok) throw new UserError("Couldn't find the uploaded file in Google Drive.", 404);
  const f = await res.json();
  if (f.trashed || f.appProperties?.northcroft !== "1" || f.appProperties?.uploadedBy !== me.id) {
    throw new UserError("That upload can't be attached.", 403);
  }
  const { data, error } = await admin
    .from("attachments")
    .insert({
      path: `drive/${f.id}`,
      drive_file_id: f.id,
      name: f.name,
      mime: f.mimeType ?? null,
      size: f.size ? Number(f.size) : null,
      task_id: body.task_id ?? null,
      project_id: projectId,
      comment_id: body.comment_id ?? null,
      conversation_id: body.conversation_id ?? null,
      version_of: body.version_of ?? null,
      recurring_id: body.task_id ? null : body.recurring_id ?? null,
      variation_id: body.task_id ? null : body.variation_id ?? null,
      vo_round: body.task_id || !body.variation_id ? null : body.vo_round ?? null,
      vo_side: body.task_id || !body.variation_id || !body.vo_round ? null : body.vo_side ?? null,
      announcement_id: body.task_id || body.variation_id ? null : body.announcement_id ?? null,
      leave_id: body.task_id || body.variation_id || body.announcement_id ? null : body.leave_id ?? null,
      uploaded_by: me.id,
    })
    .select()
    .single();
  if (error) {
    if (/duplicate key/.test(error.message)) {
      // The original record (forwarded copies of the same Drive file have their own paths).
      const { data: existing } = await admin.from("attachments").select("*").eq("path", `drive/${f.id}`).single();
      return existing;
    }
    throw new Error(error.message);
  }
  return data;
}

/* ---------------------------------------------------------------- opening */
const INLINE = /^(application\/pdf|image\/(png|jpe?g|gif|webp)|video\/(mp4|webm|quicktime)|audio\/|text\/plain)/i;

async function link(body: { attachment_id?: string; download?: boolean }, req: Request) {
  const { data: a } = await asUser(req).from("attachments").select("id, drive_file_id").eq("id", body.attachment_id ?? "").maybeSingle();
  if (!a?.drive_file_id) throw new UserError("File not found.", 404);
  const e = Math.floor(Date.now() / 1000) + LINK_HOURS * 3600;
  const d = body.download ? "1" : "0";
  const s = await hmac(`open:${a.id}:${e}:${d}`);
  return { url: `${SELF_URL}?f=${a.id}&e=${e}&d=${d}&s=${s}` };
}

/** Links for several files at once (photo previews in chats and file lists). */
async function links(body: { attachment_ids?: string[] }, req: Request) {
  const ids = (body.attachment_ids ?? []).filter((x) => typeof x === "string").slice(0, 100);
  if (!ids.length) return { urls: {} };
  const { data } = await asUser(req).from("attachments").select("id, path, drive_file_id").in("id", ids);
  const e = Math.floor(Date.now() / 1000) + LINK_HOURS * 3600;
  const urls: Record<string, string> = {};
  for (const a of data ?? []) {
    if (!a.drive_file_id) continue;
    urls[a.path] = `${SELF_URL}?f=${a.id}&e=${e}&d=0&s=${await hmac(`open:${a.id}:${e}:0`)}`;
  }
  return { urls };
}

async function stream(req: Request, url: URL): Promise<Response> {
  const id = url.searchParams.get("f") ?? "";
  const e = Number(url.searchParams.get("e"));
  const d = url.searchParams.get("d") === "1" ? "1" : "0";
  const s = url.searchParams.get("s") ?? "";
  if (!id || !e || !s || !same(s, await hmac(`open:${id}:${e}:${d}`))) return new Response("This link isn't valid.", { status: 403, headers: CORS });
  if (Date.now() / 1000 > e) return new Response("This link has expired. Open the file again from the app.", { status: 410, headers: CORS });
  const { data: a } = await admin.from("attachments").select("drive_file_id, name, mime").eq("id", id).maybeSingle();
  if (!a?.drive_file_id) return new Response("This file has been removed.", { status: 404, headers: CORS });

  const range = req.headers.get("range");
  const g = await drive(`/files/${a.drive_file_id}?alt=media`, range ? { headers: { Range: range } } : {});
  if (!g.ok && g.status !== 206) {
    console.error("Drive download failed", g.status);
    return new Response(g.status === 404 ? "This file is no longer in Google Drive." : "Couldn't open the file from Google Drive.", { status: g.status === 404 ? 404 : 502, headers: CORS });
  }
  const mime = a.mime || g.headers.get("content-type") || "application/octet-stream";
  const inline = d === "0" && INLINE.test(mime);
  const headers = new Headers(CORS);
  for (const h of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = g.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("accept-ranges")) headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Type", inline ? mime : "application/octet-stream");
  headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
  headers.set("Cache-Control", "private, max-age=3600");
  // Only PDFs, plain images, audio, video and plain text open in the browser; anything else
  // (web pages, SVG, Office files) downloads, so nothing from Drive can run as a web page.
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(g.body, { status: g.status, headers });
}

/* ---------------------------------------------------------------- delete */
async function remove(body: { attachment_id?: string }, req: Request) {
  // Delete as the signed-in person so the normal rule applies (their own files, or managers and seniors).
  const { data, error } = await asUser(req).from("attachments").delete().eq("id", body.attachment_id ?? "").select("drive_file_id");
  if (error) throw new UserError(error.message, 400);
  if (!data?.length) throw new UserError("You can't delete that file.", 403);
  const fileId = data[0].drive_file_id as string | null;
  // A file forwarded to other chats is the same file in Drive: keep it while any message still has it.
  const { count: stillUsed } = fileId
    ? await admin.from("attachments").select("id", { count: "exact", head: true }).eq("drive_file_id", fileId)
    : { count: 0 };
  if (fileId && !stillUsed) {
    // Into the Drive bin, so it can still be recovered for 30 days.
    const res = await drive(`/files/${fileId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).catch(() => null);
    if (res && !res.ok && res.status !== 404) console.error("Trash failed", res.status);
  }
  return { ok: true };
}


/* ---------------------------------------------------------------- shared Drive links */
// Folders and files anyone pastes on a task or project. They're read with a Google key (not the
// connected Drive), so they must be shared as "Anyone with the link". Google Docs, Sheets and
// Slides come out as PDF or Excel.
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: "pdf" },
};
const FILE_FIELDS = "id,name,mimeType,size,modifiedTime,resourceKey,shortcutDetails";
const ID_RE = /^[\w-]{10,}$/;

async function apiKey(): Promise<string> {
  const c = await config();
  if (!c.drive_api_key) {
    throw new UserError("Shared Drive links need a one-time Google key. A manager can add it in Settings > Google Drive.", 503, "no_key");
  }
  return c.drive_api_key;
}

/** Resource keys open older shared links: "id/key,id/key". */
function rkHeader(pairs: [string, string | null | undefined][]): Record<string, string> {
  const v = pairs.filter(([, k]) => !!k).map(([id, k]) => `${id}/${k}`).join(",");
  return v ? { "X-Goog-Drive-Resource-Keys": v } : {};
}

async function publicDrive(path: string, headers: Record<string, string> = {}, key?: string) {
  const url = new URL(`${DRIVE}${path}`);
  url.searchParams.set("key", key ?? (await apiKey()));
  url.searchParams.set("supportsAllDrives", "true");
  return fetch(url, { headers });
}

async function publicError(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}));
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  const msg = String(body?.error?.message ?? "");
  if (reason === "keyInvalid" || /API key not valid/i.test(msg)) {
    throw new UserError("Google didn't accept the key in Settings > Google Drive. A manager can check it there.", 503, "bad_key");
  }
  if (reason === "accessNotConfigured" || /has not been used|is disabled|SERVICE_DISABLED/i.test(msg)) {
    throw new UserError("Google Drive API isn't switched on for that Google key. A manager can switch it on (Settings > Google Drive has the link).", 503, "api_off");
  }
  if (res.status === 404 || res.status === 403 || res.status === 401) {
    throw new UserError('Google Drive can\'t open this link. Make sure it\'s shared as "Anyone with the link" and try again.', 404, "not_shared");
  }
  console.error("Shared Drive call failed", res.status, msg.slice(0, 200));
  throw new UserError("Couldn't reach Google Drive. Try again in a moment.", 502);
}

type DriveItem = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; resourceKey?: string; shortcutDetails?: { targetId: string; targetMimeType: string; targetResourceKey?: string } };

/** A shortcut stands in for the file it points to. */
function resolve(f: DriveItem) {
  if (f.mimeType === "application/vnd.google-apps.shortcut" && f.shortcutDetails?.targetId) {
    return { ...f, id: f.shortcutDetails.targetId, mimeType: f.shortcutDetails.targetMimeType, resourceKey: f.shortcutDetails.targetResourceKey, size: undefined };
  }
  return f;
}

function shape(raw: DriveItem) {
  const f = resolve(raw);
  const exp = EXPORTS[f.mimeType];
  const folder = f.mimeType === FOLDER;
  return {
    id: f.id,
    name: exp && !f.name.toLowerCase().endsWith(`.${exp.ext}`) ? `${f.name}.${exp.ext}` : f.name,
    mime: exp ? exp.mime : f.mimeType,
    size: f.size ? Number(f.size) : null,
    modified: f.modifiedTime ?? null,
    resource_key: f.resourceKey ?? null,
    folder,
    // Other Google files (Forms, Sites, Maps) can only be opened in Drive.
    viewable: folder || !!exp || !f.mimeType.startsWith("application/vnd.google-apps."),
  };
}

/** Folder or file id (and resource key) from a pasted Drive or Docs link. */
function parseDriveUrl(raw: string): { id: string; rk: string | null } | null {
  let u: URL;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/(?:folders|d)\/([\w-]{10,})/);
  const id = m?.[1] ?? u.searchParams.get("id");
  if (!id || !ID_RE.test(id)) return null;
  return { id, rk: u.searchParams.get("resourcekey") };
}

async function saveApiKey(body: { key?: string }, me: Me) {
  if (me.role !== "manager") throw new UserError("Only a manager can change the Google key.", 403);
  const key = String(body.key ?? "").trim();
  if (!key) {
    await setSecret("drive_api_key", "");
    await admin.from("app_settings").update({ drive_key_added_at: null }).eq("id", 1);
    return { ok: true };
  }
  if (!/^AIza[\w-]{30,}$/.test(key)) throw new UserError("That doesn't look like a Google API key. It starts with AIza.");
  // A real key gets "sign in needed" for this test call; a wrong key or a switched-off API says so.
  const res = await publicDrive("/about?fields=kind", {}, key);
  if (!res.ok && res.status !== 401) await publicError(res);
  await setSecret("drive_api_key", key);
  await admin.from("app_settings").update({ drive_key_added_at: new Date().toISOString() }).eq("id", 1);
  return { ok: true };
}

async function linkInfo(body: { url?: string }) {
  const p = parseDriveUrl(body.url ?? "");
  if (!p) throw new UserError("That isn't a Google Drive link. Copy it from Drive with Share > Copy link.");
  const res = await publicDrive(`/files/${p.id}?fields=${FILE_FIELDS}`, rkHeader([[p.id, p.rk]]));
  if (!res.ok) await publicError(res);
  const raw = (await res.json()) as DriveItem;
  const f = shape(raw);
  return {
    drive_id: f.id,
    resource_key: f.resource_key ?? p.rk,
    kind: f.folder ? "folder" : "file",
    title: raw.name,
    mime: f.folder ? FOLDER : f.mime,
    size: f.size,
  };
}

/* ---------------------------------------------------------------- other links */
// A page's name for a link card (OneDrive, Dropbox, WeTransfer, a website). Best effort: when the
// page won't say (sign-in pages, apps that build the page in the browser), the app names it from
// the address and the person can change it.
const GENERIC_TITLES = /^(onedrive|microsoft onedrive|sign in.*|sign-in.*|login|log in|dropbox|wetransfer|sharepoint|microsoft sharepoint|box|icloud|google drive|redirecting.*|just a moment.*|attention required.*|access denied|403 forbidden|404 not found|page not found|untitled)$/i;

function privateHost(host: string) {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return h.includes(":") || h.startsWith("[");
}

function decodeEntities(t: string) {
  return t
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

async function webInfo(body: { url?: string }) {
  let u: URL;
  try {
    u = new URL(String(body.url ?? "").trim());
  } catch {
    throw new UserError("That doesn't look like a web link. Copy the whole address, starting with https://");
  }
  if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) throw new UserError("That doesn't look like a web link. Copy the whole address, starting with https://");
  let title: string | null = null;
  try {
    const res = await fetch(u.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NorthcroftLinkCheck/1.0)", Accept: "text/html,application/xhtml+xml" },
    });
    if (res.ok && /html/i.test(res.headers.get("content-type") ?? "") && !privateHost(new URL(res.url).hostname)) {
      // Read the start of the page only.
      const reader = res.body?.getReader();
      let html = "";
      const dec = new TextDecoder();
      while (reader && html.length < 300_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += dec.decode(value, { stream: true });
        if (/<\/head>/i.test(html)) break;
      }
      reader?.cancel().catch(() => {});
      const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
      const tt = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
      const found = decodeEntities((og?.[1] ?? tt?.[1] ?? "").slice(0, 200));
      if (found && !GENERIC_TITLES.test(found)) title = found;
    }
  } catch {
    title = null;
  }
  return { title };
}

/** The link, as the signed-in person can see it (so only team members, and only links still on). */
async function visibleLink(id: unknown, req: Request) {
  const { data } = await asUser(req).from("drive_links").select("id, drive_id, resource_key, kind, removed_at").eq("id", String(id ?? "")).maybeSingle();
  if (!data || data.removed_at) throw new UserError("That Drive link has been taken off.", 404);
  return data as { id: string; drive_id: string; resource_key: string | null; kind: "folder" | "file" };
}

async function linkList(body: { link_id?: string; folder_id?: string; folder_rk?: string }, req: Request) {
  const link = await visibleLink(body.link_id, req);
  const keys = rkHeader([[link.drive_id, link.resource_key], [String(body.folder_id ?? ""), body.folder_rk]]);
  if (link.kind === "file") {
    const res = await publicDrive(`/files/${link.drive_id}?fields=${FILE_FIELDS}`, keys);
    if (!res.ok) await publicError(res);
    return { files: [shape(await res.json())] };
  }
  const folder = body.folder_id && ID_RE.test(body.folder_id) ? body.folder_id : link.drive_id;
  const files: ReturnType<typeof shape>[] = [];
  let page = "";
  for (let i = 0; i < 5; i++) {
    const q = encodeURIComponent(`'${folder}' in parents and trashed = false`);
    const res = await publicDrive(
      `/files?q=${q}&fields=nextPageToken,files(${FILE_FIELDS})&orderBy=folder,name_natural&pageSize=200&includeItemsFromAllDrives=true${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`,
      keys,
    );
    if (!res.ok) await publicError(res);
    const out = (await res.json()) as { files?: DriveItem[]; nextPageToken?: string };
    for (const f of out.files ?? []) files.push(shape(f));
    if (!out.nextPageToken) break;
    page = out.nextPageToken;
  }
  return { files };
}

async function linkFile(body: { link_id?: string; file_id?: string; file_rk?: string }, req: Request) {
  const link = await visibleLink(body.link_id, req);
  const id = String(body.file_id ?? "");
  if (!ID_RE.test(id)) throw new UserError("File not found.", 404);
  const res = await publicDrive(`/files/${id}?fields=${FILE_FIELDS}`, rkHeader([[link.drive_id, link.resource_key], [id, body.file_rk]]));
  if (!res.ok) await publicError(res);
  return shape(await res.json());
}

async function linkOpen(body: { link_id?: string; file_id?: string; file_rk?: string; download?: boolean }, req: Request) {
  const link = await visibleLink(body.link_id, req);
  const id = String(body.file_id ?? "");
  if (!ID_RE.test(id)) throw new UserError("File not found.", 404);
  const rk = String(body.file_rk ?? (id === link.drive_id ? link.resource_key ?? "" : ""));
  if (rk && !/^[\w-]{1,100}$/.test(rk)) throw new UserError("File not found.", 404);
  const e = Math.floor(Date.now() / 1000) + LINK_HOURS * 3600;
  const d = body.download ? "1" : "0";
  const s = await hmac(`gopen:${id}:${rk}:${e}:${d}`);
  return { url: `${SELF_URL}?g=${id}&k=${encodeURIComponent(rk)}&e=${e}&d=${d}&s=${s}` };
}

async function streamShared(req: Request, url: URL): Promise<Response> {
  const id = url.searchParams.get("g") ?? "";
  const rk = url.searchParams.get("k") ?? "";
  const e = Number(url.searchParams.get("e"));
  const d = url.searchParams.get("d") === "1" ? "1" : "0";
  const s = url.searchParams.get("s") ?? "";
  if (!ID_RE.test(id) || !e || !s || !same(s, await hmac(`gopen:${id}:${rk}:${e}:${d}`))) return new Response("This link isn't valid.", { status: 403, headers: CORS });
  if (Date.now() / 1000 > e) return new Response("This link has expired. Open the file again from the app.", { status: 410, headers: CORS });
  const keys = rkHeader([[id, rk]]);
  const meta = await publicDrive(`/files/${id}?fields=${FILE_FIELDS}`, keys);
  if (!meta.ok) return new Response("Google Drive can't open this file. It may no longer be shared.", { status: 404, headers: CORS });
  const raw = resolve((await meta.json()) as DriveItem);
  const f = shape(raw);
  const exp = EXPORTS[raw.mimeType];
  const range = req.headers.get("range");
  const g = exp
    ? await publicDrive(`/files/${raw.id}/export?mimeType=${encodeURIComponent(exp.mime)}`, rkHeader([[raw.id, raw.resourceKey ?? rk]]))
    : await publicDrive(`/files/${raw.id}?alt=media`, { ...rkHeader([[raw.id, raw.resourceKey ?? rk]]), ...(range ? { Range: range } : {}) });
  if (!g.ok && g.status !== 206) {
    console.error("Shared Drive download failed", g.status);
    return new Response(exp ? "Google can't export this file (it may be over 10 MB). Open it in Google Drive instead." : "Couldn't open the file from Google Drive.", { status: 502, headers: CORS });
  }
  const inline = d === "0" && INLINE.test(f.mime);
  const headers = new Headers(CORS);
  for (const h of ["content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
    const v = g.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set("Content-Type", inline ? f.mime : "application/octet-stream");
  headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(g.body, { status: g.status, headers });
}

/* ---------------------------------------------------------------- entry */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  try {
    if (req.method === "GET") {
      if (url.pathname.endsWith("/callback")) return await callback(url);
      if (url.searchParams.has("f")) return await stream(req, url);
      if (url.searchParams.has("g")) return await streamShared(req, url);
      return new Response("Not found", { status: 404, headers: CORS });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: auth } = await admin.auth.getUser(jwt);
    if (!auth?.user) return json({ error: "Please sign in again." }, 401);
    const { data: me } = await admin.from("profiles").select("id, short_name, role, can_assign, active").eq("id", auth.user.id).maybeSingle<Me>();
    if (!me?.active) return json({ error: "Your account doesn't have access." }, 403);

    const body = await req.json().catch(() => ({}));
    const origin = req.headers.get("origin") ?? "";
    switch (body.action) {
      case "configure":
        return json(await configure(body, me, origin));
      case "disconnect":
        return json(await disconnect(me));
      case "start_upload":
        return json(await startUpload(body, me, origin, req));
      case "finish_upload":
        return json(await finishUpload(body, me, req));
      case "link":
        return json(await link(body, req));
      case "links":
        return json(await links(body, req));
      case "delete":
        return json(await remove(body, req));
      case "save_api_key":
        return json(await saveApiKey(body, me));
      case "link_info":
        return json(await linkInfo(body));
      case "link_list":
        return json(await linkList(body, req));
      case "link_file":
        return json(await linkFile(body, req));
      case "link_open":
        return json(await linkOpen(body, req));
      case "web_info":
        return json(await webInfo(body));
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message, code: e.code }, e.status);
    console.error(e);
    return json({ error: "Something went wrong with Google Drive. Try again." }, 500);
  }
});
