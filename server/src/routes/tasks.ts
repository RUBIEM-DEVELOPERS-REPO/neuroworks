import { Router } from "express";
import { config } from "../config.js";
import { dispatchWorkflow, latestRun } from "../lib/github.js";
import { newJob, listJobs, getJob } from "../lib/jobs.js";

export const tasksRouter = Router();

tasksRouter.get("/jobs", (_req, res) => res.json({ jobs: listJobs() }));
tasksRouter.get("/jobs/:id", (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: "not found" });
  res.json(j);
});

tasksRouter.post("/digest", async (req, res) => {
  const lookback = String(req.body?.lookbackDays ?? "7");
  const job = newJob("dispatch:daily-digest");
  try {
    await dispatchWorkflow(config.githubOwner, "clawbot", "daily-digest.yml", "main", { lookback_days: lookback });
    job.status = "succeeded";
    job.finishedAt = new Date().toISOString();
    job.log.push(`workflow_dispatch sent (lookback=${lookback})`);
    res.json({ jobId: job.id });
  } catch (e: any) {
    job.status = "failed";
    job.error = e.message;
    res.status(500).json({ error: e.message });
  }
});

tasksRouter.get("/workflow/latest", async (_req, res) => {
  try {
    const run = await latestRun(config.githubOwner, "clawbot", "daily-digest.yml");
    res.json({ run });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
