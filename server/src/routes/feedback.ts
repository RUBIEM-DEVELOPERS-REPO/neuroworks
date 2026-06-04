import { Router } from "express";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { newJob, getJob, listJobs, runJob } from "../lib/jobs.js";
import { loadJobsInWindow } from "../lib/job-store.js";
import { planAndExecute } from "../lib/agent.js";
import { getActivePersona, personaSystemSuffix } from "../lib/personas.js";
import { findCustomTemplate } from "../lib/custom-templates.js";

// Outcome feedback loop — the operator tells us in one click whether a job's
// answer was good or bad, optionally why. Writes to `_neuroworks/feedback.jsonl`
// in the vault so the nightly reflection (and a future grader-calibration
// pass) can use the human signal as the anchor truth, not the LLM scorer.

const FEEDBACK_REL = "_neuroworks/feedback.jsonl";

export const feedbackRouter = Router();

feedbackRouter.post("/", (req, res) => {
  const b = req.body ?? {};
  const jobId = typeof b.jobId === "string" ? b.jobId : "";
  const rating = b.rating === "up" || b.rating === "down" ? b.rating : null;
  if (!jobId || !rating) return res.status(400).json({ error: "jobId and rating ('up' | 'down') are required" });
  const rec = {
    jobId,
    rating,
    note: typeof b.note === "string" ? b.note.slice(0, 2000) : undefined,
    persona: typeof b.persona === "string" ? b.persona.slice(0, 80) : undefined,
    template: typeof b.template === "string" ? b.template.slice(0, 120) : undefined,
    score: typeof b.score === "number" ? b.score : undefined,
    ts: new Date().toISOString(),
  };
  const full = join(config.vaultPath, FEEDBACK_REL);
  try { mkdirSync(join(full, ".."), { recursive: true }); } catch { /* tolerate */ }
  appendFileSync(full, JSON.stringify(rec) + "\n", "utf8");
  res.json({ ok: true, path: FEEDBACK_REL });
});

// POST /api/feedback/retry — relaunch the original task when the operator
// marked the previous answer 👎. The retry runs as a fresh chat job with the
// operator's feedback note injected as guidance, so the new attempt knows
// what the previous one got wrong. Returns the new jobId; the caller
// navigates to /results/{newJobId} to watch the retry land.
function findOriginalJob(jobId: string) {
  const inMem = getJob(jobId);
  if (inMem) return inMem;
  // Persisted fallback: scan the last 30 days of JSONL records.
  const now = Date.now();
  for (const j of loadJobsInWindow(now - 30 * 24 * 60 * 60 * 1000, now + 5_000)) {
    if (j.id === jobId) return j as any;
  }
  // Last-ditch: a recent in-memory record that might not be the active id.
  return listJobs().find(j => j.id === jobId);
}

function readLatestFeedback(jobId: string): { rating: "up" | "down"; note?: string } | null {
  const full = join(config.vaultPath, FEEDBACK_REL);
  if (!existsSync(full)) return null;
  try {
    const lines = readFileSync(full, "utf8").split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(lines[i]);
        if (r.jobId === jobId) return { rating: r.rating, note: r.note };
      } catch { /* tolerate */ }
    }
  } catch { /* tolerate */ }
  return null;
}

function extractOriginalTask(job: any): string | null {
  const r = job?.result ?? {};
  // Most reliable: planAndExecute records the task it received.
  if (typeof r.task === "string" && r.task.trim()) return r.task;
  // For ad-hoc chat jobs, the message content lands in the title.
  if (typeof job.title === "string" && job.title.trim()) return job.title;
  // For custom templates, look up the saved origin.task.
  if (typeof job.template === "string" && job.template.startsWith("custom-")) {
    try {
      const t = findCustomTemplate(job.template);
      const origin = (t as any)?.origin?.task;
      if (origin) return String(origin);
    } catch { /* tolerate */ }
  }
  return null;
}

