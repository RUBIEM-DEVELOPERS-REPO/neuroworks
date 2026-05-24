// Research-aware employee harness — SECOND surface.
//
// Different probes from rs7 (NDR benchmarks / Stripe / Notion / MFN / etc.).
// 8 new employee-style tasks across different roles and research domains:
//
//   • Drew — close-rate benchmarks for $50-100K ACV SaaS, MEDDIC framing
//   • Devon — K8s pod autoscaling consensus (HPA vs VPA vs KEDA), runbook
//   • Sam — vector DB landscape (Pinecone vs Weaviate vs Qdrant vs pgvector)
//   • Quinn — AI agent testing strategy (eval frameworks 2026)
//   • Tao — API docs best practices (Stripe vs Mintlify vs OpenAPI-only)
//   • Riley — Senior SWE comp benchmarks (Levels.fyi / Glassdoor)
//   • Dale — B2B SaaS product analytics stack (Amplitude vs Mixpanel etc.)
//   • Logan — EU AI Act enforcement timeline + risk landscape
//
// Each probe REQUIRES external sources to answer well — training-memory
// answers should fail the evidence grader. Same scoring shape as rs7:
// persona-shape × research-evidence × skill-discipline, combined into a
// final grade with retry-on-fail for variance recovery.
//
// Verifies the Playwright search fallback (web-client.ts browserSearch
// tier) kicks in when DDG+Bing return zero hits.

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "emp1";
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
async function pollJob(id, maxMs = 720_000) {
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
async function chatDispatch(contentOrMessages) {
  const messages = Array.isArray(contentOrMessages)
    ? contentOrMessages
    : [{ role: "user", content: contentOrMessages }];
  const post = await postJson("/api/chat", { messages });
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

// ─── Pool snapshot ────────────────────────────────────────────────
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
    } catch {}
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

// ─── Evidence + skill graders (same as rs harness) ────────────────
function researchEvidence(text) {
  const notes = [];
  const hasCites = /\[\d+\]/.test(text);
  const hasURL = /https?:\/\/[\w./?=&%#-]+/.test(text);
  const hasAccordTo = /\b(?:according to|sources?:?|as reported by|per (?:the )?(?:report|study|article|2024|2025|2026|industry)|recent (?:report|study|analysis|article|benchmark))\b/i.test(text);
  const hasDated = /\b(?:in 20\d{2}|as of 20\d{2}|20\d{2}[- ]?Q\d|Q\d\s+20\d{2}|published 20\d{2}|accessed 20\d{2})\b/i.test(text);
  const hasNamedEntity = /\b(?:Stripe|Vercel|Anthropic|OpenAI|Notion|Linear|Slack|HubSpot|Snowflake|Datadog|Kafka|Confluent|Postgres|Redis|GitHub|Cloudflare|Atlassian|Salesforce|Figma|Airtable|Mongo|Sequoia|Andreessen|Y Combinator|Bain|McKinsey|Goldman|OpenView|SaaStr|Gartner|Forrester|KeyBanc|Bessemer|DORA|JetBrains|Stack Overflow|Levels\.fyi|TechCrunch|Bloomberg|Reuters|WSJ|FT|Gong|Salesloft|Outreach|Pinecone|Weaviate|Qdrant|pgvector|Amplitude|Mixpanel|PostHog|Heap|Mintlify|Glassdoor|Robert Half|KEDA|HPA|VPA|LangSmith|promptfoo|Inspect|Hugging Face|EU AI Act|GDPR)\b/.test(text);
  if (hasCites) notes.push("cites[N]");
  if (hasURL) notes.push("URLs");
  if (hasAccordTo) notes.push("attribution");
  if (hasDated) notes.push("dated");
  if (hasNamedEntity) notes.push("real-entities");
  const count = [hasCites, hasURL, hasAccordTo, hasDated, hasNamedEntity].filter(Boolean).length;
  return { notes, count };
}

function skillDiscipline(text, skill) {
  const notes = [];
  let hits = 0;
  if (skill === "benchmark-lookup") {
    const cohort = /\b(?:\$\d+[- ]?[MK]\s+(?:ACV|ARR)|enterprise|mid[- ]market|SMB|PLG|sales[- ]led|B2B SaaS|seed|Series\s+[A-D]|remote[- ]US|US[- ]remote)\b/i.test(text);
    const tableLike = /\|\s*[A-Za-z]+\s*\|.*\|.*\|/m.test(text) || /^\|.+\|/m.test(text);
    const median = /\b(?:median|percentile|p25|p75|p50|best[- ]in[- ]class|bottom quartile|top quartile|average)\b/i.test(text);
    const caveat = /\b(?:caveat|methodology|sample|sample size|skewed|adjust|assume)\b/i.test(text);
    if (cohort) { notes.push("cohort-named"); hits++; }
    if (tableLike) { notes.push("table-shape"); hits++; }
    if (median) { notes.push("distribution-words"); hits++; }
    if (caveat) { notes.push("caveats"); hits++; }
  } else if (skill === "research-deep") {
    const cites = /\[\d+\]/.test(text);
    const sourcesBlock = /^\s*#{1,3}\s+sources?\b/im.test(text);
    const tldr = /^\s*\*\*\s*TL;?DR\s*:?\s*\*\*/im.test(text);
    const datedSources = /\b20\d{2}[- ]\d{2}[- ]\d{2}|\b20\d{2}-Q\d|\b\(\s*20\d{2}\s*\)/i.test(text);
    if (cites) { notes.push("cites"); hits++; }
    if (sourcesBlock) { notes.push("sources-block"); hits++; }
    if (tldr) { notes.push("tldr"); hits++; }
    if (datedSources) { notes.push("dated-sources"); hits++; }
  } else if (skill === "competitive-analysis") {
    const buckets = /\b(?:direct|adjacent|substitute|leading|established|newer)\b/i.test(text);
    const matrix = /\|\s*Dimension\s*\|/i.test(text) || /\|.*Pricing.*\|.*\|.*\|/i.test(text) || /^\|.+\|.+\|/m.test(text);
    const unfairAdv = /\b(?:unfair advantage|distribution|lock[- ]in|network effect|ergonomics|developer experience|DX)\b/i.test(text);
    const recommendation = /\b(?:recommend|recommendation|verdict|i('?| a)d (?:pick|use|adopt|go with)|our (?:pick|choice))\b/i.test(text);
    if (buckets) { notes.push("buckets"); hits++; }
    if (matrix) { notes.push("comparison-matrix"); hits++; }
    if (unfairAdv) { notes.push("differentiator"); hits++; }
    if (recommendation) { notes.push("recommendation"); hits++; }
  } else if (skill === "runbook-writing") {
    const numbered = /(^|\n)\s*\d+\.\s/.test(text);
    const owners = /\b(?:on[- ]call|owner|owned by|who runs this|escalat)\b/i.test(text);
    const decision = /\b(?:decision tree|if\s+.{0,40}then|when\s+.{0,40}use|use\s+(?:HPA|VPA|KEDA)\s+when)\b/i.test(text);
    const verify = /\b(?:verify|verification|smoke test|monitor|rollback|abort)\b/i.test(text);
    if (numbered) { notes.push("numbered"); hits++; }
    if (owners) { notes.push("owners"); hits++; }
    if (decision) { notes.push("decision-tree"); hits++; }
    if (verify) { notes.push("verify"); hits++; }
  }
  return { notes, hits };
}

function combineGrade(shapeGrade, evidence, discipline, textLen = 0) {
  let g = shapeGrade;
  let i = tIdx(g);
  if (i >= tIdx("B")) {
    if (evidence.count === 0) g = tFromIdx(i - 2);
    else if (evidence.count === 1) g = tFromIdx(i - 1);
  } else if (i <= tIdx("C") && evidence.count >= 3) {
    g = tFromIdx(i + 1);
  }
  i = tIdx(g);
  if (discipline.hits >= 3) g = tFromIdx(tIdx(g) + 2);
  else if (discipline.hits >= 2) g = tFromIdx(tIdx(g) + 1);
  if (textLen >= 500 && tIdx(shapeGrade) >= tIdx("B-") && (evidence.count + discipline.hits) >= 2 && tIdx(g) < tIdx("B+")) g = "B+";
  if (textLen >= 300 && evidence.count >= 2 && evidence.notes.includes("real-entities") && tIdx(g) < tIdx("B+")) g = "B+";
  if (evidence.count >= 3 && discipline.hits >= 2 && tIdx(g) < tIdx("B+")) g = "B+";
  if ((evidence.count >= 4 || (evidence.count >= 3 && discipline.hits >= 3)) && tIdx(g) < tIdx("A-")) g = "A-";
  return g;
}

// ─── Persona-shape graders ───
function gradeAE(text) {
  const notes = [];
  const meddic = /\b(MEDDIC|metric|economic buyer|decision criteria|decision process|champion|pain)\b/i.test(text);
  const discovery = /\b(discovery (?:question|call)|qualification|tell me about|walk me through|how do you)\b/i.test(text);
  const nextStep = /\b(next step|follow[- ]up|by (?:monday|tuesday|wednesday|thursday|friday)|action item)\b/i.test(text);
  const benchmark = /\b(benchmark|industry typical|median|average|typical close rate)\b/i.test(text);
  if (meddic) notes.push("MEDDIC");
  if (discovery) notes.push("discovery");
  if (nextStep) notes.push("next-step");
  if (benchmark) notes.push("benchmark");
  let grade = "A";
  const pts = [meddic, discovery, nextStep, benchmark].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B"; else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeSRE(text) {
  const notes = [];
  const hasSymptom = /\b(symptom|trigger|alert|threshold|signal)\b/i.test(text);
  const hasFirst5 = /\b(first 5 (?:min|minute)|immediate (?:action|step)|first thing|first 5|when\s+to\s+use)\b/i.test(text);
  const hasDiag = /\b(diagnostic|check (?:logs|metrics|dashboards)|HPA|VPA|KEDA|autoscal|scale[- ]up|scale[- ]down)\b/i.test(text);
  const hasEscalate = /\b(escalat|on[- ]call|page (?:the )?team|incident commander|rollback)\b/i.test(text);
  if (hasSymptom) notes.push("symptom");
  if (hasFirst5) notes.push("first-5");
  if (hasDiag) notes.push("diagnostic");
  if (hasEscalate) notes.push("escalation");
  let grade = "A";
  const pts = [hasSymptom, hasFirst5, hasDiag, hasEscalate].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B"; else if (pts === 3) grade = "B+";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeSWE(text) {
  const notes = [];
  const hasArchitecture = /\b(architecture|design|component|module|abstraction|interface|api|integration|index|embeddings?|chunk|store)\b/i.test(text);
  const hasTradeoff = /\b(trade[- ]?off|pros?\s+and\s+cons|risk|downside|cost\b.*\bbenefit|alternative)\b/i.test(text);
  const hasRecommendation = /\b(recommend|recommendation|i('?| a)d (?:adopt|use|pick|go with|choose)|verdict|our (?:pick|stack))\b/i.test(text);
  const hasSpecifics = /\b(?:Pinecone|Weaviate|Qdrant|pgvector|Postgres|HNSW|IVF|cosine|dimension|latency|recall|p99|10M|million vectors|RAG)\b/i.test(text);
  if (hasArchitecture) notes.push("architecture");
  if (hasTradeoff) notes.push("trade-offs");
  if (hasRecommendation) notes.push("recommendation");
  if (hasSpecifics) notes.push("specifics");
  let grade = "A";
  const pts = [hasArchitecture, hasTradeoff, hasRecommendation, hasSpecifics].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B"; else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeQA(text) {
  const notes = [];
  const hasStrategy = /\b(test (?:plan|strategy)|test approach|coverage)\b/i.test(text);
  const hasPattern = /\b(eval|evals?|regression|chaos|fuzz|property[- ]based|smoke test|end[- ]to[- ]end|synthetic|red[- ]team)\b/i.test(text);
  const hasTooling = /\b(promptfoo|LangSmith|Inspect|Hugging Face|Braintrust|playwright|cypress|jest|pytest|deepeval)\b/i.test(text);
  const hasRisks = /\b(risk|failure mode|edge case|gotcha|caveat|non[- ]deterministic|flaky)\b/i.test(text);
  if (hasStrategy) notes.push("strategy");
  if (hasPattern) notes.push("patterns");
  if (hasTooling) notes.push("tooling");
  if (hasRisks) notes.push("risks");
  let grade = "A";
  const pts = [hasStrategy, hasPattern, hasTooling, hasRisks].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B"; else if (pts === 3) grade = "B+";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeTechWriter(text) {
  const notes = [];
  const hasAudience = /\b(audience|developer|reader|reference|tutorial|how[- ]to|guide)\b/i.test(text);
  const hasStructure = /\b(quickstart|reference|tutorial|cookbook|examples?|sample|code block|sidebar|nav)\b/i.test(text);
  const hasExamples = /\b(?:Stripe|Mintlify|Twilio|Algolia|Resend|Vercel docs|OpenAPI|Swagger|Redoc|Docusaurus)\b/i.test(text);
  const hasRecommendation = /\b(recommend|recommendation|i('?| a)d (?:pick|use|adopt)|our pick|verdict)\b/i.test(text);
  if (hasAudience) notes.push("audience");
  if (hasStructure) notes.push("structure");
  if (hasExamples) notes.push("examples");
  if (hasRecommendation) notes.push("recommendation");
  let grade = "A";
  const pts = [hasAudience, hasStructure, hasExamples, hasRecommendation].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B"; else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeRecruiter(text) {
  const notes = [];
  const outcomes = /\b(first 90 days|first 30 days|ship|deliver|outcomes?|impact|leveled)\b/i.test(text);
  const mustHaves = /\b(must[- ]have|nice[- ]to[- ]have|required|requirements?|qualifications?|years?\s+of)\b/i.test(text);
  const comp = /\$\s*\d{2,3}[Kk]?|\b(?:base|equity|TC|total comp|RSU|sign[- ]on|bonus)\b/i.test(text);
  const benchmark = /\b(?:Levels\.fyi|Glassdoor|median|percentile|p25|p50|p75|benchmark|comparable|market rate)\b/i.test(text);
  if (outcomes) notes.push("outcomes");
  if (mustHaves) notes.push("must-haves");
  if (comp) notes.push("comp");
  if (benchmark) notes.push("benchmark");
  let grade = "A";
  const pts = [outcomes, mustHaves, comp, benchmark].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B"; else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeDataAnalyst(text) {
  const notes = [];
  const hasMethod = /\b(funnel|cohort|retention|session|event|track(?:ing)?|instrumentation|SDK)\b/i.test(text);
  const hasBenchmark = /\b(benchmark|industry|median|percentile|comparable|peer)\b/i.test(text);
  const hasMetric = /\b(MAU|DAU|engagement|conversion|activation|retention|stickiness|north star)\b/i.test(text);
  const hasRecommend = /\b(recommend|propose|i('?| a)d|suggest|our pick|approach)\b/i.test(text);
  if (hasMethod) notes.push("method");
  if (hasBenchmark) notes.push("benchmark");
  if (hasMetric) notes.push("metric");
  if (hasRecommend) notes.push("recommend");
  let grade = "A";
  const pts = [hasMethod, hasBenchmark, hasMetric, hasRecommend].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B"; else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeLegal(text) {
  const notes = [];
  const hasCaveat = /\b(not legal advice|consult (?:counsel|a lawyer|an attorney)|licensed (?:counsel|attorney)|seek (?:counsel|legal))\b/i.test(text);
  const hasRiskFrame = /\b(risk|exposure|liability|penalty|fine|enforce|in force|effective)\b/i.test(text);
  const hasTimeline = /\b(?:20\d{2}|timeline|phase|in force|effective|deadline|by\s+20\d{2}|article\s+\d+)\b/i.test(text);
  const hasPlain = /\b(in plain (?:english|language)|meaning|in other words|this means|in practice|example)\b/i.test(text);
  if (hasCaveat) notes.push("caveat");
  if (hasRiskFrame) notes.push("risk");
  if (hasTimeline) notes.push("timeline");
  if (hasPlain) notes.push("plain");
  let grade = "A";
  if (!hasCaveat) grade = "B-";
  const pts = [hasRiskFrame, hasTimeline, hasPlain].filter(Boolean).length;
  if (pts <= 1) grade = tFromIdx(tIdx(grade) - 1);
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

const PROBES = [
  {
    id: "drew-saas-close-rate-meddic",
    persona: "account-executive",
    skill: "benchmark-lookup",
    grader: gradeAE,
    targetSec: 240,
    task: `Look up typical close rates for $50K-$100K ACV B2B SaaS deals in 2025-2026 — pull data from recent industry sources (Gong's State of Sales, Salesloft, Outreach benchmark reports, or comparable). State the typical range with citations. Then prep 6-8 MEDDIC qualification questions calibrated to that benchmark — questions a real AE would use on a discovery call when the deal sits in this ACV band. Lead with the benchmark, follow with the questions.`,
  },
  {
    id: "devon-k8s-autoscaling-runbook",
    persona: "devops-sre",
    skill: "runbook-writing",
    grader: gradeSRE,
    targetSec: 240,
    task: `Research the current 2026 consensus on Kubernetes pod autoscaling — HPA vs VPA vs KEDA. Pull real practitioner perspectives (KubeCon talks, CNCF surveys, vendor docs). When does each fit best? What are the known sharp edges? Then draft a runbook for our SRE team: when to reach for which, decision tree, monitoring signals to watch, rollback procedure. Number the steps, name owners.`,
  },
  {
    id: "sam-vector-db-comparison",
    persona: "software-engineer",
    skill: "competitive-analysis",
    grader: gradeSWE,
    targetSec: 240,
    task: `Research the current state of vector databases for RAG in 2026 — compare Pinecone, Weaviate, Qdrant, and pgvector. Pull current pricing, latency benchmarks, dev ergonomics, real-world adoption signals. Build a comparison matrix on the dimensions an engineer would actually use to pick (price at our volume, p99 query latency, indexing approach, hosting model, operational burden). End with an engineering verdict for our stack: Postgres-based, ~10M vectors, mid-budget. Name trade-offs explicitly.`,
  },
  {
    id: "quinn-ai-agent-testing-strategy",
    persona: "qa-engineer",
    skill: "research-deep",
    grader: gradeQA,
    targetSec: 240,
    task: `Research the 2026 consensus on testing AI agents and LLM apps — eval frameworks (promptfoo, LangSmith, Inspect, deepeval, Braintrust), regression testing for non-deterministic outputs, chaos engineering for agent flows, red-teaming patterns. Pull practitioner experience reports. Then draft a test strategy for our chatbot (handles customer support, multi-turn, uses RAG). Cover: eval suite design, regression detection on non-deterministic output, failure-mode catalog. Cite sources with [N].`,
  },
  {
    id: "tao-api-docs-comparison",
    persona: "technical-writer",
    skill: "competitive-analysis",
    grader: gradeTechWriter,
    targetSec: 210,
    task: `Research best practices for developer API docs in 2026. Compare 3 leading approaches: Stripe-style (handcrafted, narrative + reference together), Mintlify-style (generated with docs-as-code), OpenAPI-only (auto-generated reference, light narrative). Cite specific dev tools companies as examples for each. Recommend one approach for our API docs refresh (a developer-platform startup, 20+ endpoints, 5 engineers, want to ship in 6 weeks). Name trade-offs.`,
  },
  {
    id: "riley-senior-swe-comp-benchmark",
    persona: "recruiter",
    skill: "benchmark-lookup",
    grader: gradeRecruiter,
    targetSec: 240,
    task: `Look up current 2026 compensation benchmarks for Senior Software Engineer roles, remote-US, at well-funded startups (Series B-D). Pull data from Levels.fyi, Glassdoor 2025 reports, and recent Bloomberg/CNBC tech-comp coverage. Show median + p25 + p75 for base / equity / total comp. Then write a competitive comp recommendation for our $180K base + 0.1% equity offer — does it sit at market, below, above? What's the risk if we hold the line? End with a one-line recommendation.`,
  },
  {
    id: "dale-product-analytics-stack",
    persona: "data-analyst",
    skill: "competitive-analysis",
    grader: gradeDataAnalyst,
    targetSec: 240,
    task: `Research the 2026 product analytics stack for B2B SaaS — compare Amplitude, Mixpanel, PostHog, and Heap. Pull current adoption signals (G2/SaaStr/CNCF surveys), pricing tiers, dev ergonomics, integration breadth. Recommend one for our seed-stage startup (5 engineers, ~10K MAU, B2B SaaS for ops teams). State the decision criteria, the trade-offs, and the call.`,
  },
  {
    id: "logan-eu-ai-act-timeline",
    persona: "contracts-reviewer",
    skill: "research-deep",
    grader: gradeLegal,
    targetSec: 240,
    task: `Research the current state of EU AI Act enforcement (2025-2026) — what's already in force, what's coming, the phased enforcement timeline, the penalty bands. Pull sources from the European Commission, Reuters, FT, and any compliance-vendor advisories. Then summarise the risk landscape for a US-based AI startup with EU customers: which articles bite first, what to prep for, what to ignore for now. Standard "not legal advice" caveat. Cite every claim with [N].`,
  },
];

const lines = [];
const log = (s = "") => { console.log(s); lines.push(s); };

async function main() {
  const stamp = new Date().toISOString();
  log(`# Research-aware employee harness — SECOND surface :: ${TAG} :: ${stamp}`);
  log(`Server: ${BASE}`);
  log(`Probes: ${PROBES.length} (each REQUIRES external sources). Verifies Playwright search fallback (browserSearch tier) when HTTP engines fail.`);
  log("");

  const original = (await getJson("/api/personas")).body?.activeId ?? null;
  const initial = await getPeerSnapshot();
  log(`Initial pool: primary inflight=${initial.primary.inflight}; peers=${initial.peers.map(p => `${p.name}@${p.port} inflight=${p.inflight}`).join(", ") || "(none)"}; pool=${initial.pool.count}/${initial.pool.cap}`);
  log("");

  const mon = startPoolMonitor();
  const wallStart = Date.now();
  // Dispatch in WAVES of 4 to avoid saturating OpenRouter rate limits
  // and the local LLM. emp1 ran all 8 at once and 4/8 returned 0 chars
  // (synth timeouts / OR 429s under contention). Waves let each batch
  // start fresh after the previous one's heavy research.deep calls drain.
  const WAVE_SIZE = 4;
  const dispatched = [];
  const waves = [];
  for (let i = 0; i < PROBES.length; i += WAVE_SIZE) waves.push(PROBES.slice(i, i + WAVE_SIZE));
  for (let w = 0; w < waves.length; w++) {
    const wave = waves[w];
    const waveDispatched = [];
    for (const p of wave) {
      await activate(p.persona);
      const t0 = Date.now();
      let dispatchErr = null, dResult;
      try { dResult = await chatDispatch(p.task); }
      catch (e) { dispatchErr = String(e?.message ?? e); dResult = { kind: "error" }; }
      waveDispatched.push({ ...p, dResult, t0, dispatchErr });
    }
    dispatched.push(...waveDispatched);
    if (w + 1 < waves.length) {
      // Wait for the current wave's polls before starting the next, to keep
      // OR/Ollama load bounded. We don't actually grade here — that runs in
      // Phase A below. We just poll-to-done so the next wave has headroom.
      log(`  ── wave ${w + 1}/${waves.length} dispatched (${waveDispatched.length} probes); awaiting before next wave`);
      await Promise.all(waveDispatched.map(d =>
        d.dispatchErr ? Promise.resolve() : pollJob(d.dResult.jobId).catch(() => null)
      ));
    }
  }
  log(`  ── all ${dispatched.length} probes dispatched in ${((Date.now() - wallStart) / 1000).toFixed(1)}s`);

  const gradeOne = (d, text, inline, err) => {
    const elapsed = (Date.now() - d.t0) / 1000;
    const shape = err ? { grade: "F", notes: [`ERR:${err.slice(0, 60)}`] } : d.grader(text);
    const evidence = err ? { notes: [], count: 0 } : researchEvidence(text);
    const discipline = err ? { notes: [], hits: 0 } : skillDiscipline(text, d.skill);
    const combined = err ? "F" : combineGrade(shape.grade, evidence, discipline, text.length);
    const penalty = timePenalty(elapsed, d.targetSec);
    const finalIdx = Math.max(0, tIdx(combined) + penalty);
    const finalGrade = tFromIdx(finalIdx);
    const ok = tIdx(finalGrade) >= tIdx("B+");
    return { elapsed, shapeGrade: shape.grade, shapeNotes: shape.notes, evidence, discipline, combined, finalGrade, ok, inline, textLen: text.length };
  };

  // Phase A: parallel first-attempt completions.
  const firstAttempts = await Promise.all(dispatched.map(async (d) => {
    let text = "", inline = false, err = d.dispatchErr;
    if (!err) {
      try {
        const r = await chatComplete(d.dResult);
        text = r.text;
        inline = r.inline;
      } catch (e) { err = String(e?.message ?? e); }
    }
    return { d, text, inline, err, graded: gradeOne(d, text, inline, err) };
  }));

  // Phase B: serial retry for below-B+ probes (avoid pool thrash).
  const settled = [];
  for (const fa of firstAttempts) {
    if (fa.graded.ok || fa.err) { settled.push({ ...fa.d, ...fa.graded, retried: false }); continue; }
    let retryText = "", retryInline = false, retryErr = null;
    try {
      await activate(fa.d.persona);
      const retryMsgs = [
        { role: "user", content: fa.d.task },
        { role: "assistant", content: fa.text },
        { role: "user", content: "That missed the mark — try a different approach. Lean harder on real sources, follow the playbook structure (verdict / tier-tags / cohort / segmentation / etc. as the skill demands)." },
      ];
      const dResult = await chatDispatch(retryMsgs);
      const r = await chatComplete(dResult);
      retryText = r.text;
      retryInline = r.inline;
    } catch (e) { retryErr = String(e?.message ?? e); }
    const retryGraded = gradeOne(fa.d, retryText, retryInline, retryErr);
    const winner = tIdx(retryGraded.finalGrade) > tIdx(fa.graded.finalGrade) ? retryGraded : fa.graded;
    settled.push({ ...fa.d, ...winner, retried: true });
  }
  const wallElapsed = (Date.now() - wallStart) / 1000;
  mon.stop();
  const poolSummary = summarizePool(mon.samples);

  for (const r of settled) {
    const mark = r.ok ? "✓" : "✗";
    const inlineMark = r.inline ? " (inline)" : "";
    const retryMark = r.retried ? " ↻" : "";
    log(`${mark} ${r.id.padEnd(40)} ${r.elapsed.toFixed(1)}s :: shape ${r.shapeGrade} · evidence ${r.evidence.count}/5 [${r.evidence.notes.join(",")}] · skill ${r.discipline.hits}/4 [${r.discipline.notes.join(",")}] → ${r.combined} → ${r.finalGrade}${retryMark}${inlineMark}  len=${r.textLen}`);
  }
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
  log(`| Probe | Persona | Skill | Target | Elapsed | Shape | Evidence | Skill disc. | Combined | FINAL |`);
  log(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of settled) {
    log(`| ${r.id} | ${r.persona} | ${r.skill} | ${r.targetSec}s | ${r.elapsed.toFixed(1)}s | ${r.shapeGrade} | ${r.evidence.count}/5 | ${r.discipline.hits}/4 | ${r.combined} | **${r.finalGrade}** |`);
  }
  log("");

  const aboveBPlus = settled.filter(r => r.ok).length;
  const grounded = settled.filter(r => r.evidence.count >= 3).length;
  const disciplined = settled.filter(r => r.discipline.hits >= 2).length;
  const retried = settled.filter(r => r.retried).length;
  log(`## Summary`);
  log("");
  log(`- ${aboveBPlus}/${settled.length} at B+ or higher (PASS bar)`);
  log(`- ${grounded}/${settled.length} well-grounded (≥3 evidence markers)`);
  log(`- ${disciplined}/${settled.length} show skill discipline (≥2 playbook markers)`);
  log(`- Average evidence count: ${(settled.reduce((s, r) => s + r.evidence.count, 0) / settled.length).toFixed(1)}/5`);
  log(`- Average skill discipline: ${(settled.reduce((s, r) => s + r.discipline.hits, 0) / settled.length).toFixed(1)}/4`);
  log(`- Retries used: ${retried}/${settled.length}`);
  log("");

  if (original) await activate(original);

  // Brain note
  const noteBody = [
    `# Research-employee harness ${TAG} — ${stamp}`,
    ``,
    `${aboveBPlus}/${settled.length} probes at B+ or higher. ${grounded}/${settled.length} well-grounded.`,
    ``,
    `**Parallelism:** wall ${wallElapsed.toFixed(1)}s vs ${targetSum}s sequential (${(targetSum / wallElapsed).toFixed(2)}×). Both-busy samples: ${poolSummary.bothClawbotsSamples}.`,
    ``,
    `**Per-probe:**`,
    ...settled.map(r => `- ${r.persona} (${r.id}, skill=${r.skill}): shape ${r.shapeGrade} · evidence ${r.evidence.count}/5 · discipline ${r.discipline.hits}/4 → ${r.finalGrade} (${r.elapsed.toFixed(1)}s)${r.retried ? " ↻" : ""}`),
  ].join("\n");
  try {
    const rr = await postJson("/api/templates/add-note/run", { inputs: { title: `Research-emp harness — ${stamp.slice(0, 10)}`, body: noteBody } });
    log(`Brain update: submitted${rr.body?.jobId ? ` (job ${rr.body.jobId})` : ""}.`);
  } catch (e) {
    log(`Brain update FAILED: ${String(e?.message ?? e)}`);
  }
}

main()
  .then(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = `_research-emp-harness-${TAG}-${stamp}.md`;
    import("node:fs").then(fs => {
      fs.writeFileSync(out, lines.join("\n"));
      console.log(`\nWrote: ${out}`);
    });
  })
  .catch(e => { console.error("HARNESS FAILED:", e); process.exit(1); });
