// MiniMax — optional hosted multimodal provider. Three capability families,
// all gated on config.minimaxEnabled (MINIMAX_API_KEY set):
//
//   • Chat   — MiniMax-M3 / M2.7 over an Anthropic-compatible /v1/messages
//              endpoint. A frontier cloud LLM the local Ollama stack can't
//              match for hard synthesis / long-context coding.
//   • Speech — text-to-speech (speech-2.8-hd/turbo). Turns any answer into a
//              narratable audio file (briefings, accessibility, voice replies).
//   • Video  — text/image-to-video (Hailuo 2.3). Async task → poll → download.
//   • Music  — text-to-music (music-2.6).
//
// Media outputs are written under .neuroworks/media and the local path is
// returned so the agent can attach / reference the artifact. Nothing here
// throws at import time; callers check config.minimaxEnabled (or catch) first.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = resolve(__dirname, "../../../.neuroworks/media");

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function ensureMediaDir(): string {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });
  return MEDIA_DIR;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.minimaxApiKey}`,
  };
}

function requireEnabled() {
  if (!config.minimaxEnabled) {
    throw new Error("MiniMax not configured — set MINIMAX_API_KEY in clawbot/.env to enable cloud LLM + media generation.");
  }
}

// ─────────────────────────── Chat (LLM) ───────────────────────────

export type MiniMaxCallOptions = { model?: string; temperature?: number; maxTokens?: number };

// Anthropic-compatible Messages call. Non-streaming — the media-free chat path
// is fast and the callers (synthesis, planning) want the whole answer. Retries
// transient (429/5xx) with exponential backoff, matching the OpenRouter client.
export async function minimaxGenerate(prompt: string, system?: string, opts: MiniMaxCallOptions = {}): Promise<string> {
  requireEnabled();
  const model = opts.model ?? config.minimaxModel;
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.3,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) body.system = system;

  const url = `${config.minimaxAnthropicUrl}/v1/messages`;
  const MAX = 3;
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10 * 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders(), "anthropic-version": "2023-06-01" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status === 401 || res.status === 403) throw new Error(`MiniMax auth failed (${res.status}) — check MINIMAX_API_KEY`);
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < MAX) { await sleep(Math.min(8000, 500 * 2 ** (attempt - 1))); continue; }
        throw new Error(`MiniMax ${res.status}: ${text.slice(0, 400)}`);
      }
      const j = JSON.parse(text) as { content?: { type: string; text?: string }[] };
      return (j.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("").trim();
    } catch (e: any) {
      if (e?.name === "AbortError" && attempt < MAX) { await sleep(500 * attempt); continue; }
      if (attempt >= MAX) throw e;
      await sleep(500 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─────────────────────────── Speech (TTS) ───────────────────────────

export type TtsOptions = { model?: string; voiceId?: string; speed?: number; emotion?: string; format?: "mp3" | "wav" };

// Synthesise speech and write it to .neuroworks/media. Returns the local path
// and byte size. MiniMax t2a_v2 returns hex-encoded audio in data.audio.
export async function minimaxTts(text: string, opts: TtsOptions = {}): Promise<{ path: string; bytes: number; model: string }> {
  requireEnabled();
  if (!text.trim()) throw new Error("minimax.tts: text is required");
  const model = opts.model ?? config.minimaxTtsModel;
  const format = opts.format ?? "mp3";
  const body: Record<string, unknown> = {
    model,
    text: text.slice(0, 8000),
    stream: false,
    voice_setting: {
      voice_id: opts.voiceId ?? "male-qn-qingse",
      speed: opts.speed ?? 1.0,
      vol: 1.0,
      pitch: 0,
      ...(opts.emotion ? { emotion: opts.emotion } : {}),
    },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format, channel: 1 },
  };
  const qs = config.minimaxGroupId ? `?GroupId=${encodeURIComponent(config.minimaxGroupId)}` : "";
  const res = await fetch(`${config.minimaxBaseUrl}/t2a_v2${qs}`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`MiniMax TTS ${res.status}: ${txt.slice(0, 300)}`);
  const j = JSON.parse(txt) as { data?: { audio?: string }; base_resp?: { status_code?: number; status_msg?: string } };
  if (j.base_resp && j.base_resp.status_code && j.base_resp.status_code !== 0) {
    throw new Error(`MiniMax TTS failed: ${j.base_resp.status_msg ?? j.base_resp.status_code}`);
  }
  const hex = j.data?.audio;
  if (!hex) throw new Error(`MiniMax TTS returned no audio: ${txt.slice(0, 200)}`);
  const buf = Buffer.from(hex, "hex");
  const dir = ensureMediaDir();
  const path = join(dir, `tts-${Date.now()}.${format}`);
  writeFileSync(path, buf);
  return { path, bytes: buf.length, model };
}

// ─────────────────────────── Video ───────────────────────────

export type VideoOptions = { model?: string; firstFrameImage?: string; pollMs?: number; timeoutMs?: number };

// Async video generation: create a task, poll until done, retrieve the file's
// download URL. Returns the URL (videos are large — we don't buffer them to
// disk by default). Can take minutes; bounded by timeoutMs (default 8 min).
export async function minimaxVideo(prompt: string, opts: VideoOptions = {}): Promise<{ downloadUrl: string; taskId: string; model: string }> {
  requireEnabled();
  if (!prompt.trim()) throw new Error("minimax.video: prompt is required");
  const model = opts.model ?? config.minimaxVideoModel;
  const createBody: Record<string, unknown> = { model, prompt: prompt.slice(0, 2000) };
  if (opts.firstFrameImage) createBody.first_frame_image = opts.firstFrameImage;

  const createRes = await fetch(`${config.minimaxBaseUrl}/video_generation`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify(createBody),
  });
  const createTxt = await createRes.text();
  if (!createRes.ok) throw new Error(`MiniMax video create ${createRes.status}: ${createTxt.slice(0, 300)}`);
  const created = JSON.parse(createTxt) as { task_id?: string; base_resp?: { status_code?: number; status_msg?: string } };
  const taskId = created.task_id;
  if (!taskId) throw new Error(`MiniMax video create returned no task_id: ${createTxt.slice(0, 200)}`);

  const pollMs = Math.max(3000, opts.pollMs ?? 8000);
  const deadline = Date.now() + (opts.timeoutMs ?? 8 * 60_000);
  let fileId = "";
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const q = await fetch(`${config.minimaxBaseUrl}/query/video_generation?task_id=${encodeURIComponent(taskId)}`, { headers: authHeaders() });
    if (!q.ok) continue;
    const qj = await q.json().catch(() => ({})) as { status?: string; file_id?: string };
    if (qj.status === "Success" && qj.file_id) { fileId = qj.file_id; break; }
    if (qj.status === "Fail") throw new Error(`MiniMax video generation failed (task ${taskId})`);
  }
  if (!fileId) throw new Error(`MiniMax video timed out after ${Math.round((opts.timeoutMs ?? 480000) / 1000)}s (task ${taskId})`);

  const qs = config.minimaxGroupId ? `&GroupId=${encodeURIComponent(config.minimaxGroupId)}` : "";
  const fileRes = await fetch(`${config.minimaxBaseUrl}/files/retrieve?file_id=${encodeURIComponent(fileId)}${qs}`, { headers: authHeaders() });
  const fileTxt = await fileRes.text();
  if (!fileRes.ok) throw new Error(`MiniMax file retrieve ${fileRes.status}: ${fileTxt.slice(0, 300)}`);
  const fj = JSON.parse(fileTxt) as { file?: { download_url?: string } };
  const downloadUrl = fj.file?.download_url;
  if (!downloadUrl) throw new Error(`MiniMax file retrieve returned no download_url: ${fileTxt.slice(0, 200)}`);
  return { downloadUrl, taskId, model };
}

// ─────────────────────────── Music ───────────────────────────

export type MusicOptions = { model?: string; lyrics?: string };

// Text-to-music. Returns a local audio path. The music_generation endpoint
// returns hex audio in data.audio, like TTS.
export async function minimaxMusic(prompt: string, opts: MusicOptions = {}): Promise<{ path: string; bytes: number; model: string }> {
  requireEnabled();
  if (!prompt.trim()) throw new Error("minimax.music: prompt is required");
  const model = opts.model ?? config.minimaxMusicModel;
  const body: Record<string, unknown> = {
    model,
    prompt: prompt.slice(0, 600),
    lyrics: (opts.lyrics ?? "").slice(0, 3000),
    audio_setting: { sample_rate: 44100, bitrate: 256000, format: "mp3" },
  };
  const res = await fetch(`${config.minimaxBaseUrl}/music_generation`, {
    method: "POST", headers: authHeaders(), body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`MiniMax music ${res.status}: ${txt.slice(0, 300)}`);
  const j = JSON.parse(txt) as { data?: { audio?: string }; base_resp?: { status_code?: number; status_msg?: string } };
  if (j.base_resp && j.base_resp.status_code && j.base_resp.status_code !== 0) {
    throw new Error(`MiniMax music failed: ${j.base_resp.status_msg ?? j.base_resp.status_code}`);
  }
  const hex = j.data?.audio;
  if (!hex) throw new Error(`MiniMax music returned no audio: ${txt.slice(0, 200)}`);
  const buf = Buffer.from(hex, "hex");
  const dir = ensureMediaDir();
  const path = join(dir, `music-${Date.now()}.mp3`);
  writeFileSync(path, buf);
  return { path, bytes: buf.length, model };
}

// ─────────────────────────── Health ───────────────────────────

export async function minimaxHealth(): Promise<{ ok: boolean; model: string; error?: string }> {
  if (!config.minimaxEnabled) return { ok: false, model: config.minimaxModel, error: "MINIMAX_API_KEY not set" };
  try {
    const r = await minimaxGenerate("ok", "Reply with a single word.", { maxTokens: 4 });
    return { ok: r.length > 0, model: config.minimaxModel };
  } catch (e: any) {
    return { ok: false, model: config.minimaxModel, error: String(e?.message ?? e) };
  }
}
