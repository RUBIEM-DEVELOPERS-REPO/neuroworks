import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { journal } from "./journal.js";
import { getActivePersona } from "./personas.js";
import { persistJobRecord } from "./job-store.js";
import type { Plan } from "./agent.js"; // type-only — erased at runtime, no import cycle

export type Job = {
  id: string;
  kind: string;
  status: "pending" | "awaiting-approval" | "running" | "succeeded" | "failed" | "rejected";
  startedAt: string;
  finishedAt?: string;
  log: string[];
  result?: unknown;
  error?: string;
  template?: string;
  title?: string;
  inputs?: Record<string, unknown>;
  // Set when a schedule fired this job (schedule id). Scheduled reports are
  // the one job class still mirrored into the vault by default.
  scheduledBy?: string;
  requiresApproval?: boolean;
  approvedAt?: string;
  rejectedAt?: string;
  // Plan-approval flow: the agent drafts a plan, the user reviews/approves the
  // steps, then we execute THIS plan (no re-planning). task/personaSuffix are
  // captured so approval can resume the loop exactly as planned.
  plan?: Plan;
  task?: string;
  personaSuffix?: string;
  // Persona attribution at dispatch time. Populated by callers (chat, team)
  // so the reflection's byPersona bucket has a stable name to aggregate on.
  // Previously the reflection had to reach into result.activePersona.name
  // which nobody was setting, leaving byPersona empty for every run.
  personaId?: string;
  personaName?: string;
};

const jobs = new Map<string, Job>();
// Boot timestamp of the in-memory state. Survives nothing — recorded
// at module load, reset whenever tsx watch restarts the server. We
// surface it on every job-not-found response so a client polling a
// stale jobId can tell the difference between "job ran, was evicted"
// (rare) and "server restarted under you" (common in dev / hot reload).
export const SERVER_BOOT_AT = new Date().toISOString();
// Bumped from 50 → 200 because team-dispatch can fire 12 parallel jobs that
// each spawn sub-jobs (peer.delegate, peer.review), and at 50 the eviction
// would kick out still-running team-task jobs before the harness could poll
// them ("job not found" 404s). 200 fits a full day of typical use; the
// reflection eats the long-term audit needs.
const RECENT = 200;

// Per-job event stream for SSE consumers. Emits:
//   "log"   — a new line was appended to j.log (payload: line string)
//   "patch" — j.result got a progress patch (payload: patch object)
//   "done"  — job finished (payload: { status, error? })
// Listeners are added by the /api/jobs/:id/stream route and removed
// when the consumer disconnects. EventEmitter handles multiple
// listeners per job natively, so several browser tabs can watch the
// same run without extra wiring.
const jobEvents = new Map<string, EventEmitter>();

export function getJobEvents(id: string): EventEmitter | null {
  return jobEvents.get(id) ?? null;
}

function ensureEmitter(id: string): EventEmitter {
  let ee = jobEvents.get(id);
  if (!ee) {
    ee = new EventEmitter();
    // 0 disables the leak warning — a long-running job with 4 browser
    // tabs subscribed is a normal pattern, not a leak.
    ee.setMaxListeners(0);
    jobEvents.set(id, ee);
  }
  return ee;
}

function dropEmitter(id: string): void {
  const ee = jobEvents.get(id);
  if (!ee) return;
  // Give listeners a tick to receive the "done" event before tearing
  // down. removeAllListeners is sync; the SSE consumer's `done` handler
  // would race the removal otherwise.
  setTimeout(() => {
    try { ee.removeAllListeners(); } catch { /* tolerate */ }
    jobEvents.delete(id);
  }, 200);
}

export function newJob(kind: string): Job {
  const j: Job = { id: randomUUID(), kind, status: "pending", startedAt: new Date().toISOString(), log: [] };
  jobs.set(j.id, j);
  if (jobs.size > RECENT) {
    // ONLY evict TERMINAL jobs — never kick out a job that's still pending or
    // running, even if it's the oldest. A team dispatch can leave a job in
    // `running` for 2-3 minutes; older but still-in-flight jobs MUST stay
    // pollable by the caller. Without this guard, polling returns 404 on a
    // perfectly-good running job and the caller treats it as failed.
    const sorted = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const oldestTerminal = sorted.find(x => x.status === "succeeded" || x.status === "failed" || x.status === "rejected");
    if (oldestTerminal) jobs.delete(oldestTerminal.id);
    // If everything in the table is in-flight, we let the table grow past
    // RECENT temporarily — it'll trim itself as jobs finish. Better than
    // dropping live work.
  }
  return j;
}

export function getJob(id: string) { return jobs.get(id); }
export function listJobs() { return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }

