// Focused sequential harness for the 11 NEW built-in personas.
// Runs one-at-a-time so each gets full LLM bandwidth (no OR rate-limit
// pile-up). Confirms persona prompts wire correctly and produce the
// expected signature output shape.
//
// Parallelism was already verified by _employee-harness.mjs (par1 run:
// 6.01× speedup, both clawbots working concurrently). This harness
// answers a different question: do the just-added personas behave?

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "new";
const BASE = "http://127.0.0.1:7471";

const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const tIdx = (g) => TIERS.indexOf(g);
const tFromIdx = (i) => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];

function timePenalty(elapsedSec, targetSec) {
  if (!targetSec || elapsedSec <= targetSec) return 0;
  const over = elapsedSec - targetSec;
  return -Math.floor(over / (targetSec * 0.5));
}

async function postJson(path, body, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:7470" },
        body: JSON.stringify(body ?? {}),
      });
      const j = await r.json().catch(() => null);
      return { status: r.status, body: j };
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(1500);
    }
  }
  throw last;
}

async function getJson(path) {
  const r = await fetch(`${BASE}${path}`);
  let body = null;
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
  if (post.body?.kind === "message") return { text: post.body.text ?? "", job: null };
  if (post.body?.kind === "task" && post.body?.jobId) {
    const j = await pollJob(post.body.jobId);
    return { text: j.result?.answer ?? "", job: j };
  }
  return { text: JSON.stringify(post.body).slice(0, 400), job: null };
}

async function activate(id) { await postJson(`/api/personas/${id}/activate`, {}); }

// ─── Graders (verbatim from _employee-harness.mjs) ───

