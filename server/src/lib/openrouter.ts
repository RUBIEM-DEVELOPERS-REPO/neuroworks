import { config } from "../config.js";

export type OpenRouterCallOptions = {
  model?: string;
  onToken?: (chunk: string, accumulated: string) => void;
  temperature?: number;
  maxTokens?: number;
};

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
    const res = await fetch(`${config.openrouterBaseUrl}/chat/completions`, {
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
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 400)}`);
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
          if (evt.error) throw new Error(`OpenRouter: ${evt.error.message}`);
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
