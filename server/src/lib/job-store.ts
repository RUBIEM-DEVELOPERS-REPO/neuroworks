// Append-only JSONL persistence for completed jobs.
//
// The in-memory job map in jobs.ts caps at RECENT=200 and dies with the
// process. That's fine for the live "Activity" page (recent runs only),
// but breaks the nightly reflection: anything older than the cap OR
// older than the last restart vanishes. Reflection then aggregates a
// random truncated sample and produces a misleading "what went wrong"
// section.
//
// This store appends a slim record per completed job to
// .neuroworks/jobs/<YYYY-MM-DD>.jsonl on the local filesystem. Append-
// only JSONL because:
//   - durable across restarts
//   - cheap (single fs.appendFileSync per job; no DB dep)
//   - human-readable (jq-able for ad-hoc analysis)
//   - per-day rotation keeps any single file small
//   - .neuroworks/ is gitignored — no vault repo noise from machine state
//
// Reflection reads back via loadJobsInWindow(); jobs.ts calls
// persistJobRecord() at the end of every runJob.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { Job } from "./jobs.js";

const JOBS_DIR = resolve(process.cwd(), ".neuroworks", "jobs");

// Slim job shape we persist. Reflection reads these fields; everything
// else (full log, raw answer text, large inputs) stays in the in-memory
// Job and the markdown journal entry. Keeping the JSONL terse means a
// year of heavy-traffic data is still small enough to scan in one read.
export type PersistedJob = {
  id: string;
  kind: string;
  status: Job["status"];
  startedAt: string;
  finishedAt?: string;
  template?: string;
  title?: string;
  error?: string;
  retryOf?: string;
  // Continuation lineage — when this job was a "Continue this task" reply
  // to an earlier job that asked for missing context. Both fields are
  // optional; the original-job's id lets a future reflection / report
  // stitch the chain back together even across server restarts.
  continuesJobId?: string;
  continuesOriginalText?: string;
  continuesSummary?: string;
  // Human-in-the-loop pause state. humanRequest carries the structured ask
  // (items + reason + requestedAt, resolvedAt once answered); task is the
  // full original task text, persisted ONLY for waiting jobs so the resume
  // endpoint can rebuild the continuation after a restart evicts the
  // in-memory job. Both absent on normal runs — zero cost to the JSONL.
  humanRequest?: { items: { type: string; prompt: string }[]; reason?: string; requestedAt: string; resolvedAt?: string };
  task?: string;
  persona?: string;
  peer?: string;
  // One entry per tool invocation inside the job — used by reflection's
  // tool-stats aggregation. Only the fields aggregate() reads.
  runs?: { tool: string; durationMs: number; ok: boolean; error?: string }[];
  // Skill the agent picked for this task and its score (filled in once
  // the skill-feedback patch lands — see #6 in the audit). Optional so
  // existing jobs persisted before that patch are forward-compatible.
  skillUsed?: string;
  skillScore?: number;
  // Synthesised answer + plan summary. Persisted so the Calendar's
  // day-detail panel can deep-link an old job into /results/<id> and the
  // Result page still has the actual report to show. Capped at 16 KB per
  // record so the daily JSONL stays under a few MB even at high volume.
  answer?: string;
  planSummary?: string;
  planSteps?: string[];
};

function ensureDir(): void {
  if (!existsSync(JOBS_DIR)) mkdirSync(JOBS_DIR, { recursive: true });
}

