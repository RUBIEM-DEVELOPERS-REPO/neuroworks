// Append-only JSONL persistence for completed jobs.
//
// The in-memory job map in jobs.ts caps at RECENT=50 and dies with the
// process. That's fine for the live "Activity" page (recent runs only),
// but breaks the nightly reflection: anything older than 50 jobs OR
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
      persona: r.activePersona?.name ?? inputs.activePersona?.name ?? r.persona?.name,
      peer: r.peer?.name,
      runs: Array.isArray(r.runs)
        ? r.runs.map((run: any) => ({
            tool: run?.step?.tool ?? "unknown",
            durationMs: typeof run?.durationMs === "number" ? run.durationMs : 0,
            ok: run?.ok === true,
            error: run?.error,
          }))
        : undefined,
      skillUsed: r.skillUsed,
      skillScore: typeof r.skillScore === "number" ? r.skillScore : undefined,
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
    inputs: rec.retryOf ? { retryOf: rec.retryOf } : undefined,
    result: {
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
