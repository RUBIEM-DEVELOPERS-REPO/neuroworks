import { config } from "../config.js";

export type OpenRouterCallOptions = {
  model?: string;
  onToken?: (chunk: string, accumulated: string) => void;
  temperature?: number;
  maxTokens?: number;
};

// Transient = worth retrying / falling back, NOT a config problem. 429 is the
// big one for free-tier models ("temporarily rate-limited upstream"); 5xx are
// provider hiccups. Errors carrying `transient: true` tell the llm-router it
// may fall back to the local model instead of failing the whole task.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = Math.max(1, Number(process.env.CLAWBOT_OR_MAX_ATTEMPTS ?? "3"));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// Exponential backoff: ~0.5s, 1s, 2s … capped at 8s.
const backoffMs = (attempt: number) => Math.min(8_000, 500 * 2 ** (attempt - 1));

export function isTransientError(e: unknown): boolean {
  return !!(e && typeof e === "object" && (e as { transient?: boolean }).transient === true);
}
function markTransient(e: Error): Error {
  (e as { transient?: boolean }).transient = true;
  return e;
}
function looksTransientMsg(msg: string): boolean {
  return /\b429\b|rate.?limit|temporarily|provider returned error|overloaded|timed? ?out/i.test(msg);
}

// Streaming chat completion against OpenRouter's OpenAI-compatible endpoint.
// Returns the full text and the resolved model name.
//
// Why streaming: undici (Node fetch) imposes a 5-minute body-read deadline.
// Each chunk resets that timer, so long generations don't get killed.
export async function openrouterGenerateWithMeta(
  prompt: string,
  system: string | undefined,
  opts: OpenRouterCallOptions = {},
): Promise<{ text: string; model: string }> {
  if (!config.openrouterApiKey) throw new Error("OpenRouter: OPENROUTER_API_KEY not set");
  const model = opts.model ?? config.openrouterModel;
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15 * 60_000);
  try {
    // Establish the streaming response with retry-on-transient. Retries happen
    // BEFORE any token is emitted, so the consumer never sees partial output
    // from a doomed attempt. Honours a Retry-After header when present.
    let res: Response;
    for (let attempt = 1; ; attempt++) {
      let r: Response;
      try {
        r = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.openrouterApiKey}`,
            // OpenRouter uses these to track per-app usage on dashboards and to
            // gate access to free-tier models. Required for production traffic.
            "HTTP-Referer": config.openrouterAppUrl,
            "X-Title": config.openrouterAppName,
          },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            temperature: opts.temperature ?? 0.3,
            max_tokens: opts.maxTokens ?? 1024,
          }),
          signal: ctrl.signal,
        });
      } catch (e: any) {
        // Network-level failure (DNS, reset, abort) — transient, retry.
        if (attempt < MAX_ATTEMPTS) { await sleep(backoffMs(attempt)); continue; }
        throw markTransient(new Error(`OpenRouter request failed after ${attempt} attempts: ${e?.message ?? e}`));
      }
      if (r.ok) { res = r; break; }
      const body = await r.text();
      if (TRANSIENT_STATUS.has(r.status) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(r.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : backoffMs(attempt);
        console.warn(`[openrouter] ${r.status} on ${model} (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      // Exhausted retries or a non-transient status (401/403/400/404) — throw.
      const err = new Error(`OpenRouter ${r.status}: ${body.slice(0, 400)}`);
      if (TRANSIENT_STATUS.has(r.status)) markTransient(err);
      throw err;
    }
    if (!res.body) throw new Error("OpenRouter: empty response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let response = "";
    let resolvedModel = model;

    // SSE format — each event is "data: { ... }\n\n" with a final "data: [DONE]".
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as {
            choices?: { delta?: { content?: string }; finish_reason?: string }[];
            model?: string;
            error?: { message: string };
          };
          if (evt.error) {
            // Free models sometimes 200 then stream a rate-limit error object.
            const e = new Error(`OpenRouter: ${evt.error.message}`);
            if (looksTransientMsg(evt.error.message)) markTransient(e);
            throw e;
          }
          if (evt.model) resolvedModel = evt.model;
          const delta = evt.choices?.[0]?.delta?.content;
          if (delta) {
            response += delta;
            if (opts.onToken) {
              try { opts.onToken(delta, response); } catch { /* consumer error — ignore */ }
            }
          }
        } catch (e: any) {
          if (e.message?.startsWith("OpenRouter: ")) throw e;
          // malformed SSE chunk — OR occasionally splits a JSON across reads
        }
      }
    }
    return { text: response.trim(), model: resolvedModel };
  } finally {
    clearTimeout(timer);
  }
}

export async function openrouterGenerate(
  prompt: string,
  system?: string,
  opts: OpenRouterCallOptions = {},
): Promise<string> {
  return (await openrouterGenerateWithMeta(prompt, system, opts)).text;
}

// Quick liveness check — hits /models (cheap, unauthenticated for listing).
// Returns ok=true when key is set AND the API responds. Used by /api/status.
export async function openrouterHealth(): Promise<{ ok: boolean; model: string; error?: string }> {
  if (!config.openrouterApiKey) return { ok: false, model: config.openrouterModel, error: "OPENROUTER_API_KEY not set" };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`${config.openrouterBaseUrl}/models`, {
        headers: { "Authorization": `Bearer ${config.openrouterApiKey}` },
        signal: ctrl.signal,
      });
      if (!res.ok) return { ok: false, model: config.openrouterModel, error: `HTTP ${res.status}` };
      return { ok: true, model: config.openrouterModel };
    } finally {
      clearTimeout(timer);
    }
  } catch (e: any) {
    return { ok: false, model: config.openrouterModel, error: String(e?.message ?? e) };
  }
}
