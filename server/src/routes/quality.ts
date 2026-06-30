import { Router } from "express";
import { flagQuality, getQualitySummary, getQualityFlags, getLowQualityRuns } from "../lib/quality.js";

export const qualityRouter = Router();

qualityRouter.get("/summary", (_req, res) => {
  res.json(getQualitySummary());
});

qualityRouter.get("/flags", (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  res.json({ flags: getQualityFlags(since) });
});

qualityRouter.get("/low-quality", (req, res) => {
  const threshold = typeof req.query.threshold === "string" ? parseFloat(req.query.threshold) : 0.5;
  const minFlags = typeof req.query.minFlags === "string" ? parseInt(req.query.minFlags, 10) : 3;
  res.json({ runs: getLowQualityRuns(threshold, minFlags) });
});
