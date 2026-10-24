/* Northcroft service worker: push notifications, the badge, and working without signal.
   - The app itself (pages and code) loads with no signal.
   - Each screen's data is kept per person: with no signal, screens show the last copy.
   - Photos, voice notes and files already opened are kept too.
   - "Share into the app" from other apps (Android and computers). */
const SHELL_CACHE = "northcroft-shell-v2";
const ASSET_CACHE = "northcroft-assets-v1";
const META_CACHE = "northcroft-meta";
const PUBLIC_CACHE = "northcroft-public-v1";
const DATA_PREFIX = "northcroft-data-";
const SHARE_DB = "northcroft-share";

// Read-only functions whose answers are worth keeping for no-signal use. Functions that change
// something are never answered from the saved copy.
const READ_RPCS = ["my_chats", "team_presence"];
// How many saved answers to keep per person; the oldest go first.
const DATA_LIMIT = 1500;
// Files bigger than this aren't kept for no-signal use.
const FILE_LIMIT = 25 * 1024 * 1024;
// With a weak signal, wait this long for the network before showing the saved copy.
const SLOW_MS = 7000;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = (k) => [SHELL_CACHE, ASSET_CACHE, AVATAR_CACHE, META_CACHE, PUBLIC_CACHE].includes(k) || k.startsWith(DATA_PREFIX);
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !keep(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

/* ---- Who is signed in (the page tells us; kept so it survives the worker restarting) ---- */
let session = null; // { user, api }
let sessionLoaded = false;

async function currentSession() {
  if (sessionLoaded) return session;
  try {
    const meta = await caches.open(META_CACHE);
    const res = await meta.match("/__nc/session");
    session = res ? await res.json() : null;
  } catch (e) {
    session = null;
  }
  sessionLoaded = true;
  return session;
}

self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "nc-session") {
    session = d.user ? { user: d.user, api: d.api } : null;
    sessionLoaded = true;
  }
  if (d.type === "nc-assets" && Array.isArray(d.files)) event.waitUntil(pruneAssets(d.files));
});

/** The signed-in person a request is for, from its sign-in token. */
function tokenUser(req) {
  const h = req.headers.get("authorization") || "";
  const parts = h.replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3) return null;
  try {
    let b = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const claims = JSON.parse(atob(b));
    return claims && claims.role === "authenticated" && typeof claims.sub === "string" ? claims.sub : null;
  } catch (e) {
    return null;
  }
}

const isApi = (url, s) => (s && s.api ? url.origin === s.api : /\.supabase\.co$/.test(url.hostname));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const offlineNow = () => self.navigator && self.navigator.onLine === false;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Files shared into the app from another app.
  if (req.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(receiveShare(req));
    return;
  }

  if (url.origin !== self.location.origin) {
    if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/storage/v1/object/")) {
      const handled = apiRequest(event, req, url);
      if (handled) event.respondWith(handled);
    }
    return;
  }
  if (req.method !== "GET") return;

  // Hashed build assets never change, so serve them from cache first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Pages: network first, fall back to the saved app when offline (or the signal is very slow).
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const net = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put("/", copy)).catch(() => {});
          }
          return res;
        });
        event.waitUntil(net.catch(() => {}));
        const saved = await caches.match("/");
        if (!saved) return net;
        if (offlineNow()) return saved;
        return Promise.race([net.catch(() => saved), sleep(SLOW_MS).then(() => saved)]);
      })(),
    );
  }
});

/** Requests to Supabase that we keep a copy of. Returns undefined to let anything else through untouched. */
function apiRequest(event, req, url) {
  if (url.pathname.startsWith("/rest/v1/")) {
    if (req.method === "GET" || req.method === "HEAD") return restRead(event, req, url, null);
    const fn = url.pathname.startsWith("/rest/v1/rpc/") ? url.pathname.slice("/rest/v1/rpc/".length) : null;
    if (req.method === "POST" && fn && READ_RPCS.includes(fn)) return req.clone().text().then((body) => restRead(event, req, url, body));
    return undefined;
  }
  // Private links to files: asking for one (keep the answer, so it still works with no signal)...
  if (req.method === "POST" && url.pathname.startsWith("/storage/v1/object/sign/")) {
    return req.clone().text().then((body) => restRead(event, req, url, body));
  }
  // ...and the file itself.
  if (req.method === "GET" && !url.searchParams.has("download")) {
    if (url.pathname.startsWith("/storage/v1/object/public/")) return publicFile(event, req, url);
    if (url.pathname.startsWith("/storage/v1/object/sign/")) return privateFile(event, req, url);
  }
  return undefined;
}

