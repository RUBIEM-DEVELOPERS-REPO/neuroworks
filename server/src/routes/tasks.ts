import { Router } from "express";
import { config } from "../config.js";
import { dispatchWorkflow, latestRun } from "../lib/github.js";
import { newJob, listJobs, getJob, getJobEvents, SERVER_BOOT_AT, etaStats, runJob, type Job } from "../lib/jobs.js";
import { loadJobById, loadJobsInWindow, persistJobRecord, asJob } from "../lib/job-store.js";
import { summarizeHumanWork } from "../lib/human-work.js";

export const tasksRouter = Router();

tasksRouter.get("/jobs", (_req, res) => res.json({ jobs: listJobs() }));

// ── Human-in-the-loop: the waiting queue + resume ─────────────────────────
// A job that paused on a structured human ask sits in waiting_on_human with
// result.humanRequest. The queue merges live in-memory jobs with the last 14
// days of the disk journal (so waits survive restarts), newest first, and
// hides requests already resolved.

function humanRequestOf(j: Job): any {
  return (j.result as any)?.humanRequest;
}

tasksRouter.get("/waiting", (_req, res) => {
  const seen = new Set<string>();
  const out: any[] = [];
  const consider = (j: Job) => {
    if (j.status !== "waiting_on_human" || seen.has(j.id)) return;
    const hr = humanRequestOf(j);
    if (!hr || hr.resolvedAt) { seen.add(j.id); return; }
    seen.add(j.id);
    out.push({
      id: j.id,
      title: j.title ?? j.template ?? j.kind,
      persona: j.personaName,
      startedAt: j.startedAt,
      waitingSince: hr.requestedAt ?? j.finishedAt ?? j.startedAt,
      items: hr.items,
      reason: hr.reason,
      task: typeof (j.inputs as any)?.task === "string" ? String((j.inputs as any).task).slice(0, 400) : undefined,
    });
  };
  for (const j of listJobs()) consider(j);
  try {
    const now = Date.now();
    // LAST record per id wins. The journal is append-only: resolving a wait
    // appends a NEWER record for the same id with humanRequest.resolvedAt set
    // (status stays waiting_on_human). Considering records in file order made
    // the first (unresolved) record claim the id and the resolution was never
    // seen — answered tasks kept haunting the queue after a restart.
    const latest = new Map<string, ReturnType<typeof loadJobsInWindow>[number]>();
    for (const rec of loadJobsInWindow(now - 14 * 24 * 3600 * 1000, now)) latest.set(rec.id, rec);
    for (const rec of latest.values()) {
      if (rec.status === "waiting_on_human") consider(asJob(rec));
    }
  } catch { /* journal optional */ }
  out.sort((a, b) => String(b.waitingSince).localeCompare(String(a.waitingSince)));
  res.json({ waiting: out });
});

