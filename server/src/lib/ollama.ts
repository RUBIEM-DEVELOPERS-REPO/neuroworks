// Thin compatibility shim. The actual LLM dispatch (Ollama vs OpenRouter) lives
// in ./llm.ts. We re-export under the legacy `ollama*` names so existing call
// sites — which were written before OpenRouter routing existed — keep working
// without a rename. New code should import from ./llm.js directly.

import { config } from "../config.js";
export { llmGenerate as ollamaGenerate, llmGenerateWithMeta as ollamaGenerateWithMeta } from "./llm.js";
export type { LLMCallOptions as OllamaCallOptions } from "./llm.js";

// Ollama-specific liveness check. Verifies the configured local model is pulled.
// /api/status calls this directly to render the Ollama row regardless of which
// backend is currently primary.
export async function ollamaHealth(): Promise<{ ok: boolean; model: string; error?: string }> {
  try {
    const res = await fetch(`${config.ollamaHost}/api/tags`);
    if (!res.ok) return { ok: false, model: config.ollamaModel, error: `HTTP ${res.status}` };
    const data = await res.json() as { models?: { name: string }[] };
    const names = (data.models ?? []).map(m => m.name);
    return {
      ok: names.includes(config.ollamaModel),
      model: config.ollamaModel,
      error: names.includes(config.ollamaModel) ? undefined : `model not pulled (have: ${names.join(", ") || "none"})`,
    };
  } catch (e: any) {
    return { ok: false, model: config.ollamaModel, error: e.message };
  }
}
