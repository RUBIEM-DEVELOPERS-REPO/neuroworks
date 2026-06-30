// Agent hand-off relay routes.
//
// POST /api/handoff           start a relay { teamId | members[], objective, label? }
//                             → { runId, jobId } (the relay runs async in a job)
// GET  /api/handoff           list recent relay runs (newest first)
// GET  /api/handoff/:id       one relay run with its full step timeline
//
// The relay itself lives in lib/handoff.ts. The route wraps it in a job so it
// also appears in Activity/Reports, and returns immediately so the Team page
// can poll the structured run for its timeline.

import { Router } from "express";
import { newJob, runJob } from "../lib/jobs.js";
import { createHandoffRun, executeHandoffRun, listHandoffRuns, getHandoffRun, type RosterInput } from "../lib/handoff.js";

export const handoffRouter = Router();

handoffRouter.get("/", (_req, res) => {
  res.json({ runs: listHandoffRuns() });
});

handoffRouter.get("/:id", (req, res) => {
  const run = getHandoffRun(String(req.params.id));
  if (!run) return res.status(404).json({ error: "handoff run not found" });
  res.json({ run });
});

handoffRouter.post("/", (req, res) => {
  try {
    const objective = String(req.body?.objective ?? "").trim();
    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId : undefined;
    const label = typeof req.body?.label === "string" ? req.body.label : undefined;
    const members: RosterInput | undefined = Array.isArray(req.body?.members)
      ? req.body.members
          .filter((m: any) => m && typeof m.personaId === "string")
          .map((m: any) => ({ personaId: String(m.personaId), role: typeof m.role === "string" ? m.role : undefined }))
      : undefined;

    if (!objective) return res.status(400).json({ error: "objective required" });
    if (!teamId && (!members || members.length === 0)) {
      return res.status(400).json({ error: "teamId or a non-empty members[] required" });
    }

    const job = newJob("insights:handoff-relay");
    job.title = `Hand-off relay: ${objective.slice(0, 60)}`;
    job.inputs = { objective, teamId, memberCount: members?.length };

    // Create the structured run synchronously so we can return its id at once.
    const run = createHandoffRun({ objective, teamId, members, label, jobId: job.id });

    // Drive execution in the background inside the job (shows in Activity).
    void runJob(job, async (push, progress) => {
      const finished = await executeHandoffRun(run, push);
      progress({ handoffRunId: finished.id, status: finished.status, steps: finished.steps.length });
      return {
        kind: "handoff-relay",
        handoffRunId: finished.id,
        status: finished.status,
        steps: finished.steps.length,
        answer: finished.finalReport,
      };
    });

    res.json({ runId: run.id, jobId: job.id, roster: run.roster });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