feedbackRouter.post("/retry", async (req, res) => {
  const jobId = String(req.body?.jobId ?? "").trim();
  if (!jobId) return res.status(400).json({ error: "jobId is required" });
  const original = findOriginalJob(jobId);
  if (!original) return res.status(404).json({ error: `job ${jobId} not found (in-memory and last 30 days persisted)` });
  const feedback = readLatestFeedback(jobId);
  // We DO want to allow operator-triggered retry without prior feedback (e.g.
  // they noticed the answer was thin and just want a redo), so we don't gate
  // on feedback existing — we only inject it when it does.
  // Optional override: a note in the body for "retry with this note even
  // though I haven't thumbs-downed it yet".
  const overrideNote = typeof req.body?.note === "string" ? String(req.body.note).slice(0, 1000).trim() : "";
  const note = overrideNote || feedback?.note?.slice(0, 1000)?.trim() || "";
  const task = extractOriginalTask(original);
  if (!task) {
    return res.status(422).json({
      error: "couldn't recover the original task text from this job (no result.task, no title, no custom template) — try copy-pasting the task into chat and re-run manually",
    });
  }

  const persona = getActivePersona();
  const personaSuffix = personaSystemSuffix(persona);
  // Build the retry brief. The "previous answer was marked X" framing is
  // explicit so the planner / synthesiser can address the gap rather than
  // re-emit the same answer. Reference the source jobId so the trace + the
  // vault journal show the retry lineage.
  const retryBrief = [
    `RETRY — previous attempt (job ${jobId}) was marked ${feedback?.rating === "down" ? "👎 needs work" : "for redo"} by the operator.`,
    note ? `Operator's note on what to fix:\n${note}` : `(No specific note; assume the previous answer was thin, off-target, or missed the intent.)`,
    "",
    "Address the feedback in this new attempt. Do not repeat the previous answer's shape — re-plan if the gap is structural. If the original task wants a local file / vault note / external doc, USE the local-doc primitives (vault.read, vault.search, fs.list_external, fs.read_external, vault.scan_docs) rather than going straight to research.deep.",
    "",
    "Original task:",
    task,
  ].join("\n");

  const enriched = persona
    ? `(You are operating as ${persona.name}, the ${persona.role}. Bias tool choices, output shape, and depth toward this role's conventions.)\n\n${retryBrief}`
    : retryBrief;

  // Create the retry job. We tag the kind with `retry:<originalKind>` so the
  // Tasks page + reflection can see this is a retry lineage at a glance.
  const newJobRec = newJob(`retry:${original.kind ?? "chat"}`);
  newJobRec.title = `Retry: ${(task as string).slice(0, 80)}`;
  newJobRec.log.push(`[${new Date().toISOString()}] retry of ${jobId}${note ? ` · note: "${note.slice(0, 120)}"` : ""}`);

  res.json({ newJobId: newJobRec.id, originalJobId: jobId });

  void runJob(newJobRec, async (push, progress) => {
    push(`retry of ${jobId}${feedback?.rating === "down" ? " (👎 marked)" : ""}${note ? ` — note: "${note.slice(0, 80)}"` : ""}`);
    return await planAndExecute(enriched, push, (patch) => progress(patch as Record<string, unknown>), { personaSystemSuffix: personaSuffix });
  });
});

// GET /api/feedback?jobId=... — used by the UI to render the operator's
// previous thumb (and persist optimistic state through tab reloads). Reads
// the JSONL once per call; the file stays small in practice (one record per
// answer the operator opens) so a linear scan is fine.
feedbackRouter.get("/", (req, res) => {
  const jobId = String(req.query.jobId ?? "");
  const full = join(config.vaultPath, FEEDBACK_REL);
  if (!jobId || !existsSync(full)) return res.json({ feedback: null });
  try {
    const lines = readFileSync(full, "utf8").split(/\r?\n/).filter(Boolean);
    // Latest wins — operator may have changed their mind.
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const r = JSON.parse(lines[i]);
        if (r.jobId === jobId) return res.json({ feedback: r });
      } catch { /* tolerate */ }
    }
  } catch { /* tolerate */ }
  res.json({ feedback: null });
});
