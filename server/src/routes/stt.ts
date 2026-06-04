import { Router } from "express";

// Speech-to-text via AssemblyAI. The browser records a short prompt and POSTs
// the audio (base64) here; we upload it to AssemblyAI, kick off a transcript,
// poll to completion, and return the text. The API key stays server-side
// (CLAWBOT_ASSEMBLYAI_API_KEY) so it never reaches the frontend bundle.
//
// AssemblyAI's flow is async: /upload -> /transcript -> poll /transcript/:id.
// For short chat prompts this completes in a few seconds; we hold the request
// open and poll on the server so the client just awaits one call.

export const sttRouter = Router();

const AAI = "https://api.assemblyai.com/v2";
const KEY = () => (process.env.CLAWBOT_ASSEMBLYAI_API_KEY ?? "").trim();
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_500;

sttRouter.get("/status", (_req, res) => {
  res.json({
    enabled: KEY().length > 0,
    provider: "assemblyai",
    hint: KEY() ? undefined : "set CLAWBOT_ASSEMBLYAI_API_KEY in clawbot/.env and restart to enable the chat mic",
  });
});

sttRouter.post("/", async (req, res) => {
  const key = KEY();
  if (!key) {
    return res.status(400).json({ error: "speech-to-text not configured", hint: "set CLAWBOT_ASSEMBLYAI_API_KEY in clawbot/.env and restart" });
  }

  // Accept either a bare base64 string or a data URL ("data:audio/webm;base64,...").
  const b64 = typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
  if (!b64) return res.status(400).json({ error: "audioBase64 is required" });
  const comma = b64.indexOf(",");
  const raw = b64.startsWith("data:") && comma !== -1 ? b64.slice(comma + 1) : b64;

  let audio: Buffer;
  try { audio = Buffer.from(raw, "base64"); } catch { return res.status(400).json({ error: "invalid base64 audio" }); }
  if (audio.length < 800) return res.status(400).json({ error: "audio too short or empty — hold the mic a moment longer" });
  if (audio.length > MAX_AUDIO_BYTES) return res.status(400).json({ error: "audio too large (max 25MB)" });

  try {
    // 1. Upload the raw bytes — returns a private upload_url AssemblyAI can read.
    // Copy into a Uint8Array backed by a concrete ArrayBuffer. A bare Buffer
    // (ArrayBufferLike, possibly SharedArrayBuffer) trips TS's BodyInit check;
    // this is unambiguously a Blob part and a valid fetch body.
    const bytes = new Uint8Array(audio.byteLength);
    bytes.set(audio);
    const up = await fetch(`${AAI}/upload`, {
      method: "POST",
      headers: { authorization: key, "content-type": "application/octet-stream" },
      body: new Blob([bytes]),
    });
    if (!up.ok) {
      const t = await up.text();
      if (up.status === 401) return res.status(401).json({ error: "AssemblyAI rejected the API key (401)" });
      return res.status(502).json({ error: `AssemblyAI upload failed (${up.status})`, detail: t.slice(0, 300) });
    }
    const uploadUrl = ((await up.json()) as { upload_url?: string }).upload_url;
    if (!uploadUrl) return res.status(502).json({ error: "AssemblyAI upload returned no url" });

    // 2. Request a transcript. language_detection lets a user speak any language.
    const tr = await fetch(`${AAI}/transcript`, {
      method: "POST",
      headers: { authorization: key, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: uploadUrl, language_detection: true, punctuate: true, format_text: true }),
    });
    if (!tr.ok) {
      const t = await tr.text();
      return res.status(502).json({ error: `AssemblyAI transcript request failed (${tr.status})`, detail: t.slice(0, 300) });
    }
    const id = ((await tr.json()) as { id?: string }).id;
    if (!id) return res.status(502).json({ error: "AssemblyAI returned no transcript id" });

    // 3. Poll to completion (server-side so the client awaits one request).
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const pr = await fetch(`${AAI}/transcript/${id}`, { headers: { authorization: key } });
      if (!pr.ok) continue; // transient — keep polling
      const j = (await pr.json()) as { status?: string; text?: string; error?: string; language_code?: string };
      if (j.status === "completed") {
        return res.json({ ok: true, text: (j.text ?? "").trim(), language: j.language_code ?? null });
      }
      if (j.status === "error") {
        return res.status(502).json({ error: `transcription failed: ${j.error ?? "unknown"}` });
      }
    }
    return res.status(504).json({ error: "transcription timed out — try a shorter recording" });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? String(e) });
  }
});
