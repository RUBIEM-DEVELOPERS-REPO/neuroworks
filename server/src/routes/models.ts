import { Router } from "express";
import { config } from "../config.js";
import { listModels, pickModelFor, TASK_PROFILES } from "../lib/models.js";

export const modelsRouter = Router();

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