// Mark every still-running / pending job as failed with a clear
// abort message and persist it to the JSONL store. Called from the
// graceful shutdown handler so a tsx-watch restart (or any other
// shutdown that interrupts in-flight work) leaves the journal in a
// consistent state — the reflection sees the abort rather than a
// silent disappearance, and the client can show a clear "server
// restarted" message instead of an opaque 404.
export function abortInflightJobs(reason: string): { aborted: number } {
  let aborted = 0;
  for (const j of jobs.values()) {
    if (j.status !== "pending" && j.status !== "running" && j.status !== "awaiting-approval") continue;
    j.status = "failed";
    j.error = reason;
    j.finishedAt = new Date().toISOString();
    j.log.push(`[${j.finishedAt}] ${reason}`);
    try { persistJobRecord(j); } catch { /* tolerate */ }
    aborted += 1;
  }
  return { aborted };
}

export type ProgressUpdater = (patch: Record<string, unknown>) => void;

// ── Bounded job queue (backpressure) ──────────────────────────────────────
// Without this, every job ran its work immediately (fire-and-forget), so N
// tasks submitted together all hit the LLM at once — on free-tier OpenRouter
// that's a thundering herd where all N stall on rate limits. With a cap, only
// CLAWBOT_MAX_CONCURRENT_JOBS run at a time; the rest wait in FIFO order while
// staying `pending` (still pollable). 0 = unbounded (legacy behaviour, default
// so nothing changes unless the operator opts in).
const MAX_CONCURRENT_JOBS = Math.max(0, Number(process.env.CLAWBOT_MAX_CONCURRENT_JOBS ?? "0"));
// Mirror every job into the Obsidian vault as a markdown note? Default OFF — it
// littered the user's real vault (D:\Main brain\_neuroworks\jobs\) with a new
// file per task (incl. delegated sub-tasks + test runs). The durable record the
// app actually reads (Reports, calendar, reflection) is the slim JSONL journal
// via persistJobRecord, NOT these notes — so turning the mirror off loses no
// function. Set CLAWBOT_JOURNAL_TO_VAULT=1 to restore the second-brain mirror.
const JOURNAL_TO_VAULT = process.env.CLAWBOT_JOURNAL_TO_VAULT === "1";
let activeJobs = 0;
const slotWaiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (MAX_CONCURRENT_JOBS <= 0) return Promise.resolve();
  if (activeJobs < MAX_CONCURRENT_JOBS) { activeJobs += 1; return Promise.resolve(); }
  // At capacity — queue. The waiter inherits the releaser's slot (activeJobs
  // stays at the cap), so there's no double-count.
  return new Promise<void>((resolve) => slotWaiters.push(resolve));
}
function releaseSlot(): void {
  if (MAX_CONCURRENT_JOBS <= 0) return;
  const next = slotWaiters.shift();
  if (next) next();                       // hand the slot straight to the next in line
  else activeJobs = Math.max(0, activeJobs - 1);
}

export function jobQueueStatus(): { cap: number; active: number; queued: number } {
  return { cap: MAX_CONCURRENT_JOBS, active: activeJobs, queued: slotWaiters.length };
}

