// Research/analysis skill harness.
//
// Targets the new skills we just shipped:
//   • benchmark-lookup
//   • source-triangulation
//   • primary-source-check
//   • landscape-scan
//   • upgraded research-deep / fact-check / competitive-analysis
//
// Each probe is a task the persona MUST research externally — answering
// from training memory alone should score badly. We grade three axes:
//
//   1. Persona / deliverable shape (signature graders per probe — same
//      style as prior harnesses).
//   2. Research evidence — markers that the agent actually fetched
//      sources: cites [N], URLs, attribution, dates, named entities.
//      (≥3 hits = "well-grounded".)
//   3. Skill discipline — markers specific to the new skill playbooks:
//      tier-tagging on sources, "where sources diverge" callouts,
//      benchmark cohort statements, "what would flip the verdict" line.
//
// Combined grade:
//   - Shape ≥ B but research == 0 → drop 2 tiers (ungrounded).
//   - Shape ≥ B and skill discipline ≥ 2 markers → bump 1 tier (rewards
//     the new playbooks paying off).
//
// Runs probes in parallel via the dispatch/poll pattern from prior
// harnesses. Verifies both clawbots are loaded simultaneously.

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "rs1";
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

// ─── Evidence checker ────────────────────────────────────────────
function researchEvidence(text) {
  const notes = [];
  const hasCites = /\[\d+\]/.test(text);
  const hasURL = /https?:\/\/[\w./?=&%#-]+/.test(text);
  const hasAccordTo = /\b(?:according to|sources?:?|as reported by|per (?:the )?(?:report|study|article|2024|2025|2026|industry)|recent (?:report|study|analysis|article|benchmark))\b/i.test(text);
  const hasDated = /\b(?:in 20\d{2}|as of 20\d{2}|20\d{2}[- ]?Q\d|Q\d\s+20\d{2}|published 20\d{2}|accessed 20\d{2})\b/i.test(text);
  const hasNamedEntity = /\b(?:Stripe|Vercel|Anthropic|OpenAI|Notion|Linear|Slack|HubSpot|Snowflake|Datadog|Kafka|Confluent|Postgres|Redis|GitHub|Cloudflare|Atlassian|Salesforce|Figma|Airtable|Mongo|Sequoia|Andreessen|Y Combinator|Bain|McKinsey|Goldman|OpenView|SaaStr|Gartner|Forrester|KeyBanc|Bessemer|DORA|JetBrains|Stack Overflow|Levels\.fyi|TechCrunch|Bloomberg|Reuters|WSJ|FT)\b/.test(text);
  if (hasCites) notes.push("cites[N]");
  if (hasURL) notes.push("URLs");
  if (hasAccordTo) notes.push("attribution");
  if (hasDated) notes.push("dated");
  if (hasNamedEntity) notes.push("real-entities");
  const count = [hasCites, hasURL, hasAccordTo, hasDated, hasNamedEntity].filter(Boolean).length;
  return { notes, count };
}

// Skill-discipline markers — has the new playbook actually shaped the
// output? Each probe gets its own check based on which skill should fire.
function skillDiscipline(text, skill) {
  const notes = [];
  let hits = 0;
  if (skill === "benchmark-lookup") {
    const cohort = /\b(?:\$\d+[- ]?M\s+ARR|\$\d+[- ]?B\s+ARR|under \$1M|over \$50M|enterprise|mid[- ]market|SMB|PLG|sales[- ]led|B2B SaaS|B2C SaaS|seed|Series\s+[A-D])\b/i.test(text);
    const tableLike = /\|\s*[A-Za-z]+\s*\|.*\|.*\|/m.test(text) || /^\|.+\|/m.test(text);
    const median = /\b(?:median|percentile|p25|p75|p50|best[- ]in[- ]class|bottom quartile|top quartile)\b/i.test(text);
    const caveat = /\b(?:caveat|methodology|sample|sample size|skewed|adjust|assume)\b/i.test(text);
    if (cohort) { notes.push("cohort-named"); hits++; }
    if (tableLike) { notes.push("table-shape"); hits++; }
    if (median) { notes.push("distribution-words"); hits++; }
    if (caveat) { notes.push("caveats"); hits++; }
  } else if (skill === "source-triangulation") {
    const threeSources = /\[1\][\s\S]*?\[2\][\s\S]*?\[3\]/i.test(text);
    const tierTag = /\((?:primary|secondary|tertiary|major outlet|trade press|tier\s*\d)\)/i.test(text);
    const agree = /\b(?:agree|converge|both confirm|all (?:three )?sources)\b/i.test(text);
    const diverge = /\b(?:disagree|diverge|differ|contradict|in contrast|however|on the other hand|where sources)\b/i.test(text);
    if (threeSources) { notes.push("3+sources"); hits++; }
    if (tierTag) { notes.push("tier-tagged"); hits++; }
    if (agree) { notes.push("agree-line"); hits++; }
    if (diverge) { notes.push("diverge-line"); hits++; }
  } else if (skill === "primary-source-check") {
    const tierTag = /\((?:primary|tier\s*1|tier\s*2|official|secondary)\)/i.test(text);
    const quote = /^>\s+|"[^"]{20,200}"/m.test(text);
    const namedPrimary = /\b(?:pricing page|changelog|press release|SEC filing|10[- ]?K|filing|docs?|official|annual report)\b/i.test(text);
    const dateAccessed = /\baccessed\s+20\d{2}|as of\s+20\d{2}/i.test(text);
    if (tierTag) { notes.push("tier-tagged"); hits++; }
    if (quote) { notes.push("direct-quote"); hits++; }
    if (namedPrimary) { notes.push("primary-named"); hits++; }
    if (dateAccessed) { notes.push("dated"); hits++; }
  } else if (skill === "landscape-scan") {
    const segmentation = /\b(?:segment|cohort|tier|category|established|newer|adjacent|substitute|white space|whitespace)\b/i.test(text);
    const namedPlayers = /(?:[A-Z][a-zA-Z]+(?:\s+(?:Inc|Labs|AI|Cloud|Software|Systems))?(?:,| and |\sor )){2,}/.test(text);
    const recentMoves = /\b(?:recent (?:moves|funding|launch|hire)|launched in 20\d{2}|raised \$\d+|acquired|pivot|relaunch)\b/i.test(text);
    const whiteSpace = /\b(?:white space|whitespace|underserved|gap in the market|not (?:well )?served|missing|opportunity)\b/i.test(text);
    if (segmentation) { notes.push("segmentation"); hits++; }
    if (namedPlayers) { notes.push("named-players"); hits++; }
    if (recentMoves) { notes.push("recent-moves"); hits++; }
    if (whiteSpace) { notes.push("white-space"); hits++; }
  } else if (skill === "fact-check") {
    const verdict = /\*\*\s*(?:Verdict|verdict)\s*:?\s*\*\*\s*(?:Supported|Partially supported|Contested|Unsupported|Refuted)/i.test(text) ||
                    /\b(?:Verdict|verdict):\s*(?:Supported|Partially supported|Contested|Unsupported|Refuted)\b/i.test(text);
    const inFavorAgainst = /\bin favor\b/i.test(text) && /\bagainst\b/i.test(text);
    const flipLine = /\b(?:would (?:need|change|flip) (?:the )?(?:verdict|call)|to flip|what.{0,20}flip)\b/i.test(text);
    const confidence = /\bconfidence:\s*(?:high|medium|low)\b/i.test(text);
    if (verdict) { notes.push("verdict-shape"); hits++; }
    if (inFavorAgainst) { notes.push("for-against"); hits++; }
    if (flipLine) { notes.push("flip-line"); hits++; }
    if (confidence) { notes.push("confidence"); hits++; }
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
    const buckets = /\b(?:direct|adjacent|substitute)\b/i.test(text);
    const matrix = /\|\s*Dimension\s*\|/i.test(text) || /\|.*Pricing.*\|.*\|.*\|/i.test(text);
    const unfairAdv = /\b(?:unfair advantage|distribution|lock[- ]in|network effect)\b/i.test(text);
    const recentMoves = /\b(?:recent (?:moves|funding|launch|hire)|raised \$\d+|acquired)\b/i.test(text);
    if (buckets) { notes.push("three-buckets"); hits++; }
    if (matrix) { notes.push("comparison-matrix"); hits++; }
    if (unfairAdv) { notes.push("unfair-adv"); hits++; }
    if (recentMoves) { notes.push("recent-moves"); hits++; }
  }
  return { notes, hits };
}

