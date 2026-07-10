// Research-aware employee task harness.
//
// Different surface from the prior runs: every probe here is a task the
// persona CANNOT answer well without external context — needs the web (or
// vault) to get real data. Examples:
//   - Drew researches Anthropic's actual pricing before prepping MEDDIC
//   - Riley benchmarks "Staff Engineer" expectations against real companies
//   - Fiona looks up actual NDR benchmarks for 2025-2026
//   - Logan researches MFN clause case law / industry-typical positions
//
// We grade two things on each probe:
//   1. Persona shape — the same signature graders from prior harnesses
//      (does it look like Drew's MEDDIC / Maya's brief / Logan's risk frame).
//   2. Research evidence — markers that the agent actually pulled context:
//      numbered citations [N], URLs, "according to" / "per the report" /
//      dated references, named real-world entities (Stripe, Vercel, etc).
//
// Combined grade: persona shape passes only if research evidence is also
// present. If the persona produced a beautiful MEDDIC sheet entirely from
// thin air with zero sources, we drop the grade — the point of these
// probes is to verify clawbot reaches for the web when the task demands it.
//
// Sequential dispatch (parallel = OR free-tier 429s under load), targets
// generous because research adds web.scrape / research.deep steps.

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "res";
const BASE = "http://127.0.0.1:7471";

const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const tIdx = (g) => TIERS.indexOf(g);
const tFromIdx = (i) => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];
function timePenalty(e, t) { if (!t || e <= t) return 0; return -Math.floor((e - t) / (t * 0.5)); }

async function postJson(path, body, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:7470" },
        body: JSON.stringify(body ?? {}),
      });
      let j = null; try { j = await r.json(); } catch {}
      return { status: r.status, body: j };
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(1500);
    }
  }
  throw last;
}
async function getJson(path) {
  const r = await fetch(`${BASE}${path}`); let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, ok: r.ok };
}
// Bigger pollJob timeout — research tasks legitimately take 4-6 minutes.
async function pollJob(id, maxMs = 600_000) {
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
  if (post.body?.kind === "message") return { text: post.body.text ?? "", inline: true, job: null };
  if (post.body?.kind === "task" && post.body?.jobId) {
    const j = await pollJob(post.body.jobId);
    return { text: j.result?.answer ?? "", inline: false, job: j };
  }
  return { text: JSON.stringify(post.body).slice(0, 400), inline: false, job: null };
}
// Two-step chat: dispatch (sync — post + grab jobId) then poll (async).
// Serialises the persona-activate → /api/chat POST sequence (which mutates
// global active-persona state) while still polling all jobs in parallel.
async function chatDispatch(content) {
  const post = await postJson("/api/chat", { messages: [{ role: "user", content }] });
  if (post.body?.kind === "message") return { kind: "message", text: post.body.text ?? "" };
  if (post.body?.kind === "task" && post.body?.jobId) return { kind: "task", jobId: post.body.jobId };
  return { kind: "unknown", raw: post.body };
}
async function chatComplete(dispatched) {
  if (dispatched.kind === "message") return { text: dispatched.text, inline: true, job: null };
  if (dispatched.kind === "task") {
    const j = await pollJob(dispatched.jobId);
    return { text: j.result?.answer ?? "", inline: false, job: j };
  }
  return { text: JSON.stringify(dispatched.raw).slice(0, 400), inline: false, job: null };
}
async function activate(id) { await postJson(`/api/personas/${id}/activate`, {}); }

