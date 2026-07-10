// Employee task harness — PARALLEL version.
//
// Tests "any worker on NeuroWorks" simulation with both clawbots running
// concurrently:
//
//   • Phase 1 — Fires 10 per-persona probes IN PARALLEL. Snapshots the
//     peer pool every 2s to confirm both primary + persona-shifter (and
//     any auto-spawned extras) actually take load at the same time.
//   • Phase 2 — Overload spawn: fires a burst of 5 short tasks
//     concurrently; verifies the worker pool either scales beyond 1
//     worker OR is already at cap.
//   • Phase 3 — Persona-shifter routing fidelity: spot-check that a
//     persona-shifted task and a default-clawbot task both go through
//     the worker (per CLAWBOT_DELEGATE_ALL default).
//   • Phase 4 — Multi-worker handoff (Sam→Olivia) — sequential within
//     the phase since it's multi-turn dependent, but runs concurrently
//     with the rest if BACKGROUND=1 (default off so the load chart stays
//     readable).
//   • Phase 5 — Coverage gap report (static).
//   • Final — Write a brain note via add-note.
//
// Strict time-weighted grading, same rubric as comprehensive-harness.

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "emp";
const BASE = "http://127.0.0.1:7471";

const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const tIdx = (g) => TIERS.indexOf(g);
const tFromIdx = (i) => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];

function timePenalty(elapsedSec, targetSec) {
  if (!targetSec || elapsedSec <= targetSec) return 0;
  const over = elapsedSec - targetSec;
  return -Math.floor(over / (targetSec * 0.5));
}