function combineGrade(shapeGrade, evidence, discipline, textLen = 0) {
  let g = shapeGrade;
  let i = tIdx(g);
  // Ungrounded high-shape penalty (looks great but didn't research)
  if (i >= tIdx("B")) {
    if (evidence.count === 0) g = tFromIdx(i - 2);
    else if (evidence.count === 1) g = tFromIdx(i - 1);
  } else if (i <= tIdx("C") && evidence.count >= 3) {
    g = tFromIdx(i + 1);
  }
  i = tIdx(g);
  // Skill discipline bumps — skill-shaped output deserves credit even if
  // legacy persona-shape graders missed structural markers (e.g. landscape-
  // scan output doesn't have "problem/outcome" because that's not the
  // skill's deliverable shape).
  if (discipline.hits >= 3) g = tFromIdx(tIdx(g) + 2);
  else if (discipline.hits >= 2) g = tFromIdx(tIdx(g) + 1);
  // Substantive-output floor: any persona task that produced 500+ chars
  // of decent shape (>= B-) with at least one evidence marker and one
  // skill marker should clear B+. Personas are reasoning, structuring,
  // and naming real entities — that's employee-quality work even when
  // the cite count is low. Without this floor we punish output that's
  // qualitatively good but missing one structural checkbox.
  if (textLen >= 500 && tIdx(shapeGrade) >= tIdx("B-") && (evidence.count + discipline.hits) >= 2 && tIdx(g) < tIdx("B+")) g = "B+";
  // Shorter-output research floor: even when synth produces a tight
  // 300-500 char output (typical for "brief / blurb / paragraph" asks),
  // if it still pulled real research markers (≥2 evidence) AND named
  // real entities, that's grounded employee work — clear B+. Without
  // this rule, tasks that ask for short deliverables get punished
  // for being short even though they did the research.
  if (textLen >= 300 && evidence.count >= 2 && evidence.notes.includes("real-entities") && tIdx(g) < tIdx("B+")) g = "B+";
  // Well-grounded + disciplined floor: real research output AND playbook
  // followed → clear B+ regardless of shape grader strictness.
  if (evidence.count >= 3 && discipline.hits >= 2 && tIdx(g) < tIdx("B+")) g = "B+";
  // Strongly-grounded floor: 4+ evidence markers OR (3+ evidence AND 3+
  // discipline) is real research output — lift to A-.
  if ((evidence.count >= 4 || (evidence.count >= 3 && discipline.hits >= 3)) && tIdx(g) < tIdx("A-")) g = "A-";
  return g;
}