function dateKey(iso: string): string {
  // YYYY-MM-DD from an ISO timestamp. Fall back to today if parse fails.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// Best-effort. Persistence must never throw — a disk failure can't take
// a successful job's response down with it. We log warn-level so a real
// problem still surfaces in stdout.
export function persistJobRecord(j: Job): void {
  try {
    ensureDir();
    const r: any = j.result ?? {};
    const inputs: any = j.inputs ?? {};
    const record: PersistedJob = {
      id: j.id,
      kind: j.kind,
      status: j.status,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      template: j.template,
      title: j.title,
      error: j.error,
      retryOf: inputs.retryOf,
      continuesJobId: typeof inputs.continuesJobId === "string" ? inputs.continuesJobId : undefined,
      continuesOriginalText: typeof inputs.continuesOriginalText === "string" ? inputs.continuesOriginalText.slice(0, 400) : undefined,
      continuesSummary: typeof inputs.continuesSummary === "string" ? inputs.continuesSummary.slice(0, 200) : undefined,
      humanRequest: r.humanRequest && Array.isArray(r.humanRequest.items) ? r.humanRequest : undefined,
      task: j.status === "waiting_on_human" && typeof inputs.task === "string" ? inputs.task.slice(0, 4000)
        : j.status === "waiting_on_human" && typeof j.task === "string" ? j.task.slice(0, 4000) : undefined,
      // Prefer the dispatch-time name set on the job (canonical) over
      // legacy result/input shapes. Pre-B5 records still read via the
      // fallback chain for back-compat.
      persona: j.personaName ?? r.activePersona?.name ?? inputs.activePersona?.name ?? r.persona?.name,
      peer: r.peer?.name,
      runs: Array.isArray(r.runs)
        ? r.runs
            // Drop runs that never EXECUTED (ok=false, no error, 0ms, never
            // started) — placeholder entries for steps skipped after a plan
            // abort or human.request pause. Persisting them poisoned the
            // reflection's tool stats: 7 phantom "ollama.generate failures at
            // 0ms" read as an 80% backend failure rate when Ollama was fine.
            .filter((run: any) => run?.ok === true || run?.error || run?.startedAt || (typeof run?.durationMs === "number" && run.durationMs > 0))
            .map((run: any) => ({
            tool: run?.step?.tool ?? "unknown",
            durationMs: typeof run?.durationMs === "number" ? run.durationMs : 0,
            ok: run?.ok === true,
            error: run?.error,
          }))
        : undefined,
      skillUsed: r.skillUsed,
      skillScore: typeof r.skillScore === "number" ? r.skillScore : undefined,
      // The synthesised customer-facing answer. Cap at 16 KB so a single
      // verbose job can't bloat the daily JSONL. Most answers come in
      // well under 2 KB; the cap protects against the long tail.
      answer: typeof r.answer === "string" ? r.answer.slice(0, 16 * 1024) : undefined,
      planSummary: typeof r.plan?.summary === "string" ? r.plan.summary.slice(0, 400) : undefined,
      planSteps: Array.isArray(r.plan?.steps)
        ? r.plan.steps.slice(0, 16).map((s: any) => String(s?.tool ?? "unknown"))
        : undefined,
    };
    const day = dateKey(j.startedAt);
    const path = join(JOBS_DIR, `${day}.jsonl`);
    appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
  } catch (e: any) {
    console.warn(`[job-store] persist failed for ${j.id}: ${e?.message ?? e}`);
  }
}

// Read every persisted job whose startedAt falls inside the window.
// Window is exclusive on the right edge to match reflection semantics
// (a job starting exactly at midnight belongs to that new day, not the
// previous). Files outside the window are skipped without opening.
export function loadJobsInWindow(windowStartMs: number, windowEndMs: number): PersistedJob[] {
  try {
    if (!existsSync(JOBS_DIR)) return [];
    const files = readdirSync(JOBS_DIR).filter(f => f.endsWith(".jsonl"));
    // The window spans at most a few days for a 24h reflection, but the
    // helper also supports longer ranges. We open every file whose name
    // (YYYY-MM-DD) falls inside the bounding day range.
    const startDay = new Date(windowStartMs).toISOString().slice(0, 10);
    const endDay = new Date(windowEndMs).toISOString().slice(0, 10);
    const out: PersistedJob[] = [];
    for (const fname of files) {
      const day = fname.slice(0, 10);
      if (day < startDay || day > endDay) continue;
      const full = join(JOBS_DIR, fname);
      let body: string;
      try { body = readFileSync(full, "utf8"); } catch { continue; }
      for (const line of body.split("\n")) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as PersistedJob;
          const t = new Date(rec.startedAt).getTime();
          if (t >= windowStartMs && t < windowEndMs) out.push(rec);
        } catch {
          // tolerate a malformed line — partial appendFile write under
          // a crash is rare but possible; one bad line shouldn't drop
          // the whole window.
        }
      }
    }
    return out;
  } catch (e: any) {
    console.warn(`[job-store] load failed: ${e?.message ?? e}`);
    return [];
  }
}

