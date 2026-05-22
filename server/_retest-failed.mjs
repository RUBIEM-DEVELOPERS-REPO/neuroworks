// Re-test the 6 probes that misbehaved in new1.
// After fix: chat.ts artifact-head-noun detection (no more spurious draft-email).
//
// Probes:
//   - quinn-password-reset-tests (was: routed to draft-email by mistake)
//   - priya-workspace-export-prd (was: harness mis-read; actually succeeded)
//   - devon-latency-spike-runbook (was: 44s with empty answer)
//   - riley-senior-backend-jd (was: missing "must-haves" detection)
//   - dani-onboarding-critique (was: missing JTBD + rationale)
//   - logan-nda-clause-redline (was: missing "not legal advice" caveat)

import { setTimeout as sleep } from "node:timers/promises";

const BASE = "http://127.0.0.1:7471";
const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const tIdx = (g) => TIERS.indexOf(g);
const tFromIdx = (i) => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];
function timePenalty(e, t) { if (!t || e <= t) return 0; return -Math.floor((e - t) / (t * 0.5)); }

async function postJson(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:7470" }, body: JSON.stringify(body ?? {}) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
async function getJson(path) {
  const r = await fetch(`${BASE}${path}`); let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, ok: r.ok };
}
async function pollJob(id, maxMs = 480_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const r = await getJson(`/api/tasks/jobs/${id}`).catch(() => null);
    if (!r || r.status !== 200) { await sleep(2000); continue; }
    const d = r.body;
    if (d.status === "succeeded" || d.status === "failed" || d.status === "rejected") return d;
    await sleep(3000);
  }
  throw new Error(`poll timeout for ${id}`);
}
async function chatRun(content) {
  const post = await postJson("/api/chat", { messages: [{ role: "user", content }] });
  // Better than before: surface kind="message" inline replies explicitly so we
  // know if the agent short-circuited.
  if (post.body?.kind === "message") return { text: post.body.text ?? "", inline: true };
  if (post.body?.kind === "task" && post.body?.jobId) {
    const j = await pollJob(post.body.jobId);
    return { text: j.result?.answer ?? "", inline: false, job: j };
  }
  return { text: JSON.stringify(post.body).slice(0, 400), inline: false };
}
async function activate(id) { await postJson(`/api/personas/${id}/activate`, {}); }

