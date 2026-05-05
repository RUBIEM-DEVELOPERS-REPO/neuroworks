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
