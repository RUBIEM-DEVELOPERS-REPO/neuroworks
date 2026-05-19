// Nightly self-reflection. Once a day, the primary clawbot looks back at the
// tasks it ran in the last 24 hours, aggregates raw stats (success rates, slow
// steps, failure patterns, employee attribution, tool reliability), and asks
// the LLM to produce a structured reflection: what went well, what went
// wrong, what to try differently. The output lands in
// `_neuroworks/reflections/<YYYY-MM-DD>.md` as a daily journal entry the
// customer can read in their vault.
//
// This is the learning loop: stats + LLM synthesis + persisted insight. We
// don't auto-apply changes (that would surprise the customer), but the
// reflections accumulate over time and surface patterns the customer can
// act on — "tool X fails 40% of the time; switch to Y" — and that future
// agent runs can read via vault.search.

import { listJobs, type Job } from "./jobs.js";
import { writeVaultFile } from "./vault.js";
import { enqueueVaultCommit } from "./commit-queue.js";
import { llmGenerate } from "./llm.js";
import { loadJobsInWindow, asJob, type PersistedJob } from "./job-store.js";
import { config } from "../config.js";

const REFLECTION_DIR = "_neuroworks/reflections";

// Pulled stats — what the LLM reflects on. Kept structured so future tooling
// (charts, trend lines) can read the raw shape without re-parsing prose.
export type DailyStats = {
  date: string;            // YYYY-MM-DD, the day this reflection covers
  windowStart: string;     // ISO timestamp
  windowEnd: string;       // ISO timestamp
  totalTasks: number;
  succeeded: number;
  failed: number;
  rejected: number;
  successRate: number;     // 0..1
  byKind: Record<string, { total: number; ok: number; failed: number }>;
  byTemplate: Record<string, { total: number; ok: number; failed: number; avgDurationSec: number }>;
  byPersona: Record<string, number>;
  byPeer: Record<string, number>;
  topFailures: { error: string; count: number; templates: string[] }[];
  slowestSteps: { tool: string; durationSec: number; jobId: string }[];
  toolStats: { tool: string; runs: number; ok: number; failed: number; avgDurationSec: number; failureRate: number }[];
  retries: { jobId: string; title?: string }[];
  // Skill picker telemetry — surfaces which playbook guided each task and
  // how often picks correlated with success. Reflection uses this to spot
  // patterns like "skill X chosen N times but only succeeded M". Skills
  // with avgScore < 20 are keyword-only matches (no intent agreement),
  // which is the weakest signal the picker offers.
  skillStats: { skill: string; runs: number; ok: number; failed: number; successRate: number; avgScore: number }[];
};

export type ReflectionResult = {
  date: string;
  path: string;
  stats: DailyStats;
  reflection: string;       // markdown body
  generatedAt: string;
  modelUsed?: string;
};

let lastResult: ReflectionResult | null = null;
let inFlight: Promise<ReflectionResult> | null = null;

