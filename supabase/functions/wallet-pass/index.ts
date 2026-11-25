// The Northcroft staff pass for Apple Wallet: a staff card with your name, role and a QR code,
// signed so the iPhone accepts it. The app asks for it from Account > Staff pass and hands it
// to Wallet (PassKit's "Add to Apple Wallet" screen).
//
// POST (signed-in team member)  ->  { pass: "<base64 .pkpass>" }
//
// Signing a pass needs a Pass Type ID certificate from the paid Apple Developer Program. Until these
// Edge Function secrets are set, it answers 503 { code: "not_set_up" } and the app says so:
//   WALLET_PASS_TYPE_ID   e.g. pass.com.northcroftme.qsteam
//   WALLET_TEAM_ID        the 10-character Apple team ID
//   WALLET_CERT_PEM       the pass certificate (PEM)
//   WALLET_KEY_PEM        its private key (PEM, unencrypted)
//   WALLET_WWDR_PEM       Apple's WWDR intermediate certificate (G4, PEM)
import forge from "npm:node-forge@1.3.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { createClient } from "npm:@supabase/supabase-js@2";

// The pass pictures are served by the web app (public/wallet, made from the app icon); the app's
// standard icon stands in if they aren't there yet.
const SITE = Deno.env.get("SITE_URL") ?? "https://northcroft-qs-team.vercel.app";
const PICTURES = ["icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png"];
let pictureCache: Record<string, Uint8Array> | null = null;
async function pictures(): Promise<Record<string, Uint8Array>> {
  if (pictureCache) return pictureCache;
  const get = async (path: string) => {
    const r = await fetch(`${SITE}${path}`);
    const ok = r.ok && (r.headers.get("content-type") ?? "").includes("image/png");
    return ok ? new Uint8Array(await r.arrayBuffer()) : null;
  };
  const out: Record<string, Uint8Array> = {};
  const fallback = await get("/icons/icon-192.png");
  for (const name of PICTURES) {
    const b = (await get(`/wallet/${name}`)) ?? fallback;
    if (b) out[name] = b;
  }
  if (!out["icon.png"]) throw new Error("No pass pictures");
  pictureCache = out;
  return out;
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function secrets() {
  const s = {
    passTypeId: Deno.env.get("WALLET_PASS_TYPE_ID") ?? "",
    teamId: Deno.env.get("WALLET_TEAM_ID") ?? "",
    cert: Deno.env.get("WALLET_CERT_PEM") ?? "",
    key: Deno.env.get("WALLET_KEY_PEM") ?? "",
    wwdr: Deno.env.get("WALLET_WWDR_PEM") ?? "",
  };
  return Object.values(s).every(Boolean) ? s : null;
}

const sha1 = (bytes: Uint8Array) => {
  const md = forge.md.sha1.create();
  md.update(forge.util.binary.raw.encode(bytes));
  return md.digest().toHex();
};

/** A detached PKCS #7 signature of the manifest, as Wallet expects. */
function sign(manifest: string, s: NonNullable<ReturnType<typeof secrets>>): Uint8Array {
  const cert = forge.pki.certificateFromPem(s.cert);
  const wwdr = forge.pki.certificateFromPem(s.wwdr);
  const key = forge.pki.privateKeyFromPem(s.key);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest, "utf8");
  p7.addCertificate(cert);
  p7.addCertificate(wwdr);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.binary.raw.decode(der);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth?.user) return json({ error: "Please sign in again." }, 401);
  const { data: me } = await admin
    .from("profiles")
    .select("id, full_name, title, email, active, created_at")
    .eq("id", auth.user.id)
    .maybeSingle<{ id: string; full_name: string; title: string; email: string; active: boolean; created_at: string }>();
  if (!me?.active) return json({ error: "Your account doesn't have access." }, 403);

  const s = secrets();
  if (!s) return json({ error: "The Wallet staff pass needs the Apple Developer Program certificate first.", code: "not_set_up" }, 503);

  const staffNo = `NC-${me.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: s.passTypeId,
    teamIdentifier: s.teamId,
    serialNumber: me.id,
    organizationName: "Northcroft",
    description: "Northcroft staff pass",
    logoText: "Northcroft",
    backgroundColor: "rgb(1, 32, 97)",
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: "rgb(170, 190, 230)",
    sharingProhibited: true,
    generic: {
      primaryFields: [{ key: "name", label: "NAME", value: me.full_name }],
      secondaryFields: [{ key: "title", label: "ROLE", value: me.title || "Team member" }],
      auxiliaryFields: [
        { key: "team", label: "TEAM", value: "QS Team, Riyadh" },
        { key: "since", label: "SINCE", value: me.created_at, dateStyle: "PKDateStyleMedium" },
      ],
      backFields: [
        { key: "staff", label: "Staff number", value: staffNo },
        { key: "email", label: "Email", value: me.email },
        { key: "about", label: "About this pass", value: "Your Northcroft staff card. Show the code to be checked against the team list." },
      ],
    },
    barcodes: [{ format: "PKBarcodeFormatQR", message: staffNo, messageEncoding: "iso-8859-1", altText: staffNo }],
  };

  const files: Record<string, Uint8Array> = { "pass.json": strToU8(JSON.stringify(pass)) };
  try {
    Object.assign(files, await pictures());
  } catch {
    return json({ error: "The pass pictures couldn't be loaded. Try again in a moment." }, 502);
  }
  const manifest = JSON.stringify(Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha1(b)])));
  try {
    files["manifest.json"] = strToU8(manifest);
    files["signature"] = sign(manifest, s);
  } catch (e) {
    console.error("Signing the pass failed", e);
    return json({ error: "The pass couldn't be signed. Check the Wallet certificate secrets.", code: "bad_cert" }, 500);
  }
  const zip = zipSync(files, { level: 6 });
  let bin = "";
  for (let i = 0; i < zip.length; i += 0x8000) bin += String.fromCharCode(...zip.subarray(i, i + 0x8000));
  return json({ pass: btoa(bin), name: "Northcroft.pkpass" });
});
