// Multi-role workflow chain harness — PARALLEL.
//
// Different surface from all prior runs. Each "chain" is a realistic
// business workflow that passes through 4 personas in sequence, where
// each turn picks up the prior turn's output. Tests:
//
//   • Persona shape per turn (does Sam's engineering scope still look
//     like engineering, does Maya's launch blurb still look like marketing,
//     etc. — using the same signature graders).
//   • Carry-over — does turn N actually reference content from turn N-1?
//     Workflows fail when each role plays solo and ignores upstream context.
//   • Lane gate — verifies the new gate (lib/lane.ts) doesn't false-positive
//     on legitimate role-handoffs within a workflow. Sam reading a PRD then
//     scoping engineering is in-lane for Sam, not "engineer asked to do PM
//     work".
//
// Concurrency:
//   • Each chain runs its turns SEQUENTIALLY (turn N needs turn N-1 in
//     history).
//   • Multiple chains run in PARALLEL (3 chains = 3 simultaneous workflows
//     hitting the pool).
//   • The activate→POST step is mutex'd globally so the active-persona
//     race we've seen before doesn't scramble chains. Polls run freely.
//   • Pool monitor records both-clawbots-busy + peak concurrent inflight.

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "chain";
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
async function chatDispatch(messages) {
  const post = await postJson("/api/chat", { messages });
  if (post.body?.kind === "message") return { kind: "message", text: post.body.text ?? "" };
  if (post.body?.kind === "task" && post.body?.jobId) return { kind: "task", jobId: post.body.jobId };
  return { kind: "unknown", raw: post.body };
}
async function chatComplete(dispatched) {
  if (dispatched.kind === "message") return { text: dispatched.text, inline: true };
  if (dispatched.kind === "task") {
    const j = await pollJob(dispatched.jobId);
    return { text: j.result?.answer ?? "", inline: false, job: j };
  }
  return { text: JSON.stringify(dispatched.raw).slice(0, 400), inline: false };
}
async function activate(id) { await postJson(`/api/personas/${id}/activate`, {}); }

// Global mutex around the activate→POST sequence — the active-persona
// state is shared across all chats, so we have to serialise the moment
// of "set persona, fire the request that captures persona". Polls and
// server-side work run freely outside the mutex.
let dispatchMutex = Promise.resolve();
async function withDispatchLock(fn) {
  const prev = dispatchMutex;
  let release;
  dispatchMutex = new Promise(r => { release = r; });
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}

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
  if (samples.length === 0) return { peakConcurrent: 0, peakPoolSize: 0, bothBusy: 0, peerPorts: new Set() };
  let peakConcurrent = 0, peakPoolSize = 0, bothBusy = 0;
  const peerPorts = new Set();
  for (const s of samples) {
    const peerTotal = s.peers.reduce((a, p) => a + (p.inflight ?? 0), 0);
    const total = (s.primaryInflight ?? 0) + peerTotal;
    if (total > peakConcurrent) peakConcurrent = total;
    if (s.poolCount > peakPoolSize) peakPoolSize = s.poolCount;
    if ((s.primaryInflight ?? 0) >= 1 && s.peers.some(p => (p.inflight ?? 0) >= 1)) bothBusy++;
    for (const p of s.peers) if ((p.inflight ?? 0) >= 1) peerPorts.add(p.port);
  }
  return { peakConcurrent, peakPoolSize, bothBusy, peerPorts };
}