function gradeAE(text) {
  const notes = [];
  const meddic = /\b(MEDDIC|metric|economic buyer|decision criteria|decision process|champion|pain)\b/i.test(text);
  const discovery = /\b(discovery (?:question|call)|open[- ]ended|what (?:do|does|are)|how (?:do|does|are)|tell me about|walk me through)\b/i.test(text);
  const nextStep = /\b(next step|follow[- ]up|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|will (?:send|share|email))\b/i.test(text);
  const risk = /\b(risk|red flag|concern|watchout|watch out|no (?:champion|compelling event))\b/i.test(text);
  if (meddic) notes.push("MEDDIC");
  if (discovery) notes.push("discovery-Qs");
  if (nextStep) notes.push("next-step");
  if (risk) notes.push("risk-named");
  let grade = "A";
  const pts = [meddic, discovery, nextStep, risk].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeRecruiter(text) {
  const notes = [];
  const outcomes = /\b(first 90 days|first 30 days|ship|deliver|outcomes?|impact|what you'll (?:build|do|ship))\b/i.test(text);
  const mustHaves = /\b(must[- ]have|nice[- ]to[- ]have|required|core skills|need to have)\b/i.test(text);
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
function gradeFinAnalyst(text) {
  const notes = [];
  const hasAssumptions = /\b(assumption|assume|input|key driver)/i.test(text);
  const hasScenarios = /\b(base|bull|bear|scenario|sensitivity|upside|downside)\b/i.test(text);
  const hasUnitEcon = /\b(ltv|lifetime value|cac|payback|gross margin|contribution margin|cohort)\b/i.test(text);
  const hasRecommendation = /\b(recommend|recommendation|action|next step|conclusion)\b/i.test(text);
  if (hasAssumptions) notes.push("assumptions");
  if (hasScenarios) notes.push("scenarios");
  if (hasUnitEcon) notes.push("unit-econ");
  if (hasRecommendation) notes.push("recommendation");
  let grade = "A";
  const pts = [hasAssumptions, hasScenarios, hasUnitEcon, hasRecommendation].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
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
  const hasJTBD = /\b(job[- ]to[- ]be[- ]done|user goal|user's goal|primary goal|user's job)\b/i.test(text);
  const hasCritique = /\b(friction|cognitive load|decision point|step|click|tap|interaction)\b/i.test(text);
  const hasA11y = /\b(accessibility|a11y|contrast|screen reader|keyboard|focus order|wcag|aria)\b/i.test(text);
  const hasRationale = /\b(because|rationale|reason|since|the reasoning)\b/i.test(text);
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
function gradeDataAnalyst(text) {
  const notes = [];
  const hasStats = /\b(confidence interval|95%|p[- ]value|mde|minimum detectable|sample size|significan)\b/i.test(text);
  const hasCaveat = /\b(caveat|caution|p[- ]hack|peek|multiple test|correction|correlation|causation|seasonal)\b/i.test(text);
  const hasVerdict = /\b(ship it|do not ship|don't ship|inconclusive|\bship\b|don't roll out|roll out|hold|extend|wait)\b/i.test(text);
  const hasNumbers = /\d+\.\d+%|\d+%|\d+,?\d{3,}/i.test(text);
  if (hasStats) notes.push("stats");
  if (hasCaveat) notes.push("caveat");
  if (hasVerdict) notes.push("verdict");
  if (hasNumbers) notes.push("numbers");
  let grade = "A";
  const pts = [hasStats, hasCaveat, hasVerdict, hasNumbers].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeLegal(text) {
  const notes = [];
  const hasCaveat = /\b(not legal advice|consult (?:counsel|a lawyer|an attorney)|licensed (?:counsel|attorney)|seek (?:counsel|legal))\b/i.test(text);
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
function gradeEA(text) {
  const notes = [];
  const hasTriage = /\b(act[- ]now|read[- ]later|fyi|trash|priority|urgent|defer|sort|category)\b/i.test(text);
  const hasNextStep = /\b(by (?:monday|tuesday|wednesday|thursday|friday)|by \d{1,2}[/-]\d{1,2}|next step|will (?:send|share|follow up)|draft (?:a )?reply|by tomorrow)\b/i.test(text);
  const hasApproval = /\b(for your approval|draft|approval|with your sign-off|pending your|your sign|once you confirm)\b/i.test(text);
  const hasReasoning = /\b(because|since|reason|why|prioritise|prioritize|investor|hire|deadline|signal)\b/i.test(text);
  if (hasTriage) notes.push("triage");
  if (hasNextStep) notes.push("next-step");
  if (hasApproval) notes.push("for-approval");
  if (hasReasoning) notes.push("reasoning");
  let grade = "A";
  const pts = [hasTriage, hasNextStep, hasReasoning].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C+";
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
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
function gradeTechWriter(text) {
  const notes = [];
  const hasOutcome = /\b(outcome|by the end|you'll have|you will have|in this tutorial|what you'll (?:learn|do))\b/i.test(text);
  const hasPrereqs = /\b(prerequisite|before you (?:start|begin)|requirements?|you'll need|assume(?:s)? you|what you need)\b/i.test(text);
  const hasSteps = /(^|\n)\s*\d+\.\s/.test(text);
  const hasVerify = /\b(verif|confirm|you should see|expected output|to confirm|to check|sanity check)\b/i.test(text);
  const hasTrouble = /\b(troubleshoot|if you get|common error|stumble|debug|fix|rollback|failed)\b/i.test(text);
  if (hasOutcome) notes.push("outcome");
  if (hasPrereqs) notes.push("prereqs");
  if (hasSteps) notes.push("steps");
  if (hasVerify) notes.push("verify");
  if (hasTrouble) notes.push("troubleshoot");
  let grade = "A";
  const pts = [hasOutcome, hasPrereqs, hasSteps, hasVerify, hasTrouble].filter(Boolean).length;
  if (pts <= 2) grade = "C"; else if (pts === 3) grade = "B-"; else if (pts === 4) grade = "A-";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

const PROBES = [
  { id: "drew-discovery-prep",          persona: "account-executive",    grader: gradeAE,           targetSec: 120,
    task: `I have a discovery call tomorrow with the head of operations at a 200-person manufacturing firm. They expressed interest in our supply-chain visibility product after seeing a demo at a trade show. Prep me: MEDDIC notes covering what I know vs what I still need to learn, 6-8 discovery questions, and the biggest risk I should be probing for.` },
  { id: "riley-senior-backend-jd",      persona: "recruiter",            grader: gradeRecruiter,    targetSec: 90,
    task: `Write a job description for a Senior Backend Engineer at a 40-person Series A fintech. Stack: Go + Postgres + Kafka. Remote, US time zones. Comp band $180-220K base + meaningful equity. Lead with outcomes, not buzzwords. 3-5 must-haves max.` },
  { id: "fiona-unit-economics",         persona: "financial-analyst",    grader: gradeFinAnalyst,   targetSec: 120,
    task: `Build the unit-economics view for a SaaS business with these inputs: $99/mo plan, 2.5% monthly churn, $400 paid-acquisition CAC, $300 onboarding cost (one-time), 75% gross margin. Show LTV, payback period, base/bull/bear scenarios, and the recommended action.` },
  { id: "priya-workspace-export-prd",   persona: "product-manager",      grader: gradePM,           targetSec: 150,
    task: `Write a 1-page PRD for adding workspace-level export to our analytics product. Current state: per-dashboard export exists; multiple enterprise customers requesting bulk export of all dashboards in a workspace. Lead with the problem, name the measurable outcome, declare non-goals, and ICE-score this against two alternatives: (a) better dashboard filters, (b) scheduled email reports.` },
  { id: "dani-onboarding-critique",     persona: "product-designer",     grader: gradeDesigner,     targetSec: 120,
    task: `Critique this onboarding flow for a B2B analytics product: (1) sign up with email, (2) email verification, (3) workspace name + URL slug, (4) invite 3 teammates (required to proceed), (5) connect a data source (required to proceed), (6) tutorial video (auto-plays with sound). Anchor your critique to the user's job-to-be-done and flag accessibility issues.` },
  { id: "dale-checkout-color-ab",       persona: "data-analyst",         grader: gradeDataAnalyst,  targetSec: 90,
    task: `We ran a 14-day A/B test on a new checkout button colour. Variant (orange): 12.4% conversion, n=8,420. Control (current green): 11.8% conversion, n=8,510. Write the read — should we ship? Be honest about CI, MDE, and any caveats (seasonality, weekday effects, peeking).` },
  { id: "logan-nda-clause-redline",     persona: "contracts-reviewer",   grader: gradeLegal,        targetSec: 90,
    task: `Review this NDA clause and tell me what to do with it: "Receiving Party shall hold Confidential Information in strict confidence for a period of ten (10) years from the date of disclosure, except for Confidential Information that becomes publicly available through no fault of Receiving Party." Flag the risk in plain language and suggest a redline.` },
  { id: "evie-inbox-triage",            persona: "executive-assistant",  grader: gradeEA,           targetSec: 90,
    task: `Inbox triage for the CEO this morning. Five items: (1) Series A investor asking "any update on Q3 numbers?" (we're 2 weeks from quarter-end), (2) Engineering hire candidate following up the 5th time on offer status, (3) Industry conference invite to keynote next month — they need an answer by Friday, (4) Vendor offering 30% off their tool if signed by Friday, (5) CEO of a partner asking for a "quick chat" next week. Sort them and propose response strategy for each.` },
  { id: "quinn-password-reset-tests",   persona: "qa-engineer",          grader: gradeQA,           targetSec: 120,
    task: `Write a test plan for a new password-reset flow. The flow: user enters email → receives reset link → opens link → sets new password → redirected to login. Cover happy path, edge cases, and failure modes. State severity/priority thinking on the worst-case bug you can think of.` },
  { id: "devon-latency-spike-runbook",  persona: "devops-sre",           grader: gradeSRE,          targetSec: 120,
    task: `Write an incident runbook for this scenario: API p99 latency suddenly jumps from 80ms to 3000ms with no recent deploy. The pager fires at 3am. Include symptom recognition, first-5-minute actions, a diagnostic decision tree (CPU? DB? network? upstream API?), and escalation criteria.` },
  { id: "tao-deploy-tutorial",          persona: "technical-writer",     grader: gradeTechWriter,   targetSec: 90,
    task: `Write a tutorial for using our (hypothetical) CLI command \`claw deploy --env prod\`. Audience: a backend engineer who has used the tool in staging dozens of times but never run it against production. Structure: outcome → prerequisites → numbered steps → verification → troubleshooting. Keep it skim-able.` },
];

const lines = [];
const log = (s = "") => { console.log(s); lines.push(s); };

async function main() {
  const stamp = new Date().toISOString();
  log(`# New Personas Sequential Harness :: ${TAG} :: ${stamp}`);
  log(`Server: ${BASE}`);
  log(`Probes: ${PROBES.length} new built-in personas, one at a time.`);
  log("");

  const original = (await getJson("/api/personas")).body?.activeId ?? null;
  const results = [];
  for (const p of PROBES) {
    await activate(p.persona);
    const t0 = Date.now();
    let text = "";
    let err = null;
    try {
      const r = await chatRun(p.task);
      text = r.text;
    } catch (e) {
      err = String(e?.message ?? e);
    }
    const elapsed = (Date.now() - t0) / 1000;
    const content = err ? { grade: "F", notes: [`ERR:${err.slice(0, 60)}`] } : p.grader(text);
    const penalty = timePenalty(elapsed, p.targetSec);
    const finalIdx = Math.max(0, tIdx(content.grade) + penalty);
    const finalGrade = tFromIdx(finalIdx);
    const ok = tIdx(finalGrade) >= tIdx("B-");
    const mark = ok ? "✓" : "✗";
    log(`${mark} ${p.id.padEnd(34)} ${elapsed.toFixed(1)}s :: ${content.grade} → ${finalGrade}  notes: ${content.notes.join(", ") || "(none)"}`);
    results.push({ ...p, elapsed, contentGrade: content.grade, finalGrade, notes: content.notes, ok, text: text.slice(0, 200) });
  }
  log("");

  log(`## Scorecard`);
  log("");
  log(`| Probe | Persona | Target | Elapsed | Content | FINAL | Notes |`);
  log(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    log(`| ${r.id} | ${r.persona} | ${r.targetSec}s | ${r.elapsed.toFixed(1)}s | ${r.contentGrade} | **${r.finalGrade}** | ${r.notes.join(", ").slice(0, 60)} |`);
  }
  log("");

  const aboveB = results.filter(r => r.ok).length;
  log(`## Summary`);
  log("");
  log(`${aboveB}/${results.length} above B-.`);
  log("");

  if (original) await activate(original);

  // Brain note
  const noteBody = [
    `# New built-in personas — sequential validation ${stamp}`,
    ``,
    `${aboveB}/${results.length} of just-added built-in personas above B- on role-shaped tasks (sequential, no parallel-load interference).`,
    ``,
    `**Results:**`,
    ...results.map(r => `- ${r.persona} (${r.id}): ${r.finalGrade} — ${r.notes.slice(0, 4).join(", ") || "(no shape markers)"}`),
  ].join("\n");
  try {
    const rr = await postJson("/api/templates/add-note/run", { inputs: { title: `New personas validation — ${stamp.slice(0, 10)}`, body: noteBody } });
    log(`Brain update: ${rr.body?.jobId ? `submitted (job ${rr.body.jobId})` : "submitted"}.`);
  } catch (e) {
    log(`Brain update FAILED: ${String(e?.message ?? e)}`);
  }
}

main()
  .then(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = `_new-personas-harness-${TAG}-${stamp}.md`;
    import("node:fs").then(fs => {
      fs.writeFileSync(out, lines.join("\n"));
      console.log(`\nWrote: ${out}`);
    });
  })
  .catch(e => { console.error("HARNESS FAILED:", e); process.exit(1); });