/** The key a saved answer is filed under: the address plus whatever changes the answer. */
function restKey(req, url, body) {
  const extra = new URLSearchParams();
  if (req.method === "HEAD") extra.set("__nc_head", "1");
  const accept = req.headers.get("accept");
  if (accept && accept !== "*/*") extra.set("__nc_accept", accept);
  const prefer = req.headers.get("prefer");
  if (prefer) extra.set("__nc_prefer", prefer);
  const range = req.headers.get("range");
  if (range) extra.set("__nc_range", range);
  if (body != null) extra.set("__nc_body", body);
  const more = extra.toString();
  return url.origin + url.pathname + url.search + (more ? (url.search ? "&" : "?") + more : "");
}

async function restRead(event, req, url, body) {
  const s = await currentSession();
  const forUser = tokenUser(req);
  // A request with someone else's token than the person signed in here: leave it alone.
  if (forUser && s && s.user && forUser !== s.user) return fetch(req);
  const readUser = forUser || (s && s.user);
  if (!readUser || !isApi(url, s)) return fetch(req);
  // Only ever save an answer given to the signed-in person's own token.
  const canSave = !!forUser && !!s && s.user === forUser;
  const cacheName = DATA_PREFIX + readUser;
  const key = restKey(req, url, body);

  const net = fetch(req).then(async (res) => {
    if (canSave && (res.status === 200 || res.status === 206)) {
      try {
        const cache = await caches.open(cacheName);
        // A saved copy can't be a partial answer, so the real status is kept alongside.
        const headers = new Headers(res.headers);
        headers.set("x-nc-status", String(res.status));
        headers.set("x-nc-saved", new Date().toISOString());
        const blob = req.method === "HEAD" ? null : await res.clone().blob();
        await cache.put(key, new Response(blob, { status: 200, headers }));
        trim(cache);
      } catch (e) {
        /* storage full or blocked: the answer still goes to the screen */
      }
    }
    return res;
  });
  event.waitUntil(net.catch(() => {}));

  const cache = await caches.open(cacheName);
  const saved = await cache.match(key);
  if (!saved) return net;
  const replay = () => new Response(saved.clone().body, { status: Number(saved.headers.get("x-nc-status")) || 200, headers: saved.headers });
  if (offlineNow()) return replay();
  return Promise.race([net.catch(() => replay()), sleep(SLOW_MS).then(replay)]);
}

let puts = 0;
async function trim(cache) {
  if (++puts % 40 !== 0) return;
  const keys = await cache.keys();
  if (keys.length <= DATA_LIMIT) return;
  // Oldest first: saving an answer again moves it to the end.
  await Promise.all(keys.slice(0, keys.length - DATA_LIMIT + 200).map((k) => cache.delete(k)));
}

/** Profile photos and project covers: everyone sees them, and their address changes when they do. */
async function publicFile(event, req, url) {
  const cache = await caches.open(PUBLIC_CACHE);
  const key = url.origin + url.pathname;
  const saved = await cache.match(key);
  const net = fetch(url.href, { mode: "cors", credentials: "omit" }).then((res) => {
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  if (saved) {
    event.waitUntil(net.catch(() => {}));
    return saved;
  }
  return net.catch(() => fetch(req));
}

/** Private files (photos in chats, voice notes, files opened in the app), kept per person. */
async function privateFile(event, req, url) {
  const s = await currentSession();
  if (!s || !s.user || !isApi(url, s)) return fetch(req);
  const cache = await caches.open(DATA_PREFIX + s.user);
  const key = url.origin + url.pathname; // the link's code changes every time; the file doesn't
  const range = req.headers.get("range");
  // A video or other big file played in parts: stream it as usual, and use a saved copy if offline.
  if (range && !url.pathname.includes("/voice/")) {
    try {
      return await fetch(req);
    } catch (e) {
      const saved = await cache.match(key);
      if (!saved) throw e;
      return slice(saved, range);
    }
  }
  let res;
  try {
    // The whole file once (also when a voice note asks for part of it), kept, then the part asked for.
    res = await fetch(url.href, { mode: "cors", credentials: "omit" });
  } catch (e) {
    const saved = await cache.match(key);
    if (!saved) throw e;
    return slice(saved, range);
  }
  if (!res.ok) return res;
  const size = Number(res.headers.get("content-length") || 0);
  if (size > FILE_LIMIT) return range ? fetch(req) : res;
  const blob = await res.blob();
  if (blob.size <= FILE_LIMIT) {
    cache
      .put(key, new Response(blob, { status: 200, headers: res.headers }))
      .then(() => trim(cache))
      .catch(() => {});
  }
  return slice(new Response(blob, { status: 200, headers: res.headers }), range);
}

/** Answer a "bytes=a-b" request from a whole file, the way audio players ask. */
async function slice(res, range) {
  if (!range) return res;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return res;
  const blob = await res.blob();
  const total = blob.size;
  const start = m[1] === "" ? Math.max(0, total - Number(m[2])) : Number(m[1]);
  const end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), total - 1) : total - 1;
  if (start >= total) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  const part = blob.slice(start, end + 1);
  const headers = new Headers(res.headers);
  headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
  headers.set("Content-Length", String(part.size));
  headers.set("Accept-Ranges", "bytes");
  return new Response(part, { status: 206, headers });
}

