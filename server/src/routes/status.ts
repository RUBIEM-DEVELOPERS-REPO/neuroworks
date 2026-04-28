import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { ollamaHealth } from "../lib/ollama.js";
import { latestRun } from "../lib/github.js";

export const statusRouter = Router();

statusRouter.get("/", async (_req, res) => {
  const metaPath = join(config.vaultPath, "_clawbot", "_meta", "last-run.json");
  let lastDigest: any = null;
  if (existsSync(metaPath)) {
    try { lastDigest = JSON.parse(readFileSync(metaPath, "utf8")); } catch {}
  }
  const ollama = await ollamaHealth();
  let lastWorkflow: any = null;
  if (config.ready) {
    try {
      const run = await latestRun(config.githubOwner, "clawbot", "daily-digest.yml");
      if (run) {
        lastWorkflow = {
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          createdAt: run.created_at,
          htmlUrl: run.html_url,
        };
      }
    } catch (e: any) { lastWorkflow = { error: e.message }; }
  } else {
    lastWorkflow = { error: `degraded: missing env ${config.missing.join(", ")}` };
  }
  res.json({
    ready: config.ready,
    missing: config.missing,
    vaultPath: config.vaultPath,
    vaultRepo: config.vaultRepo,
    githubOwner: config.githubOwner,
    lastDigest,
    lastWorkflow,
    ollama,
  });
});