// ─── Pool snapshot (verifies both clawbots are loaded simultaneously) ───
async function getPeerSnapshot() {
  const r = await getJson("/api/peers");
  const self = r.body?.self ?? null;
  const peers = r.body?.peers ?? [];
  const worker = await getJson("/api/peers/worker");
  return {
    primary: { name: self?.name ?? "primary", inflight: self?.inflightJobs ?? 0 },
    peers: peers.map(p => ({ name: p.name ?? "?", port: p.url.split(":").pop(), inflight: p.inflightJobs ?? 0 })),
    pool: { count: worker.body?.count ?? 0, cap: worker.body?.cap ?? 0 },
  };
}
function startPoolMonitor(intervalMs = 2000) {
  const samples = [];
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const snap = await getPeerSnapshot();
      samples.push({ t: Date.now(), primaryInflight: snap.primary.inflight, peers: snap.peers, poolCount: snap.pool.count });
    } catch { /* tolerate */ }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return { stop: () => { stopped = true; }, samples };
}
function summarizePool(samples) {
  if (samples.length === 0) return { peakConcurrent: 0, peakPoolSize: 0, bothClawbotsSamples: 0, distinctPeerPorts: new Set() };
  let peakConcurrent = 0, peakPoolSize = 0, bothClawbotsSamples = 0;
  const distinctPeerPorts = new Set();
  for (const s of samples) {
    const peerTotal = s.peers.reduce((a, p) => a + (p.inflight ?? 0), 0);
    const total = (s.primaryInflight ?? 0) + peerTotal;
    if (total > peakConcurrent) peakConcurrent = total;
    if (s.poolCount > peakPoolSize) peakPoolSize = s.poolCount;
    if ((s.primaryInflight ?? 0) >= 1 && s.peers.some(p => (p.inflight ?? 0) >= 1)) bothClawbotsSamples++;
    for (const p of s.peers) if ((p.inflight ?? 0) >= 1) distinctPeerPorts.add(p.port);
  }
  return { peakConcurrent, peakPoolSize, bothClawbotsSamples, distinctPeerPorts };
}

