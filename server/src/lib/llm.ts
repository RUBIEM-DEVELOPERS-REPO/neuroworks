import { config } from "../config.js";
import { pickModelFor, type TaskNeeds } from "./models.js";
import { openrouterGenerateWithMeta, openrouterHealth, isTransientError } from "./openrouter.js";

export type LLMCallOptions = {
  model?: string;
  profile?: "planning" | "synthesis" | "triage" | "extraction" | "balanced";
  needs?: TaskNeeds;
  onToken?: (chunk: string, accumulated: string) => void;
  // Explicit complexity hint from the caller. "high" forces the LARGE OR
  // model when OR is available (great for big synthesis with lots of
  // evidence, deep reasoning, code-heavy analysis). "normal" is the default.
  // The size-based heuristic also marks calls as "high" automatically.
  complexity?: "normal" | "high";
  // Hard cap on tokens the model can generate. Maps to Ollama's `num_predict`
  // and OpenRouter's `max_tokens`. Useful for simple-task synth (~250 words is
  // plenty), triage (one word), or quality.check (small JSON). Tighter caps
  // mean the model stops generating sooner, which on local Ollama is the
  // dominant cost on simple tasks. Default is 1024 (~750 words).
  maxTokens?: number;
  // Override the default sampling temperature (Ollama default 0.3, OR default
  // 0.3). Pass 0 to pin deterministic output — useful for scorers/graders
  // where run-to-run noise corrupts the metric. Applies to both backends.
  temperature?: number;
  // Notified once when the dispatcher picks a backend + model. Lets the
  // caller surface routing decisions in customer-facing logs (e.g. push
  // "Bumped to GPT-4o for the synth — 8k tokens of evidence" into the chat
  // run log so customers can see when their request used a big model and
  // when it stayed local). Fires BEFORE the LLM call begins.
  onRoutingDecision?: (info: { backend: Backend; model: string; reason?: string; tokenEstimate: number }) => void;
};

export type Backend = "ollama" | "openrouter";

const PROFILE_ENV_KEYS: Record<NonNullable<LLMCallOptions["profile"]>, string> = {
  planning:   "OPENROUTER_PLAN_MODEL",
  synthesis:  "OPENROUTER_SYNTH_MODEL",
  triage:     "OPENROUTER_TRIAGE_MODEL",
  extraction: "OPENROUTER_EXTRACT_MODEL",
  balanced:   "OPENROUTER_BALANCED_MODEL",
};

// OR model names always contain a slash provider prefix (e.g. "openai/gpt-4o-mini",
// "anthropic/claude-3.5-haiku"). Ollama tags use ":" for the param suffix
// (e.g. "qwen2.5:3b"). This lets a caller hand us an explicit model name and
// we route to the right backend without an extra flag.
function looksRemote(modelName: string): boolean {
  return modelName.includes("/");
}

function pickOpenRouterModelFor(profile: LLMCallOptions["profile"]): string {
  if (profile) {
    const envName = process.env[PROFILE_ENV_KEYS[profile]]?.trim();
    if (envName) return envName;
  }
  return config.openrouterModel;
}

// Pick the LARGE-tier OR model. Used when:
//   • caller passed complexity: "high" explicitly
//   • prompt was auto-routed because it exceeds local context budget
// Per-profile env pins still win (they're explicit), but only if the per-
// profile model name *looks* large itself — otherwise we override to the
// large default. This keeps "complex synth uses Sonnet" working even when
// the user pinned OPENROUTER_SYNTH_MODEL=openai/gpt-4o-mini.
function pickLargeOpenRouterModel(profile: LLMCallOptions["profile"]): string {
  // Respect per-profile pin only if it's NOT the small default (heuristic:
  // gpt-4o-mini / haiku / mistral-7b are small; full gpt-4o / sonnet / opus
  // are large). When the pin equals the small default OR a known-mini
  // identifier, we override to OPENROUTER_LARGE_MODEL.
  const pin = profile ? process.env[PROFILE_ENV_KEYS[profile]]?.trim() : "";
  if (pin && !/mini|haiku|nano|7b|small|flash/i.test(pin) && pin !== config.openrouterModel) {
    return pin;
  }
  return config.openrouterLargeModel;
}

