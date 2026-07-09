import { Router } from "express";
import { config } from "../config.js";
import { listModels, pickModelFor, TASK_PROFILES } from "../lib/models.js";
import {
  listProviders, addProvider, removeProvider, activateProvider,
  PROVIDER_DEFAULTS, type ProviderKind,
} from "../lib/model-providers.js";

export const modelsRouter = Router();

// A small curated menu of popular Ollama models users can pull, so the UI has
// something to show beyond "type a name". Sizes are approximate download sizes.
const OLLAMA_CATALOG = [
  { name: "qwen2.5:3b", size: "1.9 GB", blurb: "Fast all-rounder — the default. Good planning/synthesis on modest hardware." },
  { name: "qwen2.5:7b", size: "4.7 GB", blurb: "Stronger reasoning; better grounded answers if you have the RAM/VRAM." },
  { name: "llama3.1:8b", size: "4.7 GB", blurb: "Meta Llama 3.1 — solid general model, strong summaries." },
  { name: "gemma2:2b", size: "1.6 GB", blurb: "Tiny + quick — great for triage and short synthesis." },
  { name: "phi3.5", size: "2.2 GB", blurb: "Microsoft Phi-3.5 — small, capable reasoner." },
  { name: "mistral", size: "4.1 GB", blurb: "Mistral 7B — reliable general-purpose model." },
  { name: "nomic-embed-text", size: "274 MB", blurb: "Embeddings model for semantic search/RAG." },
  { name: "deepseek-r1:7b", size: "4.7 GB", blurb: "Reasoning-tuned; slower but stronger on multi-step logic." },
];

// All locally available models with their capability scores, plus the router's
// recommendation per task profile. Used by the UI to show "for planning we use
// qwen2.5:3b, for synthesis we use gemma2:2b" — and surfaces gaps (e.g. "no
// strong reasoning model installed; consider pulling qwen2.5:7b").
modelsRouter.get("/", async (_req, res) => {
  const models = await listModels();
  const recommendations: Record<string, string> = {};
  for (const profile of Object.keys(TASK_PROFILES) as (keyof typeof TASK_PROFILES)[]) {
    recommendations[profile] = await pickModelFor(profile, config.ollamaModel);
  }
  res.json({
    default: config.ollamaModel,
    models,
    recommendations,
    profiles: TASK_PROFILES,
  });
});

// Set the runtime default model. In-memory only — env wins again on restart.
// This is the model used as the fallback when a task doesn't specify a profile.
// (The router's profile picks still operate on capability scoring, so changing
// the default mostly affects code paths that bypass the router with config.ollamaModel.)
modelsRouter.post("/default", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const models = await listModels();
  if (!models.find(m => m.name === name)) {
    return res.status(404).json({ error: `model not pulled locally: ${name}`, available: models.map(m => m.name) });
  }
  const previous = config.ollamaModel;
  config.ollamaModel = name;
  res.json({ default: name, previous, ephemeral: true, hint: "Restart resets to OLLAMA_MODEL in clawbot/.env." });
});

// Curated catalog of pullable Ollama models, with which are already installed.
modelsRouter.get("/catalog", async (_req, res) => {
  const installed = new Set((await listModels()).map(m => m.name));
  res.json({ catalog: OLLAMA_CATALOG.map(m => ({ ...m, installed: installed.has(m.name) })) });
});

// Pull an Ollama model, streaming progress to the client as SSE. Proxies
// Ollama's /api/pull NDJSON stream.
modelsRouter.post("/pull", async (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (event: string, data: any) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ } };

  try {
    const r = await fetch(`${config.ollamaHost}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stream: true }),
    });
    if (!r.ok || !r.body) { send("error", { error: `ollama pull failed: HTTP ${r.status}` }); return res.end(); }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          if (obj.error) send("error", { error: obj.error });
          else send("progress", { status: obj.status, completed: obj.completed, total: obj.total });
        } catch { /* skip partial */ }
      }
    }
    send("done", { name });
  } catch (e: any) {
    send("error", { error: e?.message ?? String(e) });
  } finally {
    res.end();
  }
});

// Remove a locally-pulled Ollama model.
modelsRouter.delete("/installed/:name", async (req, res) => {
  const name = req.params.name;
  try {
    const r = await fetch(`${config.ollamaHost}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!r.ok) return res.status(502).json({ error: `ollama delete failed: HTTP ${r.status}` });
    res.json({ ok: true, removed: name });
  } catch (e: any) {
    res.status(502).json({ error: e?.message ?? String(e) });
  }
});

// ── Bring-your-own model providers (cloud APIs the user already uses) ────────

modelsRouter.get("/providers", (_req, res) => {
  res.json({ providers: listProviders(), kinds: PROVIDER_DEFAULTS, active: config.openrouterEnabled ? { model: config.openrouterModel, baseUrl: config.openrouterBaseUrl } : null });
});

modelsRouter.post("/providers", (req, res) => {
  try {
    const kind = String(req.body?.kind ?? "") as ProviderKind;
    if (!PROVIDER_DEFAULTS[kind]) return res.status(400).json({ error: `unknown provider kind "${kind}"` });
    if (!req.body?.apiKey) return res.status(400).json({ error: "apiKey is required" });
    if (!req.body?.model) return res.status(400).json({ error: "model is required" });
    const p = addProvider({
      label: req.body?.label ? String(req.body.label) : undefined,
      kind,
      baseUrl: req.body?.baseUrl ? String(req.body.baseUrl) : undefined,
      model: String(req.body.model),
      apiKey: String(req.body.apiKey),
      active: req.body?.active !== false,
    });
    res.json({ provider: p });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

modelsRouter.post("/providers/:id/activate", (req, res) => {
  const p = activateProvider(req.params.id);
  if (!p) return res.status(404).json({ error: "provider not found" });
  res.json({ provider: p });
});

modelsRouter.delete("/providers/:id", (req, res) => {
  const ok = removeProvider(req.params.id);
  if (!ok) return res.status(404).json({ error: "provider not found" });
  res.json({ ok: true });
});