// Resume a waiting task with the human's answers. Marks the original request
// resolved and spins a CONTINUATION job (linked via continuesJobId) that
// re-enters the agent loop with the supplied input injected into the task —
// the "continuing loop" the hybrid workforce runs on.
tasksRouter.post("/jobs/:id/human-input", async (req, res) => {
  const id = String(req.params.id);
  let j: Job | undefined = getJob(id);
  if (!j) {
    const rec = loadJobById(id);
    if (rec) j = asJob(rec);
  }
  if (!j) return res.status(404).json({ error: "job not found", serverBootAt: SERVER_BOOT_AT });
  if (j.status !== "waiting_on_human") return res.status(409).json({ error: `job is "${j.status}", not waiting on human input` });
  const hr = humanRequestOf(j);
  if (!hr) return res.status(409).json({ error: "job has no pending human request" });
  if (hr.resolvedAt) return res.status(409).json({ error: "this request was already answered" });

  const responses: { prompt: string; response: string }[] = Array.isArray(req.body?.responses)
    ? req.body.responses
        .map((r: any) => ({ prompt: String(r?.prompt ?? "").slice(0, 500), response: String(r?.response ?? "").trim().slice(0, 8000) }))
        .filter((r: any) => r.response.length > 0)
    : [];
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 4000) : "";
  if (responses.length === 0 && !note) return res.status(400).json({ error: "provide at least one response (responses[] or note)" });

  const originalTask = String((j.inputs as any)?.task ?? j.task ?? j.title ?? "").trim();
  if (!originalTask) return res.status(400).json({ error: "original job has no recorded task text — cannot continue it" });

  // Mark the request resolved on the original job and persist, so the waiting
  // queue drops it even after a restart (persist appends a newer record; the
  // journal reader returns the LAST record per id).
  hr.resolvedAt = new Date().toISOString();
  j.log.push(`[${hr.resolvedAt}] human input received (${responses.length} response${responses.length === 1 ? "" : "s"}${note ? " + note" : ""}) — continuing`);
  try { persistJobRecord(j); } catch { /* best-effort */ }

  const suppliedBlock = [
    "The human operator has now supplied the input this task was waiting on. Use it as authoritative and FINISH the task — do not ask for it again.",
    ...responses.map(r => `- ${r.prompt ? `${r.prompt}: ` : ""}${r.response}`),
    ...(note ? [`- Note from the operator: ${note}`] : []),
  ].join("\n");
  const contTask = `${originalTask}\n\n${suppliedBlock}`;

  const job = newJob("insights:general-task");
  job.template = "general-task";
  job.title = `Continue: ${(j.title ?? originalTask).slice(0, 100)}`;
  job.personaId = j.personaId;
  job.personaName = j.personaName;
  job.inputs = {
    task: contTask,
    save_as_template: false,
    continuesJobId: j.id,
    continuesOriginalText: originalTask.slice(0, 400),
    continuesSummary: `human input supplied for: ${(hr.items ?? []).map((it: any) => it.prompt).join("; ").slice(0, 160)}`,
  };
  res.json({ jobId: job.id, continuesJobId: j.id });

  void runJob(job, async (push, progress) => {
    push(`Continuing ${j!.id.slice(0, 8)} with the operator's input.`);
    const { planAndExecute } = await import("../lib/agent.js");
    const { getActivePersona, personaSystemSuffix } = await import("../lib/personas.js");
    const persona = getActivePersona();
    // Deliberately NOT re-passing workMode "human" here — a continuation with
    // supplied input is agent work again (the human already did their part).
    const wm = persona?.workMode === "human" ? undefined : persona?.workMode;
    const r = await planAndExecute(contTask, push, (patch) => progress(patch as Record<string, unknown>), {
      personaSystemSuffix: personaSystemSuffix(persona),
      workMode: wm,
    });
    return { answer: r.answer, plan: r.plan, runs: r.runs, review: r.review, quality: r.quality, security: r.security, humanRequest: r.humanRequest };
  });
});