// Decide whether a given profile should route to OpenRouter.
//   1. OR must be enabled (key present)
//   2. AND either: profile has its own OPENROUTER_<PROFILE>_MODEL env pin,
//      OR profile is listed in OPENROUTER_PROFILES,
//      OR OPENROUTER_PROFILES is empty AND no Ollama-side env pin exists
//      (treating an unconfigured profile as "OR is the default if enabled").
//
// The empty-profiles fallback only kicks in when OPENROUTER_PROFILES is
// genuinely unset. If the user sets OPENROUTER_PROFILES=planning, they're
// scoping OR to ONLY planning — synthesis stays on Ollama.
function shouldRouteToOpenRouter(profile?: LLMCallOptions["profile"]): boolean {
  if (!config.openrouterEnabled) return false;
  if (!profile) return false;
  // SPECIAL CASE: triage stays LOCAL by default even when OR is enabled.
  // Triage is a yes/no classifier with a 16-token output budget; bouncing
  // it to a remote API just adds network latency for zero quality lift.
  // Explicit opt-in via OPENROUTER_TRIAGE_MODEL or listing triage in
  // OPENROUTER_PROFILES.
  if (profile === "triage") {
    if (process.env[PROFILE_ENV_KEYS[profile]]?.trim()) return true;
    return config.openrouterProfiles.includes(profile);
  }
  if (process.env[PROFILE_ENV_KEYS[profile]]?.trim()) return true;
  if (config.openrouterProfiles.length > 0) return config.openrouterProfiles.includes(profile);
  return true;
}

// Approximate token count for a string. Real tokenisation costs a tokenizer
// load + per-string call we don't want on the hot path. ~4 chars/token is a
// reasonable mid-point across English prose, code, and JSON — good enough to
// decide "this is big enough to overflow local context".
function estimateTokens(s: string | undefined): number {
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}

// Local Ollama context window for our default model. qwen2.5:3b ships with
// 8k context (we also set num_ctx=8192 in ollama-side opts). Anything over
// ~6k input tokens leaves no room for output — those calls SHOULD route to
// OR which has 128k+ on gpt-4o-mini. Tunable via env so a user with a 32k
// local model can raise the bar.
const LOCAL_CONTEXT_BUDGET_TOKENS = Number(process.env.CLAWBOT_LOCAL_CTX_BUDGET ?? "6000");
// Hard-complexity fallback: even if OR profiles aren't configured, a call
// over this size goes to OR when the key is set. Saves the customer from
// silent context-overflow truncation on Ollama. Set CLAWBOT_LOCAL_CTX_BUDGET=0
// to disable this complexity-based override entirely.
function isTooBigForLocal(prompt: string, system: string | undefined): boolean {
  if (LOCAL_CONTEXT_BUDGET_TOKENS <= 0) return false;
  const total = estimateTokens(prompt) + estimateTokens(system);
  return total > LOCAL_CONTEXT_BUDGET_TOKENS;
}

async function chooseBackendAndModel(opts: LLMCallOptions, prompt: string, system: string | undefined): Promise<{ backend: Backend; model: string; reason?: string }> {
  // Complexity inference: either explicit ("high") or size-based.
  const sizeTriggered = isTooBigForLocal(prompt, system);
  const isComplex = opts.complexity === "high" || sizeTriggered;

  if (opts.model) {
    if (looksRemote(opts.model) && config.openrouterEnabled) {
      return { backend: "openrouter", model: opts.model, reason: `explicit remote model "${opts.model}"` };
    }
    // Explicit local model that's too big for local context → bump to OR
    // (if available) with the LARGE-tier OR model. The caller asked for a
    // specific local model but a 10k-token prompt won't fit; better a strong
    // remote model that handles the load than the local one that truncates.
    if (config.openrouterEnabled && isComplex) {
      const model = pickLargeOpenRouterModel(opts.profile);
      return {
        backend: "openrouter",
        model,
        reason: opts.complexity === "high"
          ? `caller flagged complexity:"high" — handing off to large model ${model}`
          : `prompt ~${estimateTokens(prompt) + estimateTokens(system)} tokens exceeds local context budget (${LOCAL_CONTEXT_BUDGET_TOKENS}) — auto-handoff to large model ${model}`,
      };
    }
    return { backend: "ollama", model: opts.model };
  }
  // Profile-based routing wins next — but if it's also complex, upgrade to the
  // large-tier model instead of the small default.
  if (shouldRouteToOpenRouter(opts.profile)) {
    if (isComplex) {
      const model = pickLargeOpenRouterModel(opts.profile);
      return { backend: "openrouter", model, reason: `profile "${opts.profile}" + complex task — handoff to large model ${model}` };
    }
    return { backend: "openrouter", model: pickOpenRouterModelFor(opts.profile), reason: `profile "${opts.profile}" routed to OpenRouter via config` };
  }
  // Complexity override: even when the profile would have stayed local, a
  // huge prompt won't fit in local context. Bump it to OR's LARGE-tier.
  if (config.openrouterEnabled && isComplex) {
    const model = pickLargeOpenRouterModel(opts.profile);
    return {
      backend: "openrouter",
      model,
      reason: opts.complexity === "high"
        ? `caller flagged complexity:"high" — handoff to large model ${model}`
        : `prompt ~${estimateTokens(prompt) + estimateTokens(system)} tokens exceeds local context budget (${LOCAL_CONTEXT_BUDGET_TOKENS}) — auto-handoff to large model ${model}`,
    };
  }
  if (opts.profile) {
    return { backend: "ollama", model: await pickModelFor(opts.profile, config.ollamaModel) };
  }
  return { backend: "ollama", model: config.ollamaModel };
}