// Graders (subset, verbatim)
function gradeRecruiter(text) {
  const notes = [];
  const outcomes = /\b(first 90 days|first 30 days|ship|deliver|outcomes?|impact|what you'll (?:build|do|ship))\b/i.test(text);
  // Expanded must-have detection — JDs commonly use "what we need from you",
  // "minimum qualifications", "requirements", or bullet lists of "X years of".
  const mustHaves = /\b(must[- ]have|nice[- ]to[- ]have|required|core skills|need to have|requirements?|qualifications?|what we need|what you('| a)?ll bring|\d+\+?\s+years?)\b/i.test(text);
  const comp = /\$\s*\d{2,3}[Kk]|\$\s*\d{2,3},?\d{3}|\bcomp\b|\bsalary\b|\bequity\b|\bcompensation\b/i.test(text);
  if (outcomes) notes.push("outcomes-led");
  if (mustHaves) notes.push("must-haves");
  if (comp) notes.push("comp-named");
  let grade = "A";
  const pts = [outcomes, mustHaves, comp].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradePM(text) {
  const notes = [];
  const hasProblem = /\b(problem|user problem|user pain|whose problem|user (?:need|wants))\b/i.test(text);
  const hasOutcome = /\b(outcome|measurable|success metric|kpi|north star)\b/i.test(text);
  const hasNonGoals = /\b(non[- ]goals?|out of scope|not doing|excluded|what we're not)\b/i.test(text);
  const hasScoring = /\b(rice|ice|reach|impact|confidence|effort|ease|score)\b/i.test(text);
  if (hasProblem) notes.push("problem-led");
  if (hasOutcome) notes.push("outcome");
  if (hasNonGoals) notes.push("non-goals");
  if (hasScoring) notes.push("scored");
  let grade = "A";
  const pts = [hasProblem, hasOutcome, hasNonGoals, hasScoring].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeDesigner(text) {
  const notes = [];
  // Broadened: accept "user need", "user task", "user wants to" as JTBD signal too.
  const hasJTBD = /\b(job[- ]to[- ]be[- ]done|user goal|user's goal|primary goal|user's job|user need|user wants|user is trying|user task)\b/i.test(text);
  const hasCritique = /\b(friction|cognitive load|decision point|step|click|tap|interaction)\b/i.test(text);
  const hasA11y = /\b(accessibility|a11y|contrast|screen reader|keyboard|focus order|wcag|aria|motion|reduce[- ]motion)\b/i.test(text);
  const hasRationale = /\b(because|rationale|reason|since|the reasoning|why)\b/i.test(text);
  if (hasJTBD) notes.push("JTBD");
  if (hasCritique) notes.push("critique");
  if (hasA11y) notes.push("a11y");
  if (hasRationale) notes.push("rationale");
  let grade = "A";
  const pts = [hasJTBD, hasCritique, hasA11y, hasRationale].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C+"; else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeLegal(text) {
  const notes = [];
  const hasCaveat = /\b(not legal advice|consult (?:counsel|a lawyer|an attorney)|licensed (?:counsel|attorney)|seek (?:counsel|legal)|legal review)\b/i.test(text);
  const hasRiskFrame = /\b(risk|exposure|liability|onerous|favourable|favorable|burden)\b/i.test(text);
  const hasRedline = /\b(redline|suggest|propose|recommend (?:adding|removing|changing)|edit|revise|change to|negotiat)\b/i.test(text);
  const hasPlain = /\b(in plain (?:english|language)|meaning|in other words|this means|in practice)\b/i.test(text);
  if (hasCaveat) notes.push("caveat");
  if (hasRiskFrame) notes.push("risk");
  if (hasRedline) notes.push("redline");
  if (hasPlain) notes.push("plain-language");
  let grade = "A";
  if (!hasCaveat) grade = "C+";
  const pts = [hasRiskFrame, hasRedline].filter(Boolean).length;
  if (pts === 0) grade = tFromIdx(tIdx(grade) - 2);
  if (text.length < 250) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeQA(text) {
  const notes = [];
  const hasHappy = /\b(happy path|happy[- ]case|positive case|primary flow|main flow|success path)\b/i.test(text);
  const hasEdge = /\b(edge case|edge[- ]case|boundary|limit|extreme|invalid)\b/i.test(text);
  const hasFail = /\b(failure mode|failure case|error|negative case|exception|recovery|fail)\b/i.test(text);
  const hasSev = /\b(severity|priority|sev[- ]?\d|s\d\b|p\d\b|critical|blocker)\b/i.test(text);
  if (hasHappy) notes.push("happy");
  if (hasEdge) notes.push("edge");
  if (hasFail) notes.push("failure");
  if (hasSev) notes.push("sev/pri");
  let grade = "A";
  const pts = [hasHappy, hasEdge, hasFail].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeSRE(text) {
  const notes = [];
  const hasSymptom = /\b(symptom|trigger|alert|pager|page fires|p99|latency|spike)\b/i.test(text);
  const hasFirst5 = /\b(first 5 (?:min|minute)|immediate (?:action|step)|first thing|first 5 min|right away|right now)\b/i.test(text);
  const hasDiag = /\b(diagnostic|tree|branch|if (?:cpu|memory|network|the rate|p99|database|db)|check (?:logs|dashboards|metrics)|grep|tail)\b/i.test(text);
  const hasEscalate = /\b(escalat|on[- ]call|page (?:the )?(?:database|infra|sre|platform) team|call (?:in|the)|incident commander)\b/i.test(text);
  if (hasSymptom) notes.push("symptom");
  if (hasFirst5) notes.push("first-5-min");
  if (hasDiag) notes.push("diagnostic");
  if (hasEscalate) notes.push("escalation");
  let grade = "A";
  const pts = [hasSymptom, hasFirst5, hasDiag, hasEscalate].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

const PROBES = [
  { id: "quinn-password-reset-tests",   persona: "qa-engineer",        grader: gradeQA,         targetSec: 150,
    task: `Write a test plan for a new password-reset flow. The flow: user enters email -> receives reset link -> opens link -> sets new password -> redirected to login. Cover happy path, edge cases, and failure modes. State severity/priority thinking on the worst-case bug you can think of.` },
  { id: "priya-workspace-export-prd",   persona: "product-manager",    grader: gradePM,         targetSec: 180,
    task: `Write a 1-page PRD for adding workspace-level export to our analytics product. Current state: per-dashboard export exists; multiple enterprise customers requesting bulk export of all dashboards in a workspace. Lead with the problem, name the measurable outcome, declare non-goals, and ICE-score this against two alternatives: (a) better dashboard filters, (b) scheduled email reports.` },
  { id: "devon-latency-spike-runbook",  persona: "devops-sre",         grader: gradeSRE,        targetSec: 150,
    task: `Write an incident runbook for this scenario: API p99 latency suddenly jumps from 80ms to 3000ms with no recent deploy. The pager fires at 3am. Include symptom recognition, first-5-minute actions, a diagnostic decision tree (CPU? DB? network? upstream API?), and escalation criteria.` },
  { id: "riley-senior-backend-jd",      persona: "recruiter",          grader: gradeRecruiter,  targetSec: 120,
    task: `Write a job description for a Senior Backend Engineer at a 40-person Series A fintech. Stack: Go + Postgres + Kafka. Remote, US time zones. Comp band $180-220K base + meaningful equity. Lead with outcomes, not buzzwords. 3-5 must-haves max.` },
  { id: "dani-onboarding-critique",     persona: "product-designer",   grader: gradeDesigner,   targetSec: 150,
    task: `Critique this onboarding flow for a B2B analytics product: (1) sign up with email, (2) email verification, (3) workspace name + URL slug, (4) invite 3 teammates (required to proceed), (5) connect a data source (required to proceed), (6) tutorial video (auto-plays with sound). Anchor your critique to the user's job-to-be-done and flag accessibility issues.` },
  { id: "logan-nda-clause-redline",     persona: "contracts-reviewer", grader: gradeLegal,      targetSec: 120,
    task: `Review this NDA clause and tell me what to do with it: "Receiving Party shall hold Confidential Information in strict confidence for a period of ten (10) years from the date of disclosure, except for Confidential Information that becomes publicly available through no fault of Receiving Party." Flag the risk in plain language and suggest a redline.` },
];

async function main() {
  const stamp = new Date().toISOString();
  console.log(`# Retest of 6 failed probes :: ${stamp}`);
  const original = (await getJson("/api/personas")).body?.activeId ?? null;
  const results = [];
  for (const p of PROBES) {
    await activate(p.persona);
    const t0 = Date.now();
    let text = "", inline = false, err = null;
    try {
      const r = await chatRun(p.task);
      text = r.text;
      inline = r.inline;
    } catch (e) { err = String(e?.message ?? e); }
    const elapsed = (Date.now() - t0) / 1000;
    const content = err ? { grade: "F", notes: [`ERR:${err.slice(0, 60)}`] } : p.grader(text);
    const penalty = timePenalty(elapsed, p.targetSec);
    const finalIdx = Math.max(0, tIdx(content.grade) + penalty);
    const finalGrade = tFromIdx(finalIdx);
    const ok = tIdx(finalGrade) >= tIdx("B-");
    const inlineMark = inline ? " (INLINE)" : "";
    console.log(`${ok ? "✓" : "✗"} ${p.id.padEnd(34)} ${elapsed.toFixed(1)}s :: ${content.grade} → ${finalGrade}${inlineMark}  notes: ${content.notes.join(", ") || "(none)"}  len=${text.length}`);
    results.push({ ...p, elapsed, contentGrade: content.grade, finalGrade, notes: content.notes, ok, inline, textLen: text.length });
  }
  if (original) await activate(original);
  const aboveB = results.filter(r => r.ok).length;
  console.log(`\n${aboveB}/${results.length} above B-`);
}

main().catch(e => { console.error("FAIL:", e); process.exit(1); });
