// Writes a voice note out in English with Groq Whisper (whisper-large-v3, translations endpoint),
// so notes spoken in Arabic, Tamil or English all read as English text.
// Called by the database (request_transcript) with the same shared secret as send-push.
// Needs the GROQ_API_KEY secret; without it the note is marked 'off' and nothing is sent anywhere.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const GROQ_URL = "https://api.groq.com/openai/v1/audio/translations";
const MODEL = "whisper-large-v3";
const TABLES = { comment: "comments", announcement: "announcements" } as const;

let secret: string | null = null;
let loadedAt = 0;

async function webhookSecret(): Promise<string> {
  if (secret && Date.now() - loadedAt < 5 * 60_000) return secret;
  const { data, error } = await supabase.rpc("get_push_config");
  if (error) throw new Error(`Could not load config: ${error.message}`);
  secret = (data as { push_webhook_secret: string }).push_webhook_secret;
  loadedAt = Date.now();
  return secret;
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A short hint so Whisper spells the team's names, projects and QS terms correctly. */
async function vocabulary(): Promise<string> {
  const [{ data: people }, { data: projects }] = await Promise.all([
    supabase.from("profiles").select("short_name").eq("active", true),
    supabase.from("projects").select("name").neq("status", "completed"),
  ]);
  const names = [...(people ?? []).map((p) => p.short_name), ...(projects ?? []).map((p) => p.name)].filter(Boolean);
  const hint =
    "Northcroft quantity surveying team in Saudi Arabia. Terms: BOQ, EI, VO, variation, take-off, IFT, IPC, " +
    "specification, ceiling, floor finish, wall finish, hardscaping, shade sail, drawings, quotation, SAR. " +
    `Names: ${names.join(", ")}.`;
  return hint.slice(0, 700);
}

const MIME: Record<string, string> = { m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg", wav: "audio/wav", mp3: "audio/mpeg" };

async function callGroq(key: string, audio: Blob, ext: string, prompt: string) {
  const form = new FormData();
  form.append("file", new File([audio], `voice.${ext}`, { type: MIME[ext] ?? "application/octet-stream" }));
  form.append("model", MODEL);
  form.append("response_format", "json");
  form.append("temperature", "0");
  form.append("prompt", prompt);
  return fetch(GROQ_URL, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    if (!sameSecret(req.headers.get("x-push-secret") ?? "", await webhookSecret())) return json({ error: "Unauthorized" }, 401);
  } catch (e) {
    console.error(e);
    return json({ error: "Not configured" }, 500);
  }

  const { kind, id } = await req.json().catch(() => ({}));
  const table = TABLES[kind as keyof typeof TABLES];
  if (!table || !id) return json({ error: "kind and id are required" }, 400);

  const { data: row } = await supabase.from(table).select("id, voice_path, voice_seconds").eq("id", id).maybeSingle();
  if (!row?.voice_path) return json({ error: "No voice note" }, 404);

  // Only touch the row if it still has the same recording.
  const save = (patch: Record<string, unknown>) => supabase.from(table).update(patch).eq("id", id).eq("voice_path", row.voice_path);

  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) {
    await save({ transcript_status: "off" });
    return json({ status: "off" });
  }

  try {
    const { data: audio, error: dlErr } = await supabase.storage.from("files").download(row.voice_path);
    if (dlErr || !audio) throw new Error(`Could not read the recording: ${dlErr?.message ?? "missing"}`);
    const ext = (row.voice_path.split(".").pop() ?? "webm").toLowerCase();
    const prompt = await vocabulary();

    let res = await callGroq(key, audio, ext, prompt);
    if (res.status === 429 || res.status >= 500) {
      // Busy or a hiccup: wait a moment and try once more.
      await new Promise((r) => setTimeout(r, 5000));
      res = await callGroq(key, audio, ext, prompt);
    }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const out = (await res.json()) as { text?: string };
    let text = (out.text ?? "").trim();
    // Whisper sometimes "hears" a stock phrase in near-silence; ignore it for very short clips.
    if ((row.voice_seconds ?? 0) < 1.5 && /^(thank you\.?|thanks for watching!?|you)$/i.test(text)) text = "";
    await save({ transcript: text || null, transcript_status: "done" });
    return json({ status: "done", chars: text.length });
  } catch (e) {
    console.error(e);
    await save({ transcript_status: "failed" });
    return json({ status: "failed" }, 500);
  }
});