async function postJson(path, body, attempts = 2, headers = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:7470", ...headers },
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

async function pollJob(id, maxMs = 600_000) {
  const start = Date.now();
  let consecutive404 = 0;
  while (Date.now() - start < maxMs) {
    let r;
    try { r = await getJson(`/api/tasks/jobs/${id}`); }
    catch { await sleep(2000); continue; }
    if (r.status === 404) {
      consecutive404++;
      if (consecutive404 >= 3) throw new Error(`job ${id} not found`);
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

async function chatJobOrInline(messages) {
  const post = await postJson("/api/chat", { messages });
  if (post.body?.kind === "message") return { inline: true, text: post.body.text ?? "", job: null };
  if (post.body?.kind === "task" && post.body?.jobId) {
    const j = await pollJob(post.body.jobId, 600_000);
    return { inline: false, text: j.result?.answer ?? "", job: j };
  }
  return { inline: false, text: JSON.stringify(post.body).slice(0, 400), job: null };
}

// Two-step chat: dispatch (sync — post + grab jobId) then poll (async).
// This lets us serialise the persona activate → /api/chat POST sequence
// (avoiding the global active-persona race) while still polling all jobs
// in parallel — so the actual server-side work runs concurrently.
async function chatDispatch(messages) {
  const post = await postJson("/api/chat", { messages });
  if (post.body?.kind === "message") return { kind: "message", text: post.body.text ?? "" };
  if (post.body?.kind === "task" && post.body?.jobId) return { kind: "task", jobId: post.body.jobId };
  return { kind: "unknown", raw: post.body };
}

async function chatComplete(dispatched) {
  if (dispatched.kind === "message") return { text: dispatched.text, job: null };
  if (dispatched.kind === "task") {
    const j = await pollJob(dispatched.jobId, 600_000);
    return { text: j.result?.answer ?? "", job: j };
  }
  return { text: JSON.stringify(dispatched.raw).slice(0, 400), job: null };
}

async function activatePersona(id) {
  await postJson(`/api/personas/${id}/activate`, {});
}

async function getActivePersona() {
  const r = await getJson("/api/personas");
  return r.body?.activeId ?? null;
}

async function getPeerSnapshot() {
  const r = await getJson("/api/peers");
  const self = r.body?.self ?? null;
  const peers = r.body?.peers ?? [];
  const worker = await getJson("/api/peers/worker");
  return {
    primary: {
      name: self?.name ?? "primary",
      url: self?.url ?? BASE,
      role: self?.role ?? "primary",
      inflight: self?.inflightJobs ?? 0,
    },
    peers: peers.map(p => ({
      name: p.name ?? "?",
      url: p.url,
      role: p.role,
      inflight: p.inflightJobs ?? 0,
      ready: p.ready,
    })),
    pool: {
      count: worker.body?.count ?? 0,
      cap: worker.body?.cap ?? 0,
      workers: worker.body?.workers ?? [],
    },
  };
}

function extractRoutedTo(job) {
  // job.log entries written by the chat router carry the routing decision.
  if (!job?.log || !Array.isArray(job.log)) return null;
  for (const entry of job.log) {
    const m = entry?.message ?? entry;
    if (typeof m !== "string") continue;
    const peerMatch = m.match(/delegating to (?:peer )?([^\s]+)/i) ||
      m.match(/route(?:d)? to ([^\s,]+)/i) ||
      m.match(/handing (?:off )?to ([^\s,]+)/i) ||
      m.match(/persona-shifter[^a-z]*([0-9.:]+:\d+)/i);
    if (peerMatch) return peerMatch[1];
  }
  // Fallback: routing decision in result
  const dec = job?.result?.routing ?? job?.routing ?? null;
  if (dec?.peer?.url) return dec.peer.url;
  if (dec?.peer?.name) return dec.peer.name;
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Graders (same as prior employee harness)
// ─────────────────────────────────────────────────────────────────────

const MACRO_SPEAK = /\b(we appreciate (you|your)|thank you for reaching out|feel free to (reach|contact)|do not hesitate|please do not hesitate|valuable feedback|valued customer)\b/i;
const CHAT_TIC = /^\s*(sure[!.,]|great question|absolutely[!.]|happy to help|i'd be happy to)/i;
const GENERIC_AI_INTRO = /^\s*(as an? (?:ai|language model)|i('| a)m (?:an? )?(?:ai|language model))/i;

function gradeCustomerSuccess(text) {
  const notes = [];
  const hasAck = /\b(sorry|apologi|hear|understand|frustrat|appreciate the (?:candor|honesty)|that('|')?s fair|fair point)\b/i.test(text);
  const hasDate = /\b(by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|by (?:january|february|march|april|may|june|july|august|september|october|november|december)|\bby\s+\d{1,2}[/-]\d{1,2}|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i.test(text);
  const macros = MACRO_SPEAK.test(text);
  const tic = CHAT_TIC.test(text) || GENERIC_AI_INTRO.test(text);
  const churnFlag = /\b(churn|cancel|competitor|acme|alternative|leaving)\b/i.test(text);
  if (hasAck) notes.push("ack");
  if (hasDate) notes.push("dated");
  if (churnFlag) notes.push("churn-aware");
  if (macros) notes.push("MACRO-SPEAK");
  if (tic) notes.push("CHAT-TIC");
  let grade = "A";
  if (!hasAck) grade = "C";
  if (!hasDate) grade = tIdx(grade) > tIdx("C") ? "C+" : grade;
  if (macros) grade = tFromIdx(tIdx(grade) - 2);
  if (tic) grade = tFromIdx(tIdx(grade) - 2);
  if (text.length < 250) grade = tFromIdx(tIdx(grade) - 2);
  return { grade, notes };
}

function gradeOperations(text) {
  const notes = [];
  const hasNumbered = /(^|\n)\s*\d+\.\s/.test(text) || /(^|\n)\s*-\s+\*\*?step/i.test(text);
  const hasOwner = /\b(owner|owned by|responsible|assigned to)\b/i.test(text);
  const hasByWhen = /\b(by when|deadline|due (?:by|on)|target date)\b/i.test(text);
  const hasDone = /\b(done means|done when|done\s*=|definition of done|verification|acceptance)\b/i.test(text);
  const hasInputs = /\b(inputs? (?:still )?needed|prerequisite|preconditions|assumptions to confirm)\b/i.test(text);
  const vague = /\b(soon|shortly|asap|in a bit|sometime next week|next week\b(?!\s+by))/i.test(text);
  if (hasNumbered) notes.push("numbered");
  if (hasOwner) notes.push("owners");
  if (hasByWhen) notes.push("by-when");
  if (hasDone) notes.push("done-means");
  if (hasInputs) notes.push("inputs-flagged");
  if (vague) notes.push("VAGUE-DATES");
  let grade = "A";
  if (!hasNumbered) grade = "C";
  const shapePts = [hasOwner, hasByWhen, hasDone].filter(Boolean).length;
  if (shapePts < 2) grade = tFromIdx(tIdx(grade) - 1);
  if (shapePts === 0) grade = "D";
  if (vague) grade = tFromIdx(tIdx(grade) - 1);
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeSoftwareEngineer(text) {
  const notes = [];
  const hasFileRef = /[\w/.\\-]+\.(?:ts|tsx|js|mjs|py|go|rs|java|cs)\b/i.test(text) || /\b(function|method|class)\s+[A-Za-z_]\w*/.test(text);
  const hasTestPlan = /\b(test plan|verification|how to verify|to verify|run\s+(?:pnpm|npm|node|cargo|go)|smoke test|unit test)\b/i.test(text);
  const hasTradeoff = /\b(trade[- ]?off|risk|blast radius|downside|cost\b.*\bbenefit|pros?\s+and\s+cons|caveat)\b/i.test(text);
  const tic = CHAT_TIC.test(text) || GENERIC_AI_INTRO.test(text);
  if (hasFileRef) notes.push("file-refs");
  if (hasTestPlan) notes.push("test-plan");
  if (hasTradeoff) notes.push("trade-offs");
  if (tic) notes.push("CHAT-TIC");
  let grade = "A";
  const shapePts = [hasFileRef, hasTestPlan, hasTradeoff].filter(Boolean).length;
  if (shapePts <= 1) grade = "C";
  if (shapePts === 0) grade = "D";
  if (tic) grade = tFromIdx(tIdx(grade) - 2);
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeMarketing(text) {
  const notes = [];
  const hasAudience = /\b(audience|target|segment|persona|icp)\b/i.test(text);
  const hasOutcome = /\b(save \d|\d+\s*(?:%|hours|minutes|leads|signups|sign-ups|conversions|demos|deals|users)|reduce|increase by|cut|grow by|open rate|click[- ]through|conversion rate)\b/i.test(text);
  const hasShape = /\b(hook|channels?|insight|success metric|cta|call[- ]to[- ]action|messaging|positioning|email|landing)\b/i.test(text);
  const jargon = /\b(revolutionary|best[- ]in[- ]class|cutting[- ]edge|paradigm|synergy|game[- ]chang|next[- ]gen|world[- ]class|disruptive)\b/i.test(text);
  if (hasAudience) notes.push("audience");
  if (hasOutcome) notes.push("measurable");
  if (hasShape) notes.push("brief-shape");
  if (jargon) notes.push("JARGON");
  let grade = "A";
  const shapePts = [hasAudience, hasOutcome, hasShape].filter(Boolean).length;
  if (shapePts <= 1) grade = "C";
  if (shapePts === 0) grade = "D";
  if (jargon) grade = tFromIdx(tIdx(grade) - 1);
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeResearcher(text) {
  const notes = [];
  const hasHeadings = /(^|\n)#{2,3}\s+(topic statement|perspectives|cross-cutting|open questions|bottom line)/i.test(text);
  const hasCitations = /\[\d+\]/.test(text);
  const hasPerspectives = /\b(mainstream|critical|practitioner|recent|sceptical|skeptical)\b/i.test(text);
  const namesContradictions = /\b(disagree|contradict|tension|conflict|in contrast|however|on the other hand)\b/i.test(text);
  if (hasHeadings) notes.push("section-shape");
  if (hasCitations) notes.push("citations");
  if (hasPerspectives) notes.push("perspectives-named");
  if (namesContradictions) notes.push("disagreement-named");
  let grade = "A";
  const shapePts = [hasHeadings, hasCitations, hasPerspectives].filter(Boolean).length;
  if (shapePts <= 1) grade = "C";
  if (shapePts === 0) grade = "D";
  if (text.length < 600) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeClawbot(text) {
  const notes = [];
  const hasHeadings = /(^|\n)#{2,3}\s+\w+/.test(text);
  const hasCitations = /\[\d+\]|\[vault:/i.test(text);
  const tic = CHAT_TIC.test(text) || GENERIC_AI_INTRO.test(text);
  if (hasHeadings) notes.push("structured");
  if (hasCitations) notes.push("cites");
  if (tic) notes.push("CHAT-TIC");
  let grade = "A";
  if (!hasHeadings && text.length > 400) grade = "C+";
  if (tic) grade = tFromIdx(tIdx(grade) - 2);
  if (text.length < 200) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeAIIAMarketing(text) {
  const notes = [];
  const hasAfrica = /\b(africa|harare|zimbabwe|cape town|lagos|nairobi|johannesburg)\b/i.test(text);
  const hasPRShape = /\b(for immediate release|today announced|press release|the event|keynote|attendees|registration)\b/i.test(text);
  const jargon = /\b(revolutionary|best[- ]in[- ]class|cutting[- ]edge|paradigm|synergy|game[- ]chang)\b/i.test(text);
  if (hasAfrica) notes.push("africa-context");
  if (hasPRShape) notes.push("PR-shape");
  if (jargon) notes.push("JARGON");
  let grade = "A";
  const shapePts = [hasAfrica, hasPRShape].filter(Boolean).length;
  if (shapePts === 0) grade = "D";
  if (shapePts === 1) grade = "C+";
  if (jargon) grade = tFromIdx(tIdx(grade) - 1);
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeInsuranceSales(text) {
  const notes = [];
  const hasCoverage = /\b(coverage|comprehensive|third[- ]party|liability|collision|theft|fire)\b/i.test(text);
  const hasPremiumOrDeductible = /\b(premium|deductible|excess|monthly cost|annual cost)\b/i.test(text);
  const hasRecommendation = /\b(recommend|i('| a)d suggest|my recommendation|the right (?:plan|policy|cover))\b/i.test(text);
  const hasPersonalization = /\b(toddler|family|finance|new car|software|engineer)\b/i.test(text);
  if (hasCoverage) notes.push("coverage");
  if (hasPremiumOrDeductible) notes.push("premium-mention");
  if (hasRecommendation) notes.push("recommendation");
  if (hasPersonalization) notes.push("personalized");
  let grade = "A";
  const shapePts = [hasCoverage, hasPremiumOrDeductible, hasRecommendation, hasPersonalization].filter(Boolean).length;
  if (shapePts <= 1) grade = "D";
  if (shapePts === 2) grade = "C";
  if (shapePts === 3) grade = "B";
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeInsuranceUnderwriter(text) {
  const notes = [];
  const namesRiskFactors = /\b(smoker|smoking|family history|age|tobacco|heart|cardiovascular)\b/i.test(text);
  const hasDecision = /\b(approve|decline|deny|reject|modif|rate up|substandard|standard|preferred|conditional)\b/i.test(text);
  const hasPremiumReasoning = /\b(premium|rated|surcharge|loading|class\b|table|extra)\b/i.test(text);
  if (namesRiskFactors) notes.push("risk-named");
  if (hasDecision) notes.push("decision-stated");
  if (hasPremiumReasoning) notes.push("premium-reasoned");
  let grade = "A";
  const shapePts = [namesRiskFactors, hasDecision, hasPremiumReasoning].filter(Boolean).length;
  if (shapePts <= 1) grade = "C";
  if (shapePts === 0) grade = "D";
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

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
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C";
  else if (pts === 3) grade = "B";
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
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C+";
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
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C";
  else if (pts === 3) grade = "B";
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
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C";
  else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeDesigner(text) {
  const notes = [];
  const hasJTBD = /\b(job[- ]to[- ]be[- ]done|user goal|user's goal|primary goal|user's job)\b/i.test(text);
  const hasCritique = /\b(friction|cognitive load|decision point|step|click|tap|interaction)\b/i.test(text);
  const hasA11y = /\b(accessibility|a11y|contrast|screen reader|keyboard|focus order|wcag|aria)\b/i.test(text);
  const hasRationale = /\b(because|rationale|reason|since|the reasoning)\b/i.test(text);
  if (hasJTBD) notes.push("JTBD-anchored");
  if (hasCritique) notes.push("critique-frame");
  if (hasA11y) notes.push("a11y");
  if (hasRationale) notes.push("rationale");
  let grade = "A";
  const pts = [hasJTBD, hasCritique, hasA11y, hasRationale].filter(Boolean).length;
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C+";
  else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeDataAnalyst(text) {
  const notes = [];
  const hasHonestRead = /\b(confidence interval|95%|p[- ]value|mde|minimum detectable|sample size|significan)\b/i.test(text);
  const hasCaveat = /\b(caveat|caution|p[- ]hack|peek|multiple test|correction|correlation|causation|seasonal)\b/i.test(text);
  const hasVerdict = /\b(ship it|do not ship|don't ship|inconclusive|ship|don't roll out|roll out|hold|extend|wait)\b/i.test(text);
  const hasNumbers = /\d+\.\d+%|\d+%|\d+,?\d{3,}/i.test(text);
  if (hasHonestRead) notes.push("stats");
  if (hasCaveat) notes.push("caveat");
  if (hasVerdict) notes.push("verdict");
  if (hasNumbers) notes.push("numbers");
  let grade = "A";
  const pts = [hasHonestRead, hasCaveat, hasVerdict, hasNumbers].filter(Boolean).length;
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C";
  else if (pts === 3) grade = "B";
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
  if (hasTriage) notes.push("triage-shape");
  if (hasNextStep) notes.push("next-step");
  if (hasApproval) notes.push("for-approval");
  if (hasReasoning) notes.push("reasoning");
  let grade = "A";
  const pts = [hasTriage, hasNextStep, hasReasoning].filter(Boolean).length;
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C+";
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeQA(text) {
  const notes = [];
  const hasHappyPath = /\b(happy path|happy[- ]case|positive case|primary flow|main flow|success path)\b/i.test(text);
  const hasEdgeCases = /\b(edge case|edge[- ]case|boundary|limit|extreme|invalid)\b/i.test(text);
  const hasFailure = /\b(failure mode|failure case|error|negative case|exception|recovery|fail)\b/i.test(text);
  const hasSev = /\b(severity|priority|sev[- ]?\d|s\d\b|p\d\b|critical|blocker)\b/i.test(text);
  if (hasHappyPath) notes.push("happy-path");
  if (hasEdgeCases) notes.push("edge-cases");
  if (hasFailure) notes.push("failure-modes");
  if (hasSev) notes.push("sev/pri");
  let grade = "A";
  const pts = [hasHappyPath, hasEdgeCases, hasFailure].filter(Boolean).length;
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C";
  else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeSRE(text) {
  const notes = [];
  const hasSymptom = /\b(symptom|trigger|alert|pager|page fires|p99|latency|spike)\b/i.test(text);
  const hasFirst5Min = /\b(first 5 (?:min|minute)|immediate (?:action|step)|first thing|first 5 min|right away|right now)\b/i.test(text);
  const hasDiagnostic = /\b(diagnostic|tree|branch|if (?:cpu|memory|network|the rate|p99|database|db)|check (?:logs|dashboards|metrics)|grep|tail)\b/i.test(text);
  const hasEscalation = /\b(escalat|on[- ]call|page (?:the )?(?:database|infra|sre|platform) team|call (?:in|the)|incident commander)\b/i.test(text);
  if (hasSymptom) notes.push("symptom");
  if (hasFirst5Min) notes.push("first-5-min");
  if (hasDiagnostic) notes.push("diagnostic");
  if (hasEscalation) notes.push("escalation");
  let grade = "A";
  const pts = [hasSymptom, hasFirst5Min, hasDiagnostic, hasEscalation].filter(Boolean).length;
  if (pts <= 1) grade = "D";
  else if (pts === 2) grade = "C";
  else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeTechWriter(text) {
  const notes = [];
  const hasOutcome = /\b(outcome|by the end|you'll have|you will have|in this tutorial|what you'll (?:learn|do))\b/i.test(text);
  const hasPrereqs = /\b(prerequisite|before you (?:start|begin)|requirements?|you'll need|assume(?:s)? you|what you need)\b/i.test(text);
  const hasNumberedSteps = /(^|\n)\s*\d+\.\s/.test(text);
  const hasVerification = /\b(verif|confirm|you should see|expected output|to confirm|to check|sanity check)\b/i.test(text);
  const hasTroubleshoot = /\b(troubleshoot|if you get|common error|stumble|debug|fix|rollback|failed)\b/i.test(text);
  if (hasOutcome) notes.push("outcome");
  if (hasPrereqs) notes.push("prereqs");
  if (hasNumberedSteps) notes.push("steps");
  if (hasVerification) notes.push("verify");
  if (hasTroubleshoot) notes.push("troubleshoot");
  let grade = "A";
  const pts = [hasOutcome, hasPrereqs, hasNumberedSteps, hasVerification, hasTroubleshoot].filter(Boolean).length;
  if (pts <= 2) grade = "C";
  else if (pts === 3) grade = "B-";
  else if (pts === 4) grade = "A-";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

function gradeHeadOfAI(text) {
  const notes = [];
  const hasStrategy = /\b(strategy|roadmap|plan|adoption|initiative|priorit)\b/i.test(text);
  const hasResponsibleAI = /\b(responsible|ethic|safety|guardrail|govern|fairness|transparen|privacy|bias|human (?:oversight|in the loop))\b/i.test(text);
  const hasMeasurable = /\b(\d+[- ]day|milestone|kpi|metric|measure|north star|outcome|target)\b/i.test(text);
  const hasStakeholder = /\b(ceo|leadership|stakeholder|executive|board|partner with|cross[- ]functional)\b/i.test(text);
  if (hasStrategy) notes.push("strategy");
  if (hasResponsibleAI) notes.push("responsible-AI");
  if (hasMeasurable) notes.push("measurable");
  if (hasStakeholder) notes.push("stakeholders");
  let grade = "A";
  const shapePts = [hasStrategy, hasResponsibleAI, hasMeasurable, hasStakeholder].filter(Boolean).length;
  if (shapePts <= 2) grade = "C";
  if (shapePts <= 1) grade = "D";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

// ─────────────────────────────────────────────────────────────────────
// Phase 1 — Per-persona realistic task (PARALLEL)
// ─────────────────────────────────────────────────────────────────────
const PERSONA_PROBES = [
  {
    id: "casey-frustrated-customer",
    persona: "customer-success",
    task: `A customer named Marcus emailed us in clear frustration. He says our pricing changed without notice, our docs are "a maze", and he's evaluating Acme as an alternative. He's been on our $99/mo plan for 14 months. Draft his reply — treat this as you would on the job, not as a model describing what a CS lead might do.`,
    targetSec: 90,
    grader: gradeCustomerSuccess,
  },
  {
    id: "olivia-saas-onboarding-runbook",
    persona: "operations-coordinator",
    task: `Build a runbook for onboarding a new B2B SaaS customer end-to-end: from contract signed through first business value delivered. Treat it as a runbook another operator could execute on Monday morning without asking you any questions. Assume a 30-day target to first value.`,
    targetSec: 150,
    grader: gradeOperations,
  },
  {
    id: "sam-coalescing-layer",
    persona: "software-engineer",
    task: `I'm thinking about adding an in-memory request-coalescing layer in front of GET /api/templates so a burst of dashboard refreshes doesn't re-do the listing work. Walk me through: your read of the relevant code, the smallest correct change, the trade-offs, and your test plan. Be concrete — name files and functions.`,
    targetSec: 180,
    grader: gradeSoftwareEngineer,
  },
  {
    id: "maya-q4-campaign-brief",
    persona: "marketing-manager",
    task: `Write a campaign brief for our Q4 2026 launch of a new product: "an AI agent that runs on your laptop and handles vendor outreach for solo founders". Anchor it to one target segment and one measurable success metric. Brief shape: Audience / Insight / Hook / Channels / Assets / Success metric.`,
    targetSec: 90,
    grader: gradeMarketing,
  },
  {
    id: "researcher-small-llm-enterprise",
    persona: "researcher",
    task: `Investigate the practical impact of small open-source LLMs (7B-13B class — Llama, Qwen, Mistral families) on enterprise adoption over the last 18 months. I want multiple perspectives — mainstream coverage, critical voices, practitioner reports, and recent news. Cite every substantive claim.`,
    targetSec: 360,
    grader: gradeResearcher,
  },
  {
    id: "clawbot-repo-snapshot",
    persona: "clawbot",
    task: `Give me a document-shaped snapshot of the current state of the clawbot repo on GitHub (RUBIEM-DEVELOPERS-REPO/clawbot): what it is, its main parts, and any obvious recent direction. Use headings and cite the README where you draw from it.`,
    targetSec: 150,
    grader: gradeClawbot,
  },
  {
    id: "aiia-press-release",
    persona: "aiia-marketing-specialist-v2",
    task: `Draft a 150-word press release announcing AI Tech Forum 2026. Date: 12 November 2026. Venue: Hilton Harare. Keynote theme: responsible AI in African public sector. Voice: AI Institute Africa's official voice. Audience: African tech press + public-sector decision makers.`,
    targetSec: 90,
    grader: gradeAIIAMarketing,
  },
  {
    id: "insurance-sales-corolla-pitch",
    persona: "insurance-sales-agent",
    task: `I'm a 32-year-old software engineer in Cape Town. Married with a one-year-old toddler. I rent (don't own property). I just bought a 2024 Toyota Corolla on finance — first new car I've owned. Walk me through the right car insurance for me and explain WHY, not just what.`,
    targetSec: 90,
    grader: gradeInsuranceSales,
  },
  {
    id: "underwriter-high-risk-term-life",
    persona: "insurance-underwriter",
    task: `New application: 58-year-old male, 2-pack-per-day smoker for 30 years, BMI 31, family history of coronary heart disease (father at 62), no prior insurance lapses, current BP 138/86 on medication, applying for $500K 20-year term life. Walk through your risk assessment and your decision: approve / decline / modify with a rating class, and explain your reasoning.`,
    targetSec: 90,
    grader: gradeInsuranceUnderwriter,
  },
  {
    id: "head-of-ai-adoption-memo",
    persona: "head-of-ai",
    task: `Draft a 1-page AI adoption strategy memo for a 250-person professional services firm (mid-tier consulting). The CEO has been reading about generative AI but hasn't moved. The memo should: name 3 high-impact opportunity areas, include responsible-AI guardrails, set 90-day measurable milestones, and name which stakeholders own which workstream.`,
    targetSec: 150,
    grader: gradeHeadOfAI,
  },
];

// ─────────────────────────────────────────────────────────────────────
// Phase 1b — NEW persona roster (11 just-added built-ins)
// ─────────────────────────────────────────────────────────────────────
const NEW_PERSONA_PROBES = [
  {
    id: "drew-discovery-prep",
    persona: "account-executive",
    task: `I have a discovery call tomorrow with the head of operations at a 200-person manufacturing firm. They expressed interest in our supply-chain visibility product after seeing a demo at a trade show. Prep me: MEDDIC notes covering what I know vs what I still need to learn, 6-8 discovery questions, and the biggest risk I should be probing for.`,
    targetSec: 90,
    grader: gradeAE,
  },
  {
    id: "riley-senior-backend-jd",
    persona: "recruiter",
    task: `Write a job description for a Senior Backend Engineer at a 40-person Series A fintech. Stack: Go + Postgres + Kafka. Remote, US time zones. Comp band $180-220K base + meaningful equity. Lead with outcomes, not buzzwords. 3-5 must-haves max.`,
    targetSec: 75,
    grader: gradeRecruiter,
  },
  {
    id: "fiona-unit-economics",
    persona: "financial-analyst",
    task: `Build the unit-economics view for a SaaS business with these inputs: $99/mo plan, 2.5% monthly churn, $400 paid-acquisition CAC, $300 onboarding cost (one-time), 75% gross margin. Show LTV, payback period, base/bull/bear scenarios, and the recommended action.`,
    targetSec: 90,
    grader: gradeFinAnalyst,
  },
  {
    id: "priya-workspace-export-prd",
    persona: "product-manager",
    task: `Write a 1-page PRD for adding workspace-level export to our analytics product. Current state: per-dashboard export exists; multiple enterprise customers requesting bulk export of all dashboards in a workspace. Lead with the problem, name the measurable outcome, declare non-goals, and ICE-score this against two alternatives: (a) better dashboard filters, (b) scheduled email reports.`,
    targetSec: 120,
    grader: gradePM,
  },
  {
    id: "dani-onboarding-critique",
    persona: "product-designer",
    task: `Critique this onboarding flow for a B2B analytics product: (1) sign up with email, (2) email verification, (3) workspace name + URL slug, (4) invite 3 teammates (required to proceed), (5) connect a data source (required to proceed), (6) tutorial video (auto-plays with sound). Anchor your critique to the user's job-to-be-done and flag accessibility issues.`,
    targetSec: 90,
    grader: gradeDesigner,
  },
  {
    id: "dale-checkout-color-ab",
    persona: "data-analyst",
    task: `We ran a 14-day A/B test on a new checkout button colour. Variant (orange): 12.4% conversion, n=8,420. Control (current green): 11.8% conversion, n=8,510. Write the read — should we ship? Be honest about CI, MDE, and any caveats (seasonality, weekday effects, peeking).`,
    targetSec: 75,
    grader: gradeDataAnalyst,
  },
  {
    id: "logan-nda-clause-redline",
    persona: "contracts-reviewer",
    task: `Review this NDA clause and tell me what to do with it: "Receiving Party shall hold Confidential Information in strict confidence for a period of ten (10) years from the date of disclosure, except for Confidential Information that becomes publicly available through no fault of Receiving Party." Flag the risk in plain language and suggest a redline.`,
    targetSec: 60,
    grader: gradeLegal,
  },
  {
    id: "evie-inbox-triage",
    persona: "executive-assistant",
    task: `Inbox triage for the CEO this morning. Five items: (1) Series A investor asking "any update on Q3 numbers?" (we're 2 weeks from quarter-end), (2) Engineering hire candidate following up the 5th time on offer status, (3) Industry conference invite to keynote next month — they need an answer by Friday, (4) Vendor offering 30% off their tool if signed by Friday, (5) CEO of a partner asking for a "quick chat" next week. Sort them and propose response strategy for each.`,
    targetSec: 75,
    grader: gradeEA,
  },
  {
    id: "quinn-password-reset-tests",
    persona: "qa-engineer",
    task: `Write a test plan for a new password-reset flow. The flow: user enters email → receives reset link → opens link → sets new password → redirected to login. Cover happy path, edge cases, and failure modes. State severity/priority thinking on the worst-case bug you can think of.`,
    targetSec: 90,
    grader: gradeQA,
  },
  {
    id: "devon-latency-spike-runbook",
    persona: "devops-sre",
    task: `Write an incident runbook for this scenario: API p99 latency suddenly jumps from 80ms to 3000ms with no recent deploy. The pager fires at 3am. Include symptom recognition, first-5-minute actions, a diagnostic decision tree (CPU? DB? network? upstream API?), and escalation criteria.`,
    targetSec: 90,
    grader: gradeSRE,
  },
  {
    id: "tao-deploy-tutorial",
    persona: "technical-writer",
    task: `Write a tutorial for using our (hypothetical) CLI command \`claw deploy --env prod\`. Audience: a backend engineer who has used the tool in staging dozens of times but never run it against production. Structure: outcome → prerequisites → numbered steps → verification → troubleshooting. Keep it skim-able.`,
    targetSec: 75,
    grader: gradeTechWriter,
  },
];

// ─────────────────────────────────────────────────────────────────────
// Phase 2 — Overload spawn burst (short tasks, force scale-up)
// ─────────────────────────────────────────────────────────────────────
const OVERLOAD_BURST = [
  { id: "burst-1", persona: "clawbot", task: "In two sentences, what is HTTP/2 multiplexing?" },
  { id: "burst-2", persona: "clawbot", task: "In two sentences, what is a database write-ahead log?" },
  { id: "burst-3", persona: "clawbot", task: "In two sentences, what is consistent hashing used for?" },
  { id: "burst-4", persona: "clawbot", task: "In two sentences, what is the C10K problem?" },
  { id: "burst-5", persona: "clawbot", task: "In two sentences, what does CAP theorem say?" },
];

// ─────────────────────────────────────────────────────────────────────
// Multi-worker handoff (sequential within phase, multi-turn)
// ─────────────────────────────────────────────────────────────────────
const HANDOFF_PROBE = {
  id: "sam-to-olivia-handoff",
  turns: [
    {
      persona: "software-engineer",
      content: `Read the current /api/personas route in this repo (server/src/routes/personas.ts) and give me your read on its testing posture — what's covered, what's not, what would be highest-leverage to add. Be concrete with file paths and function names.`,
      targetSec: 180,
      grader: gradeSoftwareEngineer,
    },
    {
      persona: "operations-coordinator",
      content: `Now using that engineering read, write a runbook for adding integration test coverage to the personas route. Numbered steps, owners, by-when, done-means. Treat the engineering findings above as your input.`,
      targetSec: 180,
      grader: (text) => {
        const opsGrade = gradeOperations(text);
        const refersBack = /\b(based on (?:sam|the engineering read|the prior|above)|the findings above|sam('s)? read|from the engineering)\b/i.test(text) ||
          /personas\.(?:ts|js)|persona route|persona endpoint/i.test(text);
        if (!refersBack) {
          opsGrade.notes.push("NO-CARRY-OVER");
          opsGrade.grade = tFromIdx(tIdx(opsGrade.grade) - 1);
        } else {
          opsGrade.notes.push("carry-over");
        }
        return opsGrade;
      },
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────
// Coverage gap report (static)
// ─────────────────────────────────────────────────────────────────────
const COMMON_WORKER_ROLES = [
  { role: "Customer Success",           covered: true,  via: "customer-success" },
  { role: "Operations / Project Mgmt",  covered: true,  via: "operations-coordinator" },
  { role: "Software Engineer",          covered: true,  via: "software-engineer" },
  { role: "Marketing Manager",          covered: true,  via: "marketing-manager" },
  { role: "Researcher / Analyst",       covered: true,  via: "researcher" },
  { role: "Insurance Sales Agent",      covered: true,  via: "insurance-sales-agent" },
  { role: "Insurance Underwriter",      covered: true,  via: "insurance-underwriter" },
  { role: "Head of AI / AI Lead",       covered: true,  via: "head-of-ai" },
  { role: "Sales (B2B AE)",             covered: true,  via: "account-executive" },
  { role: "Recruiter / HR",             covered: true,  via: "recruiter" },
  { role: "Financial Analyst",          covered: true,  via: "financial-analyst" },
  { role: "Product Manager",            covered: true,  via: "product-manager" },
  { role: "Designer (Product/UX)",      covered: true,  via: "product-designer" },
  { role: "Data Analyst",               covered: true,  via: "data-analyst" },
  { role: "Legal / Contracts",          covered: true,  via: "contracts-reviewer" },
  { role: "Executive Assistant",        covered: true,  via: "executive-assistant" },
  { role: "QA Engineer",                covered: true,  via: "qa-engineer" },
  { role: "DevOps / SRE",               covered: true,  via: "devops-sre" },
  { role: "Technical Writer",           covered: true,  via: "technical-writer" },
];

// ─────────────────────────────────────────────────────────────────────
// Pool snapshot recorder
// ─────────────────────────────────────────────────────────────────────
function startPoolMonitor(label, intervalMs = 2000) {
  const samples = [];
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const snap = await getPeerSnapshot();
      const t = Date.now();
      const row = {
        t,
        label,
        primaryInflight: snap.primary.inflight,
        peers: snap.peers.map(p => ({ name: p.name, role: p.role, port: p.url.split(":").pop(), inflight: p.inflight })),
        poolCount: snap.pool.count,
        poolCap: snap.pool.cap,
      };
      samples.push(row);
    } catch { /* tolerate */ }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return {
    stop: () => { stopped = true; },
    samples,
  };
}

function summarizePool(samples) {
  if (samples.length === 0) return { peakConcurrent: 0, peakPoolSize: 0, multiClawbotMoments: 0, distinctPeerPorts: new Set() };
  let peakConcurrent = 0;
  let peakPoolSize = 0;
  let multiClawbotMoments = 0;
  const distinctPeerPorts = new Set();
  for (const s of samples) {
    const peerTotal = s.peers.reduce((a, p) => a + (p.inflight ?? 0), 0);
    const total = (s.primaryInflight ?? 0) + peerTotal;
    if (total > peakConcurrent) peakConcurrent = total;
    if (s.poolCount > peakPoolSize) peakPoolSize = s.poolCount;
    // "Both clawbots working at the same time" — primary>0 AND at least one peer>0
    if ((s.primaryInflight ?? 0) >= 1 && s.peers.some(p => (p.inflight ?? 0) >= 1)) {
      multiClawbotMoments++;
    }
    for (const p of s.peers) if ((p.inflight ?? 0) >= 1) distinctPeerPorts.add(p.port);
  }
  return { peakConcurrent, peakPoolSize, multiClawbotMoments, distinctPeerPorts };
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

const lines = [];
const log = (s = "") => { console.log(s); lines.push(s); };

// Parallel-safe probe runner.
//
// The chat handler reads the GLOBAL active persona at request-time, so we
// MUST serialise the activate→POST step. After the POST returns a jobId,
// the actual work runs in the server's job queue — those jobs execute
// concurrently (the worker pool handles parallelism). We poll them in
// parallel below.
async function dispatchProbe(p) {
  await activatePersona(p.persona);
  const t0 = Date.now();
  let dispatched;
  let dispatchErr = null;
  try {
    dispatched = await chatDispatch([{ role: "user", content: p.task }]);
  } catch (e) {
    dispatchErr = String(e?.message ?? e);
    dispatched = { kind: "error", err: dispatchErr };
  }
  return { ...p, dispatched, dispatchT0: t0, dispatchErr };
}

async function completeProbe(d) {
  const { dispatched, dispatchT0, dispatchErr } = d;
  let text = "";
  let routedTo = null;
  let err = dispatchErr;
  if (!err) {
    try {
      const r = await chatComplete(dispatched);
      text = r.text;
      routedTo = extractRoutedTo(r.job);
    } catch (e) {
      err = String(e?.message ?? e);
    }
  }
  const elapsed = (Date.now() - dispatchT0) / 1000;
  const content = err ? { grade: "F", notes: [`ERR:${err.slice(0, 60)}`] } : (d.grader ?? gradeClawbot)(text);
  const penalty = timePenalty(elapsed, d.targetSec ?? 60);
  const finalIdx = Math.max(0, tIdx(content.grade) + penalty);
  const finalGrade = tFromIdx(finalIdx);
  const ok = tIdx(finalGrade) >= tIdx("B-");
  return {
    id: d.id,
    persona: d.persona,
    targetSec: d.targetSec ?? 60,
    elapsed,
    contentGrade: content.grade,
    finalGrade,
    notes: content.notes,
    ok,
    text,
    routedTo,
  };
}

async function main() {
  const stamp = new Date().toISOString();
  log(`# Employee Task Harness — PARALLEL :: ${TAG} :: ${stamp}`);
  log(`Server: ${BASE}`);
  log("");

  const originalActive = await getActivePersona();
  const initialSnap = await getPeerSnapshot();
  log(`Original active persona: ${originalActive ?? "(default/none)"}`);
  log(`Initial pool: primary=${initialSnap.primary.name}@${initialSnap.primary.url} inflight=${initialSnap.primary.inflight}`);
  log(`Initial peers: ${initialSnap.peers.map(p => `${p.name}(${p.role})@${p.url} inflight=${p.inflight}`).join(", ") || "(none)"}`);
  log(`Worker pool: ${initialSnap.pool.count}/${initialSnap.pool.cap} workers`);
  log("");

  // ─────────── PHASE 1 — parallel persona burst ───────────
  log(`## Phase 1 — Per-persona realistic tasks (PARALLEL)`);
  log("");
  const mon1 = startPoolMonitor("phase1");
  const phase1StartT = Date.now();
  // Serial dispatch (activate→POST), parallel polling.
  const phase1Dispatched = [];
  for (const p of PERSONA_PROBES) {
    phase1Dispatched.push(await dispatchProbe(p));
  }
  log(`  ── dispatched ${phase1Dispatched.length} probes in ${((Date.now() - phase1StartT) / 1000).toFixed(1)}s; now awaiting all in parallel`);
  const phase1Results = await Promise.all(phase1Dispatched.map(d => completeProbe(d)));
  const phase1Wall = (Date.now() - phase1StartT) / 1000;
  mon1.stop();
  const pool1 = summarizePool(mon1.samples);
  for (const r of phase1Results) {
    const mark = r.ok ? "✓" : "✗";
    log(`  ${mark} ${r.id.padEnd(38)} ${r.elapsed.toFixed(1)}s :: ${r.contentGrade} → ${r.finalGrade}  ${r.routedTo ? `routed:${r.routedTo}` : ""} notes: ${r.notes.join(", ") || "(none)"}`);
  }
  log(`  ── wall-clock ${phase1Wall.toFixed(1)}s; peak concurrent inflight=${pool1.peakConcurrent}; peak pool size=${pool1.peakPoolSize}; both-clawbots samples=${pool1.multiClawbotMoments}; distinct peer ports used={${[...pool1.distinctPeerPorts].join(",") || "none"}}`);
  log("");

  // ─────────── PHASE 1b — NEW persona burst ───────────
  log(`## Phase 1b — NEW personas (just-added roster, PARALLEL)`);
  log("");
  const mon1b = startPoolMonitor("phase1b");
  const phase1bStartT = Date.now();
  const phase1bDispatched = [];
  for (const p of NEW_PERSONA_PROBES) {
    phase1bDispatched.push(await dispatchProbe(p));
  }
  log(`  ── dispatched ${phase1bDispatched.length} new-persona probes in ${((Date.now() - phase1bStartT) / 1000).toFixed(1)}s; awaiting in parallel`);
  const phase1bResults = await Promise.all(phase1bDispatched.map(d => completeProbe(d)));
  const phase1bWall = (Date.now() - phase1bStartT) / 1000;
  mon1b.stop();
  const pool1b = summarizePool(mon1b.samples);
  for (const r of phase1bResults) {
    const mark = r.ok ? "✓" : "✗";
    log(`  ${mark} ${r.id.padEnd(38)} ${r.elapsed.toFixed(1)}s :: ${r.contentGrade} → ${r.finalGrade}  notes: ${r.notes.join(", ") || "(none)"}`);
  }
  log(`  ── wall-clock ${phase1bWall.toFixed(1)}s; peak concurrent inflight=${pool1b.peakConcurrent}; peak pool size=${pool1b.peakPoolSize}; both-clawbots samples=${pool1b.multiClawbotMoments}`);
  log("");

  // ─────────── PHASE 2 — overload spawn burst ───────────
  log(`## Phase 2 — Overload spawn burst (short tasks, force pool growth)`);
  log("");
  const preBurst = await getPeerSnapshot();
  const mon2 = startPoolMonitor("phase2");
  const phase2StartT = Date.now();
  const phase2Dispatched = [];
  for (const p of OVERLOAD_BURST) {
    phase2Dispatched.push(await dispatchProbe({ ...p, targetSec: 60, grader: gradeClawbot }));
  }
  log(`  ── dispatched ${phase2Dispatched.length} burst probes in ${((Date.now() - phase2StartT) / 1000).toFixed(1)}s; awaiting in parallel`);
  const phase2Results = await Promise.all(phase2Dispatched.map(d => completeProbe(d)));
  const phase2Wall = (Date.now() - phase2StartT) / 1000;
  mon2.stop();
  const pool2 = summarizePool(mon2.samples);
  const postBurst = await getPeerSnapshot();
  for (const r of phase2Results) {
    const mark = r.ok ? "✓" : "✗";
    log(`  ${mark} ${r.id.padEnd(38)} ${r.elapsed.toFixed(1)}s :: ${r.contentGrade} → ${r.finalGrade}  ${r.routedTo ? `routed:${r.routedTo}` : ""} notes: ${r.notes.join(", ") || "(none)"}`);
  }
  log(`  ── wall-clock ${phase2Wall.toFixed(1)}s; pool grew ${preBurst.pool.count}→${pool2.peakPoolSize}→${postBurst.pool.count}; peak concurrent inflight=${pool2.peakConcurrent}; distinct peer ports used={${[...pool2.distinctPeerPorts].join(",") || "none"}}`);
  log("");

  // ─────────── PHASE 3 — handoff (sequential, multi-turn) ───────────
  log(`## Phase 3 — Multi-worker handoff (Sam → Olivia, persona switch mid-thread)`);
  log("");
  const history = [];
  const phase3Results = [];
  const mon3 = startPoolMonitor("phase3");
  for (let i = 0; i < HANDOFF_PROBE.turns.length; i++) {
    const turn = HANDOFF_PROBE.turns[i];
    await activatePersona(turn.persona);
    history.push({ role: "user", content: turn.content });
    const t0 = Date.now();
    let text = "";
    let routedTo = null;
    let err = null;
    try {
      const r = await chatJobOrInline(history);
      text = r.text;
      routedTo = extractRoutedTo(r.job);
    } catch (e) {
      err = String(e?.message ?? e);
    }
    const elapsed = (Date.now() - t0) / 1000;
    const content = err ? { grade: "F", notes: [`ERR:${err.slice(0, 60)}`] } : turn.grader(text);
    const penalty = timePenalty(elapsed, turn.targetSec);
    const finalIdx = Math.max(0, tIdx(content.grade) + penalty);
    const finalGrade = tFromIdx(finalIdx);
    const ok = tIdx(finalGrade) >= tIdx("B-");
    const mark = ok ? "✓" : "✗";
    const label = `turn-${i + 1}-${turn.persona}`;
    log(`  ${mark} ${label.padEnd(38)} ${elapsed.toFixed(1)}s :: ${content.grade} → ${finalGrade}  ${routedTo ? `routed:${routedTo}` : ""} notes: ${content.notes.join(", ") || "(none)"}`);
    phase3Results.push({ label, persona: turn.persona, elapsed, contentGrade: content.grade, finalGrade, notes: content.notes, ok, text, routedTo });
    if (i < HANDOFF_PROBE.turns.length - 1) {
      history.push({ role: "assistant", content: text });
    }
  }
  mon3.stop();
  log("");

  // ─────────── PHASE 4 — coverage gap report ───────────
  log(`## Phase 4 — Coverage gap report (static)`);
  log("");
  const covered = COMMON_WORKER_ROLES.filter(r => r.covered);
  const missing = COMMON_WORKER_ROLES.filter(r => !r.covered);
  log(`Roster coverage: ${covered.length}/${COMMON_WORKER_ROLES.length} common roles represented`);
  log(`Covered:`);
  for (const r of covered) log(`  • ${r.role.padEnd(28)} via ${r.via}`);
  log(`Missing:`);
  for (const r of missing) log(`  • ${r.role.padEnd(28)} — ${r.suggest}`);
  log("");

  // ─────────── Scorecards ───────────
  log(`## Phase 1 scorecard (PARALLEL persona burst)`);
  log("");
  log(`| Probe | Persona | Target | Elapsed | Content | FINAL | Routed to | Notes |`);
  log(`|---|---|---|---|---|---|---|---|`);
  for (const r of phase1Results) {
    log(`| ${r.id} | ${r.persona} | ${r.targetSec}s | ${r.elapsed.toFixed(1)}s | ${r.contentGrade} | **${r.finalGrade}** | ${r.routedTo ?? "?"} | ${r.notes.join(", ").slice(0, 70)} |`);
  }
  log("");

  log(`## Phase 1b scorecard (NEW persona roster)`);
  log("");
  log(`| Probe | Persona | Target | Elapsed | Content | FINAL | Routed to | Notes |`);
  log(`|---|---|---|---|---|---|---|---|`);
  for (const r of phase1bResults) {
    log(`| ${r.id} | ${r.persona} | ${r.targetSec}s | ${r.elapsed.toFixed(1)}s | ${r.contentGrade} | **${r.finalGrade}** | ${r.routedTo ?? "?"} | ${r.notes.join(", ").slice(0, 70)} |`);
  }
  log("");

  log(`## Phase 2 scorecard (overload burst)`);
  log("");
  log(`| Probe | Elapsed | Content | FINAL | Routed to | Notes |`);
  log(`|---|---|---|---|---|---|`);
  for (const r of phase2Results) {
    log(`| ${r.id} | ${r.elapsed.toFixed(1)}s | ${r.contentGrade} | **${r.finalGrade}** | ${r.routedTo ?? "?"} | ${r.notes.join(", ").slice(0, 60)} |`);
  }
  log("");

  log(`## Phase 3 scorecard (handoff)`);
  log("");
  log(`| Turn | Persona | Elapsed | Content | FINAL | Routed to | Notes |`);
  log(`|---|---|---|---|---|---|---|`);
  for (const r of phase3Results) {
    log(`| ${r.label} | ${r.persona} | ${r.elapsed.toFixed(1)}s | ${r.contentGrade} | **${r.finalGrade}** | ${r.routedTo ?? "?"} | ${r.notes.join(", ").slice(0, 60)} |`);
  }
  log("");

  // ─────────── Parallelism summary ───────────
  log(`## Parallelism summary`);
  log("");
  log(`Phase 1 (10 persona probes):`);
  log(`  • Wall clock: ${phase1Wall.toFixed(1)}s (vs ~${PERSONA_PROBES.reduce((a, p) => a + p.targetSec, 0)}s sequential target sum)`);
  log(`  • Speedup: ${(PERSONA_PROBES.reduce((a, p) => a + p.targetSec, 0) / phase1Wall).toFixed(2)}× over sequential`);
  log(`  • Peak concurrent inflight: ${pool1.peakConcurrent}`);
  log(`  • Peak managed worker pool size: ${pool1.peakPoolSize}/${initialSnap.pool.cap}`);
  log(`  • Samples where primary AND a peer both had ≥1 inflight: ${pool1.multiClawbotMoments} (both-clawbots-working)`);
  log(`  • Distinct peer ports used: {${[...pool1.distinctPeerPorts].join(",") || "none"}}`);
  log("");
  log(`Phase 2 (5 short bursts):`);
  log(`  • Wall clock: ${phase2Wall.toFixed(1)}s`);
  log(`  • Pool size: pre=${preBurst.pool.count}, peak=${pool2.peakPoolSize}, post=${postBurst.pool.count} (cap=${initialSnap.pool.cap})`);
  log(`  • Peak concurrent inflight: ${pool2.peakConcurrent}`);
  log("");

  const all = [...phase1Results, ...phase1bResults, ...phase2Results, ...phase3Results];
  const aboveB = all.filter(r => r.ok).length;
  log(`## Combined summary`);
  log("");
  log(`${aboveB}/${all.length} above B- across live phases.`);
  log(`- Phase 1  (original roster):  ${phase1Results.filter(r => r.ok).length}/${phase1Results.length}`);
  log(`- Phase 1b (NEW roster):       ${phase1bResults.filter(r => r.ok).length}/${phase1bResults.length}`);
  log(`- Phase 2  (overload burst):   ${phase2Results.filter(r => r.ok).length}/${phase2Results.length}`);
  log(`- Phase 3  (handoff):          ${phase3Results.filter(r => r.ok).length}/${phase3Results.length}`);
  log(`Both-clawbots-working: ${(pool1.multiClawbotMoments + pool1b.multiClawbotMoments) > 0 ? "YES" : "NO"} (peak phase-1=${pool1.peakConcurrent}, phase-1b=${pool1b.peakConcurrent})`);
  log(`Roster gaps: ${missing.length}/${COMMON_WORKER_ROLES.length} missing → see Phase 4`);
  log("");

  // Restore original persona
  if (originalActive) {
    await activatePersona(originalActive);
    log(`Restored active persona to: ${originalActive}`);
  } else {
    await postJson(`/api/personas/deactivate`, {});
    log(`Cleared active persona.`);
  }
  log("");

  // Brain update
  log(`## Brain update`);
  const noteBody = [
    `# Employee task harness (parallel) — ${stamp}`,
    ``,
    `Strict-graded parallel persona simulation. ${aboveB}/${all.length} above B-.`,
    ``,
    `**Parallelism:**`,
    `- Peak concurrent inflight: ${pool1.peakConcurrent}`,
    `- Peak managed pool size: ${pool1.peakPoolSize}/${initialSnap.pool.cap}`,
    `- Both-clawbots-working samples: ${pool1.multiClawbotMoments}`,
    `- Phase 1 wall clock: ${phase1Wall.toFixed(1)}s for 10 probes (speedup ${(PERSONA_PROBES.reduce((a, p) => a + p.targetSec, 0) / phase1Wall).toFixed(2)}× over sequential target sum)`,
    ``,
    `**Phase 1 — original persona tasks:**`,
    ...phase1Results.map(r => `- ${r.persona}: ${r.finalGrade} (${r.elapsed.toFixed(1)}s) — ${r.notes.slice(0, 4).join(", ")}`),
    ``,
    `**Phase 1b — NEW persona roster (just-added builtins):**`,
    ...phase1bResults.map(r => `- ${r.persona}: ${r.finalGrade} (${r.elapsed.toFixed(1)}s) — ${r.notes.slice(0, 4).join(", ")}`),
    ``,
    `**Phase 2 — overload burst:**`,
    ...phase2Results.map(r => `- ${r.id}: ${r.finalGrade} (${r.elapsed.toFixed(1)}s)`),
    ``,
    `**Phase 3 — handoff:**`,
    ...phase3Results.map(r => `- ${r.label}: ${r.finalGrade} — ${r.notes.slice(0, 4).join(", ")}`),
    ``,
    `**Coverage gaps (${missing.length}):**`,
    ...missing.map(r => `- ${r.role} — ${r.suggest}`),
  ].join("\n");
  try {
    const r = await postJson("/api/templates/add-note/run", { inputs: { title: `Employee harness parallel — ${stamp.slice(0, 10)}`, body: noteBody } });
    const jobId = r.body?.jobId ?? r.body?.id ?? null;
    log(`Session note submitted${jobId ? ` (jobId: ${jobId})` : ""}.`);
  } catch (e) {
    log(`Brain update FAILED: ${String(e?.message ?? e)}`);
  }
  log("");
}

main()
  .then(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = `_employee-harness-${TAG}-${stamp}.md`;
    import("node:fs").then(fs => {
      fs.writeFileSync(out, lines.join("\n"));
      console.log(`\nWrote: ${out}`);
    });
  })
  .catch(e => {
    console.error("HARNESS FAILED:", e);
    process.exit(1);
  });
