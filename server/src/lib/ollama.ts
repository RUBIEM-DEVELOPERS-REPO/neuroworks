import { config } from "../config.js";

export async function ollamaGenerate(prompt: string, system?: string): Promise<string> {
  const res = await fetch(`${config.ollamaHost}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt,
      system,
      stream: false,
      options: { temperature: 0.3, num_ctx: 8192 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama ${res.status}: ${body}`);
  }
  const data = await res.json() as { response?: string };
  return (data.response ?? "").trim();
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