// Look up a single persisted job by id. Used by the /api/templates/jobs/:id
// fallback when a job is no longer in the in-memory map (e.g. evicted by
// the RECENT cap, server restart, or just an old job linked from the
// Calendar's day-detail panel). Scans the daily JSONL files newest-first
// since recent jobs are the most likely target. Returns undefined when no
// match is found across the whole journal.
//
// Note: the JSONL append-only design means there may be multiple records
// for the same id if the job was updated more than once (e.g. running →
// succeeded). We return the LAST occurrence — that's the most recent state.
export function loadJobById(id: string): PersistedJob | undefined {
  try {
    if (!existsSync(JOBS_DIR)) return undefined;
    const files = readdirSync(JOBS_DIR)
      .filter(f => f.endsWith(".jsonl"))
      .sort((a, b) => b.localeCompare(a)); // newest day first
    for (const fname of files) {
      const full = join(JOBS_DIR, fname);
      let body: string;
      try { body = readFileSync(full, "utf8"); } catch { continue; }
      // Walk lines in reverse so the LAST record for the id wins. Most
      // day files are small (hundreds of jobs); the cost is bounded.
      const lines = body.split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.trim()) continue;
        // Cheap substring check before parse — saves JSON.parse on most lines.
        if (!line.includes(`"${id}"`)) continue;
        try {
          const rec = JSON.parse(line) as PersistedJob;
          if (rec.id === id) return rec;
        } catch { /* tolerate malformed line */ }
      }
    }
    return undefined;
  } catch (e: any) {
    console.warn(`[job-store] loadJobById failed: ${e?.message ?? e}`);
    return undefined;
  }
}

// Reflection wants a Job-shaped object (kind, status, startedAt,
// finishedAt, result.runs, etc.) so it can reuse aggregate() unchanged.
// This shim hydrates a PersistedJob into a synthetic Job.
export function asJob(rec: PersistedJob): Job {
  return {
    id: rec.id,
    kind: rec.kind,
    status: rec.status,
    startedAt: rec.startedAt,
    finishedAt: rec.finishedAt,
    log: [],
    template: rec.template,
    title: rec.title,
    error: rec.error,
    personaName: rec.persona,
    inputs: (rec.retryOf || rec.continuesJobId || rec.task) ? {
      ...(rec.retryOf ? { retryOf: rec.retryOf } : {}),
      ...(rec.continuesJobId ? { continuesJobId: rec.continuesJobId } : {}),
      ...(rec.continuesOriginalText ? { continuesOriginalText: rec.continuesOriginalText } : {}),
      ...(rec.continuesSummary ? { continuesSummary: rec.continuesSummary } : {}),
      ...(rec.task ? { task: rec.task } : {}),
    } : undefined,
    result: {
      ...(rec.humanRequest ? { humanRequest: rec.humanRequest } : {}),
      activePersona: rec.persona ? { name: rec.persona } : undefined,
      peer: rec.peer ? { name: rec.peer } : undefined,
      runs: rec.runs?.map(r => ({
        step: { tool: r.tool },
        durationMs: r.durationMs,
        ok: r.ok,
        error: r.error,
      })),
      skillUsed: rec.skillUsed,
      skillScore: rec.skillScore,
      // Hydrate the persisted answer + plan so the Result page renders
      // the report when /api/templates/jobs/:id is served via the
      // loadJobById fallback path (job evicted from in-memory cap).
      answer: rec.answer,
      plan: (rec.planSummary || rec.planSteps)
        ? {
            summary: rec.planSummary,
            steps: (rec.planSteps ?? []).map(tool => ({ tool, args: {}, rationale: "" })),
          }
        : undefined,
    },
  };
}

// Stats for /api/status surfacing — how much history do we actually have?
export function jobStoreStats(): { files: number; totalBytes: number; oldestDay?: string; newestDay?: string } {
  try {
    if (!existsSync(JOBS_DIR)) return { files: 0, totalBytes: 0 };
    const files = readdirSync(JOBS_DIR).filter(f => f.endsWith(".jsonl")).sort();
    let totalBytes = 0;
    for (const f of files) {
      try { totalBytes += statSync(join(JOBS_DIR, f)).size; } catch { /* tolerate */ }
    }
    return {
      files: files.length,
      totalBytes,
      oldestDay: files[0]?.slice(0, 10),
      newestDay: files[files.length - 1]?.slice(0, 10),
    };
  } catch {
    return { files: 0, totalBytes: 0 };
  }
}