// ─── Persona-shape graders (subset, verbatim) ───
function gradePM(text) {
  const notes = [];
  const hasProblem = /\b(problem|user problem|user pain|whose problem|user (?:need|wants))\b/i.test(text);
  const hasOutcome = /\b(outcome|measurable|success metric|kpi|north star)\b/i.test(text);
  const hasNonGoals = /\b(non[- ]goals?|out of scope|not doing|excluded|what we're not)\b/i.test(text);
  const hasScoring = /\b(rice|ice|reach|impact|confidence|effort|ease|score)\b/i.test(text);
  if (hasProblem) notes.push("problem"); if (hasOutcome) notes.push("outcome"); if (hasNonGoals) notes.push("non-goals"); if (hasScoring) notes.push("scored");
  let grade = "A";
  const pts = [hasProblem, hasOutcome, hasNonGoals, hasScoring].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeDesigner(text) {
  const notes = [];
  const hasJTBD = /\b(job[- ]to[- ]be[- ]done|user goal|user's goal|primary goal|user's job)\b/i.test(text);
  const hasCritique = /\b(friction|cognitive load|decision point|step|click|tap|interaction|unhappy path)\b/i.test(text);
  const hasA11y = /\b(accessibility|a11y|contrast|screen reader|keyboard|focus order|wcag|aria)\b/i.test(text);
  const hasRationale = /\b(because|rationale|reason|since|the reasoning|why)\b/i.test(text);
  if (hasJTBD) notes.push("JTBD"); if (hasCritique) notes.push("critique"); if (hasA11y) notes.push("a11y"); if (hasRationale) notes.push("rationale");
  let grade = "A";
  const pts = [hasJTBD, hasCritique, hasA11y, hasRationale].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C+"; else if (pts === 3) grade = "B+";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeSWE(text) {
  const notes = [];
  const hasFileRef = /[\w/.\\-]+\.(?:ts|tsx|js|mjs|py|go|rs|java|cs)\b|\b(function|method|class|endpoint|route)\s+[A-Za-z_]\w*/i.test(text);
  const hasTestPlan = /\b(test plan|verification|how to verify|to verify|smoke test|unit test|integration test)\b/i.test(text);
  const hasTradeoff = /\b(trade[- ]?off|risk|blast radius|downside|alternative|caveat)\b/i.test(text);
  if (hasFileRef) notes.push("file-refs"); if (hasTestPlan) notes.push("test-plan"); if (hasTradeoff) notes.push("trade-offs");
  let grade = "A";
  const pts = [hasFileRef, hasTestPlan, hasTradeoff].filter(Boolean).length;
  if (pts <= 1) grade = "C"; else if (pts === 2) grade = "B";
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeMarketing(text) {
  const notes = [];
  const hasAudience = /\b(audience|target|segment|persona|ICP|user|customer)\b/i.test(text);
  const hasOutcome = /\b(save \d|\d+\s*(?:%|hours|leads|signups|conversions)|reduce|increase|grow|cut|faster|better)\b/i.test(text);
  const hasShape = /\b(hook|insight|launch|positioning|copy|headline|tagline|CTA)\b/i.test(text);
  if (hasAudience) notes.push("audience"); if (hasOutcome) notes.push("outcome"); if (hasShape) notes.push("shape");
  let grade = "A";
  const pts = [hasAudience, hasOutcome, hasShape].filter(Boolean).length;
  if (pts <= 1) grade = "C"; else if (pts === 2) grade = "B-";
  if (text.length < 200) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeSRE(text) {
  const notes = [];
  const hasTimeline = /\b(timeline|t\+\d+|at \d{1,2}:\d{2}|minutes? (?:later|after)|chronolog)\b/i.test(text);
  const hasRootCause = /\b(root cause|primary cause|underlying|contributing factor)\b/i.test(text);
  const hasMitigation = /\b(mitigation|mitigated|resolved|fix|remediat|prevent)\b/i.test(text);
  const hasActionItem = /\b(action item|action items?|follow[- ]?up|owner|by when)\b/i.test(text);
  if (hasTimeline) notes.push("timeline"); if (hasRootCause) notes.push("root-cause"); if (hasMitigation) notes.push("mitigation"); if (hasActionItem) notes.push("actions");
  let grade = "A";
  const pts = [hasTimeline, hasRootCause, hasMitigation, hasActionItem].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeCSM(text) {
  const notes = [];
  const hasAck = /\b(sorry|apologi|hear|understand|frustrat|appreciate)\b/i.test(text);
  const hasNamed = /\b(what (?:we'?re|we have)|here'?s what|what (?:happened|caused))\b/i.test(text);
  const hasNoBlame = !/\b(we apologise for any inconvenience|sorry for the inconvenience|valuable feedback)\b/i.test(text);
  const hasCommit = /\b(by (?:monday|tuesday|wednesday|thursday|friday|tomorrow|end of (?:week|day))|we will|i'?ll|expect|within \d+|over the next)\b/i.test(text);
  if (hasAck) notes.push("ack"); if (hasNamed) notes.push("named"); if (hasCommit) notes.push("commit");
  if (!hasNoBlame) notes.push("MACRO-SPEAK");
  let grade = "A";
  const pts = [hasAck, hasNamed, hasCommit].filter(Boolean).length;
  if (pts <= 1) grade = "C"; else if (pts === 2) grade = "B";
  if (!hasNoBlame) grade = tFromIdx(tIdx(grade) - 1);
  if (text.length < 150) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeStatusPage(text) {
  const notes = [];
  const hasNeutral = !/\b(absolutely|totally|incredibly|deeply sorry|wholly)\b/i.test(text);
  const hasDated = /\b(at \d{1,2}:\d{2}|UTC|GMT|UTC[+-]\d|today|yesterday|date|posted)\b/i.test(text);
  const hasUpdate = /\b(investigating|identified|monitoring|resolved|fix|mitigation|update)\b/i.test(text);
  const hasShort = text.length <= 800;
  if (hasNeutral) notes.push("neutral-tone"); if (hasDated) notes.push("dated"); if (hasUpdate) notes.push("status-words"); if (hasShort) notes.push("short");
  let grade = "A";
  const pts = [hasNeutral, hasDated, hasUpdate].filter(Boolean).length;
  if (pts <= 1) grade = "C"; else if (pts === 2) grade = "B-";
  if (!hasShort) grade = tFromIdx(tIdx(grade) - 1);
  if (text.length < 100) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeAE(text) {
  const notes = [];
  const meddic = /\b(MEDDIC|metric|economic buyer|decision criteria|decision process|champion|pain)\b/i.test(text);
  const dealBreak = /\b(deal[- ]breaker|walk away|will not|won'?t (?:do|accept)|hard line|red line)\b/i.test(text);
  const concession = /\b(concession|give (?:up|on)|willing to|trade (?:off|away)|in exchange)\b/i.test(text);
  if (meddic) notes.push("MEDDIC"); if (dealBreak) notes.push("deal-break"); if (concession) notes.push("concession");
  let grade = "A";
  const pts = [meddic, dealBreak, concession].filter(Boolean).length;
  if (pts === 0) grade = "C"; else if (pts === 1) grade = "B-";
  if (text.length < 300) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeLegal(text) {
  const notes = [];
  const hasCaveat = /\b(not legal advice|consult (?:counsel|a lawyer|an attorney)|licensed (?:counsel|attorney)|seek (?:counsel|legal))\b/i.test(text);
  const hasRedline = /\b(redline|propose|suggest|counter[- ]?propose|push back|change to|edit)\b/i.test(text);
  const hasRiskFrame = /\b(risk|exposure|liability|MFN|SLA|cap)\b/i.test(text);
  if (hasCaveat) notes.push("caveat"); if (hasRedline) notes.push("redline"); if (hasRiskFrame) notes.push("risk");
  let grade = "A";
  if (!hasCaveat) grade = "C+";
  const pts = [hasRedline, hasRiskFrame].filter(Boolean).length;
  if (pts === 0) grade = tFromIdx(tIdx(grade) - 2);
  if (text.length < 350) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeFinAnalyst(text) {
  const notes = [];
  const hasAssumptions = /\b(assumption|assume|input|holding|key driver)/i.test(text);
  const hasScenarios = /\b(base|bull|bear|scenario|sensitivity|upside|downside)\b/i.test(text);
  const hasNumbers = /\$\s*[\d,.]+[Kk]?[Mm]?|\d+\s*%/.test(text);
  const hasUnitEcon = /\b(LTV|CAC|payback|gross margin|contribution margin|cohort|ARR|MRR|net|expansion)\b/i.test(text);
  if (hasAssumptions) notes.push("assumptions"); if (hasScenarios) notes.push("scenarios"); if (hasNumbers) notes.push("numbers"); if (hasUnitEcon) notes.push("unit-econ");
  let grade = "A";
  const pts = [hasAssumptions, hasScenarios, hasNumbers, hasUnitEcon].filter(Boolean).length;
  if (pts <= 1) grade = "D"; else if (pts === 2) grade = "C"; else if (pts === 3) grade = "B";
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}
function gradeOps(text) {
  const notes = [];
  const hasNumbered = /(^|\n)\s*\d+\.\s/.test(text);
  const hasOwner = /\b(owner|owned by|responsible|assigned to)\b/i.test(text);
  const hasByWhen = /\b(by when|deadline|due (?:by|on)|target date|by (?:monday|tuesday|wednesday|thursday|friday)|by \d{1,2}\/\d{1,2})\b/i.test(text);
  const hasDone = /\b(done means|done when|verification|acceptance|definition of done)\b/i.test(text);
  if (hasNumbered) notes.push("numbered"); if (hasOwner) notes.push("owners"); if (hasByWhen) notes.push("by-when"); if (hasDone) notes.push("done-means");
  let grade = "A";
  if (!hasNumbered) grade = "C";
  const pts = [hasOwner, hasByWhen, hasDone].filter(Boolean).length;
  if (pts < 2) grade = tFromIdx(tIdx(grade) - 1);
  if (text.length < 400) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

// ─── Carry-over detector ───
// Has turn N actually used context from prior turns? We look for two
// signals: (1) explicit references ("based on the PRD above", "Sam's scope",
// "the postmortem"), and (2) substantive overlap — specific terms or
// concepts from the prior turn(s) reappear in this one.
function carryOverScore(text, priorTurns, ownContent) {
  if (priorTurns.length === 0) return { score: 1, notes: ["turn-1"] }; // turn 1 has no prior
  const notes = [];
  const lower = text.toLowerCase();
  const refersBack =
    /\b(based on (?:the|sam('?s)?|priya('?s)?|drew('?s)?|devon('?s)?|logan('?s)?|fiona('?s)?|casey('?s)?|maya('?s)?|dani('?s)?|olivia('?s)?|the (?:above|prior|previous|engineering|sales|legal|financial|product|design))|the (?:findings|postmortem|prd|scope|critique|redlines?|model|fix|positioning) (?:above|earlier|from)|as (?:described|noted|outlined|spec(?:ified|d)|sam|priya|drew|devon|logan|fiona|casey|maya|dani|olivia) (?:above|earlier|noted))\b/i.test(text);
  if (refersBack) notes.push("explicit-ref");

  // Substantive overlap: extract notable nouns from prior turns and see if
  // any reappear here. We use 6+ char alphabetic tokens that appeared in
  // prior turns (a rough heuristic for domain-specific terms).
  const priorTokens = new Set();
  for (const pt of priorTurns) {
    const tokens = pt.toLowerCase().match(/\b[a-z]{6,}\b/g) ?? [];
    for (const tok of tokens) priorTokens.add(tok);
  }
  // Ignore generic stopwords that aren't substantive.
  const stop = new Set(["because", "should", "really", "actually", "without", "however", "before", "always", "though", "anyone", "though", "between", "during", "another", "though", "anyone"]);
  for (const s of stop) priorTokens.delete(s);

  const ownTokens = lower.match(/\b[a-z]{6,}\b/g) ?? [];
  let overlap = 0;
  for (const ot of ownTokens) if (priorTokens.has(ot)) overlap++;
  // Score: 0 = none, 1 = weak (1-5 overlap), 2 = good (6-15), 3 = strong (16+)
  if (overlap >= 16) notes.push(`overlap:strong(${overlap})`);
  else if (overlap >= 6) notes.push(`overlap:good(${overlap})`);
  else if (overlap >= 1) notes.push(`overlap:weak(${overlap})`);
  else notes.push("overlap:none");

  // Composite score 0-2
  let score = 0;
  if (refersBack) score++;
  if (overlap >= 6) score++;
  return { score, notes };
}

// ─── Chains ───
const CHAINS = [
  {
    id: "product-launch",
    label: "Product launch chain",
    turns: [
      {
        persona: "product-manager",
        targetSec: 240,
        grader: gradePM,
        content: `Write a 1-page PRD for adding workspace-level export to our B2B analytics product. Current state: per-dashboard CSV export exists. Customer ask: bulk export of all dashboards in a workspace as a zip, scheduled if possible. Lead with the user problem and the measurable outcome, declare non-goals, and ICE-score this against two alternatives: (a) better in-product filters, (b) scheduled email reports.`,
      },
      {
        persona: "product-designer",
        targetSec: 210,
        grader: gradeDesigner,
        content: `Read Priya's PRD above. Critique the UX flow implied by it — where will users get confused, what unhappy paths need explicit handling, what's the simplest entry point. Anchor your critique to the user's job-to-be-done from the PRD. Flag accessibility issues for the bulk-download UX.`,
      },
      {
        persona: "software-engineer",
        targetSec: 240,
        grader: gradeSWE,
        content: `Based on the PRD + UX critique above, scope the engineering work. What components / endpoints / jobs need to change? What's the smallest correct delivery? Name the trade-offs (synchronous vs background job, in-memory zip vs streaming, etc.) and attach a test plan.`,
      },
      {
        persona: "marketing-manager",
        targetSec: 150,
        grader: gradeMarketing,
        content: `Based on the PRD + UX critique + engineering scope above, write a 1-paragraph launch positioning blurb for the public changelog. Audience: existing enterprise customers. Lead with the user benefit. Under 100 words.`,
      },
    ],
  },
  {
    id: "customer-crisis",
    label: "Customer crisis chain",
    turns: [
      {
        persona: "devops-sre",
        targetSec: 240,
        grader: gradeSRE,
        content: `Draft a blameless postmortem for this incident: API p99 latency spiked from 80ms to 3000ms for 47 minutes during peak hours yesterday. Root cause was a deploy that bumped max request concurrency without bumping the database connection pool size — pool exhaustion triggered cascading timeouts. Include timeline (t+0 through resolved), root cause, contributing factors, mitigation steps, and 3-5 action items with owners.`,
      },
      {
        persona: "software-engineer",
        targetSec: 210,
        grader: gradeSWE,
        content: `Based on Devon's postmortem above, propose the concrete engineering fix and add it to the action items. Be specific about which file/config needs to change, what the new defaults should be, and how to verify before/after with load. Include a test plan.`,
      },
      {
        persona: "customer-success",
        targetSec: 150,
        grader: gradeCSM,
        content: `Based on the postmortem and engineering fix above, draft a customer-facing email to our top enterprise accounts. Acknowledge the outage, explain what happened without making excuses, name what we're doing about it, and commit to a follow-up. Under 200 words. Sound like a person, not a help-center macro.`,
      },
      {
        persona: "marketing-manager",
        targetSec: 120,
        grader: gradeStatusPage,
        content: `Now write the public status-page update entry for the incident (keep under 80 words, neutral / factual tone, dated). Distinct from Casey's customer email — this is the public timeline anyone can read.`,
      },
    ],
  },
  {
    id: "contract-negotiation",
    label: "Contract negotiation chain",
    turns: [
      {
        persona: "account-executive",
        targetSec: 210,
        grader: gradeAE,
        content: `We're negotiating a 3-year renewal with our top customer ("TC2", $250K ARR today). Their asks: 30% volume discount, MFN pricing protection across their portfolio, and an SLA with $50K/month penalty cap for downtime over 99.5%. From a sales perspective: what are we willing to give, what's our deal-breaker, what's the MEDDIC frame here?`,
      },
      {
        persona: "contracts-reviewer",
        targetSec: 210,
        grader: gradeLegal,
        content: `Based on Drew's sales position above, draft your redline recommendations. Flag the risky clauses (MFN exposure, SLA penalty cap mechanics), suggest counter-positions, and explain in plain language what each one buys / costs us. Include the standard "not legal advice" reminder.`,
      },
      {
        persona: "financial-analyst",
        targetSec: 240,
        grader: gradeFinAnalyst,
        content: `Based on Drew's sales position and Logan's redlines above, model the financial impact: what does a 30% discount + $50K/month SLA cap actually cost at $250K ARR today? Show assumptions explicitly, base/bull/bear, and the unit-econ implication on gross margin. End with a recommendation.`,
      },
      {
        persona: "operations-coordinator",
        targetSec: 180,
        grader: gradeOps,
        content: `Based on the sales position + redlines + financial model above, write a runbook for executing this contract once signed: who owns what, by when, what's the definition of done for each step. Include legal sign-off, billing setup, SLA monitoring instrumentation, and account-team handoff.`,
      },
    ],
  },
];

const lines = [];
const log = (s = "") => { console.log(s); lines.push(s); };

async function runChain(chain) {
  const history = [];
  const turnResults = [];
  const priorTurnTexts = [];
  for (let i = 0; i < chain.turns.length; i++) {
    const turn = chain.turns[i];
    history.push({ role: "user", content: turn.content });
    const t0 = Date.now();
    let dispatched, dispatchErr = null;
    try {
      dispatched = await withDispatchLock(async () => {
        await activate(turn.persona);
        return await chatDispatch(history);
      });
    } catch (e) {
      dispatchErr = String(e?.message ?? e);
      dispatched = { kind: "error" };
    }
    let text = "", inline = false, err = dispatchErr;
    if (!err) {
      try {
        const r = await chatComplete(dispatched);
        text = r.text;
        inline = r.inline;
      } catch (e) {
        err = String(e?.message ?? e);
      }
    }
    const elapsed = (Date.now() - t0) / 1000;
    const shape = err ? { grade: "F", notes: [`ERR:${err.slice(0, 60)}`] } : turn.grader(text);
    const carry = err ? { score: 0, notes: ["err"] } : carryOverScore(text, priorTurnTexts, text);
    // Carry-over penalty: if turn > 1 and carry.score == 0, drop 2 tiers.
    // If turn > 1 and carry.score == 1, drop 1 tier.
    let combined = shape.grade;
    if (i > 0) {
      if (carry.score === 0) combined = tFromIdx(tIdx(combined) - 2);
      else if (carry.score === 1) combined = tFromIdx(tIdx(combined) - 1);
    }
    const penalty = timePenalty(elapsed, turn.targetSec);
    const finalIdx = Math.max(0, tIdx(combined) + penalty);
    const finalGrade = tFromIdx(finalIdx);
    const ok = tIdx(finalGrade) >= tIdx("B-");

    turnResults.push({
      chainId: chain.id, turnNum: i + 1, persona: turn.persona,
      elapsed, targetSec: turn.targetSec,
      shapeGrade: shape.grade, shapeNotes: shape.notes,
      carryScore: carry.score, carryNotes: carry.notes,
      combined, finalGrade, ok, inline, textLen: text.length, err,
    });
    history.push({ role: "assistant", content: text });
    priorTurnTexts.push(text);
  }
  return { chain, turnResults };
}

async function main() {
  const stamp = new Date().toISOString();
  log(`# Multi-role workflow chain harness — PARALLEL :: ${TAG} :: ${stamp}`);
  log(`Server: ${BASE}`);
  log(`Chains: ${CHAINS.length} (each 4 turns, ${CHAINS.length * 4} turns total). Sequential within chain, parallel across chains.`);
  log("");

  const original = (await getJson("/api/personas")).body?.activeId ?? null;
  const initial = await getPeerSnapshot();
  log(`Initial pool: primary inflight=${initial.primary.inflight}; peers=${initial.peers.map(p => `${p.name}@${p.port} inflight=${p.inflight}`).join(", ") || "(none)"}; pool=${initial.pool.count}/${initial.pool.cap}`);
  log("");

  const mon = startPoolMonitor();
  const wallStart = Date.now();

  // All chains in parallel. Each chain serialises internally; the global
  // dispatch mutex ensures activate→POST sequences don't scramble personas.
  const chainResults = await Promise.all(CHAINS.map(c => runChain(c)));

  const wallElapsed = (Date.now() - wallStart) / 1000;
  mon.stop();
  const poolSummary = summarizePool(mon.samples);

  for (const { chain, turnResults } of chainResults) {
    log(`## Chain: ${chain.label} (${chain.id})`);
    log("");
    for (const r of turnResults) {
      const mark = r.ok ? "✓" : "✗";
      log(`  ${mark} turn-${r.turnNum} ${r.persona.padEnd(24)} ${r.elapsed.toFixed(1)}s :: shape ${r.shapeGrade} · carry ${r.carryScore}/2 [${r.carryNotes.join(",")}] → ${r.combined} → ${r.finalGrade}  len=${r.textLen}`);
    }
    log("");
  }

  // Parallelism summary
  log(`## Parallelism`);
  log("");
  const allTurns = chainResults.flatMap(c => c.turnResults);
  const targetSum = allTurns.reduce((s, t) => s + t.targetSec, 0);
  log(`- Wall clock: ${wallElapsed.toFixed(1)}s (vs ~${targetSum}s if every turn ran strictly serially)`);
  log(`- Speedup: ${(targetSum / wallElapsed).toFixed(2)}× over fully-serial baseline`);
  log(`- Peak concurrent inflight (primary + peers): ${poolSummary.peakConcurrent}`);
  log(`- Peak managed worker pool size: ${poolSummary.peakPoolSize}/${initial.pool.cap}`);
  log(`- Samples where primary AND a peer both had ≥1 inflight: ${poolSummary.bothBusy} (both-clawbots-working)`);
  log(`- Distinct peer ports loaded: {${[...poolSummary.peerPorts].join(",") || "none"}}`);
  log("");

  // Scorecard
  log(`## Scorecard (per-turn)`);
  log("");
  log(`| Chain | Turn | Persona | Target | Elapsed | Shape | Carry | Combined | FINAL | Notes |`);
  log(`|---|---|---|---|---|---|---|---|---|---|`);
  for (const { chain, turnResults } of chainResults) {
    for (const r of turnResults) {
      log(`| ${chain.id} | ${r.turnNum} | ${r.persona} | ${r.targetSec}s | ${r.elapsed.toFixed(1)}s | ${r.shapeGrade} | ${r.carryScore}/2 | ${r.combined} | **${r.finalGrade}** | ${[...r.shapeNotes, ...r.carryNotes.slice(0, 1)].join(", ").slice(0, 55)} |`);
    }
  }
  log("");

  const aboveB = allTurns.filter(r => r.ok).length;
  const carryHits = allTurns.slice(1).filter(r => r.turnNum > 1 && r.carryScore >= 1).length;
  const carryEligible = allTurns.filter(r => r.turnNum > 1).length;
  log(`## Summary`);
  log("");
  log(`${aboveB}/${allTurns.length} turns above B-.`);
  log(`Carry-over: ${carryHits}/${carryEligible} non-first turns referenced or substantively overlapped with prior turns.`);
  log(`Both-clawbots-working: ${poolSummary.bothBusy > 0 ? "YES" : "NO"} (peak ${poolSummary.peakConcurrent} concurrent inflight, ${poolSummary.peakPoolSize}/${initial.pool.cap} pool size)`);
  log("");

  if (original) await activate(original);

  // Brain note
  const noteBody = [
    `# Workflow chain harness (parallel) — ${stamp}`,
    ``,
    `${aboveB}/${allTurns.length} of turns above B- across ${CHAINS.length} parallel workflow chains. ${carryHits}/${carryEligible} carry-over hits.`,
    ``,
    `**Parallelism:**`,
    `- Wall clock: ${wallElapsed.toFixed(1)}s (target sum ${targetSum}s; speedup ${(targetSum / wallElapsed).toFixed(2)}×)`,
    `- Peak concurrent inflight: ${poolSummary.peakConcurrent}`,
    `- Peak pool size: ${poolSummary.peakPoolSize}/${initial.pool.cap}`,
    `- Both-clawbots-working samples: ${poolSummary.bothBusy}`,
    ``,
    `**Per-chain breakdown:**`,
    ...chainResults.map(c => `- ${c.chain.label}: ${c.turnResults.map(r => r.finalGrade).join(" → ")}`),
  ].join("\n");
  try {
    const rr = await postJson("/api/templates/add-note/run", { inputs: { title: `Chain harness — ${stamp.slice(0, 10)}`, body: noteBody } });
    log(`Brain update: submitted${rr.body?.jobId ? ` (job ${rr.body.jobId})` : ""}.`);
  } catch (e) {
    log(`Brain update FAILED: ${String(e?.message ?? e)}`);
  }
}

main()
  .then(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = `_chain-harness-${TAG}-${stamp}.md`;
    import("node:fs").then(fs => {
      fs.writeFileSync(out, lines.join("\n"));
      console.log(`\nWrote: ${out}`);
    });
  })
  .catch(e => { console.error("HARNESS FAILED:", e); process.exit(1); });
