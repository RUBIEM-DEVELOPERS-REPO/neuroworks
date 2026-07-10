import { Router } from "express";
import { getExecutorConfig, setExecutorConfig, type ExecutorMode } from "../lib/executor-mode.js";
import { hermesAvailable, detectHermesBin } from "../lib/hermes.js";
import { config } from "../config.js";

// Executor mode API — flips which agent does the actual task work, LIVE (no
// server restart). "clawbot" = the built-in pipeline + persona-shifter pool;
// "hermes" = the Hermes CLI agent with persona/governance framing, and an
// automatic OFFLOAD to clawbot for anything Hermes can't do. The optional
// hermesModel overrides the configured model live.

export const executorRouter = Router();

executorRouter.get("/", (_req, res) => {
  const cfg = getExecutorConfig();
  res.json({
    mode: cfg.mode,
    hermesModelOverride: cfg.hermesModel ?? null,
    fallbackToClawbot: process.env.NEUROWORKS_HERMES_FALLBACK !== "0",
    qualityGate: process.env.NEUROWORKS_HERMES_QUALITY_GATE !== "0",
    hermes: {
      available: hermesAvailable(),
      binPath: detectHermesBin() ?? undefined,
      model: cfg.hermesModel ?? config.hermesModel,
      provider: config.hermesProvider,
    },
  });
});

// POST { mode?: "clawbot" | "hermes", hermesModel?: string | null }
executorRouter.post("/", (req, res) => {
  const body = req.body ?? {};
  const mode = body.mode as ExecutorMode | undefined;
  if (mode !== undefined && mode !== "clawbot" && mode !== "hermes") {
    return res.status(400).json({ error: 'mode must be "clawbot" or "hermes"' });
  }
  if (mode === "hermes" && !hermesAvailable()) {
    return res.status(400).json({ error: "Hermes is not installed on this machine — cannot set it as the primary executor." });
  }
  try {
    const next = setExecutorConfig({
      ...(mode !== undefined ? { mode } : {}),
      ...(body.hermesModel !== undefined ? { hermesModel: body.hermesModel } : {}),
    });
    res.json({ ok: true, mode: next.mode, hermesModelOverride: next.hermesModel ?? null });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});
