/* Northcroft service worker: push notifications, badge and a small offline shell. */
const SHELL_CACHE = "northcroft-shell-v2";
const ASSET_CACHE = "northcroft-assets-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL_CACHE, ASSET_CACHE, AVATAR_CACHE].includes(k)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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

  // Pages: network first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/")),
    );
  }
});

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
