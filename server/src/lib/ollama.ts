import { config } from "../config.js";
import { pickModelFor, type TaskNeeds } from "./models.js";

export type OllamaCallOptions = {
  // Explicit model name to use for this call. Wins over `profile`.
  model?: string;
  // Stock task profile name (planning/synthesis/triage/extraction/balanced).
  // The model router picks the best available model for this profile.
  profile?: "planning" | "synthesis" | "triage" | "extraction" | "balanced";
  // Custom needs vector — only used when neither `model` nor `profile` set.
  needs?: TaskNeeds;
};

export async function ollamaGenerate(prompt: string, system?: string, opts: OllamaCallOptions = {}): Promise<string> {
  // Pick the model: explicit override > profile-based router > config default.
  const model = opts.model
    ?? (opts.profile ? await pickModelFor(opts.profile, config.ollamaModel) : config.ollamaModel);
  // qwen3 ships with reasoning mode on by default. The /no_think directive in the
  // SYSTEM prompt (not user) suppresses the <think>…</think> block so we get the
  // answer directly. Without it, ~80% of the token budget is spent on hidden CoT
  // and short num_predict caps cut off before the JSON.
  const isQwen3 = /qwen3/i.test(model) && !/qwen3\.5/i.test(model);
  const sys = isQwen3
    ? `${system ?? ""}\n/no_think`.trim()
    : system;
  // Node fetch (undici) imposes a 5-min body-read deadline. Streaming lets each
  // chunk reset that timer, so long-running LLM calls don't get killed at 5 min.
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
        options: { temperature: 0.3, num_ctx: 8192, num_predict: 1024 },
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
          if (evt.response) response += evt.response;
        } catch (e: any) {
          if (e.message?.startsWith("Ollama: ")) throw e;
          // ignore malformed line — Ollama sometimes splits a JSON across reads
        }
      }
    }
    // Strip any stray <think>...</think> wrapper if the directive was ignored.
    return response.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function ollamaHealth(): Promise<{ ok: boolean; model: string; error?: string }> {
  try {
    const res = await fetch(`${config.ollamaHost}/api/tags`);
    if (!res.ok) return { ok: false, model: config.ollamaModel, error: `HTTP ${res.status}` };
    const data = await res.json() as { models?: { name: string }[] };
    const names = (data.models ?? []).map(m => m.name);
    return { ok: names.includes(config.ollamaModel), model: config.ollamaModel, error: names.includes(config.ollamaModel) ? undefined : `model not pulled (have: ${names.join(", ") || "none"})` };
  } catch (e: any) {
    return { ok: false, model: config.ollamaModel, error: e.message };
  }
}