// Pull every job that falls inside the window.
//
// Sources, in this order of trust:
//   1. .neuroworks/jobs/<date>.jsonl — local disk, durable.
//   2. listJobs() in-memory cap — local jobs not yet flushed.
//   3. Each peer's /api/peers/jobs?since=&until= — the secondary's work
//      that a delegation routed there. Without this, the reflection
//      only sees what the primary handled and dramatically undercounts
//      fleet activity on busy days.
//
// Dedupe by id. Disk wins over memory wins over peers, since disk
// reflects FINAL status; in-memory may be mid-run; peer responses are a
// snapshot in time.
async function collectJobsInWindow(windowStartMs: number, windowEndMs: number): Promise<Job[]> {
  const seen = new Set<string>();
  const out: Job[] = [];
  for (const rec of loadJobsInWindow(windowStartMs, windowEndMs)) {
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);
    out.push(asJob(rec));
  }
  for (const j of listJobs()) {
    if (seen.has(j.id)) continue;
    const t = j.startedAt ? new Date(j.startedAt).getTime() : 0;
    if (t < windowStartMs || t >= windowEndMs) continue;
    seen.add(j.id);
    out.push(j);
  }
  // Fan out to peers in parallel. 5s per-peer timeout — reflection runs
  // nightly, no rush, but we don't want one slow peer to stall the whole
  // pipeline. Errors are swallowed: a missing peer just means we
  // aggregate less, not that we crash the run.
  if (config.peers.length > 0) {
    const since = new Date(windowStartMs).toISOString();
    const until = new Date(windowEndMs).toISOString();
    const peerResults = await Promise.allSettled(
      config.peers.map(async (base) => {
        const url = `${base.replace(/\/+$/, "")}/api/peers/jobs?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5_000);
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = (await r.json()) as { jobs?: PersistedJob[] };
          return data.jobs ?? [];
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    for (const r of peerResults) {
      if (r.status !== "fulfilled") continue;
      for (const rec of r.value) {
        if (seen.has(rec.id)) continue;
        seen.add(rec.id);
        out.push(asJob(rec));
      }
    }
  }
  return out;
}

function aggregate(jobs: Job[], windowStartMs: number, windowEndMs: number): DailyStats {
  const date = new Date(windowStartMs).toISOString().slice(0, 10);
  const byKind: DailyStats["byKind"] = {};
  const byTemplate: Record<string, { total: number; ok: number; failed: number; totalSec: number }> = {};
  const byPersona: Record<string, number> = {};
  const byPeer: Record<string, number> = {};
  const failureBuckets: Record<string, { count: number; templates: Set<string> }> = {};
  const slowSteps: { tool: string; durationSec: number; jobId: string }[] = [];
  const toolBuckets: Record<string, { runs: number; ok: number; failed: number; totalSec: number }> = {};
  const retries: { jobId: string; title?: string }[] = [];
  const skillBuckets: Record<string, { runs: number; ok: number; failed: number; totalScore: number }> = {};

  let succeeded = 0, failed = 0, rejected = 0;

  for (const j of jobs) {
    const k = j.kind ?? "unknown";
    byKind[k] = byKind[k] ?? { total: 0, ok: 0, failed: 0 };
    byKind[k].total++;
    if (j.status === "succeeded") { succeeded++; byKind[k].ok++; }
    else if (j.status === "failed") { failed++; byKind[k].failed++; }
    else if (j.status === "rejected") { rejected++; byKind[k].failed++; }

    const tpl = j.template ?? j.kind ?? "unknown";
    byTemplate[tpl] = byTemplate[tpl] ?? { total: 0, ok: 0, failed: 0, totalSec: 0 };
    byTemplate[tpl].total++;
    if (j.status === "succeeded") byTemplate[tpl].ok++;
    if (j.status === "failed" || j.status === "rejected") byTemplate[tpl].failed++;
    if (j.startedAt && j.finishedAt) {
      const sec = (new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000;
      byTemplate[tpl].totalSec += sec;
    }

    const r: any = j.result ?? {};
    const personaName = r.activePersona?.name ?? (j.inputs as any)?.activePersona?.name ?? r.persona?.name;
    if (personaName) byPersona[personaName] = (byPersona[personaName] ?? 0) + 1;
    const peerName = r.peer?.name;
    if (peerName) byPeer[peerName] = (byPeer[peerName] ?? 0) + 1;
    if ((j.inputs as any)?.retryOf) retries.push({ jobId: j.id, title: j.title });

    // Skill picker telemetry. We bucket every job that had a skill pick
    // — including failed ones — so the reflection can spot patterns like
    // "skill X chosen 12 times but only succeeded 4". avgScore tracks
    // how confident the picker was: < 20 means keyword-only, 20+ means
    // intent agreement, 30+ means both signals fired.
    const skill = typeof r.skillUsed === "string" ? r.skillUsed : undefined;
    if (skill) {
      skillBuckets[skill] = skillBuckets[skill] ?? { runs: 0, ok: 0, failed: 0, totalScore: 0 };
      skillBuckets[skill].runs++;
      if (j.status === "succeeded") skillBuckets[skill].ok++;
      else if (j.status === "failed" || j.status === "rejected") skillBuckets[skill].failed++;
      if (typeof r.skillScore === "number") skillBuckets[skill].totalScore += r.skillScore;
    }

    if (j.status === "failed" && j.error) {
      // Bucket failures by a normalised prefix so similar errors merge.
      const norm = j.error.slice(0, 80).replace(/\d+/g, "N").replace(/[a-f0-9]{8,}/gi, "<hash>");
      failureBuckets[norm] = failureBuckets[norm] ?? { count: 0, templates: new Set() };
      failureBuckets[norm].count++;
      failureBuckets[norm].templates.add(tpl);
    }

    const runs = Array.isArray(r.runs) ? r.runs : [];
    for (const run of runs) {
      const tool = run?.step?.tool ?? "unknown";
      toolBuckets[tool] = toolBuckets[tool] ?? { runs: 0, ok: 0, failed: 0, totalSec: 0 };
      toolBuckets[tool].runs++;
      if (run.ok) toolBuckets[tool].ok++;
      else toolBuckets[tool].failed++;
      const sec = (run.durationMs ?? 0) / 1000;
      toolBuckets[tool].totalSec += sec;
      if (sec >= 30) slowSteps.push({ tool, durationSec: Math.round(sec), jobId: j.id });
    }
  }

  const topFailures = Object.entries(failureBuckets)
    .map(([error, v]) => ({ error, count: v.count, templates: [...v.templates] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  slowSteps.sort((a, b) => b.durationSec - a.durationSec);
  const toolStats = Object.entries(toolBuckets).map(([tool, v]) => ({
    tool,
    runs: v.runs,
    ok: v.ok,
    failed: v.failed,
    avgDurationSec: v.runs > 0 ? Math.round((v.totalSec / v.runs) * 10) / 10 : 0,
    failureRate: v.runs > 0 ? Math.round((v.failed / v.runs) * 100) / 100 : 0,
  })).sort((a, b) => b.runs - a.runs);
  const skillStats = Object.entries(skillBuckets).map(([skill, v]) => ({
    skill,
    runs: v.runs,
    ok: v.ok,
    failed: v.failed,
    successRate: v.runs > 0 ? Math.round((v.ok / v.runs) * 100) / 100 : 0,
    avgScore: v.runs > 0 ? Math.round((v.totalScore / v.runs) * 10) / 10 : 0,
  })).sort((a, b) => b.runs - a.runs);

  return {
    date,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    totalTasks: jobs.length,
    succeeded,
    failed,
    rejected,
    successRate: jobs.length > 0 ? Math.round((succeeded / jobs.length) * 100) / 100 : 0,
    byKind,
    byTemplate: Object.fromEntries(Object.entries(byTemplate).map(([t, v]) => [
      t,
      { total: v.total, ok: v.ok, failed: v.failed, avgDurationSec: v.total > 0 ? Math.round((v.totalSec / v.total) * 10) / 10 : 0 },
    ])),
    byPersona,
    byPeer,
    topFailures,
    slowestSteps: slowSteps.slice(0, 8),
    toolStats: toolStats.slice(0, 12),
    retries,
    skillStats: skillStats.slice(0, 12),
  };
}

// Ask the LLM to synthesize a reflection. complexity: "high" so the dispatcher
// hands it off to the large-tier OR model when configured — this prompt is
// long-ish and the customer reads it the next morning, so quality matters.
async function synthesizeReflection(stats: DailyStats): Promise<{ text: string; modelUsed?: string }> {
  if (stats.totalTasks === 0) {
    return {
      text: `_No tasks ran on ${stats.date}. Nothing to reflect on yet — start a task in Chat and the next reflection will have material to work with._`,
    };
  }

  const sys = `You are NeuroWorks's daily reflection writer. The customer hired AI employees and the clawbot fleet ran their tasks yesterday. Your job is to look at the raw stats and produce a HONEST, CONCISE reflection in markdown.

Output sections — use these EXACT headings:
## What went well
2-4 bullet points. Concrete wins from yesterday. Reference real numbers from the stats.

## What went wrong
2-4 bullet points. Real failure patterns. Name the tool, error, or template. If nothing went wrong, say so plainly — don't invent problems.

## What I notice
1-3 observations about how the system is being used. Tool preferences, persona patterns, peer load — whatever's interesting from the data.

## What to try next
2-4 specific, actionable changes the customer or the system could make. Each MUST be concrete (a tool to prefer, a config to flip, a persona to retire). Avoid vague advice like "improve quality".

Rules:
- Be terse. The customer reads this in 60 seconds.
- Numbers always. "Failed 4 of 6 runs" beats "often failed".
- No filler ("Overall, today was…"). No emoji.
- If the stats are thin, say so honestly — don't pad.`;

  const prompt = `Date: ${stats.date}
Window: ${stats.windowStart} → ${stats.windowEnd}

## Raw stats

Total tasks: ${stats.totalTasks} (${stats.succeeded} succeeded, ${stats.failed} failed, ${stats.rejected} rejected)
Success rate: ${(stats.successRate * 100).toFixed(0)}%

### By kind
${Object.entries(stats.byKind).map(([k, v]) => `- ${k}: ${v.total} (${v.ok} ok, ${v.failed} failed)`).join("\n") || "_(none)_"}

### By template
${Object.entries(stats.byTemplate).map(([t, v]) => `- ${t}: ${v.total} total, ${v.failed} failed, avg ${v.avgDurationSec}s`).join("\n") || "_(none)_"}

### Employees on the clock
${Object.entries(stats.byPersona).map(([p, n]) => `- ${p}: ${n} tasks`).join("\n") || "_(none recorded)_"}

### Peer attribution
${Object.entries(stats.byPeer).map(([p, n]) => `- ${p}: ${n} delegations`).join("\n") || "_(no delegations — all local)_"}

### Top failures
${stats.topFailures.map(f => `- "${f.error}" — ${f.count}x (templates: ${f.templates.join(", ")})`).join("\n") || "_(no failures)_"}

### Slowest steps
${stats.slowestSteps.map(s => `- ${s.tool} — ${s.durationSec}s (job ${s.jobId.slice(0, 8)})`).join("\n") || "_(no slow steps)_"}

### Tool reliability
${stats.toolStats.map(t => `- ${t.tool}: ${t.runs} runs, ${(t.failureRate * 100).toFixed(0)}% failure rate, avg ${t.avgDurationSec}s`).join("\n") || "_(no tool runs)_"}

### Skill picker correlations
${stats.skillStats.length > 0
  ? stats.skillStats.map(s => `- ${s.skill}: ${s.runs} runs (${s.ok} ok, ${s.failed} failed) — ${(s.successRate * 100).toFixed(0)}% success, avg picker score ${s.avgScore} (${s.avgScore >= 30 ? "intent + keyword" : s.avgScore >= 20 ? "intent only" : "keyword only — weak match"})`).join("\n")
  : "_(no skill picks recorded)_"}
${stats.skillStats.some(s => s.runs >= 3 && s.successRate < 0.5) ? "_Note: at least one skill has 3+ runs and a sub-50% success rate — investigate whether the playbook needs revision or the picker is misrouting._" : ""}

${stats.retries.length > 0 ? `### Retried tasks\n${stats.retries.map(r => `- ${r.title ?? r.jobId} (${r.jobId.slice(0, 8)})`).join("\n")}` : ""}

Write the reflection. Honest, terse, numerically grounded.`;

  // Single retry before falling back. The reflection LLM call is a
  // big complex synthesis (large context, complexity:"high") that goes
  // through OpenRouter when configured — a transient 429 or network
  // blip would otherwise lose the whole day's reflection. One retry
  // with a 2s backoff catches the common transient failures (TLS
  // hiccup, rate-limit window) without dragging the run out if the
  // underlying problem is real (auth, model not pulled).
  let lastErr: any;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const meta = await import("./llm.js").then(m => m.llmGenerateWithMeta(prompt, sys, { profile: "synthesis", complexity: "high" }));
      if (attempt > 0) {
        console.log(`[reflection] LLM call succeeded on retry`);
      }
      return { text: meta.text.trim(), modelUsed: meta.model };
    } catch (e: any) {
      lastErr = e;
      if (attempt === 0) {
        const msg = String(e?.message ?? e).slice(0, 100);
        console.warn(`[reflection] LLM call failed (${msg}) — retrying once in 2s`);
        await new Promise(r => setTimeout(r, 2_000));
        continue;
      }
    }
  }
  // Fallback: produce a stat-only reflection so the file still lands.
  return {
    text: `_LLM reflection failed after retry (\`${String(lastErr?.message ?? lastErr).slice(0, 100)}\`). The raw stats above are still valid — review them manually._\n\n## What to try next\n- Investigate the LLM error above and re-run \`/api/reflection/run\` once it's resolved.`,
  };
}

function renderMarkdown(result: { stats: DailyStats; text: string; generatedAt: string; modelUsed?: string }): string {
  const s = result.stats;
  const header = `---
type: reflection
date: ${s.date}
totalTasks: ${s.totalTasks}
successRate: ${s.successRate}
generated: ${result.generatedAt}
${result.modelUsed ? `model: ${result.modelUsed}\n` : ""}---

# Daily reflection — ${s.date}

_${s.totalTasks} tasks · ${s.succeeded} succeeded · ${s.failed} failed · ${(s.successRate * 100).toFixed(0)}% success rate_

`;
  const footer = `

---

<details><summary>Raw stats snapshot</summary>

\`\`\`json
${JSON.stringify(s, null, 2)}
\`\`\`

</details>
`;
  return header + result.text.trim() + footer;
}

// Run the reflection NOW. Idempotent across concurrent calls — a second
// invocation while one's in flight returns the same promise. Result is
// cached in `lastResult` for the /api endpoint.
export async function runReflection(opts: { windowHours?: number; force?: boolean } = {}): Promise<ReflectionResult> {
  if (inFlight) return inFlight;
  const windowHours = opts.windowHours ?? 24;
  const windowEndMs = Date.now();
  const windowStartMs = windowEndMs - windowHours * 3600_000;
  inFlight = (async () => {
    // Peer fan-out makes collectJobsInWindow async; resolve inside the
    // promise so concurrent runReflection() callers share the same
    // peer-fetch wave rather than each issuing their own.
    const jobs = await collectJobsInWindow(windowStartMs, windowEndMs);
    const stats = aggregate(jobs, windowStartMs, windowEndMs);
    const { text, modelUsed } = await synthesizeReflection(stats);
    const generatedAt = new Date().toISOString();
    const path = `${REFLECTION_DIR}/${stats.date}.md`;
    const body = renderMarkdown({ stats, text, generatedAt, modelUsed });
    try {
      writeVaultFile(path, body);
      // Best-effort commit — the queue handles serialisation and the journal
      // gets the same fate as any other vault write.
      void enqueueVaultCommit(`chore(reflection): daily reflection for ${stats.date}`);
    } catch (e: any) {
      console.warn(`[reflection] write failed: ${e?.message ?? e}`);
    }
    const result: ReflectionResult = { date: stats.date, path, stats, reflection: text, generatedAt, modelUsed };
    lastResult = result;
    return result;
  })();
  try { return await inFlight; }
  finally { inFlight = null; }
}

export function lastReflection(): ReflectionResult | null {
  return lastResult;
}

// Hourly tick. Fires the reflection once a day at REFLECTION_HOUR (default 2
// AM local). We use setInterval (1h) plus a "have we run today?" guard so a
// long-running server only runs the reflection once per day even if the
// scheduler fires at non-precise intervals.
let scheduler: NodeJS.Timeout | null = null;
let lastRunDate: string | null = null;

export function startReflectionScheduler(): void {
  if (scheduler) return;
  const REFLECTION_HOUR = Number(process.env.CLAWBOT_REFLECTION_HOUR ?? "2");
  const tick = async () => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === REFLECTION_HOUR && lastRunDate !== today) {
      lastRunDate = today;
      console.log(`[reflection] firing daily reflection (hour=${REFLECTION_HOUR})`);
      try { await runReflection(); }
      catch (e: any) { console.warn(`[reflection] scheduler run failed: ${e?.message ?? e}`); }
    }
  };
  // Run a check every 10 minutes — gives a 10-min window inside REFLECTION_HOUR
  // for the run to fire even if the server boots mid-hour. Cheap.
  scheduler = setInterval(tick, 10 * 60_000);
  void tick(); // also check immediately on boot
}

export function stopReflectionScheduler(): void {
  if (scheduler) { clearInterval(scheduler); scheduler = null; }
}

// Stay tree-shake-friendly — referenced only when the route imports it.
void llmGenerate;