// ── Time-waste analysis: where does the org's time actually go? ──────────
// Decomposes the last N days into
//   agent runtime      — wall-clock of finished jobs (the machines working)
//   waiting-on-human   — gaps between a job pausing on a human ask and its
//                        continuation starting (plus still-open waits)
//   human work         — hours logged in the human-work ledger
// and points at the biggest sinks on each side. This is the evidence base
// for shifting work between humans and agents.
tasksRouter.get("/time-analysis", (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, Number(req.query.days ?? 30)));
    const now = Date.now();
    const windowStart = now - days * 24 * 3600 * 1000;

    // Merge journal + in-memory, last record per id wins (journal appends on
    // every persist, and in-memory is freshest of all).
    const byId = new Map<string, any>();
    try { for (const rec of loadJobsInWindow(windowStart, now)) byId.set(rec.id, rec); } catch { /* optional */ }
    for (const j of listJobs()) {
      byId.set(j.id, {
        id: j.id, kind: j.kind, status: j.status, startedAt: j.startedAt, finishedAt: j.finishedAt,
        template: j.template, title: j.title,
        continuesJobId: (j.inputs as any)?.continuesJobId,
        humanRequest: (j.result as any)?.humanRequest,
      });
    }
    const recs = [...byId.values()];

    const HOUR = 3600 * 1000;
    let agentMs = 0;
    let humanWaitMs = 0;
    let openWaitMs = 0;
    const agentByType = new Map<string, number>();
    const waits: { title: string; waitMs: number; open: boolean }[] = [];

    for (const r of recs) {
      if (r.startedAt && r.finishedAt) {
        const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
        if (Number.isFinite(ms) && ms > 0 && ms < 3 * HOUR) {
          agentMs += ms;
          const key = (r.template && String(r.template).trim()) ? String(r.template) : String(r.kind ?? "task").replace(/^[^:]+:/, "");
          agentByType.set(key, (agentByType.get(key) ?? 0) + ms);
        }
      }
      // Resolved waits: this job continues an earlier one that was parked.
      if (r.continuesJobId) {
        const prev = byId.get(String(r.continuesJobId));
        if (prev?.finishedAt && r.startedAt) {
          const gap = new Date(r.startedAt).getTime() - new Date(prev.finishedAt).getTime();
          if (Number.isFinite(gap) && gap > 0 && gap < 30 * 24 * HOUR) {
            humanWaitMs += gap;
            waits.push({ title: String(prev.title ?? prev.template ?? prev.kind ?? "task").slice(0, 100), waitMs: gap, open: false });
          }
        }
      }
      // Open waits: still parked, clock running.
      if (r.status === "waiting_on_human" && r.humanRequest && !r.humanRequest.resolvedAt) {
        const since = new Date(r.humanRequest.requestedAt ?? r.finishedAt ?? r.startedAt).getTime();
        const gap = now - since;
        if (Number.isFinite(gap) && gap > 0 && gap < 30 * 24 * HOUR) {
          openWaitMs += gap;
          waits.push({ title: String(r.title ?? r.template ?? r.kind ?? "task").slice(0, 100), waitMs: gap, open: true });
        }
      }
    }

    const humanWork = summarizeHumanWork(days);
    const humanWorkMs = humanWork.totalHours * HOUR;
    const totalMs = agentMs + humanWaitMs + openWaitMs + humanWorkMs;
    const pct = (ms: number) => totalMs > 0 ? Math.round((ms / totalMs) * 1000) / 10 : 0;

    // A plain-language verdict so the number means something at a glance.
    const humanSideMs = humanWaitMs + openWaitMs + humanWorkMs;
    const verdict = totalMs === 0
      ? "Not enough activity in this window to attribute time yet."
      : humanSideMs > agentMs * 2
        ? "Most time in this window sits on the HUMAN side (waiting + logged human work). Look at the open waits below — answering them faster, or moving those asks to agents/connectors, is the biggest lever."
        : agentMs > humanSideMs * 2
          ? "Most time is AGENT runtime. If throughput matters more than cost, look at the slowest task types below — model routing or plan tightening are the levers."
          : "Time is roughly balanced between the agent and human sides. The slowest task types and longest waits below are the next efficiency targets.";

    waits.sort((a, b) => b.waitMs - a.waitMs);

    res.json({
      days,
      totals: {
        agentMs, humanWaitMs, openWaitMs, humanWorkMs: Math.round(humanWorkMs), totalMs: Math.round(totalMs),
        pct: { agent: pct(agentMs), humanWait: pct(humanWaitMs + openWaitMs), humanWork: pct(humanWorkMs) },
      },
      verdict,
      slowestAgentTypes: [...agentByType.entries()]
        .map(([type, ms]) => ({ type, ms }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 8),
      longestWaits: waits.slice(0, 8),
      humanWorkHours: humanWork.totalHours,
      jobCount: recs.length,
    });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
// Duration history so the UI can show an ETA on a running task. Median
// wall-clock per task type + a global fallback. Cheap (reads the journal).
tasksRouter.get("/eta", (_req, res) => res.json(etaStats()));
tasksRouter.get("/jobs/:id", (req, res) => {
  const j = getJob(req.params.id);
  if (!j) {
    return res.status(404).json({
      error: "not found",
      // Boot timestamp lets the client distinguish "evicted" from "server
      // restarted". The latter is the common case under tsx watch and the
      // UI uses it to show a friendlier retry message.
      serverBootAt: SERVER_BOOT_AT,
      hint: "The job is no longer in memory. This often means the server restarted (tsx watch hot-reload) while the job was running — retry the original task.",
    });
  }
  res.json(j);
});

// Live log stream over Server-Sent Events. The Tasks / Activity page
// can open this for a running job and render lines as they arrive
// instead of polling /api/tasks/jobs/:id every second. Events:
//   "log"   data: { line: "[ISO] message" }
//   "patch" data: <progress patch object>
//   "done"  data: { status, error? }
// On open, we replay any lines already in j.log so a late subscriber
// catches up to where the run currently is. Then live events flow.
// The stream closes cleanly when the job ends, or when the client
// disconnects.
tasksRouter.get("/jobs/:id/stream", (req, res) => {
  const j = getJob(req.params.id);
  if (!j) {
    res.status(404).json({ error: "not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering if ever fronted
  // Hint browsers to keep the connection alive without retrying too
  // aggressively if the network blips.
  res.write("retry: 5000\n\n");

  const send = (event: string, data: any) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch { /* client probably disconnected — onClose cleans up */ }
  };

  // Replay buffered log lines so a subscriber that connects mid-run
  // catches up immediately.
  for (const line of j.log) send("log", { line });

  // If the job already finished before the client subscribed, send a
  // synthetic "done" right away and close. The emitter for finished
  // jobs has been torn down (dropEmitter), so live subscription would
  // just hang.
  if (j.status !== "running" && j.status !== "pending") {
    send("done", { status: j.status, error: j.error });
    res.end();
    return;
  }

  const ee = getJobEvents(j.id);
  if (!ee) {
    // Edge case: emitter was dropped between status check and now.
    send("done", { status: j.status, error: j.error });
    res.end();
    return;
  }

  // Heartbeat every 25s so proxies + Vite dev server keep the socket
  // open even when the job is mid-LLM-call with no log output. The
  // comment-frame (lines starting with `:`) is the SSE no-op format.
  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { /* tolerate */ }
  }, 25_000);

  const onLog = (line: string) => send("log", { line });
  const onPatch = (patch: any) => send("patch", patch);
  const onDone = (data: any) => {
    send("done", data);
    cleanup();
    try { res.end(); } catch { /* tolerate */ }
  };
  ee.on("log", onLog);
  ee.on("patch", onPatch);
  ee.once("done", onDone);

  function cleanup() {
    clearInterval(heartbeat);
    try { ee?.off("log", onLog); } catch {}
    try { ee?.off("patch", onPatch); } catch {}
    try { ee?.off("done", onDone); } catch {}
  }

  req.on("close", () => { cleanup(); });
  req.on("aborted", () => { cleanup(); });
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

// Plan-approval flow — draft a plan for a task and PAUSE for human sign-off
// instead of executing immediately. The job parks at awaiting-approval with the
// planned steps attached; approving it (Approvals page) executes THIS plan via
// the templates approve endpoint (which replays the preplan, no re-planning).
tasksRouter.post("/plan", async (req, res) => {
  const task = String(req.body?.task ?? "").trim();
  if (!task) return res.status(400).json({ error: "task required" });
  const job = newJob("insights:plan-approval");
  job.title = task.slice(0, 120);
  job.requiresApproval = true;
  job.task = task;
  job.status = "pending";
  res.json({ jobId: job.id, status: "planning" });

  // Draft the plan asynchronously; the client polls the job until it reaches
  // awaiting-approval and the plan steps appear.
  void (async () => {
    try {
      const { plan } = await import("../lib/agent.js");
      const { getActivePersona, personaSystemSuffix } = await import("../lib/personas.js");
      const persona = getActivePersona();
      const suffix = personaSystemSuffix(persona);
      job.status = "running";
      job.personaId = persona?.id;
      job.personaName = persona?.name;
      job.log.push(`[${new Date().toISOString()}] drafting a plan…`);
      const p = await plan(task, suffix, (m) => job.log.push(m));
      job.plan = p;
      job.personaSuffix = suffix;
      job.status = "awaiting-approval";
      job.log.push(`[${new Date().toISOString()}] plan ready — ${p.steps.length} step${p.steps.length === 1 ? "" : "s"}; waiting on your approval`);
    } catch (e: any) {
      job.status = "failed";
      job.error = String(e?.message ?? e);
      job.finishedAt = new Date().toISOString();
      job.log.push(`[${new Date().toISOString()}] planning failed: ${job.error}`);
    }
  })();
});
