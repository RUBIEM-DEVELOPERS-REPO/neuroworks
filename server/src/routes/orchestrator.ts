import { Router } from "express";
import { createOrchestration, getOrchestration, listOrchestrations } from "../lib/orchestrator.js";

export const orchestratorRouter = Router();

orchestratorRouter.post("/run", async (req, res) => {
  const { objective } = req.body ?? {};
  if (!objective || typeof objective !== "string" || !objective.trim()) {
    return res.status(400).json({ error: "objective (string) is required" });
  }
  try {
    const run = await createOrchestration(objective.trim());
    res.json({ id: run.id, label: run.label, status: run.status, subTasks: run.subTasks.map(s => ({ id: s.id, label: s.label, status: s.status, elapsedMs: s.elapsedMs })) });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e).slice(0, 300) });
  }
});

orchestratorRouter.post("/run-async", async (req, res) => {
  const { objective } = req.body ?? {};
  if (!objective || typeof objective !== "string" || !objective.trim()) {
    return res.status(400).json({ error: "objective (string) is required" });
  }
  res.json({ accepted: true, objective: objective.trim() });
  // Fire and forget
  createOrchestration(objective.trim()).catch(() => {});
});

orchestratorRouter.get("/runs", (_req, res) => {
  const runs = listOrchestrations();
  res.json({ runs: runs.map(r => ({
    id: r.id, label: r.label, status: r.status, subTaskCount: r.subTasks.length,
    doneCount: r.subTasks.filter(s => s.status === "done").length,
    createdAt: r.createdAt, elapsedMs: r.elapsedMs,
  })) });
});

orchestratorRouter.get("/runs/:id", (req, res) => {
  const run = getOrchestration(req.params.id);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json({ run });
});