export async function runJob<T>(j: Job, fn: (push: (msg: string) => void, progress: ProgressUpdater) => Promise<T>): Promise<void> {
  // Backpressure gate. Stays `pending` (pollable) while queued. If the job was
  // aborted (e.g. graceful shutdown) while waiting, bail without running.
  if (MAX_CONCURRENT_JOBS > 0 && activeJobs >= MAX_CONCURRENT_JOBS) {
    const ahead = slotWaiters.length;
    try { ensureEmitter(j.id); } catch { /* tolerate */ }
    j.log.push(`[${new Date().toISOString()}] Queued — ${ahead} task${ahead === 1 ? "" : "s"} ahead (cap ${MAX_CONCURRENT_JOBS} running at once).`);
  }
  await acquireSlot();
  if (j.status === "failed" || j.status === "rejected") { releaseSlot(); return; }
  j.status = "running";
  const ee = ensureEmitter(j.id);
  const push = (m: string) => {
    const line = `[${new Date().toISOString()}] ${m}`;
    j.log.push(line);
    // SSE subscribers receive each line as it's appended. Errors in
    // listeners must not crash the job runner — wrap in try.
    try { ee.emit("log", line); } catch { /* tolerate */ }
  };
  const progress: ProgressUpdater = (patch) => {
    j.result = { ...(j.result ?? {}), ...patch } as Record<string, unknown>;
    try { ee.emit("patch", patch); } catch { /* tolerate */ }
  };
  try {
    const final = await fn(push, progress);
    if (final && typeof final === "object") {
      j.result = { ...(j.result ?? {}), ...(final as Record<string, unknown>) };
    } else if (final !== undefined) {
      j.result = final;
    }
    j.status = "succeeded";
  } catch (e: any) {
    j.status = "failed";
    j.error = e.message ?? String(e);
    push(`error: ${j.error}`);
  } finally {
    j.finishedAt = new Date().toISOString();
    // Mirror the job into the vault as a note — OFF by default for ad-hoc tasks
    // (a file per task cluttered the real vault). SCHEDULED runs are the
    // exception: those are the progress reports the operator wants in the
    // second brain (daily briefing, recurring digests). Opt everything in with
    // CLAWBOT_JOURNAL_TO_VAULT=1.
    if (JOURNAL_TO_VAULT || j.scheduledBy) void journalJob(j);
    // Append a slim JSONL record to .neuroworks/jobs/ so the nightly
    // reflection still sees this job after the in-memory RECENT=200 cap
    // evicts it or the server restarts. Synchronous + best-effort —
    // appendFileSync is fast, and persistJobRecord swallows errors so a
    // disk hiccup can't fail the response.
    persistJobRecord(j);
    // Notify SSE subscribers the job ended so they can close their
    // streams cleanly, then drop the emitter after a short grace.
    try { ee.emit("done", { status: j.status, error: j.error }); } catch { /* tolerate */ }
    dropEmitter(j.id);
    // Release the concurrency slot LAST so the next queued job starts only
    // after this one is fully wound down.
    releaseSlot();
  }
}

async function journalJob(j: Job) {
  try {
    const r: any = j.result ?? {};
    const lines: string[] = [];
    lines.push(`- **Status:** ${j.status}`);
    lines.push(`- **Template:** ${j.template ?? j.kind}`);
    lines.push(`- **Started:** ${j.startedAt}`);
    if (j.finishedAt) lines.push(`- **Finished:** ${j.finishedAt}`);
    if (j.title) lines.push(`- **Title:** ${j.title}`);
    if (j.inputs && Object.keys(j.inputs).length > 0) {
      lines.push("");
      lines.push("## Inputs");
      lines.push("```json");
      lines.push(JSON.stringify(j.inputs, null, 2));
      lines.push("```");
    }
    if (r.plan?.summary) {
      lines.push("");
      lines.push("## Plan");
      lines.push(r.plan.summary);
    }
    if (Array.isArray(r.plan?.steps) && r.plan.steps.length > 0) {
      lines.push("");
      lines.push("### Steps");
      for (let i = 0; i < r.plan.steps.length; i++) {
        const s = r.plan.steps[i];
        const run = r.runs?.[i];
        const mark = run?.ok ? "✓" : run?.error ? "✗" : "·";
        const modelTag = run?.modelUsed ? ` · model \`${run.modelUsed}\`` : "";
        lines.push(`${i + 1}. ${mark} ${s.label ?? s.tool} — \`${s.tool}\`${run?.durationMs != null ? ` (${(run.durationMs / 1000).toFixed(1)}s)` : ""}${modelTag}`);
        if (s.rationale) lines.push(`    > ${s.rationale}`);
        if (run?.error) lines.push(`    error: ${run.error}`);
      }
    }
    if (typeof r.answer === "string" && r.answer.trim()) {
      lines.push("");
      lines.push("## Answer");
      lines.push(r.answer);
    }
    if (j.error) {
      lines.push("");
      lines.push("## Error");
      lines.push("```");
      lines.push(j.error);
      lines.push("```");
    }
    if (j.log.length > 0) {
      lines.push("");
      lines.push("<details><summary>Log</summary>");
      lines.push("");
      lines.push("```");
      lines.push(j.log.slice(-50).join("\n"));
      lines.push("```");
      lines.push("</details>");
    }
    const slug = (j.title ?? j.template ?? j.kind).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60) + "-" + j.id.slice(0, 8);
    // Stamp the active persona on every journal entry so vault searches like
    // `tags: clawbot` or frontmatter filters can isolate one persona's work.
    const activePersona = getActivePersona();
    await journal({
      kind: "job",
      slug,
      title: j.title ?? `${j.template ?? j.kind} (${j.status})`,
      frontmatter: {
        jobId: j.id,
        status: j.status,
        template: j.template ?? j.kind,
        persona: activePersona?.id ?? "none",
        personaName: activePersona?.name ?? "",
        startedAt: j.startedAt,
        finishedAt: j.finishedAt ?? "",
      },
      body: lines.join("\n"),
    });
  } catch { /* journal must never crash a job */ }
}