// Raw Ollama streaming call — same as the original ollamaGenerate body but
// without the routing logic (that's now upstream in llmGenerateWithMeta).
async function callOllamaStream(prompt: string, system: string | undefined, model: string, onToken?: LLMCallOptions["onToken"], maxTokens?: number, temperature?: number): Promise<{ text: string; model: string }> {
  // qwen3 ships with reasoning mode on by default. The /no_think directive in
  // the SYSTEM prompt (not user) suppresses the <think>…</think> block.
  const isQwen3 = /qwen3/i.test(model) && !/qwen3\.5/i.test(model);
  const sys = isQwen3 ? `${system ?? ""}\n/no_think`.trim() : system;
  const numPredict = typeof maxTokens === "number" && maxTokens > 0 ? Math.min(8192, Math.max(8, Math.floor(maxTokens))) : 1024;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15 * 60_000);
  try {
    const res = await fetch(`${config.ollamaHost}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        system: sys,
        stream: true,
        think: false,
        options: { temperature: typeof temperature === "number" ? temperature : 0.3, num_ctx: 8192, num_predict: numPredict },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status}: ${body}`);
    }
    if (!res.body) throw new Error("Ollama: empty response body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let response = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line) as { response?: string; error?: string };
          if (evt.error) throw new Error(`Ollama: ${evt.error}`);
          if (evt.response) {
            response += evt.response;
            if (onToken) { try { onToken(evt.response, response); } catch { /* consumer error */ } }
          }
        } catch (e: any) {
          if (e.message?.startsWith("Ollama: ")) throw e;
          // tolerate malformed line — Ollama sometimes splits a JSON across reads
        }
      }
    }
    return { text: response.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(), model };
  } finally {
    clearTimeout(timer);
  }
}

