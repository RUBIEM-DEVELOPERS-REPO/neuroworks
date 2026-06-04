import { Router } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { newJob, listJobs } from "../lib/jobs.js";
import { persistJobRecord } from "../lib/job-store.js";

// Surface external-agent runs (e.g. Hermes Agent) on the same Tasks /
// Reports / Activity pages as clawbot jobs. The external agent runs in
// its own process; this endpoint accepts the post-hoc record and stamps
// a real Job into the in-memory store + the .neuroworks/jobs/ JSONL so
// the reflection picks it up. No execution happens here — the agent has
// already finished by the time we're called.

export const externalAgentsRouter = Router();

// Locate the Hermes CLI installed by the Nous Research installer. The script
// drops the venv in either `%LOCALAPPDATA%/hermes/...` (Windows default) or a
// custom `$HERMES_HOME`. We check both and the Unix fallback.
function detectHermes(): { installed: boolean; binPath?: string } {
  const home = process.env.HERMES_HOME
    ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "hermes") : null)
    ?? (process.env.HOME ? path.join(process.env.HOME, ".hermes") : null);
  if (!home) return { installed: false };
  for (const rel of ["hermes-agent/venv/Scripts/hermes.exe", "hermes-agent/venv/bin/hermes"]) {
    const p = path.join(home, rel);
    if (existsSync(p)) return { installed: true, binPath: p };
  }
  return { installed: false };
}

// GET /api/external-agents — workforce snapshot for the Dashboard + Admin
// pages. Lists external agents the operator has installed alongside clawbot,
// each with install/configured state and recent-job counts pulled from the
// in-memory journal. Currently only Hermes; the shape supports more.
externalAgentsRouter.get("/", (_req, res) => {
  const hermes = detectHermes();
  const jobs = listJobs();
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const hermesJobs = jobs.filter(j => (j.kind ?? "").startsWith("hermes:"));
  let last1h = 0, last24h = 0, succeeded = 0, failed = 0, lastRunAt: string | undefined;
  for (const j of hermesJobs) {
    const t = Date.parse(j.finishedAt ?? j.startedAt);
    if (!Number.isFinite(t)) continue;
    if (now - t <= hour) last1h++;
    if (now - t <= day) last24h++;
    if (j.status === "succeeded") succeeded++;
    else if (j.status === "failed" || j.status === "rejected") failed++;
    if (!lastRunAt || (j.finishedAt ?? j.startedAt) > lastRunAt) lastRunAt = j.finishedAt ?? j.startedAt;
  }
  res.json({
    agents: [
      {
        id: "hermes",
        name: "Hermes",
        kind: "cli",
        installed: hermes.installed,
        // We can't probe Hermes' own .env without spawning the binary; if
        // any hermes:* job has succeeded we know the config is live.
        configured: hermes.installed && (succeeded > 0 || hermesJobs.length === 0),
        binPath: hermes.binPath,
        // Hermes runs are spawn-per-task — there's no long-running daemon
        // to query an inflight count from, so we surface recent throughput
        // instead. The Dashboard treats `recentJobs.last1h` like a heartbeat.
        recentJobs: { last1h, last24h, succeeded, failed, total: hermesJobs.length },
        lastRunAt,
      },
    ],
  });
});

externalAgentsRouter.post("/log", (req, res) => {
  const b = req.body ?? {};
  const agent = String(b.agent ?? "external").toLowerCase();
  const templateId = String(b.templateId ?? "ad-hoc");
  const role = b.role ? String(b.role) : "Custom";
  const title = String(b.title ?? templateId);
  const task = String(b.task ?? "");
  const answer = typeof b.answer === "string" ? b.answer : "";
  const status: "succeeded" | "failed" | "rejected" =
    b.status === "succeeded" || b.status === "failed" || b.status === "rejected"
      ? b.status
      : answer.length >= 40 ? "succeeded" : "failed";
  const durationSec = Number(b.durationSeconds ?? 0);
  const score = typeof b.score === "number" ? b.score : undefined;
  const pass = typeof b.pass === "boolean" ? b.pass : undefined;
  const deliverableClass = b.deliverableClass ? String(b.deliverableClass) : undefined;
  const issues = Array.isArray(b.issues) ? b.issues.slice(0, 8).map((x: any) => String(x).slice(0, 200)) : undefined;
  const error = b.error ? String(b.error).slice(0, 400) : undefined;

  // `kind` mirrors the clawbot convention `${role.toLowerCase()}:${templateId}`
  // so the Tasks page groups external-agent runs alongside clawbot runs.
  const j = newJob(`${agent}:${templateId}`);
  j.template = templateId;
  j.title = title;
  // personaName feeds the reflection's byPersona bucket — tagging the agent
  // here means the daily reflection can report per-agent stats.
  j.personaName = agent === "hermes" ? "Hermes" : agent.charAt(0).toUpperCase() + agent.slice(1);
  // Back-date startedAt so the task duration the UI shows reflects the
  // agent's actual wall time, not a 0-second "instant" record.
  const finishedAt = new Date();
  const startedAt = new Date(finishedAt.getTime() - Math.max(0, durationSec) * 1000);
  j.startedAt = startedAt.toISOString();
  j.finishedAt = finishedAt.toISOString();
  j.status = status;
  if (error) j.error = error;
  j.log.push(`[${j.startedAt}] dispatched to ${j.personaName} (${agent})`);
  j.log.push(`[${j.finishedAt}] ${status} in ${durationSec.toFixed(1)}s — ${answer.length} chars`);
  j.result = {
    agent,
    role,
    answer,
    // Mirror the QA gate shape clawbot jobs use so ResultPanel renders
    // the score block without any external-agent special-casing.
    quality: score !== undefined ? { score, pass, deliverableClass, issues } : undefined,
    durationSec,
  };
  // Persist to .neuroworks/jobs/ so the nightly reflection sees the run
  // even after the in-memory cap evicts it.
  try { persistJobRecord(j); } catch { /* tolerate */ }

  res.json({ jobId: j.id, kind: j.kind, status: j.status });
});
