import { Router } from "express";
import { config } from "../config.js";
import { dispatchWorkflow, latestRun } from "../lib/github.js";
import { newJob, listJobs, getJob, getJobEvents, SERVER_BOOT_AT } from "../lib/jobs.js";

export const tasksRouter = Router();

tasksRouter.get("/jobs", (_req, res) => res.json({ jobs: listJobs() }));
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
