// Features PoC harness — exercises the three new features:
//
//   1. Document uploads (context staging + vault import)
//   2. Persona auto-routing from chat (no active persona → router picks one)
//   3. Multi-persona parallel team-task endpoint
//
// Grading: each probe gets a tier on the standard rubric. B+ floor (B+ or
// higher) required for the PoC to be considered passing. Falls back to a
// per-feature retry where appropriate.

import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";

const TAG = process.argv[2] ?? "feat";
const BASE = "http://127.0.0.1:7471";

const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const tIdx = (g) => TIERS.indexOf(g);
const tFromIdx = (i) => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];

async function postJson(path, body, headers = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:7470", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, body: j };
}

async function getJson(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { "Origin": "http://127.0.0.1:7470" } });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, ok: r.ok };
}

async function pollJob(id, maxMs = 600_000) {
  const start = Date.now();
  let consecutive404 = 0;
  while (Date.now() - start < maxMs) {
    let r;
    try { r = await getJson(`/api/tasks/jobs/${id}`); }
    catch { await sleep(2000); continue; }
    if (r.status === 404) {
      consecutive404++;
      if (consecutive404 >= 5) throw new Error(`job ${id} not found`);
      await sleep(2000); continue;
    }
    consecutive404 = 0;
    if (r.status !== 200) { await sleep(2000); continue; }
    const d = r.body;
    if (d.status === "succeeded" || d.status === "failed" || d.status === "rejected") return d;
    await sleep(3000);
  }
  throw new Error(`poll timeout for ${id}`);
}