// ─── Research-evidence checker ────────────────────────────────────
//
// Markers that the agent reached for external context. Score out of 5;
// we want at least 2 hits to consider the probe "research-grounded".
function researchEvidence(text) {
  const notes = [];
  const hasCites = /\[\d+\]/.test(text);
  const hasURL = /https?:\/\/[\w./?=&%#-]+/.test(text);
  const hasAccordTo = /\b(?:according to|sources?:?|as reported by|per (?:the )?(?:report|study|article|2024|2025|2026|industry)|recent (?:report|study|analysis|article|benchmark))\b/i.test(text);
  const hasDated = /\b(?:in 20\d{2}|as of 20\d{2}|20\d{2}[- ]?Q\d|Q\d\s+20\d{2}|published 20\d{2})\b/i.test(text);
  const hasNamedEntity = /\b(?:Stripe|Vercel|Anthropic|OpenAI|Notion|Linear|Slack|HubSpot|Snowflake|Datadog|Kafka|Confluent|Postgres|Redis|GitHub|Cloudflare|Atlassian|Salesforce|Figma|Airtable|Mongo|Sequoia|Andreessen|Y Combinator|Bain|McKinsey|Goldman|OpenView|SaaStr|Gartner|Forrester)\b/.test(text);
  if (hasCites) notes.push("cites[N]");
  if (hasURL) notes.push("URLs");
  if (hasAccordTo) notes.push("attribution");
  if (hasDated) notes.push("dated");
  if (hasNamedEntity) notes.push("real-entities");
  const count = [hasCites, hasURL, hasAccordTo, hasDated, hasNamedEntity].filter(Boolean).length;
  return { notes, count };
}

// Combine a persona-shape grader with the research-evidence check.
// Rules:
//   - If shape grade ≥ B but research evidence count == 0 → drop 2 tiers
//     (looks great but didn't actually research; ungrounded).
//   - If shape grade ≥ B and evidence count == 1 → drop 1 tier (weak).
//   - If shape grade < C and evidence count ≥ 3 → bump 1 tier (research was
//     done but synthesis was thin; partial credit).
function combineGrade(shapeGrade, evidence) {
  let g = shapeGrade;
  const i = tIdx(g);
  if (i >= tIdx("B")) {
    if (evidence.count === 0) g = tFromIdx(i - 2);
    else if (evidence.count === 1) g = tFromIdx(i - 1);
  } else if (i <= tIdx("C") && evidence.count >= 3) {
    g = tFromIdx(i + 1);
  }
  return g;
}

// ─── Persona-shape graders (subset; verbatim from prior harnesses) ───

function gradeAE(text) {
  const notes = [];
  const meddic = /\b(MEDDIC|metric|economic buyer|decision criteria|decision process|champion|pain)\b/i.test(text);
  const discovery = /\b(discovery (?:question|call)|tell me about|walk me through)\b/i.test(text);
  const nextStep = /\b(next step|follow[- ]up|by (?:monday|tuesday|wednesday|thursday|friday))\b/i.test(text);
  const risk = /\b(risk|red flag|concern|no (?:champion|compelling event))\b/i.test(text);
  if (meddic) notes.push("MEDDIC");
  if (discovery) notes.push("discovery");
  if (nextStep) notes.push("next-step");
  if (risk) notes.push("risk");
  let grade = "A";
  const pts = [meddic, discovery, nextStep, risk].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeMarketing(text) {
  const notes = [];
  const hasAudience = /\b(audience|target|segment|persona|ICP)\b/i.test(text);
  const hasOutcome = /\b(\d+\s*(?:%|hours|leads|signups|conversions|demos)|open rate|conversion|reduce|grow|cut)\b/i.test(text);
  const hasShape = /\b(hook|channels?|insight|success metric|positioning|messaging|cta|call[- ]to[- ]action)\b/i.test(text);
  if (hasAudience) notes.push("audience");
  if (hasOutcome) notes.push("measurable");
  if (hasShape) notes.push("brief-shape");
  let grade = "A";
  const pts = [hasAudience, hasOutcome, hasShape].filter(Boolean).length;
  if (pts <= 1) grade = "C"; else if (pts === 2) grade = "B-";
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeRecruiter(text) {
  const notes = [];
  const outcomes = /\b(first 90 days|first 30 days|ship|deliver|outcomes?|impact)\b/i.test(text);
  const mustHaves = /\b(must[- ]have|nice[- ]to[- ]have|required|requirements?|qualifications?|what you('| a)?ll bring|\d+\+?\s+years?)\b/i.test(text);
  const comp = /\$\s*\d{2,3}[Kk]|\$\s*\d{2,3},?\d{3}|\bequity\b|\bcompensation\b/i.test(text);
  if (outcomes) notes.push("outcomes");
  if (mustHaves) notes.push("must-haves");
  if (comp) notes.push("comp");
  let grade = "A";
  const pts = [outcomes, mustHaves, comp].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeFinAnalyst(text) {
  const notes = [];
  const hasAssumptions = /\b(assumption|assume|input|key driver)/i.test(text);
  const hasBenchmark = /\b(benchmark|industry (?:average|typical|standard)|comparable|peer|median|percentile)\b/i.test(text);
  const hasUnitEcon = /\b(LTV|CAC|payback|gross margin|NDR|net dollar retention|cohort|ARR|MRR)\b/i.test(text);
  const hasRecommendation = /\b(recommend|recommendation|action|conclusion|takeaway)\b/i.test(text);
  if (hasAssumptions) notes.push("assumptions");
  if (hasBenchmark) notes.push("benchmark");
  if (hasUnitEcon) notes.push("unit-econ");
  if (hasRecommendation) notes.push("recommendation");
  let grade = "A";
  const pts = [hasAssumptions, hasBenchmark, hasUnitEcon, hasRecommendation].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeSWE(text) {
  const notes = [];
  const hasArchitecture = /\b(architecture|design|component|module|abstraction|interface|api|integration)\b/i.test(text);
  const hasTradeoff = /\b(trade[- ]?off|pros?\s+and\s+cons|risk|downside|cost\b.*\bbenefit|alternative)\b/i.test(text);
  const hasRecommendation = /\b(recommend|recommendation|i('?| a)d (?:adopt|use|pick|go with|choose)|verdict)\b/i.test(text);
  const hasSpecifics = /\b(?:Vercel|Next\.?js|React|Node|TypeScript|API|SDK|framework|library)\b/.test(text);
  if (hasArchitecture) notes.push("architecture");
  if (hasTradeoff) notes.push("trade-offs");
  if (hasRecommendation) notes.push("recommendation");
  if (hasSpecifics) notes.push("specifics");
  let grade = "A";
  const pts = [hasArchitecture, hasTradeoff, hasRecommendation, hasSpecifics].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeLegal(text) {
  const notes = [];
  const hasCaveat = /\b(not legal advice|consult (?:counsel|a lawyer|an attorney)|licensed (?:counsel|attorney)|seek (?:counsel|legal))\b/i.test(text);
  const hasRiskFrame = /\b(risk|exposure|liability|onerous|favourable|favorable|burden)\b/i.test(text);
  const hasPosition = /\b(industry[- ]typical|standard market|customer[- ]favourable|customer[- ]favorable|vendor[- ]favourable|vendor[- ]favorable|best practice|market position|push back)\b/i.test(text);
  const hasPlain = /\b(in plain (?:english|language)|meaning|in other words|this means|in practice|example)\b/i.test(text);
  if (hasCaveat) notes.push("caveat");
  if (hasRiskFrame) notes.push("risk");
  if (hasPosition) notes.push("position");
  if (hasPlain) notes.push("plain");
  let grade = "A";
  if (!hasCaveat) grade = "C+";
  const pts = [hasRiskFrame, hasPosition].filter(Boolean).length;
  if (pts === 0) grade = tFromIdx(tIdx(grade) - 2);
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeResearcher(text) {
  const notes = [];
  const hasHeadings = /(^|\n)#{2,3}\s+(topic statement|perspectives|cross-cutting|open questions|bottom line)/i.test(text);
  const hasCitations = /\[\d+\]/.test(text);
  const hasPerspectives = /\b(mainstream|critical|practitioner|recent|sceptical|skeptical)\b/i.test(text);
  const hasContradiction = /\b(disagree|contradict|tension|in contrast|however|on the other hand)\b/i.test(text);
  if (hasHeadings) notes.push("section-shape");
  if (hasCitations) notes.push("citations");
  if (hasPerspectives) notes.push("perspectives");
  if (hasContradiction) notes.push("disagreement");
  let grade = "A";
  const pts = [hasHeadings, hasCitations, hasPerspectives].filter(Boolean).length;
  if (pts <= 1) grade = "C"; else if (pts === 2) grade = "B-";
  if (text.length < 600) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeQA(text) {
  const notes = [];
  const hasStrategy = /\b(test (?:plan|strategy)|test approach|coverage)\b/i.test(text);
  const hasPattern = /\b(contract testing|chaos engineering|integration test|consumer driven|fuzz|property[- ]based|smoke test|end[- ]to[- ]end|synthetic)\b/i.test(text);
  const hasTooling = /\b(jest|pytest|playwright|cypress|gauge|pact|wiremock|k6|gatling|chaos[- ]monkey|toxiproxy|mockito)\b/i.test(text);
  const hasRisks = /\b(risk|failure mode|edge case|gotcha|caveat)\b/i.test(text);
  if (hasStrategy) notes.push("strategy");
  if (hasPattern) notes.push("patterns");
  if (hasTooling) notes.push("tooling");
  if (hasRisks) notes.push("risks");
  let grade = "A";
  const pts = [hasStrategy, hasPattern, hasTooling, hasRisks].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeSRE(text) {
  const notes = [];
  const hasSymptom = /\b(symptom|trigger|alert|pager|lag|spike|consumer lag)\b/i.test(text);
  const hasFirst5 = /\b(first 5 (?:min|minute)|immediate (?:action|step)|first thing|first 5)\b/i.test(text);
  const hasDiag = /\b(diagnostic|tree|check (?:logs|metrics|dashboards)|consumer offset|broker|partition)\b/i.test(text);
  const hasEscalate = /\b(escalat|on[- ]call|page (?:the )?team|incident commander)\b/i.test(text);
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
function gradePM(text) {
  const notes = [];
  const hasProblem = /\b(problem|user problem|whose problem|user (?:need|wants|pain))\b/i.test(text);
  const hasOutcome = /\b(outcome|measurable|success metric|kpi|north star)\b/i.test(text);
  const hasMarket = /\b(competitor|alternative|landscape|category|positioning|differentiat)\b/i.test(text);
  const hasGap = /\b(gap|opportunity|underserved|unmet|complain|pain point)\b/i.test(text);
  if (hasProblem) notes.push("problem");
  if (hasOutcome) notes.push("outcome");
  if (hasMarket) notes.push("market");
  if (hasGap) notes.push("gap");
  let grade = "A";
  const pts = [hasProblem, hasOutcome, hasMarket, hasGap].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeDataAnalyst(text) {
  const notes = [];
  const hasMethod = /\b(cohort|retention curve|survival|monthly|quarterly|trailing|rolling)\b/i.test(text);
  const hasBenchmark = /\b(benchmark|industry|median|percentile|comparable|peer)\b/i.test(text);
  const hasMetric = /\b(retention|churn|NDR|GRR|expansion|stickiness|engagement)\b/i.test(text);
  const hasRecommend = /\b(recommend|propose|i('?| a)d|suggest|approach)\b/i.test(text);
  if (hasMethod) notes.push("method");
  if (hasBenchmark) notes.push("benchmark");
  if (hasMetric) notes.push("metric");
  if (hasRecommend) notes.push("recommend");
  let grade = "A";
  const pts = [hasMethod, hasBenchmark, hasMetric, hasRecommend].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

const PROBES = [
  {
    id: "drew-anthropic-pricing-meddic",
    persona: "account-executive",
    grader: gradeAE,
    targetSec: 240,
    task: `I have a discovery call on Friday with the VP of Engineering at a Series B AI company. Before the call, I need to understand Anthropic's actual enterprise pricing structure as of 2026 — what tiers they have, what the entry point looks like, what triggers an upgrade conversation. Research it on the web, then prep MEDDIC notes specifically calling out what their pricing structure reveals about ICP, budget signals, and how to position my discovery questions around it. End with 6-8 discovery questions calibrated to what you learned.`,
  },
  {
    id: "maya-notion-competitive-response",
    persona: "marketing-manager",
    grader: gradeMarketing,
    targetSec: 210,
    task: `Look up Notion's most recent product launch (anything in the last 6 months — AI features, calendar integration, whatever they shipped). Then write a 1-page competitive response brief for our product: an AI agent for solo founders. How do we position against Notion's latest? Brief shape: Audience / Insight / Hook / Channels / Differentiator vs Notion / Success metric.`,
  },
  {
    id: "riley-staff-engineer-jd",
    persona: "recruiter",
    grader: gradeRecruiter,
    targetSec: 210,
    task: `I'm writing a JD for a Staff Software Engineer. Look up what "Staff Engineer" level expectations actually mean at well-known engineering companies (Stripe, Vercel, Linear, or similar — pick 2-3 to ground in). Then draft a JD that's competitive against those bars. Lead with outcomes, 3-5 must-haves max, name comp range and the specific staff-level scope distinctions.`,
  },
  {
    id: "fiona-ndr-benchmark-table",
    persona: "financial-analyst",
    grader: gradeFinAnalyst,
    targetSec: 240,
    task: `Look up what the current net dollar retention (NDR) benchmarks are for B2B SaaS in 2025-2026 according to recent industry reports (OpenView, SaaStr, Gartner, or similar). Then build a benchmark table comparing different ARR tiers (under $1M, $1-10M, $10-50M, $50M+). State your assumptions and end with a one-line recommendation on where a healthy NDR sits for a startup approaching $10M ARR.`,
  },
  {
    id: "sam-vercel-ai-sdk-adoption",
    persona: "software-engineer",
    grader: gradeSWE,
    targetSec: 240,
    task: `Research the current state of Vercel's AI SDK — what's its core architecture, what makes it different from LangChain or the OpenAI SDK, who's using it in production, what are the known sharp edges. Then give me your engineering read: should we adopt it for our chatbot stack (a Next.js app on Vercel with multiple model providers)? Name trade-offs explicitly and end with a verdict.`,
  },
  {
    id: "logan-mfn-clause-research",
    persona: "contracts-reviewer",
    grader: gradeLegal,
    targetSec: 240,
    task: `Research how MFN (Most-Favored-Nation) pricing clauses are typically negotiated in commercial software contracts. What's the industry-typical position? Which carve-outs are common? Where does the customer have leverage? Where should we push back? Summarise the risk landscape and the typical redline pattern. Standard reminder about not being legal advice.`,
  },
  {
    id: "researcher-small-llm-impact",
    persona: "researcher",
    grader: gradeResearcher,
    targetSec: 360,
    task: `Multi-perspective investigation: what's the practical impact of small open-source LLMs (Llama, Qwen, Mistral, 7B-13B class) on enterprise adoption in 2025-2026? I want at least four perspectives — mainstream coverage, critical / sceptical voices, practitioner reports, and recent news. Cite every substantive claim, name disagreements between perspectives explicitly.`,
  },
  {
    id: "quinn-event-driven-testing",
    persona: "qa-engineer",
    grader: gradeQA,
    targetSec: 240,
    task: `Research the current best practices for testing event-driven microservices in 2026 — what testing patterns have practitioners settled on (contract testing, consumer-driven contracts, chaos engineering, etc.), what tools are dominant, and where the common failures live. Then draft a test strategy for our event pipeline (Kafka-based, ~10 producer services, ~30 consumer services). Cover happy path / edge cases / failure modes.`,
  },
  {
    id: "devon-kafka-lag-runbook",
    persona: "devops-sre",
    grader: gradeSRE,
    targetSec: 240,
    task: `Research the current consensus on observability and incident triage for high-throughput Kafka deployments — what metrics matter (consumer lag, partition skew, ISR, etc.), what tooling people actually use, what bad-day patterns repeat. Then draft a runbook for incident response when a Kafka cluster shows consumer-lag spikes at 3am. Include symptom recognition, first-5-minute actions, diagnostic decision tree, and escalation.`,
  },
  {
    id: "priya-ai-agent-solo-founder-prd",
    persona: "product-manager",
    grader: gradePM,
    targetSec: 240,
    task: `Research the current landscape for "AI agents for solo founders" as a product category in 2026 — who's playing (real product names + positioning), what users complain about most, where the gap is. Then draft a positioning section for our PRD: the problem, the measurable outcome, the gap we exploit vs competitors, and 2-3 non-goals. Be concrete about who the competitors are.`,
  },
  {
    id: "dale-saas-retention-curve",
    persona: "data-analyst",
    grader: gradeDataAnalyst,
    targetSec: 180,
    task: `Look up what cohort retention curve shapes are typical for B2B SaaS in 2025-2026 — specifically the early-cliff vs smiling-curve patterns, how product-led-growth vs sales-led businesses differ, and what "best in class" looks like. Then propose a benchmarking framework: how should we compare our own cohort retention (mostly mid-market B2B, 12-month cohorts) against industry, what's the signal we're looking for, and what would trigger an investigation.`,
  },
];

const lines = [];
const log = (s = "") => { console.log(s); lines.push(s); };

async function main() {
  const stamp = new Date().toISOString();
  log(`# Research-aware employee harness — PARALLEL :: ${TAG} :: ${stamp}`);
  log(`Server: ${BASE}`);
  log(`Probes: ${PROBES.length}. Each requires external context. PARALLEL dispatch (serial activate→POST→jobId, then poll all in parallel).`);
  log("");

  const original = (await getJson("/api/personas")).body?.activeId ?? null;
  const initial = await getPeerSnapshot();
  log(`Initial pool: primary inflight=${initial.primary.inflight}; peers=${initial.peers.map(p => `${p.name}@${p.port} inflight=${p.inflight}`).join(", ") || "(none)"}; pool=${initial.pool.count}/${initial.pool.cap}`);
  log("");

  // Phase: PARALLEL dispatch + poll.
  // Step A: serially activate-persona → POST /api/chat → grab jobId. This
  // serialises only the dispatch (which depends on global active-persona
  // state); the actual server-side work runs concurrently across primary +
  // worker pool.
  // Step B: await all polls in parallel.
  const mon = startPoolMonitor();
  const wallStart = Date.now();
  const dispatched = [];
  for (const p of PROBES) {
    await activate(p.persona);
    const t0 = Date.now();
    let dispatchErr = null, dResult;
    try { dResult = await chatDispatch(p.task); }
    catch (e) { dispatchErr = String(e?.message ?? e); dResult = { kind: "error" }; }
    dispatched.push({ ...p, dResult, t0, dispatchErr });
  }
  log(`  ── dispatched ${dispatched.length} probes in ${((Date.now() - wallStart) / 1000).toFixed(1)}s; awaiting completions in parallel`);

  const settled = await Promise.all(dispatched.map(async (d) => {
    let text = "", inline = false, err = d.dispatchErr;
    if (!err) {
      try {
        const r = await chatComplete(d.dResult);
        text = r.text;
        inline = r.inline;
      } catch (e) { err = String(e?.message ?? e); }
    }
    const elapsed = (Date.now() - d.t0) / 1000;
    const shape = err ? { grade: "F", notes: [`ERR:${err.slice(0, 60)}`] } : d.grader(text);
    const evidence = err ? { notes: [], count: 0 } : researchEvidence(text);
    const combined = err ? "F" : combineGrade(shape.grade, evidence);
    const penalty = timePenalty(elapsed, d.targetSec);
    const finalIdx = Math.max(0, tIdx(combined) + penalty);
    const finalGrade = tFromIdx(finalIdx);
    const ok = tIdx(finalGrade) >= tIdx("B-");
    return { ...d, elapsed, shapeGrade: shape.grade, shapeNotes: shape.notes, evidence, combined, finalGrade, ok, inline, textLen: text.length };
  }));
  const wallElapsed = (Date.now() - wallStart) / 1000;
  mon.stop();
  const poolSummary = summarizePool(mon.samples);

  // Print results in the original probe order.
  for (const r of settled) {
    const mark = r.ok ? "✓" : "✗";
    const inlineMark = r.inline ? " (inline)" : "";
    log(`${mark} ${r.id.padEnd(38)} ${r.elapsed.toFixed(1)}s :: shape ${r.shapeGrade} · research ${r.evidence.count}/5 [${r.evidence.notes.join(",")}] → ${r.combined} → ${r.finalGrade}${inlineMark}  len=${r.textLen}`);
  }
  const results = settled;
  log("");

  log(`## Parallelism`);
  log("");
  const targetSum = PROBES.reduce((s, p) => s + p.targetSec, 0);
  log(`- Wall clock: ${wallElapsed.toFixed(1)}s (vs ~${targetSum}s sequential target sum)`);
  log(`- Speedup: ${(targetSum / wallElapsed).toFixed(2)}× over sequential`);
  log(`- Peak concurrent inflight (primary + peers): ${poolSummary.peakConcurrent}`);
  log(`- Peak managed worker pool size: ${poolSummary.peakPoolSize}/${initial.pool.cap}`);
  log(`- Samples where primary AND a peer both had ≥1 inflight: ${poolSummary.bothClawbotsSamples} (both-clawbots-working)`);
  log(`- Distinct peer ports loaded: {${[...poolSummary.distinctPeerPorts].join(",") || "none"}}`);
  log("");

  log(`## Scorecard`);
  log("");
  log(`| Probe | Persona | Target | Elapsed | Shape | Research | Combined | FINAL | Notes |`);
  log(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of results) {
    log(`| ${r.id} | ${r.persona} | ${r.targetSec}s | ${r.elapsed.toFixed(1)}s | ${r.shapeGrade} | ${r.evidence.count}/5 | ${r.combined} | **${r.finalGrade}** | ${[...r.shapeNotes, ...r.evidence.notes].join(", ").slice(0, 60)} |`);
  }
  log("");

  const aboveB = results.filter(r => r.ok).length;
  const grounded = results.filter(r => r.evidence.count >= 2).length;
  log(`## Summary`);
  log("");
  log(`${aboveB}/${results.length} above B-.`);
  log(`${grounded}/${results.length} grounded in external research (≥2 evidence markers).`);
  log(`Average research evidence count: ${(results.reduce((s, r) => s + r.evidence.count, 0) / results.length).toFixed(1)}/5.`);
  log("");

  if (original) await activate(original);

  // Brain note
  const noteBody = [
    `# Research-aware employee harness (parallel) — ${stamp}`,
    ``,
    `${aboveB}/${results.length} of personas above B- when forced to use external context. ${grounded}/${results.length} grounded in research evidence.`,
    ``,
    `**Parallelism:**`,
    `- Wall clock: ${wallElapsed.toFixed(1)}s (sequential target sum ~${targetSum}s; speedup ${(targetSum / wallElapsed).toFixed(2)}×)`,
    `- Peak concurrent inflight: ${poolSummary.peakConcurrent}`,
    `- Peak managed pool size: ${poolSummary.peakPoolSize}/${initial.pool.cap}`,
    `- Both-clawbots-working samples: ${poolSummary.bothClawbotsSamples}`,
    ``,
    `**Per-probe (shape · research markers · final):**`,
    ...results.map(r => `- ${r.persona} (${r.id}): shape ${r.shapeGrade} · research ${r.evidence.count}/5 [${r.evidence.notes.join(",") || "none"}] → ${r.finalGrade} (${r.elapsed.toFixed(1)}s)`),
  ].join("\n");
  try {
    const rr = await postJson("/api/templates/add-note/run", { inputs: { title: `Research harness — ${stamp.slice(0, 10)}`, body: noteBody } });
    log(`Brain update: submitted${rr.body?.jobId ? ` (job ${rr.body.jobId})` : ""}.`);
  } catch (e) {
    log(`Brain update FAILED: ${String(e?.message ?? e)}`);
  }
}

main()
  .then(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = `_research-harness-${TAG}-${stamp}.md`;
    import("node:fs").then(fs => {
      fs.writeFileSync(out, lines.join("\n"));
      console.log(`\nWrote: ${out}`);
    });
  })
  .catch(e => { console.error("HARNESS FAILED:", e); process.exit(1); });
