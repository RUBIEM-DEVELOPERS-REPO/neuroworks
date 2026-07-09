// HeyGen — AI avatar / spokesperson video generation.
//
// HeyGen turns a script into a talking-head presenter video (an avatar speaking
// your text in a chosen voice). It's an ASYNC API: you create a job, get a
// video_id, then poll status until it's "completed" and returns a video URL.
//
// Auth is a plain X-Api-Key header (NOT Bearer). Gated on HEYGEN_API_KEY — when
// unset, every call returns a friendly "not configured" error rather than
// throwing, so the capability simply isn't offered.
//
// Docs: https://docs.heygen.com — v2 generate + avatars/voices, v1 status.

import { config } from "../config.js";

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_WAIT_MS = 8 * 60_000; // avatar renders can take a few minutes

function headers(): Record<string, string> {
  return { "X-Api-Key": config.heygenApiKey, "Content-Type": "application/json", accept: "application/json" };
}

async function heygenFetch(path: string, init?: RequestInit): Promise<any> {
  const url = path.startsWith("http") ? path : `${config.heygenBaseUrl}${path}`;
  const r = await fetch(url, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  if (!r.ok) {
    const msg = body?.error?.message ?? body?.message ?? (typeof body === "string" ? body.slice(0, 200) : `HTTP ${r.status}`);
    throw new Error(`HeyGen ${r.status}: ${msg}`);
  }
  return body;
}

export type HeygenAvatar = { avatar_id: string; avatar_name?: string; gender?: string; preview_image_url?: string };
export type HeygenVoice = { voice_id: string; name?: string; language?: string; gender?: string };

// List the avatars available on the account (so a caller can pick avatar_id).
export async function heygenListAvatars(limit = 40): Promise<HeygenAvatar[]> {
  const body = await heygenFetch("/v2/avatars");
  const avatars: HeygenAvatar[] = body?.data?.avatars ?? body?.avatars ?? [];
  return avatars.slice(0, limit);
}

// List the voices available (so a caller can pick voice_id).
export async function heygenListVoices(limit = 40): Promise<HeygenVoice[]> {
  const body = await heygenFetch("/v2/voices");
  const voices: HeygenVoice[] = body?.data?.voices ?? body?.voices ?? [];
  return voices.slice(0, limit);
}

export type HeygenGenerateInput = {
  script: string;
  avatarId?: string;   // defaults to the first account avatar when omitted
  voiceId?: string;    // defaults to the first account voice when omitted
  width?: number;
  height?: number;
  background?: string; // solid colour hex, e.g. "#ffffff"
  title?: string;
};

// Create a video job. Returns the video_id to poll. Resolves default avatar/voice
// from the account if the caller didn't specify (HeyGen requires both).
export async function heygenCreateVideo(input: HeygenGenerateInput): Promise<{ videoId: string; avatarId: string; voiceId: string }> {
  let avatarId = input.avatarId?.trim();
  let voiceId = input.voiceId?.trim();
  if (!avatarId) { const a = await heygenListAvatars(1); avatarId = a[0]?.avatar_id; }
  if (!voiceId) { const v = await heygenListVoices(1); voiceId = v[0]?.voice_id; }
  if (!avatarId) throw new Error("no HeyGen avatar available — create one in your HeyGen account or pass avatarId");
  if (!voiceId) throw new Error("no HeyGen voice available — pass voiceId");

  const payload: any = {
    video_inputs: [{
      character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
      voice: { type: "text", input_text: input.script, voice_id: voiceId },
      ...(input.background ? { background: { type: "color", value: input.background } } : {}),
    }],
    dimension: { width: input.width ?? 1280, height: input.height ?? 720 },
    ...(input.title ? { title: input.title } : {}),
  };
  const body = await heygenFetch("/v2/video/generate", { method: "POST", body: JSON.stringify(payload) });
  const videoId = body?.data?.video_id ?? body?.video_id;
  if (!videoId) throw new Error(`HeyGen: no video_id in response (${JSON.stringify(body).slice(0, 200)})`);
  return { videoId, avatarId, voiceId };
}

export type HeygenStatus = { status: string; videoUrl?: string; thumbnailUrl?: string; error?: string };

export async function heygenVideoStatus(videoId: string): Promise<HeygenStatus> {
  const body = await heygenFetch(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
  const d = body?.data ?? body ?? {};
  return { status: d.status ?? "unknown", videoUrl: d.video_url, thumbnailUrl: d.thumbnail_url, error: d.error?.message ?? (typeof d.error === "string" ? d.error : undefined) };
}

// Create + poll until the render finishes (or times out). This is the one an
// agent primitive calls: give it a script, get back a playable video URL.
export async function heygenGenerateAndWait(input: HeygenGenerateInput, opts: { maxWaitMs?: number } = {}): Promise<{ videoId: string; videoUrl: string; avatarId: string; voiceId: string; waitedMs: number }> {
  const { videoId, avatarId, voiceId } = await heygenCreateVideo(input);
  const deadline = Date.now() + (opts.maxWaitMs ?? DEFAULT_WAIT_MS);
  const t0 = Date.now();
  // Small grace before first poll — the job won't be ready instantly.
  await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  while (Date.now() < deadline) {
    const st = await heygenVideoStatus(videoId);
    if (st.status === "completed" && st.videoUrl) return { videoId, videoUrl: st.videoUrl, avatarId, voiceId, waitedMs: Date.now() - t0 };
    if (st.status === "failed") throw new Error(`HeyGen render failed: ${st.error ?? "unknown error"} (video_id ${videoId})`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`HeyGen render timed out after ${Math.round((opts.maxWaitMs ?? DEFAULT_WAIT_MS) / 1000)}s (video_id ${videoId} still processing — poll media status later)`);
}

// Lightweight reachability check for /api/status/llm-style health surfacing.
export async function heygenHealth(): Promise<{ ok: boolean; error?: string }> {
  if (!config.heygenEnabled) return { ok: false, error: "disabled (no HEYGEN_API_KEY)" };
  try { await heygenListVoices(1); return { ok: true }; }
  catch (e: any) { return { ok: false, error: String(e?.message ?? e).slice(0, 160) }; }
}