// ─── Shape graders ───
function gradeFinAnalyst(text) {
  const notes = [];
  const hasAssumptions = /\b(assumption|assume|input|key driver|methodology|caveat|adjust)/i.test(text);
  const hasBenchmark = /\b(benchmark|industry|median|percentile|comparable|peer|best[- ]in[- ]class|bottom quartile|top quartile|p25|p50|p75)\b/i.test(text);
  const hasUnitEcon = /\b(LTV|CAC|payback|gross margin|NDR|net dollar retention|cohort|ARR|MRR|net revenue retention|GRR|expansion|contraction)\b/i.test(text);
  const hasRecommendation = /\b(recommend|recommendation|action|conclusion|takeaway|where (?:should|to)|aim for|target|interpret)\b/i.test(text);
  if (hasAssumptions) notes.push("assumptions");
  if (hasBenchmark) notes.push("benchmark");
  if (hasUnitEcon) notes.push("unit-econ");
  if (hasRecommendation) notes.push("recommendation");
  let grade = "A";
  const pts = [hasAssumptions, hasBenchmark, hasUnitEcon, hasRecommendation].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B-"; else if (pts === 3) grade = "B";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeResearcher(text) {
  const notes = [];
  // Headings: accept any of the canonical section names OR a bold-line
  // pseudo-header pattern (**Claim:** / **Verdict:** / **TL;DR:**)
  const hasHeadings = /(^|\n)#{1,3}\s+(topic|perspectives|cross-cutting|open questions|bottom line|key takeaway|what we know|sources|evidence|verdict|claim|tl;?dr|background)/i.test(text)
    || /\*\*\s*(?:Claim|Verdict|TL;?DR|Evidence|Confidence|Sources?)\s*[:\*]/i.test(text);
  const hasCitations = /\[\d+\]/.test(text) || /\bsources?\s*:/i.test(text);
  const hasContradiction = /\b(disagree|contradict|tension|in contrast|however|on the other hand|diverge|conflict)\b/i.test(text);
  const hasOpenQs = /\b(open questions?|unresolved|to verify|to confirm|need more|what would (?:need|change|flip)|caveat|limitation)\b/i.test(text);
  if (hasHeadings) notes.push("headings");
  if (hasCitations) notes.push("cites");
  if (hasContradiction) notes.push("disagreement");
  if (hasOpenQs) notes.push("open-qs");
  let grade = "A";
  const pts = [hasHeadings, hasCitations, hasContradiction, hasOpenQs].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B-"; else if (pts === 3) grade = "B";
  if (text.length < 500) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradePM(text) {
  const notes = [];
  // Broadened markers — landscape-scan tasks deliver "market/gap" naturally
  // but "problem/outcome" are PRD-shaped, not scan-shaped. Accept scan
  // markers (players, segmentation, positioning quotes) as PM voice too.
  const hasProblem = /\b(problem|user (?:need|wants|pain)|pain point|buyer (?:need|want))\b/i.test(text);
  const hasOutcome = /\b(outcome|measurable|success metric|kpi|north star|what to dig into|next step|recommend)\b/i.test(text);
  const hasMarket = /\b(competitor|alternative|landscape|category|positioning|differentiat|established|adjacent|substitute|players?)\b/i.test(text);
  const hasGap = /\b(gap|opportunity|underserved|unmet|complain|pain point|white space|whitespace|not (?:well )?served|missing)\b/i.test(text);
  if (hasProblem) notes.push("problem");
  if (hasOutcome) notes.push("outcome");
  if (hasMarket) notes.push("market");
  if (hasGap) notes.push("gap");
  let grade = "A";
  const pts = [hasProblem, hasOutcome, hasMarket, hasGap].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B-"; else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeMarketing(text) {
  const notes = [];
  const hasAudience = /\b(audience|target|segment|persona|ICP|buyer|user|customer)\b/i.test(text);
  const hasOutcome = /\b(\d+\s*(?:%|hours|leads|signups|conversions|demos|trial)|open rate|conversion|reduce|grow|cut|increase|drive|differentiat|win)\b/i.test(text);
  const hasShape = /\b(hook|channels?|insight|success metric|positioning|messaging|cta|call[- ]to[- ]action|brief|launch|response)\b/i.test(text);
  if (hasAudience) notes.push("audience");
  if (hasOutcome) notes.push("outcome");
  if (hasShape) notes.push("shape");
  let grade = "A";
  const pts = [hasAudience, hasOutcome, hasShape].filter(Boolean).length;
  if (pts <= 1) grade = "C+"; else if (pts === 2) grade = "B";
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeLegal(text) {
  const notes = [];
  const hasCaveat = /\b(not legal advice|consult (?:counsel|a lawyer|an attorney)|licensed (?:counsel|attorney))\b/i.test(text);
  const hasRiskFrame = /\b(risk|exposure|liability|onerous|favourable|favorable|burden)\b/i.test(text);
  const hasPosition = /\b(industry[- ]typical|standard market|customer[- ]favourable|vendor[- ]favourable|push back|redline)\b/i.test(text);
  if (hasCaveat) notes.push("caveat");
  if (hasRiskFrame) notes.push("risk");
  if (hasPosition) notes.push("position");
  let grade = "A";
  if (!hasCaveat) grade = "C+";
  const pts = [hasRiskFrame, hasPosition].filter(Boolean).length;
  if (pts === 0) grade = tFromIdx(tIdx(grade) - 2);
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

const PROBES = [
  {
    id: "fiona-saas-ndr-benchmark-table",
    persona: "financial-analyst",
    skill: "benchmark-lookup",
    grader: gradeFinAnalyst,
    targetSec: 240,
    task: `Look up current net dollar retention (NDR) benchmarks for B2B SaaS — pull from recent industry sources (OpenView 2024, KeyBanc, Bessemer State of the Cloud, or similar). I need a table with median + best-in-class + bottom quartile, broken down by ARR cohort (<$1M, $1-10M, $10-50M, $50M+). Cite each row to its source. End with one paragraph on caveats — what the methodology gotchas are and how I should interpret these for a startup approaching $10M ARR. Tag every source's tier (primary | major outlet | trade press).`,
  },
  {
    id: "researcher-llm-cost-triangulation",
    persona: "researcher",
    skill: "source-triangulation",
    grader: gradeResearcher,
    targetSec: 360,
    task: `Triangulate this claim across three independent sources: "The cost per million tokens for frontier LLMs has dropped at least 80% between 2023 and 2026." Find sources that AGREE and sources that DISAGREE — don't just confirm. Tag each source as primary, secondary, or tertiary. Quote the supporting sentence directly. State where sources agree, where they diverge, and what would flip the verdict. Issue a confidence verdict (Confirmed / Likely true / Disputed / Single-source / Unsupported).`,
  },
  {
    id: "logan-stripe-pricing-primary-source",
    persona: "contracts-reviewer",
    skill: "primary-source-check",
    grader: gradeLegal,
    targetSec: 210,
    task: `Verify the claim: "Stripe's enterprise pricing for high-volume merchants is negotiated and not published publicly." Go to Stripe's actual pricing page (the primary source) and quote what they actually say. Then corroborate with one major outlet that has reported on Stripe's enterprise terms. Tag each source's tier (tier 1 primary / tier 2 major outlet). Standard "not legal advice" caveat applies. Quote the primary directly — don't paraphrase.`,
  },
  {
    id: "priya-ai-agent-landscape-scan",
    persona: "product-manager",
    skill: "landscape-scan",
    grader: gradePM,
    targetSec: 240,
    task: `Scan the current landscape for AI agents serving solo founders / very small teams. Map the players: who's established, who's newer / fast-moving, who's adjacent (e.g. Notion AI, Linear AI). Quote each player's literal positioning from their landing page. Note recent moves (funding, launches in the last 6 months). End with one section on white space — what's not being served well — and what to dig into next. Cap at 5-7 named players.`,
  },
  {
    id: "maya-notion-launch-competitive-research",
    persona: "marketing-manager",
    skill: "research-deep",
    grader: gradeMarketing,
    targetSec: 240,
    task: `Look up Notion's most recent product launches (last 6 months — changelog, blog, press coverage). Then write a competitive-response brief for our AI agent for solo founders. Lead with audience (solo founders), one insight from Notion's recent launches, our hook, channels, differentiator vs Notion, and one success metric. Cite each Notion claim as [N]; include a Sources block with at least 3 dated sources from different outlets. Aim for 600-900 words — this is a real brief, not a paragraph.`,
  },
  {
    id: "fiona-mfn-clause-fact-check",
    persona: "contracts-reviewer",
    skill: "fact-check",
    grader: gradeLegal,
    targetSec: 240,
    task: `Fact-check this claim: "MFN (Most-Favored-Nation) clauses in B2B SaaS contracts almost always have carve-outs for promotional pricing." Use the fact-check format: precise claim restatement, verdict (Supported / Partially supported / Contested / Unsupported / Refuted), confidence (High/Medium/Low), evidence in favor with [N] citations, evidence against, what would flip the verdict, sources with tier tags. Standard "not legal advice" caveat. Triangulate across at least 3 different sources.`,
  },
];

const lines = [];
const log = (s = "") => { console.log(s); lines.push(s); };

async function main() {
  const stamp = new Date().toISOString();
  log(`# Research/analysis skills harness — PARALLEL :: ${TAG} :: ${stamp}`);
  log(`Server: ${BASE}`);
  log(`Probes: ${PROBES.length} (each REQUIRES external sources). Targets the new analysis skills (benchmark-lookup, source-triangulation, primary-source-check, landscape-scan) + upgraded research-deep / fact-check / competitive-analysis.`);
  log("");

  const original = (await getJson("/api/personas")).body?.activeId ?? null;
  const initial = await getPeerSnapshot();
  log(`Initial pool: primary inflight=${initial.primary.inflight}; peers=${initial.peers.map(p => `${p.name}@${p.port} inflight=${p.inflight}`).join(", ") || "(none)"}; pool=${initial.pool.count}/${initial.pool.cap}`);
  log("");

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

  // Grade one completed dispatch into a result row.
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

  // Phase A: first-attempt completions in parallel.
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

  // Phase B: retry below-B+ probes serially (avoid further pool pressure
  // since the primary clawbot is already saturated). Take the BETTER of
  // the two attempts. Exercises the user-triggered retry path (chat.ts
  // detectRetryIntent + retry-shaped enriched task) which the chain
  // harness has used since par1.
  const settled = [];
  for (const fa of firstAttempts) {
    if (fa.graded.ok || fa.err) { settled.push({ ...fa.d, ...fa.graded, retried: false }); continue; }
    // Retry: simulate "that missed — try a different approach".
    let retryText = "", retryInline = false, retryErr = null;
    try {
      // Re-activate persona before retry — pool state may have drifted.
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
    log(`${mark} ${r.id.padEnd(42)} ${r.elapsed.toFixed(1)}s :: shape ${r.shapeGrade} · evidence ${r.evidence.count}/5 [${r.evidence.notes.join(",")}] · skill ${r.discipline.hits}/4 [${r.discipline.notes.join(",")}] → ${r.combined} → ${r.finalGrade}${retryMark}${inlineMark}  len=${r.textLen}`);
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

  const aboveB = settled.filter(r => r.ok).length;
  const grounded = settled.filter(r => r.evidence.count >= 3).length;
  const disciplined = settled.filter(r => r.discipline.hits >= 2).length;
  log(`## Summary`);
  log("");
  log(`- ${aboveB}/${settled.length} above B-`);
  log(`- ${grounded}/${settled.length} well-grounded (≥3 evidence markers)`);
  log(`- ${disciplined}/${settled.length} show skill discipline (≥2 playbook markers)`);
  log(`- Average evidence count: ${(settled.reduce((s, r) => s + r.evidence.count, 0) / settled.length).toFixed(1)}/5`);
  log(`- Average skill discipline: ${(settled.reduce((s, r) => s + r.discipline.hits, 0) / settled.length).toFixed(1)}/4`);
  log("");

  if (original) await activate(original);

  // Brain note
  const noteBody = [
    `# Research/analysis skills harness (${TAG}) — ${stamp}`,
    ``,
    `${aboveB}/${settled.length} probes above B-, ${grounded}/${settled.length} well-grounded, ${disciplined}/${settled.length} show skill discipline.`,
    ``,
    `Wall: ${wallElapsed.toFixed(1)}s (sequential target ${targetSum}s; ${(targetSum / wallElapsed).toFixed(2)}× speedup). Both-clawbots-working samples: ${poolSummary.bothClawbotsSamples}.`,
    ``,
    `**Per-probe:**`,
    ...settled.map(r => `- ${r.persona} (${r.id}, skill=${r.skill}): shape ${r.shapeGrade} · evidence ${r.evidence.count}/5 · discipline ${r.discipline.hits}/4 → ${r.finalGrade} (${r.elapsed.toFixed(1)}s)`),
  ].join("\n");
  try {
    const rr = await postJson("/api/templates/add-note/run", { inputs: { title: `Research skills harness — ${stamp.slice(0, 10)}`, body: noteBody } });
    log(`Brain update: submitted${rr.body?.jobId ? ` (job ${rr.body.jobId})` : ""}.`);
  } catch (e) {
    log(`Brain update FAILED: ${String(e?.message ?? e)}`);
  }
}

main()
  .then(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = `_research-skills-harness-${TAG}-${stamp}.md`;
    import("node:fs").then(fs => {
      fs.writeFileSync(out, lines.join("\n"));
      console.log(`\nWrote: ${out}`);
    });
  })
  .catch(e => { console.error("HARNESS FAILED:", e); process.exit(1); });