// Unified entry point. Dispatches to OpenRouter or Ollama based on routing
// rules and returns both the text and the model that actually answered, so
// step-level provenance shows up in StepRun + the vault journal.
//
// OpenRouter failures split two ways. CONFIG errors (401/403/400, unknown
// model) still throw — silent fallback there would mask a real misconfig.
// TRANSIENT errors (429 rate-limit, 5xx, network) instead fall back to the
// local Ollama model when no token has streamed yet, so a temporary upstream
// rate-limit doesn't fail the whole task with a partial result. Disable the
// fallback with CLAWBOT_OR_FALLBACK_OLLAMA=0.
export async function llmGenerateWithMeta(prompt: string, system?: string, opts: LLMCallOptions = {}): Promise<{ text: string; model: string }> {
  const { backend, model, reason } = await chooseBackendAndModel(opts, prompt, system);
  const tokenEstimate = estimateTokens(prompt) + estimateTokens(system);
  // Customer-facing notification: caller decides whether to push the
  // routing decision into the chat run log. We pass enough context for the
  // caller to render "thinking with <model> because <reason>" themselves.
  if (opts.onRoutingDecision) {
    try { opts.onRoutingDecision({ backend, model, reason, tokenEstimate }); } catch { /* consumer error */ }
  }
  // One-line stdout breadcrumb when the complexity-based override kicks in,
  // so a customer scanning the server log can see "this synth was bumped to
  // OR because it was 8k tokens" without digging through job logs.
  if (reason && (reason.includes("auto-routed") || reason.includes("auto-handoff") || reason.includes("complex task"))) {
    console.log(`[llm] ${reason} (profile=${opts.profile ?? "none"})`);
  }
  if (backend === "openrouter") {
    // Track whether any token reached the consumer. A transient failure
    // (429/5xx) BEFORE streaming starts can fall back to the local model
    // cleanly; once tokens have streamed, falling back would double-emit, so
    // we rethrow. A 429 is rate-limiting, not the config error the original
    // no-fallback rule guarded against — so failing the whole task is wrong.
    let streamed = false;
    const onToken = opts.onToken
      ? (chunk: string, acc: string) => { streamed = true; opts.onToken!(chunk, acc); }
      : undefined;
    try {
      return await openrouterGenerateWithMeta(prompt, system, { model, onToken, maxTokens: opts.maxTokens, temperature: opts.temperature });
    } catch (e: any) {
      const fallbackOn = process.env.CLAWBOT_OR_FALLBACK_OLLAMA !== "0";
      if (isTransientError(e) && fallbackOn && !streamed) {
        const localModel = opts.profile ? await pickModelFor(opts.profile, config.ollamaModel) : config.ollamaModel;
        console.warn(`[llm] OpenRouter transient failure — falling back to local ${localModel}: ${String(e?.message ?? e).slice(0, 140)}`);
        if (opts.onRoutingDecision) {
          try { opts.onRoutingDecision({ backend: "ollama", model: localModel, reason: `OpenRouter rate-limited/unavailable — fell back to local ${localModel}`, tokenEstimate }); } catch { /* consumer error */ }
        }
        return callOllamaStream(prompt, system, localModel, opts.onToken, opts.maxTokens, opts.temperature);
      }
      throw e;
    }
  }
  return callOllamaStream(prompt, system, model, opts.onToken, opts.maxTokens, opts.temperature);
}

export async function llmGenerate(prompt: string, system?: string, opts: LLMCallOptions = {}): Promise<string> {
  return (await llmGenerateWithMeta(prompt, system, opts)).text;
}

// Backwards-compat aliases — existing call sites import these names from
// `./ollama.js`. The shim in ollama.ts re-exports these.
export { llmGenerate as ollamaGenerate, llmGenerateWithMeta as ollamaGenerateWithMeta };
export type { LLMCallOptions as OllamaCallOptions };

// Combined health snapshot — reports both backends. /api/status uses this
// to render which path is live. ok=true for Ollama means the configured
// model is pulled; for OpenRouter means the API key works.
export async function llmHealth(): Promise<{
  ollama: { ok: boolean; model: string; error?: string };
  openrouter: { enabled: boolean; ok: boolean; model: string; error?: string };
  primary: Backend;
}> {
  const [ollama, or] = await Promise.all([
    (async () => {
      try {
        const res = await fetch(`${config.ollamaHost}/api/tags`);
        if (!res.ok) return { ok: false, model: config.ollamaModel, error: `HTTP ${res.status}` };
        const data = await res.json() as { models?: { name: string }[] };
        const names = (data.models ?? []).map(m => m.name);
        return { ok: names.includes(config.ollamaModel), model: config.ollamaModel, error: names.includes(config.ollamaModel) ? undefined : `model not pulled (have: ${names.join(", ") || "none"})` };
      } catch (e: any) {
        return { ok: false, model: config.ollamaModel, error: e.message };
      }
    })(),
    config.openrouterEnabled ? openrouterHealth() : Promise.resolve({ ok: false, model: config.openrouterModel, error: "disabled (no OPENROUTER_API_KEY)" }),
  ]);
  // "Primary" reflects which backend handles a generic /balanced call. If OR is
  // enabled AND set as the balanced profile, it's primary. Otherwise Ollama.
  const primary: Backend = shouldRouteToOpenRouter("balanced") ? "openrouter" : "ollama";
  return {
    ollama,
    openrouter: { enabled: config.openrouterEnabled, ...or },
    primary,
  };
}
