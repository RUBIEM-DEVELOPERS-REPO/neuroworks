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
const MAX_ATTEMPTS = Math.max(1, Number(process.env.NEUROWORKS_OR_MAX_ATTEMPTS ?? "3"));
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// Exponential backoff: ~0.5s, 1s, 2s … capped at 8s.
const backoffMs = (attempt: number) => Math.min(8_000, 500 * 2 ** (attempt - 1));

// Circuit breaker. Without this, during a sustained OpenRouter outage EVERY
// LLM call in a task pays the full MAX_ATTEMPTS retry+backoff tax before the
// llm-router falls back to local — turning one flaky window into minutes of
// latency (observed: a ~12-min task, most of it repeated retry cycles logged as
// "OpenRouter request failed after 3 attempts: fetch failed"). After a couple
// of consecutive failures we OPEN the circuit and fail fast (transient error →
// instant local fallback) for a cooldown, so the outage costs seconds not
// minutes. A single success closes it again.
const CB_THRESHOLD = Math.max(1, Number(process.env.NEUROWORKS_OR_CB_THRESHOLD ?? "2"));
const CB_COOLDOWN_MS = Math.max(5_000, Number(process.env.NEUROWORKS_OR_CB_COOLDOWN_MS ?? "60000"));
// Fallback hold when the FREE DAILY quota is exhausted but no reset time is
// given. The daily cap (e.g. 50 free req/day) won't recover in 60s, so re-probing
// on the normal cooldown just retry-storms all day. Hold local for an hour.
const CB_DAILY_QUOTA_HOLD_MS = Math.max(60_000, Number(process.env.NEUROWORKS_OR_DAILY_HOLD_MS ?? "3600000"));
// Hold when the PROVIDER ACCOUNT is out of credits ("Your credit balance is
// too low…" from the Anthropic-compatible endpoint, HTTP 402 / "Insufficient
// credits" from OpenRouter proper). Credits don't recover on their own — a
// human has to top up — so re-probing every 60s just fails every task's synth
// in the meantime. Hold local for 30min between probes.
const CB_BILLING_HOLD_MS = Math.max(60_000, Number(process.env.NEUROWORKS_OR_BILLING_HOLD_MS ?? "1800000"));
let cbConsecutiveFails = 0;
let cbOpenUntil = 0;
let cbDailyQuotaHit = false; // sticky: true once we've seen a free-models-per-day 429
let cbBillingHit = false;    // sticky: true once the provider said "credits exhausted"
export function openrouterCircuitOpen(): boolean { return Date.now() < cbOpenUntil; }
export function openrouterDailyQuotaExhausted(): boolean { return cbDailyQuotaHit && openrouterCircuitOpen(); }
export function openrouterBillingExhausted(): boolean { return cbBillingHit && openrouterCircuitOpen(); }
function cbRecordSuccess(): void { cbConsecutiveFails = 0; cbOpenUntil = 0; cbDailyQuotaHit = false; cbBillingHit = false; }
function cbRecordFailure(): void {
  cbConsecutiveFails += 1;
  if (cbConsecutiveFails >= CB_THRESHOLD && !openrouterCircuitOpen()) {
    cbOpenUntil = Date.now() + CB_COOLDOWN_MS;
    console.warn(`[openrouter] circuit OPEN for ${Math.round(CB_COOLDOWN_MS / 1000)}s after ${cbConsecutiveFails} consecutive failures — routing to local until it cools down`);
  }
}
// The free DAILY quota is a persistent condition, not a transient blip. Open the
// circuit until the quota resets (X-RateLimit-Reset, epoch ms) — or an hour if we
// don't know — so every call stays LOCAL for the rest of the day instead of
// paying the retry tax and leaking 429s into deliverables.
function cbTripDailyQuota(resetMs?: number): void {
  cbDailyQuotaHit = true;
  const until = (resetMs && resetMs > Date.now()) ? Math.min(resetMs, Date.now() + 24 * 3600_000) : Date.now() + CB_DAILY_QUOTA_HOLD_MS;
  if (until > cbOpenUntil) cbOpenUntil = until;
  const mins = Math.round((cbOpenUntil - Date.now()) / 60_000);
  console.warn(`[openrouter] FREE DAILY QUOTA exhausted (free-models-per-day) — circuit OPEN for ~${mins}min (until quota reset); all calls route to LOCAL until then.`);
}
function isDailyQuotaBody(body: string): boolean {
  return /free-models-per-day|free[- ]models[- ]per[- ]day/i.test(body);
}
// Provider-credit exhaustion is a PERSISTENT condition dressed up as a config
// error (Anthropic returns it as a 400 invalid_request_error). Before this
// check existed, that 400 threw non-transient → no local fallback → the synth
// failed → the customer got a raw "rescue summary" emailed out. Now it trips
// the breaker AND marks transient so the llm-router finishes the task locally.
function isBillingBody(body: string): boolean {
  return /credit balance is too low|insufficient credits|payment required|billing hard limit|plans? & billing|purchase credits/i.test(body);
}
function cbTripBilling(): void {
  cbBillingHit = true;
  const until = Date.now() + CB_BILLING_HOLD_MS;
  if (until > cbOpenUntil) cbOpenUntil = until;
  console.warn(`[openrouter] PROVIDER CREDITS EXHAUSTED — circuit OPEN for ~${Math.round(CB_BILLING_HOLD_MS / 60_000)}min; all calls route to LOCAL. Top up the provider account (or switch the active provider) to restore cloud models.`);
}

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
): Promise<{ text: string; model: string; usage?: { inputTokens: number; outputTokens: number } }> {
  if (!config.openrouterApiKey) throw new Error("OpenRouter: OPENROUTER_API_KEY not set");
  // Circuit open → fail fast so the llm-router uses local immediately instead of
  // re-discovering the outage with a full retry cycle on every call.
  if (openrouterCircuitOpen()) throw markTransient(new Error("OpenRouter circuit open (recent failures) — using local model"));
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
            // Ask for a final usage chunk even in streaming mode (OpenAI-
            // compatible spec) so cost-tracker.ts can record REAL billed
            // tokens instead of a chars/4 estimate. Without this, models
            // with invisible billed tokens the estimate can't see (e.g.
            // Claude Fable's always-on extended thinking, billed as output
            // but never returned as text) silently under-report cost.
            stream_options: { include_usage: true },
            // Claude Fable models REJECT the temperature param outright
            // (400 "`temperature` is deprecated for this model") — omit it
            // there; every other provider/model keeps the explicit value.
            ...(/^claude-fable/i.test(model) ? {} : { temperature: opts.temperature ?? 0.3 }),
            max_tokens: opts.maxTokens ?? 1024,
          }),
          signal: ctrl.signal,
        });
      } catch (e: any) {
        // Network-level failure (DNS, reset, abort) — transient, retry.
        if (attempt < MAX_ATTEMPTS) { await sleep(backoffMs(attempt)); continue; }
        cbRecordFailure(); // sustained connection failure → trip the breaker
        throw markTransient(new Error(`OpenRouter request failed after ${attempt} attempts: ${e?.message ?? e}`));
      }
      if (r.ok) { res = r; cbRecordSuccess(); break; }
      const body = await r.text();
      // FREE DAILY QUOTA (free-models-per-day) — a persistent daily cap, NOT a
      // transient blip. Do NOT retry (all attempts will 429) and open the circuit
      // until the quota resets so the whole app stays local for the rest of the
      // day. This is what was leaking a raw 429 into report deliverables.
      if (r.status === 429 && isDailyQuotaBody(body)) {
        const resetHdr = Number(r.headers.get("x-ratelimit-reset"));
        cbTripDailyQuota(Number.isFinite(resetHdr) ? resetHdr : undefined);
        throw markTransient(new Error(`OpenRouter 429 (free daily quota exhausted): ${body.slice(0, 200)}`));
      }
      // CREDITS EXHAUSTED — persistent until a human tops up. Do NOT retry,
      // trip the breaker, and mark transient so the caller falls back to the
      // local model instead of failing the task.
      if (r.status === 402 || isBillingBody(body)) {
        cbTripBilling();
        throw markTransient(new Error(`Provider credits exhausted (HTTP ${r.status}) — completed locally instead. Top up the provider account. ${body.slice(0, 200)}`));
      }
      if (TRANSIENT_STATUS.has(r.status) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(r.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10_000) : backoffMs(attempt);
        console.warn(`[openrouter] ${r.status} on ${model} (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      // Exhausted retries or a non-transient status (401/403/400/404) — throw.
      const err = new Error(`OpenRouter ${r.status}: ${body.slice(0, 400)}`);
      // A drained transient status (sustained 429/5xx) also trips the breaker so
      // the next calls skip straight to local. Config errors (401/400) do not.
      if (TRANSIENT_STATUS.has(r.status)) { markTransient(err); cbRecordFailure(); }
      throw err;
    }
    if (!res.body) throw new Error("OpenRouter: empty response body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let response = "";
    let resolvedModel = model;
    let usage: { inputTokens: number; outputTokens: number } | undefined;

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
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          if (evt.error) {
            // Free models sometimes 200 then stream a rate-limit error object.
            const e = new Error(`OpenRouter: ${evt.error.message}`);
            if (isBillingBody(evt.error.message)) { cbTripBilling(); markTransient(e); }
            else if (looksTransientMsg(evt.error.message)) markTransient(e);
            throw e;
          }
          if (evt.model) resolvedModel = evt.model;
          // Usage chunk (requested via stream_options.include_usage) arrives on
          // its own SSE event, typically after the final content delta, with an
          // empty/absent choices array — real billed counts, including any
          // invisible tokens (e.g. Fable's extended thinking) the text-length
          // estimate can't see.
          if (evt.usage && typeof evt.usage.prompt_tokens === "number" && typeof evt.usage.completion_tokens === "number") {
            usage = { inputTokens: evt.usage.prompt_tokens, outputTokens: evt.usage.completion_tokens };
          }
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
    return { text: response.trim(), model: resolvedModel, usage };
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
      // Send BOTH auth header styles: OpenAI-compatible providers use Bearer;
      // Anthropic's /v1/models requires x-api-key + anthropic-version (its
      // compat layer accepts Bearer on chat/completions but not here). Each
      // provider ignores the other's headers, so this stays provider-agnostic.
      const res = await fetch(`${config.openrouterBaseUrl}/models`, {
        headers: {
          "Authorization": `Bearer ${config.openrouterApiKey}`,
          "x-api-key": config.openrouterApiKey,
          "anthropic-version": "2023-06-01",
        },
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