async function ensureNoActivePersona() {
  // Auto-routing only fires when no persona is active or active=clawbot.
  // Activate clawbot so any prior state is cleared.
  await postJson(`/api/personas/clawbot/activate`, {}).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// Feature 1 — uploads
// ─────────────────────────────────────────────────────────────────────

async function uploadContextDoc(filename, text) {
  const contentBase64 = Buffer.from(text, "utf8").toString("base64");
  const r = await postJson("/api/uploads", {
    filename,
    contentBase64,
    target: "context",
    mimeType: "text/plain",
  });
  if (r.status !== 200) throw new Error(`upload failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body; // { contextId, hasExtractedText, extractedChars, ... }
}

// Grade an attachment-referencing answer: must echo something specific from
// the uploaded document. We seed the doc with distinctive tokens and look
// for them in the output.
function gradeAttachmentEcho(text, seedTokens) {
  const notes = [];
  let hits = 0;
  for (const tok of seedTokens) {
    if (text.toLowerCase().includes(tok.toLowerCase())) { hits++; notes.push(`echo:${tok}`); }
  }
  let grade = "F";
  if (hits >= 3) grade = "A";
  else if (hits === 2) grade = "B+";
  else if (hits === 1) grade = "C";
  if (text.length < 200) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes, hits };
}

// ─────────────────────────────────────────────────────────────────────
// Feature 2 — persona auto-routing from chat
// ─────────────────────────────────────────────────────────────────────

function gradeAutoRoute(resp, expectedPersonaId) {
  const notes = [];
  const ar = resp?.body?.personaAutoRouted ?? null;
  if (!ar) return { grade: "F", notes: ["no-auto-route"], routedTo: null };
  const routedTo = ar.personaId ?? resp?.body?.activePersona?.id ?? null;
  notes.push(`routed:${routedTo}`);
  notes.push(`score:${ar.score}`);
  let grade = "F";
  if (routedTo === expectedPersonaId) grade = "A";
  else grade = "C"; // routed but not to the expected — partial credit
  return { grade, notes, routedTo };
}

// ─────────────────────────────────────────────────────────────────────
// Feature 3 — multi-persona team-task
// ─────────────────────────────────────────────────────────────────────

function gradeTeam(resp, expectedCount, expectedPersonas) {
  const notes = [];
  if (resp?.status !== 200) return { grade: "F", notes: [`status:${resp?.status}`] };
  const jobs = resp?.body?.jobs ?? [];
  notes.push(`jobs:${jobs.length}`);
  let grade = "A";
  if (jobs.length !== expectedCount) grade = "C";
  const got = new Set(jobs.map(j => j?.persona?.id).filter(Boolean));
  const missing = expectedPersonas.filter(p => !got.has(p));
  if (missing.length > 0) {
    notes.push(`missing:${missing.join(",")}`);
    grade = tFromIdx(tIdx(grade) - 2);
  }
  return { grade, notes, jobs };
}

// Grade each per-job output: persona-specific shape + length floor.
function gradePerJobOutput(text, personaId) {
  const notes = [];
  if (!text || text.length < 100) return { grade: "D", notes: ["too-short"] };
  const hasStructure = /(^|\n)#{1,3}\s+|(^|\n)[-*•]\s+|(^|\n)\d+\.\s+/.test(text);
  if (hasStructure) notes.push("structured");
  let grade = "A";
  if (!hasStructure && text.length < 300) grade = "C";
  if (text.length < 250) grade = tFromIdx(tIdx(grade) - 1);
  // Persona-flavored shape checks (gentle — main score from length+structure):
  if (personaId === "recruiter" && /\b(job description|JD|interview|candidate|requirements?|must[- ]have|nice[- ]to[- ]have)\b/i.test(text)) notes.push("recruiter-shape");
  if (personaId === "marketing-manager" && /\b(audience|channel|positioning|CTA|launch|campaign|hook)\b/i.test(text)) notes.push("mkt-shape");
  if (personaId === "operations-coordinator" && /\b(SOP|step|owner|approval|workflow|procedure)\b/i.test(text)) notes.push("ops-shape");
  if (personaId === "data-analyst" && /\b(cohort|funnel|metric|retention|segment|A\/B|experiment)\b/i.test(text)) notes.push("analyst-shape");
  if (personaId === "financial-analyst" && /\b(revenue|cost|margin|burn|cashflow|LTV|CAC|model)\b/i.test(text)) notes.push("fin-shape");
  return { grade, notes };
}

// ─────────────────────────────────────────────────────────────────────
// Probes
// ─────────────────────────────────────────────────────────────────────

const ATTACHMENT_DOC_TEXT = `
TripleSpine Industries — Q3 2026 Onboarding Brief

Project codename: AURORA-7
Project owner: Jasmine Wabuya (Director of Customer Operations)
Launch window: 2026-08-14 through 2026-08-28
Budget cap: $147,500 USD
Risk theme: integration with the LegacyMail SMTP gateway must complete
  before the SOC-2 audit on 2026-09-02. Any delay > 5 business days
  triggers an executive escalation per policy CO-114.

Key deliverable: a customer-facing dashboard surfacing usage telemetry
with three privacy modes (full, anonymized, opted-out).
`.trim();

const ATTACHMENT_SEEDS = ["AURORA-7", "Jasmine Wabuya", "147,500", "2026-08-14", "SOC-2", "CO-114"];

async function runUploadProbe() {
  console.log(`\n[${TAG}] FEATURE 1 — UPLOADS`);
  console.log("=".repeat(60));
  const t0 = Date.now();

  // Upload the doc as context
  const up = await uploadContextDoc("aurora-7-brief.txt", ATTACHMENT_DOC_TEXT);
  console.log(`  uploaded: contextId=${up.contextId} hasText=${up.hasExtractedText} chars=${up.extractedChars}`);

  // Reference it in a chat task — ask for a summary that should echo the seeds
  await ensureNoActivePersona();
  const resp = await postJson("/api/chat", {
    messages: [{ role: "user", content: "Read the attached onboarding brief and produce a 2-paragraph executive summary that names the codename, owner, budget, launch dates, and the SOC-2 risk." }],
    attachments: [{ contextId: up.contextId }],
  });
  if (resp.body?.kind !== "task" || !resp.body?.jobId) {
    console.log(`  FAIL: expected task, got: ${JSON.stringify(resp.body).slice(0, 200)}`);
    return { grade: "F", elapsed: (Date.now() - t0) / 1000, notes: ["no-jobid"] };
  }
  const job = await pollJob(resp.body.jobId, 600_000);
  const answer = job?.result?.answer ?? "";
  const g = gradeAttachmentEcho(answer, ATTACHMENT_SEEDS);
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`  job ${resp.body.jobId.slice(0, 8)} → ${job.status} · ${answer.length} chars · ${elapsed.toFixed(0)}s · grade=${g.grade} · hits=${g.hits}/${ATTACHMENT_SEEDS.length}`);
  console.log(`  notes: ${g.notes.join(", ")}`);
  return { grade: g.grade, elapsed, notes: g.notes, contextId: up.contextId, jobId: resp.body.jobId };
}

const AUTO_ROUTE_PROBES = [
  { expect: "recruiter", task: "Draft a JD for a senior backend engineer focused on payments — must-haves and nice-to-haves." },
  { expect: "marketing-manager", task: "Write a launch announcement and social media post for our new pricing tier; keep brand voice consistent." },
  { expect: "operations-coordinator", task: "Write an SOP for vendor onboarding: approval routing, document collection, and procurement request submission." },
  { expect: "account-executive", task: "Draft MEDDIC discovery questions for a $250K deal and frame the next 3 steps for the lead qualification." },
  { expect: "customer-success", task: "Write a KB article responding to a customer complaint about a slow support ticket escalation." },
  { expect: "financial-analyst", task: "Build a budget model with unit economics, LTV/CAC sensitivity analysis, and burn rate projection." },
];

async function runAutoRouteProbe(probe) {
  const t0 = Date.now();
  await ensureNoActivePersona();
  const resp = await postJson("/api/chat", {
    messages: [{ role: "user", content: probe.task }],
  });
  const g = gradeAutoRoute(resp, probe.expect);
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`  expect=${probe.expect} → routed=${g.routedTo} · grade=${g.grade} · ${elapsed.toFixed(0)}s · ${g.notes.join(", ")}`);
  // Don't wait for job result — auto-routing PoC is about the routing decision
  // itself, not the downstream output. The team-task probe covers per-job
  // output grading separately.
  return { grade: g.grade, elapsed, notes: g.notes, expected: probe.expect, routedTo: g.routedTo };
}

async function runAutoRouteSuite() {
  console.log(`\n[${TAG}] FEATURE 2 — AUTO-ROUTING`);
  console.log("=".repeat(60));
  const results = [];
  for (const p of AUTO_ROUTE_PROBES) {
    const r = await runAutoRouteProbe(p);
    results.push(r);
  }
  return results;
}

async function runTeamProbe() {
  console.log(`\n[${TAG}] FEATURE 3 — MULTI-PERSONA TEAM TASK`);
  console.log("=".repeat(60));
  const t0 = Date.now();

  // 4 personas working independent angles on the same launch initiative.
  const tasks = [
    { persona: "marketing-manager", content: "Draft a 1-paragraph launch announcement and three social-media variants for the AURORA-7 customer dashboard launch (target 2026-08-14). Include the headline hook and CTA." },
    { persona: "recruiter", content: "Draft a job description for a Customer Operations Lead to support AURORA-7 — must-haves, nice-to-haves, and the first-90-days outcomes." },
    { persona: "operations-coordinator", content: "Write a numbered SOP for the AURORA-7 launch readiness checklist: owners, by-when dates, and the definition of done for each step." },
    { persona: "financial-analyst", content: "Build a budget summary for AURORA-7 with the $147,500 cap, cost categories, and burn-rate analysis. Flag what to cut first if we hit 90% of cap." },
  ];

  const resp = await postJson("/api/chat/team", { tasks });
  const g = gradeTeam(resp, tasks.length, tasks.map(t => t.persona));
  console.log(`  team dispatch grade=${g.grade} · ${g.notes.join(", ")}`);
  if (g.grade === "F") {
    return { grade: "F", elapsed: (Date.now() - t0) / 1000, notes: g.notes, perJob: [] };
  }

  // Poll all jobs in parallel and grade each result
  const jobs = resp.body.jobs;
  const perJob = await Promise.all(jobs.map(async (j) => {
    try {
      const job = await pollJob(j.jobId, 600_000);
      const answer = job?.result?.answer ?? "";
      const pg = gradePerJobOutput(answer, j.persona?.id);
      console.log(`    ${j.persona?.id ?? "?"} → ${job.status} · ${answer.length} chars · grade=${pg.grade} · ${pg.notes.join(", ")}`);
      return { personaId: j.persona?.id, status: job.status, chars: answer.length, grade: pg.grade, notes: pg.notes };
    } catch (e) {
      console.log(`    ${j.persona?.id ?? "?"} → POLL ERROR: ${e?.message ?? e}`);
      return { personaId: j.persona?.id, status: "error", chars: 0, grade: "F", notes: [String(e?.message ?? e).slice(0, 80)] };
    }
  }));

  const elapsed = (Date.now() - t0) / 1000;
  // Overall grade is the MIN of dispatch grade + per-job grades
  const allGrades = [g.grade, ...perJob.map(p => p.grade)];
  const worst = allGrades.reduce((a, b) => (tIdx(a) <= tIdx(b) ? a : b));
  console.log(`  overall: dispatch=${g.grade} · per-job min=${perJob.reduce((a, b) => tIdx(a) <= tIdx(b.grade) ? a : b.grade, "A+")} · combined=${worst} · ${elapsed.toFixed(0)}s`);
  return { grade: worst, elapsed, notes: g.notes, perJob, dispatchGrade: g.grade };
}

// ─────────────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`[${TAG}] FEATURES POC — uploads + auto-route + team`);
  console.log(`${"═".repeat(60)}`);

  const overall = [];

  try {
    const up = await runUploadProbe();
    overall.push({ phase: "uploads", grade: up.grade, elapsed: up.elapsed, notes: up.notes });
  } catch (e) {
    console.log(`  UPLOAD PROBE FATAL: ${e?.message ?? e}`);
    overall.push({ phase: "uploads", grade: "F", elapsed: 0, notes: ["fatal:" + String(e?.message ?? e).slice(0, 80)] });
  }

  try {
    const ar = await runAutoRouteSuite();
    for (const r of ar) {
      overall.push({ phase: `auto-route:${r.expected}`, grade: r.grade, elapsed: r.elapsed, notes: r.notes });
    }
  } catch (e) {
    console.log(`  AUTO-ROUTE SUITE FATAL: ${e?.message ?? e}`);
    overall.push({ phase: "auto-route", grade: "F", elapsed: 0, notes: ["fatal:" + String(e?.message ?? e).slice(0, 80)] });
  }

  try {
    const team = await runTeamProbe();
    overall.push({ phase: "team-dispatch", grade: team.dispatchGrade ?? team.grade, elapsed: 0, notes: team.notes });
    for (const j of team.perJob ?? []) {
      overall.push({ phase: `team:${j.personaId}`, grade: j.grade, elapsed: 0, notes: j.notes });
    }
  } catch (e) {
    console.log(`  TEAM PROBE FATAL: ${e?.message ?? e}`);
    overall.push({ phase: "team", grade: "F", elapsed: 0, notes: ["fatal:" + String(e?.message ?? e).slice(0, 80)] });
  }

  // ─── Report ───
  console.log(`\n${"═".repeat(60)}`);
  console.log(`[${TAG}] FINAL SCORECARD`);
  console.log(`${"═".repeat(60)}`);
  console.log(`phase                          | grade | elapsed | notes`);
  console.log(`-`.repeat(60));
  let bPlus = 0;
  for (const r of overall) {
    const okBPlus = tIdx(r.grade) >= tIdx("B+");
    if (okBPlus) bPlus++;
    console.log(`${(r.phase + " ").padEnd(30)} | ${(r.grade + " ").padEnd(5)} | ${(r.elapsed.toFixed(0) + "s").padStart(6)}  | ${(r.notes ?? []).join(",").slice(0, 60)}`);
  }
  console.log(`-`.repeat(60));
  console.log(`B+ or higher: ${bPlus}/${overall.length}  ·  pass = ${bPlus === overall.length ? "YES ✅" : "NO ❌"}`);
})().catch(e => {
  console.error("FATAL:", e?.stack ?? e);
  process.exit(1);
});
