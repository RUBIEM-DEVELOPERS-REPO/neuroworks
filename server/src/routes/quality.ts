import { Router } from "express";
import { flagQuality, getQualitySummary, getQualityFlags, getLowQualityRuns, type QualityFlag } from "../lib/quality.js";

export const qualityRouter = Router();

// POST /api/quality/flag — operator marks a specific job's output good/bad,
// optionally tagged with a category and the language it was actually in.
// This was previously dead code: flagQuality() existed in lib/quality.ts and
// the read-side routes (summary/flags/low-quality) worked off whatever was
// in the JSONL file, but nothing ever wrote to it — Quality.tsx's own copy
// said "Flag outputs as good/bad from the results page" and no such control
// existed anywhere in the web app.
const VALID_CATEGORIES = new Set(["accuracy", "relevance", "tone", "completeness", "formatting", "localization", "other"]);
const VALID_LANGUAGES = new Set(["en", "sn", "nd"]);
qualityRouter.post("/flag", (req, res) => {
  const body = req.body ?? {};
  if (!body.jobId || typeof body.jobId !== "string") return res.status(400).json({ error: "jobId (string) is required" });
  if (body.rating !== "up" && body.rating !== "down") return res.status(400).json({ error: "rating must be 'up' or 'down'" });
  const flag: QualityFlag = {
    jobId: body.jobId,
    rating: body.rating,
    ts: new Date().toISOString(),
  };
  if (typeof body.note === "string" && body.note.trim()) flag.note = body.note.trim().slice(0, 2000);
  if (typeof body.persona === "string" && body.persona.trim()) flag.persona = body.persona.trim();
  if (typeof body.template === "string" && body.template.trim()) flag.template = body.template.trim();
  if (typeof body.score === "number" && Number.isFinite(body.score)) flag.score = body.score;
  if (typeof body.category === "string" && VALID_CATEGORIES.has(body.category)) flag.category = body.category as QualityFlag["category"];
  if (typeof body.language === "string" && VALID_LANGUAGES.has(body.language)) flag.language = body.language as QualityFlag["language"];
  flagQuality(flag);
  res.json({ ok: true, flag });
});

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