/** Keep this version's and the previous version's screen code; let anything older go. */
async function pruneAssets(files) {
  const meta = await caches.open(META_CACHE);
  const prevRes = await meta.match("/__nc/assets");
  const prev = prevRes ? await prevRes.json() : [];
  const keep = new Set([...files, ...prev].map((f) => new URL(f, self.location.origin).pathname));
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.filter((k) => !keep.has(new URL(k.url).pathname)).map((k) => cache.delete(k)));
  await meta.put("/__nc/assets", new Response(JSON.stringify(files)));
}

/* ---- Share into the app ----
   Another app shares files, a link or text. They're kept on the phone and the Share screen opens,
   where the person picks the chat or task. They stay until sent or cancelled, so having to sign in
   first doesn't lose them. */
function shareDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(SHARE_DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains("shared")) r.result.createObjectStore("shared", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function receiveShare(req) {
  try {
    const form = await req.formData();
    const files = form
      .getAll("files")
      .filter((f) => f && typeof f === "object" && "size" in f && f.size > 0)
      .map((f) => ({ blob: f, name: f.name || "Shared file", type: f.type || "application/octet-stream" }));
    const item = {
      id: "current",
      at: new Date().toISOString(),
      title: String(form.get("title") || ""),
      text: String(form.get("text") || ""),
      url: String(form.get("url") || ""),
      files,
    };
    const db = await shareDb();
    await new Promise((resolve, reject) => {
      const t = db.transaction("shared", "readwrite");
      t.objectStore("shared").put(item);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
    });
  } catch (e) {
    return Response.redirect("/share?error=1", 303);
  }
  return Response.redirect("/share", 303);
}

/* ---- Sender photo for notifications, WhatsApp style ----
   Android and computers show the notification icon next to the message, so we draw the
   sender's photo as a circle (or their initials on their colour). iPhone always shows
   the app icon for Home Screen apps, so there it simply falls back to the Northcroft icon. */
const AVATAR_CACHE = "northcroft-avatars-v1";
const APP_ICON = "/icons/icon-192.png";

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function photoBlob(url) {
  // Photo addresses change whenever someone uploads a new one, so caching them forever is safe.
  const cache = await caches.open(AVATAR_CACHE);
  let res = await cache.match(url);
  if (!res) {
    res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) return null;
    cache.put(url, res.clone()).catch(() => {});
  }
  return res.blob();
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return "data:" + (blob.type || "image/png") + ";base64," + btoa(bin);
}

async function roundAvatar(actor) {
  if (!actor || typeof OffscreenCanvas === "undefined") return null;
  const S = 192;
  const canvas = new OffscreenCanvas(S, S);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  let drawn = false;
  if (actor.photo) {
    try {
      const blob = await photoBlob(actor.photo);
      if (blob) {
        const img = await createImageBitmap(blob);
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
        if (img.close) img.close();
        drawn = true;
      }
    } catch (e) {
      /* fall back to initials */
    }
  }
  if (!drawn) {
    ctx.fillStyle = /^#[0-9a-f]{3,8}$/i.test(actor.color || "") ? actor.color : "#1B3570";
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 74px -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(actor.initials || "?").slice(0, 2), S / 2, S / 2 + 3);
  }
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { notification: { title: "Northcroft", body: event.data ? event.data.text() : "" } };
  }
  const n = payload.notification || payload;
  const data = payload.data || {};
  const url = n.navigate || data.url || "/inbox";
  const title = n.title || "Northcroft";
  const badge = Number(n.app_badge);

  const show = async () => {
    // Never let a slow photo hold up the notification.
    const icon = (await withTimeout(roundAvatar(data.actor).catch(() => null), 2500)) || APP_ICON;
    return self.registration.showNotification(title, {
      body: n.body || "",
      icon,
      badge: "/icons/badge-96.png",
      tag: n.tag,
      renotify: Boolean(n.tag),
      timestamp: Date.now(),
      data: { url, tag: n.tag || null },
    });
  };

  event.waitUntil(
    Promise.all([
      // Tell open windows once it's showing, so a window already on that chat can clear it.
      show().then(() =>
        self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) =>
          list.forEach((c) => c.postMessage({ type: "push", payload })),
        ),
      ),
      Number.isFinite(badge) && self.navigator && "setAppBadge" in self.navigator
        ? (badge > 0 ? self.navigator.setAppBadge(badge) : self.navigator.clearAppBadge()).catch(() => {})
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = new URL((event.notification.data && event.notification.data.url) || "/inbox", self.location.origin);
  const target = self.location.origin + raw.pathname + raw.search;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: "navigate", url: target });
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The page re-syncs the subscription on next launch; let any open window know now.
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => list.forEach((c) => c.postMessage({ type: "resubscribe" }))),
  );
});
