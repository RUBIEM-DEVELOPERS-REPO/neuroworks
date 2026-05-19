import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { journal } from "./journal.js";
import { getActivePersona } from "./personas.js";
import { persistJobRecord } from "./job-store.js";

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
  requiresApproval?: boolean;
  approvedAt?: string;
  rejectedAt?: string;
};

const jobs = new Map<string, Job>();
const RECENT = 50;

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
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    if (oldest) jobs.delete(oldest.id);
  }
  return j;
}

export function getJob(id: string) { return jobs.get(id); }
export function listJobs() { return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }

export type ProgressUpdater = (patch: Record<string, unknown>) => void;

export async function runJob<T>(j: Job, fn: (push: (msg: string) => void, progress: ProgressUpdater) => Promise<T>): Promise<void> {
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
    // Mirror the job into the vault so every task NeuroWorks runs is in the
    // second brain. Don't await — never block the response on vault I/O.
    void journalJob(j);
    // Append a slim JSONL record to .neuroworks/jobs/ so the nightly
    // reflection still sees this job after the in-memory RECENT=50 cap
    // evicts it or the server restarts. Synchronous + best-effort —
    // appendFileSync is fast, and persistJobRecord swallows errors so a
    // disk hiccup can't fail the response.
    persistJobRecord(j);
    // Notify SSE subscribers the job ended so they can close their
    // streams cleanly, then drop the emitter after a short grace.
    try { ee.emit("done", { status: j.status, error: j.error }); } catch { /* tolerate */ }
    dropEmitter(j.id);
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
