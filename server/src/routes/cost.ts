import { Router } from "express";
import { getCostSummary, getCostRecords } from "../lib/cost-tracker.js";

export const costRouter = Router();

costRouter.get("/summary", (_req, res) => {
  res.json(getCostSummary());
});

costRouter.get("/records", (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  res.json({ records: getCostRecords(since) });
});
