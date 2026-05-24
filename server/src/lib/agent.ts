import { findPrimitive, humanStepLabel, primitivesPromptCatalog, primitives } from "./primitives.js";
import { ollamaGenerate, ollamaGenerateWithMeta } from "./ollama.js";
import { pollPeers } from "./peers.js";
import { searchVault, searchVaultFilenames } from "./vault.js";
import { suggestSkillsForIntent, suggestSkillsForTask, topSkillScoreForTask } from "./skills.js";
import { config } from "../config.js";
import { PLAN_SYSTEM, POLISHED_DIRECT, POLISHED_SYNTH, TRIVIAL_DIRECT } from "./agent-prompts.js";

// Parse the "Interpretation: intent=foo, target=..." line that chat.ts
// appends to enriched tasks. Returns the intent label when present, or
// undefined if the task didn't go through intent extraction. Used by the
// synth path to load a matching skill playbook.
function parseIntentFromTask(task: string): string | undefined {
  const m = task.match(/Interpretation:\s*intent=([\w-]+)/i);
  return m ? m[1].toLowerCase() : undefined;
}

// Extract just the user's actual request from the enriched task — strip
// thread context, interpretation lines, deliverable hints, AND chat-template
// preambles so heuristics + extractTopic see only the original ask.
//
// Three shapes get stripped (in priority order):
//   1. Chat templates (Quick web look-up, Multi-perspective, etc.) wrap the
//      user's typed text as "<template instructions>\n\nTopic: <bare text>".
//      The bare text after "Topic:" is the real ask.
//   2. Thread-context enrichment wraps as "Current request (...): <text>".
//   3. Plain enriched tasks just have the persona prefix and trailing
//      Interpretation: / Deliverable shape: blocks to strip.
export function parseUserRequestFromTask(task: string): string {
  // 1. Template preamble + Topic: suffix. The web UI splices the user's typed
  //    text in via "${activeTemplate.task}\n\nTopic: ${topic}" — without this
  //    extraction the planner sees the full template prose as the topic
  //    (cause of the 5-min "whats the hanta virus" research run).
  const topicMatch = task.match(/(?:^|\n)\s*Topic:\s*([\s\S]+?)(?:\n\nInterpretation:|\n\nDeliverable shape:|$)/i);
  if (topicMatch && topicMatch[1].trim().length > 0) return topicMatch[1].trim().slice(0, 400);
  // 2. Thread-context block.
  const m = task.match(/Current request \(.*?\):\s*([\s\S]*?)(?:\n\nInterpretation:|\n\nDeliverable shape:|$)/);
  if (m && m[1].trim().length > 0) return m[1].trim().slice(0, 400);
  // 3. Plain enriched task — strip wrappers and return the body.
  return task
    .replace(/\n*Interpretation:[\s\S]*$/i, "")
    .replace(/\n*Deliverable shape:[\s\S]*$/i, "")
    .replace(/^\(You are operating as[^)]+\)\n+/, "")
    .trim()
    .slice(0, 400);
}

// True when the original task came in via a chat template (i.e. has a
// "Topic: <X>" splice). When this is the case, the user explicitly asked for
// the template's behavior (web look-up, multi-perspective, etc.) — we should
// honor that and NOT shortcut to a direct LLM answer even when the bare
// topic looks like a definition question.
function taskWasTemplated(task: string): boolean {
  return /(?:^|\n)\s*Topic:\s*\S/i.test(task);
}

export type PlanStep = { tool: string; args: Record<string, any>; rationale?: string; label?: string };
export type Plan = { steps: PlanStep[]; summary?: string; waves?: number[][] };
export type StepRun = { step: PlanStep; ok: boolean; result?: any; error?: string; durationMs: number; startedAt?: number; modelUsed?: string };

export type PeerReview = {
  verdict: "good" | "needs-work" | "bad";
  issues: string[];
  revised_answer?: string;
  confidence: number;
  reviewer?: { name?: string; model?: string };
  elapsedMs?: number;
};

export type QualityScore = {
  pass: boolean;
  factuality_risk: number;
  citation_coverage: number;
  persona_fit: number;
  score?: number;
  issues?: string[];
};

export type SecurityScan = {
  pass: boolean;
  findings: { type: string; match: string; severity: "high" | "medium" | "low"; reason: string }[];
  redacted?: string;
  kind?: string;
};

export type AgentResult = {
  task: string;
  plan: Plan;
  runs: StepRun[];
  answer: string;
  // Streamed partial answer surfaced during synthesis. Replaced by the final
  // `answer` once synthesis completes; the UI prefers `answer` when present.
  partialAnswer?: string;
  hadWrites: boolean;
  review?: PeerReview;
  quality?: QualityScore;
  security?: SecurityScan;
  // Sub-agent spin-up telemetry — the UI uses this to show users why their
  // run was fast (or wasn't). `budgets` are the dual-lane caps used for this
  // run; `subagentTimings` is per-wave elapsed time in ms.
  budgets?: { llm: number; io: number; idlePeers: number };
  subagentTimings?: { wave: number; elapsedMs: number; ioCount: number; llmCount: number }[];
  // Skill picker telemetry. `skillUsed` is the name of the playbook the
  // synth was guided by; `skillScore` is the composite score (intent +
  // keyword) from suggestSkillsForTask. Both are persisted by job-store
  // and aggregated by the daily reflection so the picker has a feedback
  // loop — patterns like "skill X chosen N times but the customer flagged
  // M as wrong" become visible without manual review.
  skillUsed?: string;
  skillScore?: number;
};

// PLAN_SYSTEM, POLISHED_DIRECT, POLISHED_SYNTH moved to agent-prompts.ts
// — see that file for the prompt bodies. Imported above; usages below.

// Phrases that signal "the customer wants real external sources, not your
// training-data memory". When any of these appear in the task we add a
// research-required hint to the planner prompt — without it the LLM
// planner sometimes shortcuts long persona tasks ("I have a discovery call
// Friday — research Anthropic's enterprise pricing as of 2026 then prep
// MEDDIC notes") to a direct ollama.generate from memory, producing
// confident but untethered output. Patterns are matched case-insensitive
// against the full enriched task body. Returns the matched phrase for
// audit (so the planner prompt can name it back), or null when no signal.
const RESEARCH_SIGNAL_PATTERNS: RegExp[] = [
  // Look-up verbs anywhere in the body
  /\b(?:look\s+(?:it\s+|them\s+|this\s+)?up|find\s+(?:out|me\s+)\s*(?:what|how|who|whether|if)|investigate|dig\s+into|look\s+into)\b/i,
  // "Research X" — broadened. Previously required research + (it|them|this|
  // how|...) which missed the most common research framing "Research Notion's
  // launches" / "Research Stripe pricing" / "Research the current state of X".
  // Now matches research followed by ANY word (capitalised entity, article,
  // determiner, pronoun) — anything except a sentence boundary.
  /\bresearch\s+(?:[\w']+|the\s+|a\s+|an\s+)/i,
  // "Scan X" / "map the landscape for X" — landscape-scan trigger
  /\b(?:scan\s+(?:the\s+|a\s+)?(?:current\s+)?(?:landscape|market|category|space|players|competitive\s+set)|map\s+(?:the\s+|out\s+the\s+)?(?:market|landscape|competitive\s+set|category))\b/i,
  // Triangulate / verify / fact-check — these all imply gathering multiple
  // sources before answering
  /\b(?:triangulat(?:e|ing|ed)|verify\s+(?:the\s+|this\s+|a\s+)?claim|fact[- ]?check\s+(?:the\s+|this\s+|a\s+)?claim|cross[- ](?:check|verify|reference)\s+(?:the\s+|this\s+|a\s+)?claim)\b/i,
  // "Look up <noun> (on the web|online)" — most common research framing
  /\blook\s+up\s+(?:the\s+|a\s+|an\s+|some\s+)?\w+/i,
  // Recency markers — claims that depend on fresh facts
  /\b(?:latest|most\s+recent|currently|as\s+of\s+20\d{2}|in\s+20(?:2[5-9]|3\d)|this\s+(?:year|quarter|month))\b/i,
  /\b(?:the\s+current\s+(?:state|landscape|consensus|best\s+practices?|status)|what(?:'?s|\s+is)\s+(?:the\s+)?(?:current|latest|most\s+recent|trending))\b/i,
  // Benchmark / industry-typical asks
  /\b(?:industry[- ]?(?:standard|typical|average|median|benchmark)|best[- ]in[- ]class\s+(?:companies|teams|orgs|saas)|what\s+(?:do|does)\s+(?:typical|good|great|leading)\s+(?:companies|teams|saas|firms|orgs|engineers))\b/i,
  /\b(?:benchmark(?:s|ed|ing)?|comparable\s+(?:company|companies|saas|firm)|what\s+(?:are\s+the\s+|what\s+are\s+)?typical\s+(?:ranges?|numbers?|values?|figures?|rates?))\b/i,
  // "According to" / cite-a-source phrasing
  /\b(?:according\s+to\s+(?:a\s+|the\s+|recent\s+)?(?:report|study|article|analyst|industry|survey|benchmark)|cite\s+(?:your\s+|the\s+)?sources?|with\s+citations?|with\s+sources?|grounded\s+in\s+(?:a\s+|the\s+)?source)\b/i,
  // Named-report or report-class lookups
  /\b(?:OpenView|SaaStr|KeyBanc|Bessemer|Gartner|Forrester|McKinsey|Bain|Goldman|Deloitte|Stack\s+Overflow\s+Developer\s+Survey|DORA\s+State\s+of\s+DevOps|JetBrains)\b/i,
  // Verbs that require real-world data
  /\b(?:price\s+check|pricing\s+(?:page|structure|tiers|model)|recent\s+(?:funding|launch|product|release|hire)|changelog|release\s+notes|roadmap\s+for\s+\w+)\b/i,
  // Multi-company / market-scan phrasings
  /\b(?:who(?:'?s|\s+is)\s+(?:playing|competing|in)\s+(?:this|the)\s+(?:market|space|category)|landscape\s+(?:for|of|on)|map\s+(?:the\s+|out\s+the\s+)?(?:market|landscape|competitive\s+set))\b/i,
];

export function detectResearchSignals(text: string): string | null {
  if (!text || text.length < 10) return null;
  const cap = text.slice(0, 4000);
  for (const re of RESEARCH_SIGNAL_PATTERNS) {
    const m = cap.match(re);
    if (m) return m[0].slice(0, 60);
  }
  return null;
}

// Hard cap on the planner LLM call. Slow local models occasionally take 2+
// minutes JUST to plan — by which point the customer has given up. After
// PLAN_TIMEOUT_MS we abandon the LLM plan and fall back to defaultVaultPlan,
// which routes the task to research.deep (or web.scrape for bare URLs).
// Dropped from 60s → 30s → 18s: with the templated-task path and `whats X`
// heuristic, anything that DIDN'T already match the heuristic by now is a
// genuinely unusual shape and 18s is enough for a small local planner; if
// it isn't, the fallback is faster than waiting any longer.
const PLAN_TIMEOUT_MS = Number(process.env.CLAWBOT_PLAN_TIMEOUT_MS ?? "18000");

export async function plan(task: string, _personaSystemSuffix?: string, push?: (msg: string) => void): Promise<Plan> {
  // Persona deliberately omitted from the TOOL CHOICE prompt: tool selection
  // is mechanical and must not be gated by role. (Head of AI asking about
  // NeuroWorks is still allowed to search the vault.) The persona colors the
  // synthesised answer. We DO however pass vault-hits context — the planner
  // makes much better decisions when it knows whether the vault has notes on
  // the topic ("4 hits → prefer vault.search before web").
  const topic = extractTopic(task);
  let vaultContext = "";
  if (topic && topic.length >= 2) {
    try {
      // Filename-only scan here too: the planner only needs a hint about
      // whether the vault has anything on this topic. Full content search
      // would cost 10-15s on a big vault before the planner LLM even starts.
      const hits = searchVaultFilenames(topic, 5);
      if (hits.length > 0) {
        vaultContext = `\n\nVault context: the user's vault has ${hits.length} note${hits.length === 1 ? "" : "s"} matching this topic. Sample paths: ${hits.slice(0, 3).map(h => h.path).join(", ")}. Strongly prefer vault.search / vault.read over the web for this task; the user wants their own notes prioritised.\n`;
      } else {
        vaultContext = `\n\nVault context: the user's vault has NO notes on this topic. Web research (research.deep or research.multiperspective) is appropriate; capture findings back to 0-Inbox/.\n`;
      }
    } catch { /* tolerate — vault search failure shouldn't block planning */ }
  }
  // Research-trigger hint: when the task TEXT itself implies the customer
  // wants real external sources (look-up verbs, recency markers, benchmark
  // asks, "according to a recent report" phrasing), explicitly tell the
  // planner: do NOT short-circuit to ollama.generate / direct answer —
  // fetch web sources first. This catches the failure mode where the LLM
  // planner reads a long persona task ("I have a discovery call... research
  // Anthropic's pricing... then prep MEDDIC") and picks a single
  // ollama.generate from training memory because the surface verb wasn't
  // a bare "research X".
  const researchHint = detectResearchSignals(task);
  const researchContext = researchHint
    ? `\n\nResearch required: the task contains "${researchHint}" — the customer expects you to FETCH external sources, not answer from memory. Your plan MUST include at least one of: research.deep, research.multiperspective, web.search + smartFetch chain, or web.scrape. If you also need to synthesise persona-flavored output afterward, chain a final ollama.generate that takes the research result as evidence. Do NOT skip the fetch step.\n`
    : "";
  // Compact catalog: ~40% smaller prompt → faster planning on small models.
  const sys = PLAN_SYSTEM + primitivesPromptCatalog({ compact: true }) + vaultContext + researchContext;

  // Race the planner LLM call against PLAN_TIMEOUT_MS. If the LLM stalls,
  // we fall back to an empty plan; the caller then uses defaultVaultPlan
  // (research.deep). Better a generic-but-fast plan than a 2-min planner
  // stall that makes the customer think it's hung.
  //
  // Planning is marked complexity:"normal" because the prompt is short
  // (under the 6k-token complexity threshold). When OPENROUTER_API_KEY is
  // set AND OPENROUTER_PROFILES is empty or includes "planning", the
  // dispatcher routes to OR's small/cheap model — typically ~1-2 seconds
  // vs ~30-90 seconds on local Ollama. Customers wanting strict local-only
  // can set OPENROUTER_PROFILES to exclude planning.
  let out: string;
  try {
    out = await Promise.race([
      ollamaGenerate(`Task: ${task}`, sys, {
        profile: "planning",
        onRoutingDecision: push ? (info) => {
          // Only push when planner went remote — the local-Ollama-default
          // case is the silent norm and doesn't deserve a log line.
          if (info.backend === "openrouter") {
            push(`Planning with ${info.model}${info.reason ? ` — ${info.reason}` : ""}.`);
          }
        } : undefined,
      }),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error(`planner timeout after ${PLAN_TIMEOUT_MS / 1000}s`)), PLAN_TIMEOUT_MS),
      ),
    ]);
  } catch (e: any) {
    console.warn(`[planner] ${e?.message ?? e} — falling back to empty plan; caller will use defaultVaultPlan`);
    return { steps: [] };
  }
  const json = extractJson(out);
  if (!json) return { steps: [] };
  if (!Array.isArray(json.steps)) return { steps: [] };
  // Validate each step references a real tool
  const steps: PlanStep[] = [];
  for (const s of json.steps) {
    if (!s || typeof s.tool !== "string") continue;
    if (!findPrimitive(s.tool)) continue;
    const args = s.args ?? {};
    steps.push({ tool: s.tool, args, rationale: s.rationale, label: humanStepLabel(s.tool, args) });
  }
  const waves = computeWaves(steps);
  return { steps, summary: typeof json.summary === "string" ? json.summary : undefined, waves };
}

// Build dependency graph from $step_<i> references and group steps into "waves"
// — each wave's steps depend only on earlier waves, so they all run in parallel
// as sub-agents.
function computeWaves(steps: PlanStep[]): number[][] {
  const deps: Set<number>[] = steps.map(s => collectDeps(s.args));
  const wave: number[] = new Array(steps.length).fill(-1);
  const result: number[][] = [];
  let placed = 0;
  while (placed < steps.length) {
    const w: number[] = [];
    for (let i = 0; i < steps.length; i++) {
      if (wave[i] !== -1) continue;
      const ready = [...deps[i]].every(d => wave[d] !== -1 && wave[d] < result.length);
      if (ready) w.push(i);
    }
    if (w.length === 0) {
      // Cycle or invalid dep — give up and serialize remaining steps
      for (let i = 0; i < steps.length; i++) if (wave[i] === -1) { wave[i] = result.length; result.push([i]); placed++; }
      break;
    }
    for (const i of w) wave[i] = result.length;
    result.push(w);
    placed += w.length;
  }
  return result;
}

function collectDeps(args: any, acc: Set<number> = new Set()): Set<number> {
  if (typeof args === "string") {
    for (const m of args.matchAll(/\$step_(\d+)/g)) acc.add(Number(m[1]));
  } else if (Array.isArray(args)) {
    for (const v of args) collectDeps(v, acc);
  } else if (args && typeof args === "object") {
    for (const v of Object.values(args)) collectDeps(v, acc);
  }
  return acc;
}

// Sub-agent concurrency budgets. We have two lanes because the two cost
// curves are different:
//   • LLM-bound tools (ollama.generate, research.deep, peer.review,
//     quality.check, peer.delegate) — bottlenecked by the local Ollama model.
//     Running many in parallel only helps if OLLAMA_NUM_PARALLEL is high or
//     idle peers can absorb the work. Default: 3 + 2 per idle peer.
//   • I/O-bound tools (vault.*, github.*, web.fetch, web.scrape, fs.*,
//     clock.*) — bound by network/disk and parallelise great. Default: 6.
//
// CLAWBOT_SUBAGENT_BUDGET overrides the LLM-lane base. CLAWBOT_IO_BUDGET
// overrides the I/O lane. Persona-shifter peers can crank both up because
// they're the dedicated worker — their job IS to run as many sub-agents as
// the tools can handle.
const LLM_BASE = Number(process.env.CLAWBOT_SUBAGENT_BUDGET ?? "3");
const IO_BASE = Number(process.env.CLAWBOT_IO_BUDGET ?? "6");
const PER_PEER_BONUS = 2;
const HARD_CAP = 12;

const LLM_HEAVY_TOOLS = new Set([
  "ollama.generate", "research.deep", "peer.review", "peer.delegate",
  "quality.check", "synth", "synthesis",
]);

function isLlmHeavy(tool: string): boolean {
  return LLM_HEAVY_TOOLS.has(tool);
}

type Budgets = { llm: number; io: number; idlePeers: number };

// Compute both budgets once at the start of a run, then keep them stable for
// the whole plan. The peer poll is bounded by pollPeers's own 2s/peer timeout
// so an unreachable peer can't stall the run start.
async function computeBudgets(): Promise<Budgets> {
  try {
    const peers = await pollPeers();
    const idleReachable = peers.filter(p => p.ok && p.ready && (p.inflightJobs ?? 0) === 0).length;
    const llm = Math.min(HARD_CAP, Math.max(LLM_BASE, LLM_BASE + idleReachable * PER_PEER_BONUS));
    const io = Math.min(HARD_CAP, Math.max(IO_BASE, IO_BASE + idleReachable));
    return { llm, io, idlePeers: idleReachable };
  } catch {
    return { llm: LLM_BASE, io: IO_BASE, idlePeers: 0 };
  }
}

// Errors that look transient and worth one retry. Network blips, Ollama load
// timeouts, GitHub 5xx — the kind of thing that's usually fine on a second try.
const TRANSIENT_ERROR_RE = /\b(?:ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|abort|timeout|503|502|504|429|empty response body)\b/i;
// Unrecoverable failures — auth, missing model, hard config issues. We do NOT
// retry these (the next attempt will fail the same way) but we ALSO don't
// abort the whole plan: the wave-level check decides whether to continue.
const FATAL_ERROR_RE = /\b(?:401|403|model not found|model not pulled|API key|invalid_request_error|insufficient_quota)\b/i;
const STEP_RETRY_BACKOFF_MS = [1500, 4000]; // two retries: 1.5s, then 4s

export async function executePlan(p: Plan, push: (msg: string) => void, onProgress?: (runs: StepRun[]) => void): Promise<{ runs: StepRun[]; hadWrites: boolean; budgets?: { llm: number; io: number; idlePeers: number }; subagentTimings?: { wave: number; elapsedMs: number; ioCount: number; llmCount: number }[] }> {
  const runs: StepRun[] = p.steps.map(step => ({ step, ok: false, durationMs: 0 }));
  let hadWrites = false;
  for (const step of p.steps) {
    const tool = findPrimitive(step.tool)!;
    if (!tool.readonly) hadWrites = true;
  }
  const waves = p.waves && p.waves.length > 0 ? p.waves : p.steps.map((_, i) => [i]);
  let aborted = false;
  // Resolve both concurrency lanes for this run. The I/O lane stays wider
  // than the LLM lane so vault/web/github sub-agents fan out aggressively
  // while LLM calls respect the local Ollama bottleneck.
  const budgets = await computeBudgets();
  const spinStartedAt = Date.now();
  // Only surface the budget line when an idle peer is boosting capacity (the
  // customer-relevant case — they paid for that worker, show it's helping) or
  // when the budgets exceed the trivial defaults. Otherwise this line is
  // operator-only noise that clutters the chat-side trace.
  if (budgets.idlePeers > 0) {
    push(`Running with help from ${budgets.idlePeers} peer worker${budgets.idlePeers === 1 ? "" : "s"} (capacity ${budgets.llm} thinking + ${budgets.io} I/O sub-agents).`);
  } else if (process.env.CLAWBOT_VERBOSE === "1") {
    push(`Capacity: ${budgets.llm} thinking + ${budgets.io} I/O sub-agents.`);
  }
  onProgress?.([...runs]);
  // Inform progress callbacks via the runs payload (executePlan only emits
  // runs — we stamp the budget on the first run as a side-channel so the UI
  // can surface it without changing the existing wire shape).

  async function runStep(i: number) {
    if (aborted) return;
    const step = p.steps[i];
    const tool = findPrimitive(step.tool)!;
    const args = resolveArgs(step.args, runs);
    push(`Step ${i + 1} of ${p.steps.length}: ${step.label ?? step.tool}`);
    runs[i] = { step, ok: false, durationMs: 0, startedAt: Date.now() };
    onProgress?.([...runs]);
    const t0 = Date.now();
    let attempt = 0;
    while (true) {
      try {
        const result = await tool.handler(args);
        // ollama.generate returns { text, model } so we capture the model used.
        // Other tools just leave modelUsed undefined.
        const modelUsed = result && typeof result === "object" && "model" in result ? String((result as any).model) : undefined;
        runs[i] = { step, ok: true, result, durationMs: Date.now() - t0, startedAt: t0, modelUsed };
        onProgress?.([...runs]);
        return;
      } catch (e: any) {
        const msg = String(e.message ?? e);
        // Up to TWO retries on transient errors with growing backoff. Real
        // network blips, brief rate limits, undici socket hang-ups — these
        // recover within seconds, so a single retry sometimes wasn't enough.
        if (attempt < STEP_RETRY_BACKOFF_MS.length && TRANSIENT_ERROR_RE.test(msg) && !FATAL_ERROR_RE.test(msg)) {
          const wait = STEP_RETRY_BACKOFF_MS[attempt];
          attempt++;
          push(`  ⟳ ${step.label ?? step.tool}: transient error (attempt ${attempt}/${STEP_RETRY_BACKOFF_MS.length}), retrying in ${(wait / 1000).toFixed(1)}s — ${msg.slice(0, 120)}`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        runs[i] = { step, ok: false, error: msg, durationMs: Date.now() - t0, startedAt: t0 };
        // DO NOT abort the whole plan on a single step failure. A fan-out
        // wave (multiperspective research, parallel scrapers) often has 4+
        // steps and losing one shouldn't doom the rest. The wave-level
        // check below decides whether enough succeeded to keep going.
        push(`  ✗ ${step.label ?? step.tool}: ${msg.slice(0, 200)}`);
        onProgress?.([...runs]);
        return;
      }
    }
  }

  const subagentTimings: { wave: number; elapsedMs: number; ioCount: number; llmCount: number }[] = [];
  for (let w = 0; w < waves.length; w++) {
    if (aborted) break;
    const ids = waves[w];
    // Track wave-level success/failure. If EVERY step in a wave fails we
    // abort — there's nothing downstream can build on. But if at least one
    // succeeds, we continue: the wave produced partial evidence the next
    // wave (and the synth) can use.
    const waveStepIds = [...ids];
    if (ids.length > 1) {
      const llmIds = ids.filter(i => isLlmHeavy(p.steps[i].tool));
      const ioIds = ids.filter(i => !isLlmHeavy(p.steps[i].tool));
      const waveStartedAt = Date.now();
      push(`Running ${ids.length} sub-agents in parallel (${ioIds.length} I/O + ${llmIds.length} thinking).`);
      // Run the lanes in parallel against each other. Within a lane we chunk
      // to respect the budget. I/O sub-agents start FIRST so they have a head
      // start (they're typically faster); LLM sub-agents follow on the LLM
      // lane while I/O is still finishing — most plans gate the LLM step on
      // the I/O step's output anyway, but when they don't this is a free win.
      const ioPromise = (async () => {
        for (let off = 0; off < ioIds.length; off += budgets.io) {
          if (aborted) break;
          const chunk = ioIds.slice(off, off + budgets.io);
          await Promise.all(chunk.map(runStep));
        }
      })();
      const llmPromise = (async () => {
        for (let off = 0; off < llmIds.length; off += budgets.llm) {
          if (aborted) break;
          const chunk = llmIds.slice(off, off + budgets.llm);
          await Promise.all(chunk.map(runStep));
        }
      })();
      await Promise.all([ioPromise, llmPromise]);
      const waveMs = Date.now() - waveStartedAt;
      subagentTimings.push({ wave: w + 1, elapsedMs: waveMs, ioCount: ioIds.length, llmCount: llmIds.length });
      const okInWave = waveStepIds.filter(idx => runs[idx]?.ok).length;
      const failedInWave = waveStepIds.length - okInWave;
      if (failedInWave > 0) {
        push(`Wave ${w + 1} finished in ${(waveMs / 1000).toFixed(1)}s — ${okInWave} of ${waveStepIds.length} sub-agents succeeded (${failedInWave} failed; partial results kept).`);
      } else {
        push(`Wave ${w + 1} finished in ${(waveMs / 1000).toFixed(1)}s.`);
      }
    } else {
      // Single-step wave — no lane split needed.
      const tSingle = Date.now();
      await runStep(ids[0]);
      const stepTool = p.steps[ids[0]].tool;
      subagentTimings.push({ wave: w + 1, elapsedMs: Date.now() - tSingle, ioCount: isLlmHeavy(stepTool) ? 0 : 1, llmCount: isLlmHeavy(stepTool) ? 1 : 0 });
    }
    // Wave-level abort gate: only abort if EVERY step in this wave failed
    // AND the failure was something downstream can't recover from. A
    // single-step wave that fails on a single-step plan obviously means
    // there's nothing left to synthesize; multi-step waves get to keep
    // going as long as at least one perspective succeeded.
    const okInWave = waveStepIds.filter(idx => runs[idx]?.ok).length;
    if (okInWave === 0 && waveStepIds.length > 0) {
      // Special tolerance: if a SUBSEQUENT wave succeeded earlier or there
      // are still later waves to try, we don't abort — synth can work from
      // anything we've gathered so far. But if this was the FIRST wave and
      // it produced nothing, there's no evidence to build on, so we stop.
      const anySucceededOverall = runs.some(r => r.ok);
      if (!anySucceededOverall && w === 0) {
        push(`First wave had no successful sub-agents — stopping early. I'll summarise what was tried and why it didn't land.`);
        aborted = true;
      }
    }
  }
  const totalSpinMs = Date.now() - spinStartedAt;
  push(`All sub-agents finished in ${(totalSpinMs / 1000).toFixed(1)}s.`);
  return { runs, hadWrites, budgets, subagentTimings };
}

// Auto-review is opt-out via env. Skipped automatically when the answer is
// trivial (under MIN_REVIEW_CHARS) or no peer is reachable. This makes the
// behavior degrade cleanly on single-clawbot setups.
const AUTO_REVIEW = process.env.CLAWBOT_AUTO_REVIEW !== "0";
const MIN_REVIEW_CHARS = 120;

// Build a compact, numbered evidence string from successful step runs.
// quality.check accepts a `sources` arg — without it the scorer is grading
// citation_coverage blind. Format mirrors the catalog the synth saw so the
// scorer can match the draft's [N] markers back to real sources.
function buildEvidenceCatalog(runs: StepRun[]): string {
  const ok = runs.filter(r => r.ok && r.step.tool !== "quality.check" && r.step.tool !== "security.scan" && r.step.tool !== "peer.review");
  if (ok.length === 0) return "";
  const lines: string[] = [];
  for (let i = 0; i < ok.length; i++) {
    const r = ok[i];
    const result: any = r.result;
    let body = "";
    if (typeof result === "string") body = result;
    else if (result && typeof result === "object") {
      if (typeof result.answer === "string") body = result.answer;
      else if (typeof result.text === "string") body = result.text;
      else if (typeof result.content === "string") body = result.content;
      else if (Array.isArray(result.matches)) body = result.matches.slice(0, 6).map((m: any) => `${m.path ?? "?"}: ${(m.preview ?? "").slice(0, 120)}`).join("\n");
      else if (Array.isArray(result.results)) body = result.results.slice(0, 6).map((m: any) => `${m.title ?? m.path ?? m.url ?? "?"} — ${(m.snippet ?? m.preview ?? "").slice(0, 120)}`).join("\n");
      else if (Array.isArray(result.webSources)) body = result.webSources.slice(0, 6).map((s: any, i: number) => `[${i + 1}] ${s.title ?? s.url}`).join("\n");
      else { try { body = JSON.stringify(result); } catch { body = ""; } }
    }
    body = String(body).slice(0, 1500);
    if (!body) continue;
    const args = r.step.args ?? {};
    const provenance: string[] = [];
    for (const k of ["url", "path", "query", "name", "repo", "owner"]) {
      const v = (args as any)[k];
      if (typeof v === "string") provenance.push(`${k}="${v.slice(0, 60)}"`);
    }
    lines.push(`[${i + 1}] ${r.step.tool}${provenance.length ? ` (${provenance.join(", ")})` : ""}\n${body}`);
  }
  return lines.join("\n\n").slice(0, 8000);
}
// Triage skips the planner for short conversational/world-knowledge prompts.
// Set CLAWBOT_TRIAGE=0 to disable. The triage call uses the smallest available
// model so the shortcut path is much faster than full plan→execute→synth.
const TRIAGE_ENABLED = process.env.CLAWBOT_TRIAGE !== "0";
const TRIAGE_MAX_CHARS = 200;

// Heuristic prefilter: certain shapes are obviously direct-answer (greetings,
// simple math, "what is/are" world-knowledge questions) — skip the LLM triage
// call entirely. Saves 2-5s per simple task on local Ollama. The LLM triage
// handles the ambiguous middle.
//
// Anything that name-drops vault/notes/brain, a file path, a URL, a repo, or a
// "search/find/look up" verb is NOT direct — those need tools and must reach
// the planner. The vault-hits check downstream still vetoes a direct path
// when the user's notes actually cover the topic.
const TOOL_CUES = /\b(?:my\s+(?:vault|notes?|brain|second\s+brain|repos?|files?|docs?|inbox)|the\s+(?:vault|repo|repository|inbox)|in\s+(?:my|the)\s+(?:vault|notes?|brain|repo|inbox|files?|docs?)|find|search|look\s+(?:up|for|inside)|browse|fetch|scrape|read\s+\S+\.(?:md|pdf|docx|xlsx|txt|json|yaml|yml|csv)|github\.com|https?:\/\/|[a-zA-Z]:\\|\/[\w-]+\/[\w-]+|\.md\b|\.pdf\b|\.docx\b)/i;
export function looksLikeDirectAnswer(task: string): boolean {
  const t = task.trim();
  if (t.length === 0 || t.length > TRIAGE_MAX_CHARS) return false;
  const lower = t.toLowerCase();
  // Tool-cue blocklist applies to every direct-answer pattern below.
  if (TOOL_CUES.test(t)) return false;
  if (/^(?:hi|hello|hey|yo|sup|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|bye|goodbye|cool|ok|okay|got\s+it|nice|sweet|sounds\s+good)\b[\s!,.?]*$/i.test(lower)) return true;
  // Single-word affirmations / non-questions.
  if (/^\s*(?:yes|yeah|yep|sure|fine|no|nope|nah|maybe|idk)[\s!.?]*$/i.test(lower)) return true;
  if (/^[\d\s+\-*/().,]+\??$/.test(lower) && /\d/.test(lower)) return true; // pure arithmetic
  // World-knowledge question shapes — short prompts with no tool cues.
  // "what is X" / "what are X" / "what's X" / "whats X" / "what does X mean"
  // (apostrophe in "what's" is optional — users frequently type "whats")
  if (/^\s*what(?:'?s|\s+is|\s+are|\s+does|\s+do)\s+\S/i.test(t) && t.length <= 120) return true;
  // "define X" / "explain X" / "describe X" / "tell me about X" with no tool cues
  if (/^\s*(?:define|explain|describe|clarify|elaborate(?:\s+on)?)\s+\S/i.test(t) && t.length <= 120) return true;
  // "how do/does/can/should/would X" / "how long/much/many/big X"
  if (/^\s*how\s+(?:do|does|can|should|would|long|much|many|big|small|fast|slow|often|come|to)\b/i.test(t) && t.length <= 140) return true;
  // "why is/are/does X" / "when is/was/did X" / "where is/are X"
  if (/^\s*(?:why|when|where|who|which)\s+(?:is|are|was|were|did|does|do|will|would|should|can)\b/i.test(t) && t.length <= 140) return true;
  // "can you X" / "could you X" where X is a reasoning task (not a tool task)
  if (/^\s*(?:can|could)\s+you\s+(?:help|explain|describe|tell|clarify|elaborate|summari[sz]e|recommend|suggest)\b/i.test(t) && t.length <= 140) return true;
  // Pure "compare X and Y" / "X vs Y" reasoning prompts
  if (/^\s*(?:compare|contrast)\s+\S+\s+(?:and|vs\.?|versus|with|to)\s+\S/i.test(t) && t.length <= 160) return true;
  return false;
}

// True when the prompt is the kind of trivial input where world knowledge
// is the right tier and NEITHER the vault NOR web research would help:
// greetings, pure arithmetic, single-word affirmations. These bypass the
// "if direct, try heuristicPlan first" cascade rule — we send them straight
// to world knowledge without checking for `aboutMatch` etc.
//
// `hasPriorTurnContext` — when the full task includes thread-context
// wrapping (e.g. "Current request (after prior turns about X): yes"),
// affirmations like "yes" / "no" / "maybe" are meaningful answers to a
// prior question and SHOULD route trivially. Without that wrapping,
// a bare "yes" is meaningless — the cold-start user has nothing to
// affirm — so we let it fall through to the LLM which will at least
// ask "yes to what?" rather than hallucinate a confident response.
export function isTriviallyDirectAnswer(task: string, hasPriorTurnContext = true): boolean {
  const t = task.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  // Greetings, thanks, farewells — never benefit from vault/web.
  if (/^(?:hi|hello|hey|yo|sup|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you|bye|goodbye|cool|ok|okay|got\s+it|nice|sweet|sounds\s+good)\b[\s!,.?]*$/i.test(lower)) return true;
  // Arithmetic-only (with or without "what is" prefix).
  if (/^[\d\s+\-*/().,]+\??$/.test(lower) && /\d/.test(lower)) return true;
  if (/^\s*what(?:'?s|\s+is)\s+[\d\s+\-*/().,]+\??$/i.test(lower)) return true;
  // Single-word affirmations / non-questions. Only trivial when we have
  // prior-turn context for them to answer to.
  if (/^\s*(?:yes|yeah|yep|sure|fine|no|nope|nah|maybe|idk)[\s!.?]*$/i.test(lower)) {
    return hasPriorTurnContext;
  }
  return false;
}

// Detect whether the enriched task carries prior-turn context. Used by
// the affirmation branch of isTriviallyDirectAnswer to distinguish
// "yes" answering a question we asked from "yes" arriving cold.
function taskHasPriorTurnContext(fullTask: string): boolean {
  // The thread-context wrapper inserted by chat.ts/templates.ts looks
  // like "Current request (after prior turns about X): <bare ask>".
  return /Current request \([^)]*\):/i.test(fullTask);
}

// Ask the smallest available model "does this need tools, or can you answer
// directly from world knowledge?". Returns true → direct, false → plan.
async function llmTriage(task: string): Promise<boolean> {
  const sys = `Classify whether the user's task can be answered DIRECTLY from world knowledge alone, or whether it needs tools (vault search, GitHub, web, file system).

Reply with exactly one word: DIRECT or TOOLS.

DIRECT examples: small talk, definitions, general knowledge, simple math, programming concepts, advice, reasoning puzzles.
TOOLS examples: anything mentioning "my vault/notes/brain", repo names, file paths, URLs, "what's in X", "summarize X", "find X", "scrape X".`;
  try {
    // The classifier returns a single word — 16 tokens is generous. Tight
    // num_predict means the small triage model stops generating as soon as
    // it's emitted DIRECT or TOOLS, shaving 1-3s off this call on local
    // Ollama compared to the default 1024-token budget.
    const out = await ollamaGenerate(`Task: ${task}\n\nClassification:`, sys, { profile: "triage", maxTokens: 16 });
    return /\bDIRECT\b/i.test(out.trim().slice(0, 30));
  } catch { return false; }
}

export async function planAndExecute(
  task: string,
  push: (msg: string) => void,
  onProgress?: (patch: Partial<AgentResult> & { phase?: string }) => void,
  opts: { personaSystemSuffix?: string; autoReview?: boolean; preplan?: Plan } = {},
): Promise<AgentResult> {
  // CRITICAL: every heuristic below MUST run against the bare user text, not
  // the enriched task (which is prefixed with persona framing + thread
  // context + interpretation/deliverable blocks). Otherwise:
  //   • looksLikeDirectAnswer fails the `^\s*<verb>` check
  //   • heuristicPlan fails the URL/path/topic regex anchors
  //   • extractTopic returns the persona framing as the "topic"
  //   • defaultVaultPlan passes that garbage as the research query
  // This bug produced 5-minute fallbacks on requests that should have
  // matched the URL-only heuristic in milliseconds (e.g. "fetch http://...").
  // We compute bareTask once and thread it through every heuristic.
  const bareTask = parseUserRequestFromTask(task);
  const fromTemplate = taskWasTemplated(task);

  // Pre-planned execution. Custom templates ship with a saved plan that was
  // verified the first time it ran via the agent. When the caller supplies
  // `opts.preplan`, skip all triage / heuristic / LLM planning and jump
  // straight to executing that plan + synthesising an answer. Without this
  // path, saved-plan customs returned raw {plan, runs, ...} JSON with no
  // `answer` field — the customer saw machine output instead of a written
  // reply.
  if (opts.preplan && opts.preplan.steps.length > 0) {
    push(`Replaying a saved plan — ${opts.preplan.steps.length} step${opts.preplan.steps.length === 1 ? "" : "s"}.`);
    const p: Plan = opts.preplan;
    onProgress?.({ plan: p, phase: "executing" });
    const runsBuffer: StepRun[] = [];
    const { runs, hadWrites } = await executePlan(p, push, (rs) => {
      runsBuffer.splice(0, runsBuffer.length, ...rs);
      onProgress?.({ runs: [...rs] });
    });
    onProgress?.({ phase: "synthesizing", runs });
    const synth = await synthesize(task, p, runs, opts.personaSystemSuffix, (partial) => {
      onProgress?.({ partialAnswer: partial });
    }, { push });
    return { task, plan: p, runs, answer: synth.answer, hadWrites };
  }

  // Triage first — the cheapest possible path is skipping the planner entirely
  // for prompts that don't need tools. Total round-trip drops from ~3min to
  // ~10-20s for trivial tasks.
  //
  // SPEED OPTIMISATION: triage LLM call + vault pre-check run in parallel.
  // The LLM triage costs ~1-3s; vault search costs ~10-50ms. Running them
  // sequentially wasted the vault budget. Now they overlap and the result
  // is combined: if EITHER (a) triage said DIRECT AND (b) vault has no
  // hits, we take the direct-answer path. Otherwise plan.
  //
  // EXCEPTION: when the task came in via a chat template (Topic: suffix),
  // the customer explicitly asked for that template's behavior — Quick web
  // look-up wants the web, Multi-perspective wants the fan-out. We must NOT
  // shortcut to a direct LLM answer in that case even when the topic itself
  // looks like a definition question.
  if (!fromTemplate && TRIAGE_ENABLED && bareTask.length > 0 && bareTask.length <= TRIAGE_MAX_CHARS) {
    const heuristicDirect = looksLikeDirectAnswer(bareTask);
    const topic = extractTopic(bareTask);
    // Vault pre-check uses the filename-only scan: we only need a yes/no
    // signal "does the user have notes on this topic?" and the full content
    // search takes 10-15s on a multi-thousand-note vault. Filename scan
    // returns in ~50-200ms. The content search still runs later inside the
    // research primitives when we actually need real matches.
    const [llmDirect, vaultHits] = await Promise.all([
      heuristicDirect ? Promise.resolve(true) : llmTriage(bareTask).catch(() => false),
      (topic && topic.length >= 2)
        ? Promise.resolve().then(() => { try { return searchVaultFilenames(topic, 1); } catch { return []; } })
        : Promise.resolve([] as { path: string; line: number; preview: string }[]),
    ]);
    let direct = llmDirect;
    // Vault override: if filename scan hit AND the topic is non-trivial,
    // we'd rather use the user's own notes than world knowledge. Trivial
    // inputs (greetings, arithmetic) bypass this — "hi" matching a note
    // called "hi-everyone.md" shouldn't promote a greeting to vault search.
    //
    // EXCLUDE agent-internal job tracker files (_neuroworks/jobs/*) —
    // those are scratch records of past runs ("Research: who is X"),
    // not real user knowledge. Without this filter, the second run of
    // any query routes itself to research.deep because the FIRST run's
    // job-tracker file matched the topic name. Round-2 harness hit this
    // for "who is dario amodei" — the bare entity query stayed in
    // research mode (which couldn't find him) instead of falling through
    // to direct-answer / world knowledge.
    const realVaultHits = vaultHits.filter(h => !/^_neuroworks\/jobs\//i.test(h.path));
    const priorContext = taskHasPriorTurnContext(task);
    if (direct && realVaultHits.length > 0 && !isTriviallyDirectAnswer(bareTask, priorContext) && topic && topic.length >= 3) {
      push(`Tier 2 — your second brain: found ${realVaultHits.length} note${realVaultHits.length === 1 ? "" : "s"} on "${topic}". Pulling those in instead of going to general knowledge.`);
      direct = false;
    }
    // CONTEXT CASCADE: even when triage thinks "direct answer is fine", we
    // still defer to heuristicPlan if it recognises a shape that includes
    // tools. The cascade we want is:
    //   1. chat input (already in `task` via buildEnrichedTask)
    //   2. vault (heuristicPlan's vault/research.deep paths)
    //   3. web (research.deep / web.search)
    //   4. world knowledge (this direct-answer path) — final fallback only
    // For "what is hanta virus" with empty vault, that means research.deep
    // (vault + web) runs BEFORE we settle for the model's training data.
    // World knowledge only kicks in when no heuristic shape matches AND
    // the question is conversational / definitional with no topic worth
    // researching.
    //
    // EXCEPTION: truly trivial inputs (greetings, arithmetic, "yes"/"no")
    // never benefit from vault or web — bypass the cascade and answer
    // directly. Without this guard, "what is 2+2" would needlessly route
    // to research.deep.
    if (direct && !isTriviallyDirectAnswer(bareTask, priorContext)) {
      const speculativeHeuristic = heuristicPlan(bareTask);
      const wantsResearch = speculativeHeuristic && speculativeHeuristic.steps.length > 0
        && speculativeHeuristic.steps.some(s => s.tool === "research.deep" || s.tool === "web.search" || s.tool === "vault.search");
      // Short-definitional override: when the query is a definitional
      // explainer shape (looksLikeDirectAnswer already returned true) AND
      // the bare task is short (≤ 80 chars) AND the vault filename scan
      // surfaced no real hits, the model's training knowledge is the
      // right tier. Routing through research.deep on free-tier OR often
      // returns thin/irrelevant evidence and the small synth model then
      // refuses despite Rule 0 — the TCP-vs-UDP regression hit this
      // path. We trust direct-answer + POLISHED_DIRECT's anti-
      // hallucination guard for short questions about likely-known
      // concepts; longer / vault-rooted queries still route through
      // research.
      const isShortDefinitional = bareTask.length <= 80;
      if (wantsResearch && !isShortDefinitional) {
        push(`Tier 2/3 — checking your second brain first, then the web if needed (instead of guessing from general knowledge).`);
        direct = false;
      } else if (wantsResearch && isShortDefinitional) {
        push(`Tier 4 — short definitional question with no relevant vault notes; answering from training knowledge.`);
      }
    }
    if (direct) {
      // Tier 4 — final fallback. World knowledge only. We ALSO race a
      // capped vault content search in parallel: if the second brain
      // actually has matter on this topic by the time the LLM finishes,
      // we'll have grounded the answer; if not, we use world knowledge
      // cleanly. 1.5s cap so a big vault never blocks a trivial answer.
      push(`Tier 4 — general knowledge. (Your second brain has no notes on this; no web search needed for the shape.)`);
      onProgress?.({ phase: "synthesizing" });
      const vaultContentRace: Promise<{ path: string; line: number; preview: string }[]> = (topic && topic.length >= 2)
        ? Promise.race([
            new Promise<any[]>((resolve) => {
              // Lazy-import the slow content scan only when we actually need
              // it — keeps the hot-path triage scan fast.
              import("./vault.js").then(({ searchVault }) => {
                try { resolve(searchVault(topic, 3)); } catch { resolve([]); }
              }).catch(() => resolve([]));
            }),
            new Promise<any[]>(resolve => setTimeout(() => resolve([]), 1500)),
          ])
        : Promise.resolve([]);
      // Trivial inputs (greetings, arithmetic, single-word affirmations
      // with prior context) get the TIGHT prompt + 96-token cap so we
      // don't burn 40s generating a LaTeX essay for "2+2". Non-trivial
      // direct answers (explainers, definitions with no vault hit) keep
      // the POLISHED_DIRECT framing and the larger 384-token budget.
      const isTrivial = isTriviallyDirectAnswer(bareTask, taskHasPriorTurnContext(task));
      const directPrompt = isTrivial ? TRIVIAL_DIRECT : POLISHED_DIRECT;
      const directMaxTokens = isTrivial ? 96 : 384;
      const sys = (opts.personaSystemSuffix ? opts.personaSystemSuffix + "\n\n" : "") + directPrompt;
      try {
        // SPEED: direct-answer prose is short. We route through the
        // TRIAGE profile by default, which picks the user's
        // smallest/fastest model — qwen3.5:0.8b on this machine —
        // instead of the larger synthesis-tier model. Measured drop:
        // ~67s → ~15-25s on local Ollama. Customer can opt out with
        // CLAWBOT_FAST_DIRECT_ANSWER=0 when they'd rather have the
        // larger model's prose quality. Token budgets:
        //   trivial → 96 (one sentence is plenty)
        //   non-trivial → 384 (40-180 words of professional prose)
        const useFastDirect = process.env.CLAWBOT_FAST_DIRECT_ANSWER !== "0";
        // Inner helper so we can re-issue with a different backend when the
        // first attempt hits OR 429 / transport hiccup. Keeps the late-vault
        // race + return shape identical between primary and retry paths.
        async function runDirect(profile: "triage" | "synthesis" | undefined) {
          const [meta, lateVaultHits] = await Promise.all([
            ollamaGenerateWithMeta(task, sys, {
              profile,
              maxTokens: directMaxTokens,
              onToken: (_chunk, accumulated) => onProgress?.({ partialAnswer: accumulated }),
            }),
            vaultContentRace,
          ]);
          return { meta, lateVaultHits };
        }
        let attempt;
        try {
          attempt = await runDirect(useFastDirect ? "triage" : "synthesis");
        } catch (e: any) {
          // OR free-tier 429 / transport hiccup is the common failure here
          // because triage routes to OR when OPENROUTER_TRIAGE_MODEL is
          // pinned. Retry once with profile=undefined which forces local
          // Ollama (shouldRouteToOpenRouter returns false when profile is
          // missing) — slower (~15-25s) but always available. If THAT also
          // fails we have no LLM and fall through to the planner.
          const msg = String(e?.message ?? e);
          const transientLLM = /429|rate[\s-]?limit|fetch\s+failed|terminated|ECONNRESET|HTTP\s+5\d\d|other\s+side\s+closed/i.test(msg);
          if (!transientLLM) throw e;
          push(`Direct answer hit a remote hiccup (${msg.slice(0, 80)}) — retrying once on local Ollama.`);
          attempt = await runDirect(undefined);
        }
        // If the late vault search found something AFTER the model already
        // answered (which usually means the answer is world-knowledge-only),
        // flag it for the customer so they know there's vault context they
        // could promote next time.
        if (attempt.lateVaultHits.length > 0) {
          push(`Note: your second brain has ${attempt.lateVaultHits.length} note${attempt.lateVaultHits.length === 1 ? "" : "s"} that mention this topic (e.g. ${attempt.lateVaultHits[0].path}) — re-ask if you want me to use those instead of general knowledge.`);
        }
        const direct: Plan = { steps: [], summary: "Direct answer (general knowledge — no vault notes, no web search).", waves: [] };
        return { task, plan: direct, runs: [], answer: attempt.meta.text.trim(), hadWrites: false };
      } catch (e: any) {
        push(`Direct answer didn't land cleanly (${String(e?.message ?? e).slice(0, 80)}) — switching to the planner.`);
        // fall through
      }
    }
  }

  // Heuristic planner shortcut. Common task shapes ("tell me about X",
  // "open <path>", "scrape <url>") have one obvious tool — we skip the LLM
  // planner entirely for those and save 3-8s. Only falls back to the LLM
  // planner when the shape isn't recognised.
  //
  // bareTask (computed at top) strips persona framing so URL / path / verb
  // anchors match from line-start.
  onProgress?.({ phase: "planning" });
  let p = heuristicPlan(bareTask) ?? { steps: [], summary: undefined, waves: [] };
  if (p.steps.length > 0) {
    // Customer-facing context-tier badge based on what the plan touches.
    // Helps the customer see "this answer drew on your vault" vs "this
    // pulled from the web" vs "this just used a single tool" at a glance.
    const tools = new Set(p.steps.map(s => s.tool));
    const hitsVault = ["vault.search", "vault.read", "vault.scan_docs"].some(t => tools.has(t));
    const hitsWeb = ["research.deep", "research.multiperspective", "web.search", "web.fetch", "web.scrape", "web.firecrawl"].some(t => tools.has(t));
    const hitsLocal = ["fs.find_in", "fs.read_external", "fs.list_external"].some(t => tools.has(t));
    let tier = "Tier 1 — chat context";
    if (hitsVault && hitsWeb) tier = "Tier 2+3 — your second brain + the web";
    else if (hitsVault) tier = "Tier 2 — your second brain";
    else if (hitsWeb) tier = "Tier 3 — the web";
    else if (hitsLocal) tier = "Tier 2 — your local files";
    else tier = "Direct tool use";
    push(`Recognised the shape — ${tier}, ${p.steps.length} step${p.steps.length === 1 ? "" : "s"}.`);
  } else {
    push(`Thinking about the best approach…`);
    p = await plan(task, opts.personaSystemSuffix, push);
  }
  if (p.steps.length === 0) {
    // Vault-first fallback uses bareTask so extractTopic doesn't fold the
    // persona prefix into the research query (root cause of the 5-minute
    // research.deep run measured in the wild). This IS the default cascade:
    // vault search inside research.deep, then web if the vault is thin.
    push(`Couldn't draft a tight plan in time — falling back to the standard cascade: your second brain first, then the web.`);
    p = defaultVaultPlan(bareTask);
  }
  push(`Plan ready: ${p.steps.length} step${p.steps.length === 1 ? "" : "s"}${p.summary ? ` — ${p.summary}` : ""}.`);
  onProgress?.({ phase: "executing", plan: p, runs: [] });

  const { runs, hadWrites, budgets, subagentTimings } = await executePlan(p, push, (runs) => onProgress?.({ runs: [...runs] }));
  if (budgets) onProgress?.({ budgets, subagentTimings });

  // Synthesize a chat-friendly answer from the step results. Stream tokens as
  // they arrive into job.result.partialAnswer so the UI can render the answer
  // materialising in real time instead of waiting for the full generation.
  onProgress?.({ phase: "synthesizing", runs });
  const synth = await synthesize(task, p, runs, opts.personaSystemSuffix, (partial) => {
    onProgress?.({ partialAnswer: partial });
  }, { push });

  // Post-flight QA. Split into two phases so the happy path doesn't pay for
  // peer.review (the slowest QA call, 30-90s):
  //   Phase A — quality.check + security.scan (fast, parallel)
  //   Phase B — peer.review, ONLY when phase-A says the draft needs help
  //
  // Both phases land as real plan steps so the AgentVisualizer shows them
  // live next to the user's other sub-agents.
  // Skip the QA wave when the plan produced ZERO real successes. The synth
  // in that case is a fallback rescue summary ("we tried X, it failed
  // because Y") — there's no real content to quality-check, no citations
  // to verify, and running peer.review on an apology wastes 60-90s on a
  // task that already failed once. Detected via runs.every(!ok).
  const allWorkFailed = runs.length > 0 && runs.every(r => !r.ok);
  const wantQA = (opts.autoReview ?? AUTO_REVIEW) && synth.answer.length >= MIN_REVIEW_CHARS && !allWorkFailed;
  // Use bareTask length here too — enriched task is always > 30 chars due to
  // the persona prefix, which neutered this QA-skip optimisation entirely.
  const trivialTask = bareTask.trim().length < 30;
  // Definitional explainers: "explain X" / "what is X" / "who is X" /
  // "tell me about X" / "describe X" / "how does X work". When the plan
  // is a SINGLE research.* step (no compare, no multi-source) the QA wave
  // costs 60-90s for marginal value — research.deep already grounds against
  // vault+web, and there's no compound claim to peer-review. Trades a tiny
  // accuracy risk for substantial latency on every "explain X" query.
  const looksDefinitionalExplainer =
    /^(?:what(?:'?s|\s+is|\s+are|\s+does|\s+do)|who(?:'?s|\s+is|\s+are|\s+was)|tell\s+me\s+about|explain|describe|how\s+(?:do|does|can|should|would)|summari[sz]e|recap|brief\s+me\s+on|tldr)\s+/i.test(bareTask)
    && bareTask.length <= 100;
  const singleResearchStep = p.steps.length === 1 && /^research\./.test(p.steps[0].tool);
  const skipQAForExplainer = looksDefinitionalExplainer && singleResearchStep && synth.answer.length >= MIN_REVIEW_CHARS;
  if (allWorkFailed) {
    push(`Skipping quality review — every step failed, so the response is just a summary of what went wrong (nothing to grade).`);
  }
  const plannerAlreadyReviewed = p.steps.some(s => s.tool === "peer.review");
  // Build a compact evidence catalog from successful runs to feed quality.check.
  // Without this the scorer is asked to grade citation_coverage but can't
  // actually verify whether claims are sourced — it only sees the draft.
  // Passing the same numbered evidence the synth saw makes the score meaningful.
  const evidenceForQA = buildEvidenceCatalog(runs);

  if (wantQA && !trivialTask && !skipQAForExplainer) {
    onProgress?.({ phase: "reviewing", runs });
    // ---- Phase A: quality + security (parallel) ----
    const phaseASteps: PlanStep[] = [
      {
        tool: "quality.check",
        args: { task, answer: synth.answer, sources: evidenceForQA },
        rationale: "auto-injected: score factuality, citation coverage, persona fit (evidence-aware)",
        label: humanStepLabel("quality.check", {}),
      },
      {
        tool: "security.scan",
        args: { content: synth.answer, kind: "note" },
        rationale: "auto-injected: scan answer for secrets, dodgy URLs",
        label: humanStepLabel("security.scan", { kind: "note" }),
      },
    ];
    push(`Reviewing the draft — running quality and security checks in parallel.`);
    const baseIdxA = p.steps.length;
    const waveA = phaseASteps.map((_, i) => baseIdxA + i);
    p.steps.push(...phaseASteps);
    p.waves = [...(p.waves ?? p.steps.slice(0, baseIdxA).map((_, i) => [i])), waveA];
    runs.push(...phaseASteps.map(step => ({ step, ok: false, durationMs: 0 } as StepRun)));
    onProgress?.({ plan: p, runs: [...runs] });
    const planA: Plan = { steps: p.steps, summary: p.summary, waves: [waveA] };
    await executePlan(planA, push, (rs) => {
      for (const i of waveA) if (rs[i]) runs[i] = rs[i];
      onProgress?.({ runs: [...runs] });
    });

    // ---- Phase B: peer.review, only when the draft didn't clearly pass ----
    if (!plannerAlreadyReviewed) {
      const qScore = (runs.find(r => r.step.tool === "quality.check" && r.ok)?.result as any)?.score ?? 0;
      const qPass = (runs.find(r => r.step.tool === "quality.check" && r.ok)?.result as any)?.pass === true;
      const sPass = (runs.find(r => r.step.tool === "security.scan" && r.ok)?.result as any)?.pass !== false;
      // GOOD bar: quality.check says pass=true AND composite score >= 0.75
      // AND security clean. Skip peer.review on confident outputs.
      const cleanDraft = qPass && qScore >= 0.75 && sPass;
      if (cleanDraft) {
        push(`Quality check passed (${Math.round(qScore * 100)}%) and security is clean — peer review skipped (saves 30-90s).`);
      } else {
        const peerStep: PlanStep = {
          tool: "peer.review",
          args: { task, answer: synth.answer },
          rationale: `auto-injected: quality score=${qScore.toFixed(2)} (pass=${qPass}) — peer review for a second opinion`,
          label: humanStepLabel("peer.review", {}),
        };
        const baseIdxB = p.steps.length;
        const waveB = [baseIdxB];
        p.steps.push(peerStep);
        p.waves = [...(p.waves ?? []), waveB];
        runs.push({ step: peerStep, ok: false, durationMs: 0 });
        onProgress?.({ plan: p, runs: [...runs] });
        const planB: Plan = { steps: p.steps, summary: p.summary, waves: [waveB] };
        await executePlan(planB, push, (rs) => {
          for (const i of waveB) if (rs[i]) runs[i] = rs[i];
          onProgress?.({ runs: [...runs] });
        });
      }
    }
  } else if (wantQA && skipQAForExplainer) {
    push(`Skipping quality review — definitional explainer with a single research step (saves 60-90s; research.deep already grounds against vault + web).`);
  } else if (wantQA && trivialTask) {
    push(`Skipping quality review — short task, not worth a full QA pass.`);
  }

  // Pull the structured results out of the QA runs.
  const reviewRun = runs.find(r => r.step.tool === "peer.review" && r.ok);
  const qualityRun = runs.find(r => r.step.tool === "quality.check" && r.ok);
  const securityRun = runs.find(r => r.step.tool === "security.scan" && r.ok);
  const review = reviewRun?.result ? coerceReview(reviewRun.result) : undefined;
  let quality: any = qualityRun?.result;
  const security = securityRun?.result;

  // SKILL-ACQUISITION RESCUE (first-tier, cheap): if quality.check failed AND
  // no matching skill exists for the detected intent, the agent draft-writes
  // one and re-synthesises with it loaded. This is the "Claude makes a skill
  // when one is missing" loop — each unique struggle teaches the system a
  // new playbook that subsequent runs benefit from.
  //
  // Order matters: try this BEFORE the OR-rescue because (a) it doesn't
  // require OpenRouter, (b) a well-targeted skill is often a bigger lift
  // than swapping models, and (c) the drafted skill persists, helping the
  // next run too.
  let rescuedSynth: string | undefined;
  // Skill picker telemetry the rescue paths can overwrite — once a
  // drafted skill is used to rescue a failed synth, that skill is what
  // actually guided the FINAL answer, so the reflection should learn
  // from the rescue's pick, not the original.
  let finalSkillUsed: string | undefined = synth.skillUsed;
  let finalSkillScore: number | undefined = synth.skillScore;
  if (quality && quality.pass === false && synth.answer.length >= MIN_REVIEW_CHARS) {
    const intent = parseIntentFromTask(task);
    const bareTaskForSkill = parseUserRequestFromTask(task);
    // Combined picker score: 20+ means we had an exact intent match;
    // 15-19 means keyword-only; under 15 means no real match. We treat the
    // last two as "the matched skill (if any) is a weak fit" — draft a new
    // one rather than re-running with thin guidance.
    const topMatch = topSkillScoreForTask(bareTaskForSkill, intent);
    const matchedStrongly = topMatch !== null && topMatch.score >= 20;
    if (intent && !matchedStrongly) {
      const reason = topMatch === null
        ? `no skill targets intent "${intent}" or the task body`
        : `only weakly matched "${topMatch.skill.name}" (score ${topMatch.score}) — drafting a stronger fit`;
      push(`${reason} — drafting a new skill playbook (the system learns from this struggle)`);
      // We use intent here so the drafted skill is wired into the registry's
      // applies_to list, making subsequent tasks with the same intent find
      // it automatically.
        try {
          const { draftSkillForIntent } = await import("./skills.js");
          const firstIssue = Array.isArray(quality.issues) && quality.issues.length > 0 ? String(quality.issues[0]) : `quality score ${quality.score ?? "?"} below pass threshold`;
          const newSkill = await draftSkillForIntent({
            intent,
            taskSample: parseUserRequestFromTask(task),
            failureReason: firstIssue,
          });
          if (newSkill) {
            push(`drafted skill "${newSkill.name}" — re-running synth with the new playbook loaded`);
            try {
              const rescue = await synthesize(task, p, runs, opts.personaSystemSuffix, undefined, { push });
              if (rescue && rescue.answer.length >= MIN_REVIEW_CHARS) {
                rescuedSynth = rescue.answer;
                try {
                  const checkTool = findPrimitive("quality.check");
                  if (checkTool) {
                    const rq: any = await checkTool.handler({ task, answer: rescue.answer, sources: buildEvidenceCatalog(runs) });
                    const rs = rq?.score ?? 0;
                    const os = quality?.score ?? 0;
                    if (rs > os) {
                      push(`skill rescue improved score: ${os} → ${rs}; keeping the skill-rescued draft`);
                      quality = { ...rq, rescuedBy: "skill-acquisition", originalScore: os };
                      // Rescue's pick guided the kept answer — surface it
                      // to the reflection loop as the skill of record.
                      finalSkillUsed = rescue.skillUsed ?? finalSkillUsed;
                      finalSkillScore = rescue.skillScore ?? finalSkillScore;
                    } else {
                      push(`skill rescue produced ${rs} (not better than ${os}); falling through to OR rescue if available`);
                      rescuedSynth = undefined;
                    }
                  }
                } catch { /* tolerate re-score failure */ }
              }
            } catch (e: any) {
              push(`skill-rescue synth failed: ${String(e?.message ?? e).slice(0, 80)}`);
            }
          } else {
            push(`skill draft was unusable — falling through to OR rescue if available`);
          }
        } catch (e: any) {
          push(`skill draft failed: ${String(e?.message ?? e).slice(0, 80)}`);
        }
    }
  }

  // QUALITY RESCUE (second-tier): if quality.check failed (pass=false) AND
  // OpenRouter is configured AND we didn't already rescue via skill
  // acquisition, re-synth with the LARGE-tier model. The first attempt used
  // whatever the dispatcher picked (often local Ollama); the rescue forces
  // complexity:"high" so the dispatcher hands off to the bigger model. We
  // re-score the rescued draft and keep whichever has the better score.
  if (!rescuedSynth && config.openrouterEnabled && quality && quality.pass === false && synth.answer.length >= MIN_REVIEW_CHARS) {
    push(`quality.check failed (score=${quality.score ?? "?"}, issues: ${(quality.issues ?? []).slice(0, 2).join("; ")}) — re-synthesising with the large model`);
    try {
      const rescue = await synthesize(task, p, runs, opts.personaSystemSuffix, undefined, { forceComplex: true, push });
      if (rescue && rescue.answer.length >= MIN_REVIEW_CHARS) {
        rescuedSynth = rescue.answer;
        // Re-score the rescue draft so we know whether to keep it.
        try {
          const checkTool = findPrimitive("quality.check");
          if (checkTool) {
            const rescueQuality: any = await checkTool.handler({ task, answer: rescue.answer });
            const rescueScore = rescueQuality?.score ?? 0;
            const originalScore = quality?.score ?? 0;
            if (rescueScore > originalScore) {
              push(`quality rescue improved score: ${originalScore} → ${rescueScore}; using the rescued draft`);
              quality = { ...rescueQuality, rescued: true, originalScore };
              // Rescue's skill pick guided the kept draft — record it.
              finalSkillUsed = rescue.skillUsed ?? finalSkillUsed;
              finalSkillScore = rescue.skillScore ?? finalSkillScore;
            } else {
              push(`quality rescue produced score ${rescueScore} (not better than ${originalScore}); keeping the original`);
              rescuedSynth = undefined;
            }
          }
        } catch (e: any) {
          push(`quality re-score failed (${String(e?.message ?? e).slice(0, 80)}); keeping the rescued draft anyway`);
        }
      }
    } catch (e: any) {
      push(`quality rescue failed (${String(e?.message ?? e).slice(0, 80)}); keeping the original draft`);
    }
  }

  // Final answer precedence:
  //   1. Rescued synth (large OR model) if it scored better — that's the
  //      strongest output we have access to; favour it over a small-model
  //      peer review revision.
  //   2. Reviewer revision if reviewer flagged + provided one AND rescue
  //      didn't happen (so the small-model draft isn't surfacing untouched).
  //   3. Original synth.
  // Original is preserved on the review object for audit either way.
  const finalAnswer = rescuedSynth
    ? rescuedSynth
    : ((review && review.verdict !== "good" && review.revised_answer)
        ? review.revised_answer
        : synth.answer);

  return {
    task, plan: p, runs, answer: finalAnswer, hadWrites, review, quality, security, budgets, subagentTimings,
    skillUsed: finalSkillUsed,
    skillScore: finalSkillScore,
  };
}

function coerceReview(r: any): PeerReview {
  return {
    verdict: ["good", "needs-work", "bad"].includes(r.verdict) ? r.verdict : "needs-work",
    issues: Array.isArray(r.issues) ? r.issues : [],
    revised_answer: typeof r.revised_answer === "string" && r.revised_answer ? r.revised_answer : undefined,
    confidence: typeof r.confidence === "number" ? r.confidence : 0,
    reviewer: r.peer ?? r.reviewer,
    elapsedMs: r.elapsedMs,
  };
}

// Pulled-from-task search query: strip filler so the vault search actually
// hits the right notes. "give me a summary on neuroworks" → "neuroworks".
export function extractTopic(task: string): string {
  const stripped = task
    .replace(/^\s*(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|kindly\s+)?/i, "")
    .replace(/^(?:give\s+me\s+|tell\s+me\s+|show\s+me\s+|share\s+|provide\s+)/i, "")
    .replace(/^(?:a\s+|the\s+|an\s+)?(?:summary|overview|recap|tldr|brief|update|status|rundown)\s+(?:on|of|about|for|regarding)\s+/i, "")
    .replace(/^(?:summari[sz]e|recap|brief\s+me\s+on|tell\s+me\s+about|what(?:'?s|\s+is)\s+(?:up\s+with\s+|going\s+on\s+with\s+)?|what\s+do\s+(?:we|i|you)\s+know\s+about)\s+/i, "")
    // "what my vault says about X" / "what my notes have on X" /
    // "what we know about X" / "what i have on X" tail — by this
    // point the verb prefix ("summarise", "tell me", etc.) has
    // already been stripped above, but the noisy "what (subject)
    // (verb) about/on" stem is still in the way. Strip it so the
    // captured topic is just X. Without this, "summarise what my
    // vault says about neuroworks" left "what my vault says about
    // neuroworks" as the topic, which then routed a literal web
    // search that hit Slovak-language sites matching "my".
    .replace(/^what\s+(?:my\s+(?:vault|notes?|brain|second\s+brain|knowledge|repo|repos?|files?|docs?|inbox)|the\s+(?:vault|repo|inbox)|we|i|you)\s+(?:says?|has|have|knows?|got|contain|contains|covers?|mentions?)\s+(?:about\s+|on\s+|of\s+|regarding\s+)?/i, "")
    // Drafting verbs: "draft an AIIA Reference Letter" → "AIIA Reference
    // Letter". Without this strip, the triage vault check searches for the
    // verb-prefixed phrase ("draft aiia reference letter") and gets zero
    // hits — letting the direct-answer path hallucinate the meaning of
    // proper nouns it doesn't know. Article (a/an/the/some/new) optional.
    .replace(/^(?:draft|write|compose|create|prepare|produce|generate|build|put\s+together|make)\s+(?:a\s+|an\s+|the\s+|some\s+|new\s+)?(?:short\s+|quick\s+|brief\s+|long\s+|formal\s+|professional\s+)?/i, "")
    // After the verb strips above run, a leading noise preposition often
    // remains: "tell me " (stripped) leaves "about neuroworks"; "give me
    // info " leaves "on neuroworks"; "summary on neuroworks" leaves "on
    // neuroworks" when the summary strip narrowly misses. Drop the bare
    // preposition so the topic is the actual subject.
    .replace(/^(?:about|regarding|concerning|on|of)\s+/i, "")
    .replace(/[?!.]+$/, "")
    .trim();
  return stripped || task.trim();
}

// Heuristic planner. Matches common task shapes to a single-tool plan
// without calling the LLM, eliminating 3-8s of planner latency on the most
// frequent ad-hoc tasks. Falls through (returns null) when nothing matches.
//
// Shapes covered:
//   • URL-only or "scrape/browse/open <url>" → web.scrape
//   • "tell me about X" / "explain X" / "what is X" → research.deep
//   • Bare vault-path mention ("read 2-Permanent/x.md") → vault.read
//   • "search the web for X" → research.deep
export function heuristicPlan(task: string): Plan | null {
  const t = task.trim();
  if (!t) return null;

  // Import-to-vault: "move/copy/import/save/file/add X to my vault" /
  // "save X to my knowledge" / "put X in neuroworks". Chains fs.find_in
  // (to resolve a bare filename across user folders) → fs.import_to_vault
  // (copy the binary + write a markdown sidecar so it shows up in the
  // knowledge view). MUST match before the read-only doc heuristic below,
  // because "save X to my vault" superficially looks like a read request.
  //
  // We detect the "remove original" intent from the verb: "move" with
  // "and delete" / "and remove from" implies removeOriginal=true. Bare
  // "move" stays copy-semantics — the user typically wants a backup, not
  // an evacuation.
  // Matches either:
  //   <verb> <target> (in)?to my? vault|knowledge|second brain|neuroworks|...
  //   <verb> <target> (in)?to 0-Inbox|1-Literature|1-projects|2-Permanent
  const importMatch =
    // Optional trailing modifier handles "...to my vault and delete the
    // original" / "...to neuroworks and remove from downloads". The
    // removeOriginal flag below detects that modifier on the FULL task,
    // so the regex only needs to TOLERATE the trailing phrase.
    t.match(/^\s*(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:move|copy|import|save|file|add|put|drop|stash|archive)\s+(.+?)\s+(?:(?:in)?to|into|to|in)\s+(?:my\s+|the\s+)?(?:vault|second\s+brain|knowledge(?:\s+base)?|neuroworks|obsidian|brain|inbox|0-inbox|1-literature|1-projects|2-permanent)(?:\s+(?:and\s+(?:then\s+)?|then\s+)?(?:delete|remove)\s+(?:the\s+)?(?:original|originals|source|copy|file|it)?(?:\s+from\s+\w+)?)?\s*[.?!]?\s*$/i);
  if (importMatch) {
    // Strip leading articles AND the "and delete/remove" intent suffix so the
    // captured target is just the filename. E.g. "and delete tax-return.pdf"
    // → "tax-return.pdf" (the remove flag is detected separately on the full t).
    const target = importMatch[1].trim()
      .replace(/^(?:and\s+(?:then\s+)?(?:delete|remove)\s+)/i, "")
      .replace(/^(?:then\s+(?:delete|remove)\s+)/i, "")
      .replace(/^(?:the\s+|this\s+|that\s+|a\s+|an\s+)/i, "")
      .replace(/[.?!]+$/, "")
      .trim();
    // Whole-folder imports aren't supported by fs.import_to_vault (it imports
    // one file at a time). If the user asked for a folder, fall through to
    // the planner so it can build a multi-step plan.
    const looksLikeFolder = /^(?:downloads?|desktop|documents?|docs|all\s+(?:my\s+)?(?:pdfs?|docs?|files?))$/i.test(target);
    if (!looksLikeFolder && target.length >= 2 && target.length <= 200) {
      // Heuristic for removal: explicit "move ... and delete/remove" — or
      // a literal "move ... to my vault and remove from <folder>".
      const removeOriginal = /\b(?:and\s+(?:delete|remove)|then\s+(?:delete|remove)|move\s+and\s+delete)\b/i.test(t);
      // If the target ALREADY looks like an absolute path, skip the find
      // step — go straight to import.
      const isAbsolute = /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith("/");
      if (isAbsolute) {
        return {
          steps: [
            {
              tool: "fs.import_to_vault",
              args: { path: target, vaultFolder: "0-Inbox", removeOriginal },
              rationale: "absolute-path import — copy into vault + write sidecar",
              label: humanStepLabel("fs.import_to_vault", { path: target, vaultFolder: "0-Inbox" }),
            },
          ],
          summary: `Import ${target.split(/[\\/]/).pop() ?? target} into your second brain`,
          waves: [[0]],
        };
      }
      return {
        steps: [
          {
            tool: "fs.find_in",
            args: { folder: "all", name: target, limit: 5 },
            rationale: "resolve the named file across Downloads + Desktop + Documents + Inbox before importing",
            label: humanStepLabel("fs.find_in", { folder: "all", name: target }),
          },
          {
            tool: "fs.import_to_vault",
            args: { path: "$step_0.matches.0.path", vaultFolder: "0-Inbox", removeOriginal },
            rationale: "copy the top match into the vault and write a markdown sidecar so it shows up in NeuroWorks Knowledge",
            label: humanStepLabel("fs.import_to_vault", { path: target, vaultFolder: "0-Inbox" }),
          },
        ],
        summary: `Find "${target}" on your PC and ${removeOriginal ? "move" : "copy"} it into your second brain`,
        waves: [[0], [1]],
      };
    }
  }

  // Vault path read MUST match before the local-doc heuristic below.
  // "read 0-Inbox/note.md" superficially looks like docPhraseMatch's
  // ".md path" branch, but docPhraseMatch routes to fs.find_in (which
  // sweeps Downloads/Desktop/Documents/Inbox, NOT the vault) — the file
  // would never be found. The slash-required regex prevents this from
  // catching bare filenames ("read foo.md") that genuinely need the
  // local-doc sweep.
  const vaultPathMatch = t.match(/^\s*(?:read|show(?:\s+me)?|open|cat)\s+([\w._-]+(?:[/\\][\w._-]+)+\.md)\s*$/i);
  if (vaultPathMatch) {
    const path = vaultPathMatch[1].replace(/\\/g, "/");
    return {
      steps: [{ tool: "vault.read", args: { path }, rationale: "direct vault read — slashed path resolves inside the vault", label: humanStepLabel("vault.read", { path }) }],
      summary: `Read ${path} from your vault`,
      waves: [[0]],
    };
  }

  // Vault folder listing: "list 5 notes from my vault inbox folder" /
  // "show me the files in my vault" / "list notes in inbox". Maps common
  // folder words ("inbox", "knowledge", "neuroworks", "jobs", "archive")
  // onto the real vault paths. Without this heuristic the planner falls
  // back to research.deep, which never finds folder listings — round-2
  // harness showed a refusal because research returned nothing relevant.
  const vaultFolderAliases: Record<string, string> = {
    inbox: "0-Inbox",
    "0-inbox": "0-Inbox",
    knowledge: "_knowledge",
    neuroworks: "_neuroworks",
    jobs: "_neuroworks/jobs",
    archive: "_archive",
    summaries: "_clawbot/summaries",
    clawbot: "_clawbot",
    decisions: "",
    root: "",
    vault: "",
  };
  const vaultListMatch = t.match(/^\s*(?:list|show(?:\s+me)?|what(?:'?s|\s+is|\s+are))\s+(?:\d+\s+|the\s+|all\s+|some\s+|a\s+few\s+|recent\s+|latest\s+)?(?:notes?|files?|items?|things?|entries?|docs?|markdown(?:\s+files?)?)\s+(?:in|from|under|inside)\s+(?:my\s+|the\s+|your\s+)?(?:vault(?:'s)?\s+)?(?:(?:in\s+the\s+|the\s+)?([\w/.-]+?)\s+folder|folder\s+([\w/.-]+)|([\w/.-]+?))\s*[.?!]?\s*$/i);
  if (vaultListMatch) {
    const raw = (vaultListMatch[1] ?? vaultListMatch[2] ?? vaultListMatch[3] ?? "").toLowerCase().trim().replace(/^my\s+|^the\s+|^your\s+/i, "");
    const path = raw in vaultFolderAliases ? vaultFolderAliases[raw] : raw;
    // Pull explicit count if present, so the synth knows how many to show.
    const countMatch = t.match(/\b(\d+)\s+(?:notes?|files?|items?|things?|entries?|docs?)/i);
    const limit = countMatch ? Math.min(50, Math.max(1, parseInt(countMatch[1], 10))) : undefined;
    return {
      steps: [{
        tool: "vault.list",
        args: { path },
        rationale: `list ${limit ?? "all"} entries in vault folder "${path || "<root>"}"`,
        label: humanStepLabel("vault.list", { path }),
      }],
      summary: `List entries in ${path || "vault root"}`,
      waves: [[0]],
    };
  }

  // Vault folder scan (summarise multiple docs): "summarise the docs in
  // 0-Inbox" / "what's in my knowledge folder" / "read all notes in
  // _clawbot" / "scan my inbox docs". Routes to vault.scan_docs which
  // reads MANY docs in parallel and returns extracted text. Without
  // this heuristic the LLM planner often picks research.deep which
  // misses the user's actual files.
  const vaultScanMatch = t.match(
    /^\s*(?:summari[sz]e|scan|read|skim|brief\s+me\s+on)\s+(?:all\s+)?(?:the\s+|my\s+|your\s+)?(?:docs?|documents?|notes?|files?|content|markdown(?:\s+files?)?|entries?)\s+(?:in|inside|under|from)\s+(?:my\s+|the\s+|your\s+)?(?:vault(?:'s)?\s+)?(?:([\w/.-]+?)\s+folder|folder\s+([\w/.-]+)|([\w/.-]+?))\s*[.?!]?\s*$/i,
  );
  if (vaultScanMatch) {
    const raw = (vaultScanMatch[1] ?? vaultScanMatch[2] ?? vaultScanMatch[3] ?? "").toLowerCase().trim().replace(/^my\s+|^the\s+|^your\s+/i, "");
    const folderAliases = {
      inbox: "0-Inbox", "0-inbox": "0-Inbox",
      knowledge: "_knowledge", neuroworks: "_neuroworks",
      jobs: "_neuroworks/jobs", archive: "_archive",
      summaries: "_clawbot/summaries", clawbot: "_clawbot",
    };
    const folder = (raw in folderAliases) ? folderAliases[raw] : raw;
    return {
      steps: [{
        tool: "vault.scan_docs",
        args: { folder, limit: 12 },
        rationale: "scan multiple docs in the named vault folder and return extracted text for synthesis",
        label: humanStepLabel("vault.scan_docs", { folder }),
      }],
      summary: `Scan docs in vault folder "${folder || "<root>"}"`,
      waves: [[0]],
    };
  }

  // Local-doc lookup WITHOUT a folder hint: "what's in this doc X" /
  // "summarise this pdf X" / "read this file X" / "open X.pdf". The customer
  // hasn't told us which folder — we sweep Downloads + Desktop + Documents +
  // Inbox in parallel via fs.find_in folder='all'. Catches the common shape
  // where someone refers to a doc by name without remembering where they put
  // it. Routes BEFORE the URL/research patterns so we never fall through to
  // a web search on a doc the user already has locally.
  //
  // Patterns covered:
  //   • "what(?:'?s| is| does) (?:in |inside )?this (?:doc|file|pdf|note|letter|paper|document) X"
  //   • "summari[sz]e (?:this |the )?(?:doc|file|pdf|note|letter) X"
  //   • "read (?:this |the |)?X.(?:pdf|docx|md|txt|xlsx)"
  //   • Bare "X.pdf" / "X.docx" with optional verb prefix
  const docPhraseMatch =
    t.match(/^\s*(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:what(?:'?s|\s+is|\s+does)\s+(?:in\s+|inside\s+|about\s+)?(?:this\s+|the\s+|that\s+)?(?:doc|document|file|pdf|note|letter|paper|memo|report|deck)\s+(?:called\s+|named\s+|titled\s+)?(.+?))(?:[?.!]|\s*$)/i) ??
    t.match(/^\s*(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:summari[sz]e|recap|tldr|brief\s+me\s+on|read|open|show\s+me)\s+(?:this\s+|the\s+|that\s+)?(?:doc(?:ument)?|file|pdf|note|letter|paper|memo|report|deck)\s+(?:called\s+|named\s+|titled\s+)?(.+?)\s*[?.!]?\s*$/i) ??
    t.match(/^\s*(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:summari[sz]e|recap|tldr|read|open|show\s+me)\s+(.+?\.(?:pdf|docx|md|txt|xlsx|pptx))\s*[?.!]?\s*$/i);
  if (docPhraseMatch) {
    const name = docPhraseMatch[1].trim().replace(/[.?!]+$/, "");
    // Reject pronouns / placeholders that mean the user hasn't named anything
    // ("read this doc" with no name — better to ask).
    const isPronounOnly = /^(?:it|this|that|one|something|anything)\s*$/i.test(name);
    if (!isPronounOnly && name.length >= 2 && name.length <= 200) {
      return {
        steps: [
          {
            tool: "fs.find_in",
            args: { folder: "all", name, limit: 5 },
            rationale: "local-doc lookup (no folder hint) — sweep Downloads + Desktop + Documents + Inbox",
            label: humanStepLabel("fs.find_in", { folder: "all", name }),
          },
          {
            tool: "fs.read_external",
            args: { path: "$step_0.matches.0.path" },
            rationale: "read the top match (newest first) to surface its contents",
            label: "Reading the top match",
          },
        ],
        summary: `Find and read "${name}" from your usual doc folders`,
        waves: [[0], [1]],
      };
    }
  }

  // Local-file lookup WITH an explicit folder hint: "check/look/find/search in
  // my downloads for X" / "look in my desktop for X" / "open the AIIA letter
  // in my documents" — etc.
  // Routes to fs.find_in + fs.read_external so PDFs/DOCXs run through the
  // doc-extractor cleanly. Chained via $step_0 reference so a single match
  // gets read automatically; the synth handles the "tell me what's inside"
  // suffix without needing a separate step.
  //
  // CRITICAL: matches BEFORE the URL/research patterns so the LLM planner
  // never sees this shape (the previous behaviour was a 3-minute web research
  // run for "check my downloads for AIIA Reference Letter").
  // TWO shapes supported:
  //   (A) folder-first: "find in my downloads for X" / "look in my desktop X"
  //   (B) name-first:   "find X in my downloads" / "look for X in my desktop"
  // Both extract folder + name and route through fs.find_in. (B) is the
  // natural shape most people type; (A) was the only one this heuristic
  // handled before, which left "find resume.pdf in my downloads" falling
  // through to the LLM planner → research.deep on the bare phrase.
  const localFileMatch = t.match(
    /^\s*(?:(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:check|look|find|search|browse|see|grab|open|read)\s+(?:in\s+)?)?my\s+(downloads?|desktop|documents?|docs|inbox|vault|home(?:\s+folder)?)\s+(?:folder\s+)?(?:for\s+|to\s+find\s+|to\s+see\s+|to\s+look\s+up\s+)?(.+?)(?:\s+(?:and|then|to)\s+(?:tell|show|read|summari[sz]e|explain).*)?\s*[.?!]?\s*$/i,
  ) ?? t.match(
    /^\s*(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:check|look|find|search|browse|locate|grab)\s+(?:for\s+|up\s+)?(.+?)\s+(?:in|inside|under|on)\s+(?:my\s+|the\s+|your\s+)?(downloads?|desktop|documents?|docs|inbox|vault|home(?:\s+folder)?)\s*(?:\s+(?:and|then|to)\s+(?:tell|show|read|summari[sz]e|explain).*)?\s*[.?!]?\s*$/i,
  );
  if (localFileMatch) {
    // Disambiguate which group is folder vs name. Shape (A) captures folder
    // first; shape (B) captures name first. The alternation order above
    // means shape (A) returns groups [folder, name] and shape (B) returns
    // [name, folder]. Detect by checking which group looks like a known
    // folder word.
    const KNOWN_FOLDERS = /^(?:downloads?|desktop|documents?|docs|inbox|vault|home(?:\s+folder)?)$/i;
    const g1 = localFileMatch[1] ?? "";
    const g2 = localFileMatch[2] ?? "";
    let folderRaw: string, name: string;
    if (KNOWN_FOLDERS.test(g1.trim())) {
      folderRaw = g1.toLowerCase().replace(/\s+folder/, "");
      name = g2.trim().replace(/[.?!]+$/, "");
    } else {
      folderRaw = g2.toLowerCase().replace(/\s+folder/, "");
      name = g1.trim().replace(/[.?!]+$/, "");
    }
    // Map "docs" → "documents", "home folder" → "home", strip trailing 's'
    // for downloads/documents so both forms match.
    const folder = folderRaw === "docs" ? "documents"
                 : folderRaw === "downloads" ? "downloads"
                 : folderRaw === "document" ? "documents"
                 : folderRaw === "download" ? "downloads"
                 : folderRaw;
    if (name && name.length >= 2 && name.length <= 200) {
      return {
        steps: [
          {
            tool: "fs.find_in",
            args: { folder, name, limit: 5 },
            rationale: "local-file lookup shape recognised — find matching file in user's folder",
            label: humanStepLabel("fs.find_in", { folder, name }),
          },
          {
            // Read the top match. fs.read_external routes PDF/DOCX/XLSX
            // through the doc-extractor so binary contents become readable
            // text for the synth to summarise.
            tool: "fs.read_external",
            args: { path: "$step_0.matches.0.path" },
            rationale: "read the top match (newest first) to surface its contents",
            label: "Reading the top match",
          },
        ],
        summary: `Look in your ${folder} for "${name}" and surface its contents`,
        waves: [[0], [1]],
      };
    }
  }

  // Bare URL or scrape/browse/open <url>
  const urlMatch = t.match(/^\s*(?:(?:scrape|browse|open|fetch|read)\s+)?(https?:\/\/\S+)\s*$/i);
  if (urlMatch) {
    const url = urlMatch[1];
    return {
      steps: [{ tool: "web.scrape", args: { url }, rationale: "single URL — render in Playwright", label: humanStepLabel("web.scrape", { url }) }],
      summary: `Scrape ${url}`,
      waves: [[0]],
    };
  }

  // Vault path read: "read 2-Permanent/x.md" or "show me 0-Inbox/note.md"
  const pathMatch = t.match(/^\s*(?:read|show(?:\s+me)?|open|cat)\s+([\w./_-]+\.md)\s*$/i);
  if (pathMatch) {
    const path = pathMatch[1];
    return {
      steps: [{ tool: "vault.read", args: { path }, rationale: "direct vault read", label: humanStepLabel("vault.read", { path }) }],
      summary: `Read ${path}`,
      waves: [[0]],
    };
  }

  // "search the web for X" (forces research.deep instead of just web.search,
  // because the user usually wants synthesis too)
  const webSearchMatch = t.match(/^\s*(?:search|google|look\s+up)\s+(?:the\s+)?(?:web|online|internet)\s+(?:for\s+)?(.+?)\s*$/i);
  if (webSearchMatch) {
    const query = webSearchMatch[1];
    return {
      steps: [{ tool: "research.deep", args: { query, depth: 3, capture: true }, rationale: "web research with vault capture", label: humanStepLabel("research.deep", { query }) }],
      summary: `Research: ${query}`,
      waves: [[0]],
    };
  }

  // GitHub-repo lookups: "list the open PRs in <repo>", "show me PRs/issues
  // for <repo>", "what's in <owner>/<repo>". Routes to github.read_repo
  // which returns commits + PRs + issues + README in one call. Without
  // this heuristic, the LLM planner often picks research.deep (web
  // search) which doesn't know GitHub state and answers with "no info
  // available" — graded B at best, refuses-without-trying.
  //
  // Repo name resolution:
  //   - "owner/name" → exact owner + name
  //   - bare "name"   → use config.githubOwner from env
  const ghRepoMatch = t.match(/^\s*(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:list|show(?:\s+me)?|what(?:'?s|\s+are)?)\s+(?:the\s+)?(?:open\s+|all\s+|recent\s+|current\s+)?(?:prs?|pull\s+requests?|issues?|commits?|pr|pull-requests?)\s+(?:in|for|on|of)\s+(?:the\s+)?(?:repo\s+)?([\w./-]+?)\s*[.?!]?\s*$/i);
  if (ghRepoMatch) {
    const target = ghRepoMatch[1].trim();
    let owner: string, name: string;
    if (target.includes("/")) {
      [owner, name] = target.split("/");
    } else {
      owner = config.githubOwner || "";
      name = target;
    }
    if (owner && name) {
      return {
        steps: [{
          tool: "github.read_repo",
          args: { owner, name },
          rationale: `GitHub repo lookup — pull commits, PRs, issues, README for ${owner}/${name}`,
          label: humanStepLabel("github.read_repo", { owner, name }),
        }],
        summary: `Read ${owner}/${name} from GitHub`,
        waves: [[0]],
      };
    }
  }

  // GitHub README lookups: "fetch the README of <repo> on github" /
  // "read the readme of <repo>" / "show me what <repo> does on github" /
  // "what does <repo>'s README say". Routes to github.read_repo so the
  // README + recent state come back in one call. Without this heuristic,
  // the LLM planner often picks github.get_file with path="README.md"
  // but forgets to resolve the owner from "the clawbot repo" → the
  // call fails with "no such file" because owner defaults to empty.
  const ghReadmeMatch =
    t.match(/^\s*(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:fetch|read|show(?:\s+me)?|get|grab|pull)\s+(?:the\s+)?(?:readme|read[\s-]?me)\s+(?:of\s+|for\s+|from\s+)?(?:the\s+)?([\w./-]+?)(?:\s+repo(?:sitory)?)?(?:\s+(?:on|from|in)\s+(?:github|gh))?(?:\s+and\s+.+)?\s*[.?!]?\s*$/i) ??
    t.match(/^\s*(?:please\s+|could\s+you\s+|can\s+you\s+)?(?:what\s+(?:does|is\s+in)|tell\s+me\s+about)\s+(?:the\s+)?([\w./-]+?)(?:'s)?(?:\s+repo(?:sitory)?)?\s+(?:readme|read[\s-]?me)(?:\s+(?:say|cover|describe))?(?:\s+(?:on|from)\s+(?:github|gh))?(?:\s+and\s+.+)?\s*[.?!]?\s*$/i);
  if (ghReadmeMatch) {
    const target = ghReadmeMatch[1].trim();
    let owner: string, name: string;
    if (target.includes("/")) {
      [owner, name] = target.split("/");
    } else {
      owner = config.githubOwner || "";
      name = target;
    }
    if (owner && name) {
      return {
        steps: [{
          tool: "github.read_repo",
          args: { owner, name },
          rationale: "GitHub README lookup — uses read_repo to return README + recent state",
          label: humanStepLabel("github.read_repo", { owner, name }),
        }],
        summary: `Read ${owner}/${name} from GitHub`,
        waves: [[0]],
      };
    }
  }

  // "tell me about X" / "explain X" / "what is X" / "whats X" / "describe X" —
  // these are research/explainer prompts. We use research.deep so vault is
  // checked first, web only if vault is thin. (Apostrophe in "what's" is
  // optional — users frequently type "whats".)
  //
  // SPEED: short definition queries (≤ 40 chars after the verb) drop to
  // depth=2 and capture=false. Quick look-ups don't need three web fetches
  // plus a vault commit — that's where the "5 minutes for 'whats the hanta
  // virus'" came from. Longer / open-ended explanations keep depth=3 and
  // still capture, because they tend to be non-trivial research notes.
  const aboutMatch = t.match(/^\s*(?:tell\s+me\s+about|explain|what(?:'?s|\s+is|\s+are|\s+does)|describe|how\s+does|how\s+do|summari[sz]e|recap|brief\s+me\s+on|tldr)\s+(.+?)[?.!]?\s*$/i);
  if (aboutMatch && aboutMatch[1].length >= 2 && aboutMatch[1].length <= 80) {
    const query = aboutMatch[1].trim();
    const isQuickLookup = query.length <= 40;
    const depth = isQuickLookup ? 2 : 3;
    const capture = !isQuickLookup;
    return {
      steps: [{
        tool: "research.deep",
        args: { query, depth, capture },
        rationale: isQuickLookup
          ? "short definition lookup — 2 sources, no vault capture (keeps the second brain tidy)"
          : "explainer — vault + web research",
        label: humanStepLabel("research.deep", { query }),
      }],
      summary: `Research: ${query}`,
      waves: [[0]],
    };
  }

  // Multi-perspective trigger phrases — when the task name-drops
  // "perspectives", "compare", "side by side", "pros and cons", "investigate"
  // / "analyse" we skip the planner LLM and go straight to the right tool.
  // Was: the planner usually picks research.multiperspective for these but
  // pays a 30-90s LLM call to decide; this saves that.
  const multiPerspMatch = t.match(/\b(?:multi[\s-]?perspective|from\s+(?:different\s+|multiple\s+)?perspectives|pros?\s+and\s+cons?|investigate|analy[sz]e|compare\s+.+?\s+(?:and|vs\.?|versus)\s+.+|side[\s-]?by[\s-]?side)\b/i);
  if (multiPerspMatch && t.length < 600) {
    // Pull a topic from the task — strip filler verbs but keep the body.
    const topic = t
      .replace(/^\s*(?:use\s+(?:research\.multiperspective|multi[\s-]?perspective)[^:]*?(?::|to|on|of|for|about)\s*)/i, "")
      .replace(/^\s*(?:investigate|analy[sz]e|explore|look\s+into|examine|compare)\s+/i, "")
      .replace(/\s+from\s+(?:multiple|different)\s+perspectives.*$/i, "")
      .trim()
      .slice(0, 200);
    if (topic.length >= 3) {
      return {
        steps: [{ tool: "research.multiperspective", args: { topic, perspectives: "mainstream, critical, practitioner, recent", sourcesPerPerspective: 5, capture: true }, rationale: "multi-perspective shape recognised — skipping planner LLM", label: humanStepLabel("research.multiperspective", { topic }) }],
        summary: `Multi-perspective: ${topic}`,
        waves: [[0]],
      };
    }
  }

  // Research-signal heuristic. When the task TEXT contains strong cues
  // that the customer expects fresh external sources ("look up X",
  // "research Y", "as of 2026", "industry benchmark", "according to a
  // recent report"), force a research.deep step BEFORE the LLM planner
  // gets a chance to short-circuit to a memory-only ollama.generate.
  //
  // Why this exists: rs1 harness showed 1/6 above B- because the LLM
  // planner kept answering long persona tasks ("I have a discovery call
  // Friday — research Anthropic's pricing as of 2026, then prep MEDDIC")
  // from training memory. The planner-side hint we added in plan()
  // wasn't enough — the LLM still chose the cheaper path.
  //
  // Bypass conditions:
  //   • detectResearchSignals fires (look-up verbs, recency markers,
  //     benchmark / industry-typical asks, named research firms, etc.)
  //   • Task is non-trivial (>= 60 chars) — short asks already get
  //     caught by aboutMatch / webSearchMatch above.
  //   • No URL in the task (URLs go to web.scrape via the earlier
  //     heuristic).
  const researchTrigger = detectResearchSignals(t);
  if (researchTrigger && t.length >= 60 && !/https?:\/\/\S+/.test(t)) {
    // Extract a focused research query. Try in order:
    //   1. "look up X" / "research X" / "investigate X" anywhere in body
    //   2. "benchmarks for X" / "the current state of X"
    //   3. Fall back to extractTopic over the whole task
    let query: string | undefined;
    const lookupMatch = t.match(/\b(?:look\s+up|research|investigate|dig\s+into|look\s+into|find\s+out\s+(?:about|what|how))\s+(?:the\s+|a\s+|an\s+|some\s+|how\s+|what\s+|whether\s+)?(.{8,140}?)(?:[.,;:!?\n]|\s+then\b|\s+and\s+(?:then\s+)?(?:prep|draft|write|build|create|compose)\b|$)/i);
    if (lookupMatch) query = lookupMatch[1].trim();
    if (!query) {
      const benchmarkMatch = t.match(/\b(?:benchmarks?|industry[- ]?(?:standard|typical|average|median)|current\s+(?:state|landscape|consensus|best\s+practices?))\s+(?:for|of|on|about|in)\s+(.{6,120}?)(?:[.,;:!?\n]|$)/i);
      if (benchmarkMatch) query = benchmarkMatch[1].trim();
    }
    if (!query) {
      // Final fallback: just compress the first 140 chars of the task as
      // the search query. Imperfect but keeps the heuristic robust.
      query = extractTopic(t).slice(0, 140);
    }
    // Strip persona-prefix wrappers that might've slipped in via enriched
    // task (research.deep's query is user-facing in the captured note —
    // we want it clean, not "You are Drew operating as ...").
    query = query
      .replace(/^[\s.,;:()]+|[\s.,;:()]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .slice(0, 140);
    if (query.length >= 6) {
      return {
        steps: [{
          tool: "research.deep",
          args: { query, depth: 3, capture: true },
          rationale: `research signal detected ("${researchTrigger}") — fetching external sources before synth so the persona answer is grounded, not memory-only`,
          label: humanStepLabel("research.deep", { query }),
        }],
        summary: `Research: ${query}`,
        waves: [[0]],
      };
    }
  }

  // "draft / write / compose / create a [doc type] for/about X" — grounded
  // synthesis. Was previously a bare ollama.generate which let the model
  // fabricate meanings for proper nouns / acronyms (e.g. "draft an AIIA
  // Reference Letter" → hallucinated "Association of International Investors").
  // Now we preflight: vault.search (the user's second brain) AND fs.find_in
  // (Downloads + Desktop + Documents + Inbox) in parallel. The synth then
  // has REAL evidence — prior notes on the topic, prior versions of the
  // document on the PC — and the anti-hallucination rules in POLISHED_SYNTH
  // kick in when both searches return empty (model must ask, not invent).
  const draftMatch = t.match(/^\s*(?:draft|write|compose|create|prepare|produce|generate|build|put\s+together|make)\s+(?:a\s+|an\s+|the\s+|some\s+|new\s+)?(?:short\s+|quick\s+|brief\s+|long\s+|formal\s+|professional\s+)?(.+?)\s*$/i);
  if (draftMatch && draftMatch[1].length >= 3 && draftMatch[1].length <= 200) {
    const body = draftMatch[1].trim();
    // Search topic: strip generic doc-type suffix so we hunt the SUBJECT,
    // not the type. "an AIIA Reference Letter" → search for "AIIA Reference",
    // which finds your existing vault notes about AIIA AND any AIIA-named
    // file in Downloads. Keep the full body for the synth so it knows the
    // deliverable shape (reference letter, memo, brief, etc.).
    const searchTopic = body
      .replace(/\s+(?:letter|email|memo|report|brief|proposal|plan|note|doc|document|update|summary|spec|prd|adr|deck|pitch|post)$/i, "")
      .trim() || body;
    return {
      steps: [
        {
          tool: "vault.search",
          args: { query: searchTopic },
          rationale: "ground the draft in any prior context in the user's second brain — avoid fabricating meaning for unfamiliar terms",
          label: humanStepLabel("vault.search", { query: searchTopic }),
        },
        {
          tool: "fs.find_in",
          args: { folder: "all", name: searchTopic, limit: 3 },
          rationale: "check the user's PC (Downloads + Desktop + Documents + Inbox) for prior versions of this doc — runs in parallel with the vault search",
          label: humanStepLabel("fs.find_in", { folder: "all", name: searchTopic }),
        },
      ],
      summary: `Find context for "${body.slice(0, 80)}" then draft it`,
      // Both searches run in the same wave — they're independent.
      waves: [[0, 1]],
    };
  }

  return null;
}

function defaultVaultPlan(task: string): Plan {
  // Last-line-of-defense URL detection — if the bare task is "fetch <url>"
  // or just a URL, route to web.scrape instead of pushing the URL through
  // research.deep as a search query (which would search for the URL string,
  // not fetch it, wasting minutes for zero value). The SSRF gate inside
  // web.scrape will reject dangerous targets in milliseconds.
  const urlMatch = task.trim().match(/^\s*(?:(?:scrape|browse|open|fetch|read|visit|get)\s+)?(https?:\/\/\S+)\s*$/i);
  if (urlMatch) {
    const url = urlMatch[1];
    return {
      steps: [{
        tool: "web.scrape",
        args: { url },
        rationale: "default fallback: bare URL request — scrape directly instead of researching the URL string",
        label: humanStepLabel("web.scrape", { url }),
      }],
      summary: `Scrape ${url}`,
      waves: [[0]],
    };
  }
  const topic = extractTopic(task);
  const steps: PlanStep[] = [
    {
      tool: "research.deep",
      args: { query: topic, depth: 3, capture: true },
      rationale: "default fallback: search vault + web, synthesise, capture findings to 0-Inbox/",
      label: humanStepLabel("research.deep", { query: topic }),
    },
  ];
  return { steps, summary: `Default research plan for: ${topic}`, waves: [[0]] };
}

// SynthResult bundles the synth body with the picker telemetry the
// reflection loop wants to learn from. answer is the same string the
// previous string-returning shape produced; skillUsed/skillScore are
// undefined when no skill matched. Callers that only need the text can
// destructure { answer }.
type SynthResult = {
  answer: string;
  skillUsed?: string;
  skillScore?: number;
};

async function synthesize(
  task: string,
  p: Plan,
  runs: StepRun[],
  personaSystemSuffix?: string,
  onPartial?: (partial: string) => void,
  opts: { forceComplex?: boolean; push?: (msg: string) => void } = {},
): Promise<SynthResult> {
  const succeeded = runs.filter(r => r.ok);
  const failed = runs.filter(r => !r.ok);
  if (succeeded.length === 0) {
    return { answer: humanizeAllFail(task, failed) };
  }

  // Passthrough: when a single primitive (e.g. research.deep, peer.delegate)
  // already returned a complete answer, skip the synthesis LLM call entirely.
  // Saves 30-60s on the most common ad-hoc shape — the primitive did the work,
  // re-LLMing it would just paraphrase what we already have.
  //
  // EXCEPTION: when an active persona is set AND the customer's task is
  // long-form (>= 200 chars — implying a persona-specific deliverable like
  // MEDDIC notes / fact-check verdict / competitive brief), DON'T pass
  // through. We need to reshape the research result into the persona's
  // signature output format. Without this carve-out, the rs1 harness saw
  // raw research notes returned instead of MEDDIC / brief / verdict shapes,
  // and the graders dinged the shape even though the citations were there.
  const taskIsLongForm = task.length >= 200;
  const hasPersona = !!personaSystemSuffix && personaSystemSuffix.trim().length > 50;
  const skipPassthroughForPersona = hasPersona && taskIsLongForm;
  if (!skipPassthroughForPersona && (succeeded.length === 1 || (succeeded.length > 0 && hasOnlyOneSemanticStep(succeeded)))) {
    const candidate = succeeded[0]?.result;
    if (candidate && typeof candidate === "object" && typeof candidate.answer === "string" && candidate.answer.trim().length >= 60) {
      onPartial?.(candidate.answer.trim());
      return { answer: candidate.answer.trim() };
    }
  }

  // Build a numbered evidence catalog the LLM can cite as [N]. Sources come
  // straight from each step's result so the model has a concrete anchor for
  // citation_coverage to score well on.
  const evidence: { ref: number; tool: string; from: string; body: string }[] = [];
  for (let i = 0; i < succeeded.length; i++) {
    const r = succeeded[i];
    const compact = compactResult(r.result);
    const body = typeof compact === "string" ? compact : JSON.stringify(compact, null, 2);
    evidence.push({
      ref: i + 1,
      tool: r.step.tool,
      from: describeStepProvenance(r),
      body: body.slice(0, 4000),
    });
  }

  // POLISHED_SYNTH body lives in agent-prompts.ts. The persona's
  // systemPromptOverride (when set) prefaces it; the matched skill
  // playbook gets appended below.
  // Auto-attach a skill playbook for this task. Picker uses TWO signals:
  //   1. The intent label stamped on the enriched task ("Interpretation:
  //      intent=draft-email, ..."). Highest weight when present.
  //   2. Doc-type keywords in the bare user text (e.g. "PRD", "ADR",
  //      "post-mortem", "1:1"). Catches the case where the intent classifier
  //      missed but the user literally named the deliverable.
  // Both signals score together; the skill with the highest composite score
  // wins. When nothing matches, the synth runs without skill guidance.
  let skillBlock = "";
  let pickedSkill: string | undefined;
  let pickedSkillScore: number | undefined;
  try {
    const intent = parseIntentFromTask(task);
    const bareTaskForSkill = parseUserRequestFromTask(task);
    // Use topSkillScoreForTask so we get the composite score for the
    // feedback loop, then re-fetch the body via suggestSkillsForTask only
    // when we have a hit. Two lookups but both are O(skills) and cheap.
    const top = topSkillScoreForTask(bareTaskForSkill, intent);
    if (top) {
      const skills = suggestSkillsForTask(bareTaskForSkill, intent, 1);
      if (skills.length > 0) {
        const s = skills[0];
        pickedSkill = s.name;
        pickedSkillScore = top.score;
        // Cap the skill body so a verbose playbook doesn't blow the synth's
        // context budget. 3000 chars ~ 750 tokens — enough for any of our
        // built-in skills, which are all under that.
        skillBlock = `\n\n--- Skill playbook: ${s.name} ---\n${s.body.slice(0, 3000)}\n--- end playbook ---`;
      }
    }
  } catch { /* skill lookup failure shouldn't block synthesis */ }
  const sys = (personaSystemSuffix ? personaSystemSuffix + "\n\n" : "") + POLISHED_SYNTH + skillBlock;
  const prompt = `Task: ${task}\n\nNumbered evidence:\n${evidence.map(e => `[${e.ref}] (${e.tool} — ${e.from})\n${e.body}`).join("\n\n")}\n\nWrite the report:`;

  // Stream tokens as they arrive so the UI can show the answer materialising.
  // Empty/very-short outputs (LLM returned blank, "ok", or a single sentence)
  // get the fallback treatment too — a blank chat reply is the worst possible
  // experience after waiting through plan + execute.
  //
  // Synthesis with ≥4 evidence sources OR ≥6k chars of total evidence is
  // "complex" — the dispatcher will hand off to the large-tier OR model
  // when available so the answer isn't gimped by a small model trying to
  // reason over a lot of evidence.
  const totalEvidenceChars = evidence.reduce((n, e) => n + e.body.length, 0);
  // Complexity inference: caller's forceComplex (quality rescue path) wins,
  // otherwise size-based heuristic.
  // Raised the complexity bar from 4-evidence / 6k-chars to 6-evidence
  // / 10k-chars after the OR-free-tier grading round showed that
  // bumping to LARGE on every modest research task was 429ing the
  // large model. Most research.deep results sit at 3-5 evidence chunks
  // and the small model handles those fine.
  const synthComplexity: "high" | "normal" = opts.forceComplex
    ? "high"
    : ((evidence.length >= 6 || totalEvidenceChars > 10000) ? "high" : "normal");
  // COMPACT-SYNTH detection. When the task is a short "what is X" /
  // "summarise X" research question AND the evidence is small, route
  // the synth through the TRIAGE profile (smallest/fastest model —
  // qwen3.5:0.8b on this machine) with a 256-token budget. Measured
  // win on this grade test: ~60s synth → ~15s, taking "summarise
  // neuroworks" from 174s end-to-end to ~120s. The output quality
  // stays usable because the answer shape is a one-paragraph
  // definition, not a multi-section report.
  //
  // Triggered when: task is single research.deep step OR research.multi
  // (the heuristic-planner shapes), evidence is short, AND complexity
  // wasn't escalated.
  const bareTask = parseUserRequestFromTask(task);
  const looksDefinitional = /^(?:what(?:'?s|\s+is|\s+are)|tell\s+me\s+about|explain|describe|summari[sz]e|recap|brief\s+me\s+on|tldr)\s+/i.test(bareTask) && bareTask.length <= 80;
  const singleResearchStep = p.steps.length === 1 && /^research\./.test(p.steps[0].tool);
  const compactSynth = !opts.forceComplex && synthComplexity === "normal" && looksDefinitional && singleResearchStep && totalEvidenceChars < 4000;
  // Token budget tracks complexity. Compact synth = 256 (one paragraph).
  // Simple = 512 (80-250 words). Complex = 1024 (multi-section).
  const synthMaxTokens = compactSynth ? 256 : (synthComplexity === "high" ? 1024 : 512);
  const synthProfile: "synthesis" | "triage" = compactSynth ? "triage" : "synthesis";
  const MIN_USEFUL_SYNTH = 40;
  // Single retry on transient fetch failures. The big synth call is the
  // most likely place for an Ollama hiccup (concurrent quality.check +
  // peer.review can saturate the single-threaded local model). Without
  // a retry, a one-time TCP reset nukes the entire run — research.deep
  // already gathered the evidence and the customer gets a "synthesiser
  // couldn't run" dump instead of the actual answer. One retry catches
  // the transient case; the second failure falls through to the
  // structured fallback as before.
  let lastErr: any;
  // Track whether the prior attempt failed with a rate-limit on the
  // LARGE-tier model. If so, retry by DROPPING complexity to "normal"
  // — that routes to the cheaper default model (or local Ollama),
  // which is more reliable than retrying the same large-tier endpoint.
  let downgradeOnRetry = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const meta = await ollamaGenerateWithMeta(prompt, sys, {
        profile: synthProfile,
        complexity: downgradeOnRetry ? "normal" : synthComplexity,
        maxTokens: synthMaxTokens,
        onToken: onPartial ? (_chunk: string, accumulated: string) => onPartial(accumulated) : undefined,
        onRoutingDecision: (attempt === 0 && opts.push) ? (info) => {
          // Only surface the decision when it's non-default — a complexity
          // bump, a remote model handoff. Routine local synth doesn't need a
          // log line every time. Suppress on retry to avoid double-logging.
          if (info.backend === "openrouter") {
            opts.push!(`Thinking with ${info.model} (~${info.tokenEstimate.toLocaleString()} tokens of context). ${info.reason ? `Reason: ${info.reason}.` : ""}`);
          } else if (synthComplexity === "high") {
            opts.push!(`Thinking with local ${info.model} on a complex synth (~${info.tokenEstimate.toLocaleString()} tokens). OpenRouter isn't configured — set OPENROUTER_API_KEY to route this to a bigger model.`);
          }
        } : undefined,
      });
      const text = meta.text.trim();
      if (text.length < MIN_USEFUL_SYNTH) {
        // Model produced nothing useful — that's a content failure, not
        // a transport one. No point retrying; fall through to fallback.
        return { answer: fallbackSynthesis(task, p, runs), skillUsed: pickedSkill, skillScore: pickedSkillScore };
      }
      if (attempt > 0 && opts.push) opts.push(`Synth recovered on retry — keeping the rescue draft.`);
      return { answer: text, skillUsed: pickedSkill, skillScore: pickedSkillScore };
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      // Only retry on transport-class failures. Content errors (model
      // refused, prompt-too-large) won't get better on retry.
      // Match HTTP 5xx + 429 (rate limit) + connection-class errors.
      // The free OR tier returns 429 frequently when the large model is
      // hot — separate-class retry waits longer (5s) since it's an
      // upstream throttle, not a transport blip.
      const isRateLimit = /(?:OpenRouter|HTTP)\s*429|rate[- ]?limit/i.test(msg);
      const isTransport = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|aborted|stream closed|HTTP 5\d\d|OpenRouter 5\d\d|EAI_AGAIN|terminated|other side closed/i.test(msg);
      if (attempt === 0 && (isRateLimit || isTransport)) {
        const waitMs = isRateLimit ? 5_000 : 2_000;
        // On a rate-limit OR transient on the LARGE tier, downgrade to
        // the cheaper default model on retry. Stops "free large model
        // is rate-limited upstream" from killing the whole run.
        if (isRateLimit && synthComplexity === "high") downgradeOnRetry = true;
        if (opts.push) opts.push(`Synth hiccup (${msg.slice(0, 80)}) — retrying once in ${waitMs/1000}s${downgradeOnRetry ? " on the smaller model" : ""}.`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      break;
    }
  }
  return { answer: fallbackSynthesis(task, p, runs, String(lastErr?.message ?? lastErr)), skillUsed: pickedSkill, skillScore: pickedSkillScore };
}

// One "semantic" step = ignore non-LLM-impacting steps when deciding whether
// the run had a single meaningful action. Used by passthrough to recognise
// research.deep + nothing-else patterns.
function hasOnlyOneSemanticStep(succeeded: StepRun[]): boolean {
  const semantic = succeeded.filter(r => !["clock.now"].includes(r.step.tool));
  return semantic.length === 1;
}

// Pluck a useful provenance string from a step's args — paths, URLs, repo names —
// so citations can read like `[2] (vault.search — query="cognify")` instead of
// just the tool name. Aids the citation_coverage score downstream.
function describeStepProvenance(r: StepRun): string {
  const a = r.step.args ?? {};
  const fields = ["url", "path", "query", "name", "repo", "owner"];
  const bits: string[] = [];
  for (const k of fields) {
    const v = (a as any)[k];
    if (typeof v === "string" && v.length > 0) bits.push(`${k}="${v.slice(0, 80)}"`);
  }
  return bits.length > 0 ? bits.join(", ") : r.step.tool;
}

function compactResult(r: any): any {
  if (!r) return r;
  if (typeof r === "string") return r.slice(0, 800);
  if (Array.isArray(r)) return r.slice(0, 10);
  if (typeof r === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) {
      if (Array.isArray(v)) out[k] = v.slice(0, 10);
      else if (typeof v === "string") out[k] = v.slice(0, 1500);
      else out[k] = v;
    }
    return out;
  }
  return r;
}

// Produce a polished, customer-facing message when EVERY plan step failed.
// Replaces the old "I tried, but step 1 (web.scrape) failed: <stack>" dump
// that exposed internal step indices, tool names, and env-var hints.
//
// Strategy:
//   1. Categorise each failure — security gate, network, auth, missing
//      file, planning gap, other.
//   2. Pick the dominant failure (the first one usually exposes the root
//      cause; the rest are often cascades).
//   3. Render a short, employee-style explanation with the relevant
//      next-action — never the raw stack trace, never tool names.
//
// Categories produce different copy. The output reads as one paragraph of
// prose to the customer; technical detail (the original error text) is
// folded into a small italic line at the bottom for debugging without
// being the headline.
function humanizeAllFail(task: string, failed: StepRun[]): string {
  if (failed.length === 0) {
    return "I couldn't get anywhere on this — nothing executed. Could you rephrase what you'd like me to do?";
  }
  // Pick the first failure as the headline. Subsequent failures are usually
  // cascades from the same root cause.
  const head = failed[0];
  const err = String(head.error ?? "").trim();
  const tool = head.step.tool;
  const args = head.step.args ?? {};
  const targetUrl = typeof (args as any).url === "string" ? (args as any).url : "";
  const targetPath = typeof (args as any).path === "string" ? (args as any).path : "";

  // 1. SECURITY REFUSAL — SSRF gate on a web tool. The error message starts
  //    with "Refused to fetch …". Reframe in plain language with the
  //    specific target named, and offer the override path WITHOUT exposing
  //    the env var name (the curious customer can find it in .env.example).
  if (/^Refused to fetch/i.test(err) && targetUrl) {
    const host = (() => { try { return new URL(targetUrl).hostname; } catch { return targetUrl; } })();
    const why =
      /169\.254\.169\.254/.test(host) ? "the cloud-metadata service, which agents are blocked from to prevent credential leaks"
      : /^(?:127\.|::1$|localhost)/i.test(host) ? "a loopback address (your own machine)"
      : /^(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(host) ? "a private internal network"
      : "a non-public address";
    return `I can't reach **${host}** — it's ${why}, and my web tools are scoped to the public internet so secrets stored on internal services aren't exposed accidentally.\n\nIf this is a deliberate request (you're testing reachability or fetching from your own dev server), enable private-host access in \`.env\` (see \`.env.example\` — look for \`CLAWBOT_WEB_ALLOW_PRIVATE\`) and try again. Otherwise, share a public URL or tell me what you're trying to find out and I'll dig differently.`;
  }

  // 2. PATH SECURITY REFUSAL — fs gate on .env / .ssh / cred stores.
  if (/^Refused to read/i.test(err) && targetPath) {
    return `That path looks like a sensitive file (credentials, keys, or browser cookie store), so I won't read it by default — it's the kind of thing that would leak if I quoted it back in a reply or wrote it to your vault.\n\nIf you genuinely need me to read it (you're debugging a config), there's an override in \`.env\` (\`CLAWBOT_FS_UNRESTRICTED\` in \`.env.example\`). Otherwise tell me what you're after and I'll find a safer path.`;
  }

  // 3. NETWORK — couldn't reach the public web. Common: timeouts, DNS,
  //    transient TLS issues. Suggest retry; don't blame the customer.
  if (/\b(?:ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|abort|timeout)\b/i.test(err)) {
    const targetBit = targetUrl ? ` reaching **${(() => { try { return new URL(targetUrl).hostname; } catch { return targetUrl; } })()}**` : "";
    return `I hit a network snag${targetBit} — the connection dropped, timed out, or couldn't resolve the host. Often this clears up in a few seconds. Want me to try again, or do you have a different source in mind?`;
  }

  // 4. AUTH / FORBIDDEN — 401/403, missing token, expired creds.
  if (/\b(?:401|403|unauthori[sz]ed|forbidden|invalid_request_error|API key|missing.*token)\b/i.test(err)) {
    return `I'm not authorised to access that resource — looks like the token / key is missing, expired, or doesn't have permission. Check the relevant entry in your \`.env\` (GitHub PAT, API keys, etc.) and try again.`;
  }

  // 5. NOT FOUND — file or repo doesn't exist where I looked.
  if (/\b(?:file not found|no such file|ENOENT|404|not found)\b/i.test(err)) {
    if (targetPath) return `I couldn't find anything at \`${targetPath}\`. Could the path be slightly different (typo, wrong folder), or should I look somewhere else?`;
    if (targetUrl) return `That URL returned a 404 — the page doesn't exist (or moved). Want me to try a search for the same topic instead?`;
    return `I couldn't find what you were pointing me at. Want to share a path, URL, or topic and I'll try again?`;
  }

  // 6. RATE LIMIT — 429.
  if (/\b(?:429|rate.?limit|too many requests)\b/i.test(err)) {
    return `We're being rate-limited by the upstream service. Give it a minute and ask again; if it keeps happening, this provider may need an API key upgrade.`;
  }

  // 7. PLANNING / TOOL CATALOG MISMATCH — the planner picked a tool that
  //    doesn't exist, or args didn't validate.
  if (/(?:invalid tool|no such tool|unknown tool|missing.*arg|args.*invalid)/i.test(err)) {
    return `I planned this in a way that didn't quite fit my actual tools — that's on me. Want to rephrase the request or share a bit more about what you need? Sometimes naming the deliverable (email, brief, code, etc.) helps me pick the right approach.`;
  }

  // 8. FALLBACK — unknown class. Give the customer something useful: name
  //    the kind of work that failed (vault read, web fetch, research, etc.)
  //    without exposing tool name, and tuck the technical detail in italic
  //    at the end so a developer-customer can still see what happened.
  const friendlyAction = humanWorkKind(tool);
  const errSnippet = err.length > 240 ? err.slice(0, 240) + "…" : err;
  return `I tried to ${friendlyAction} and hit an error I don't have a clean recovery for. Could you tell me a bit more about what you're trying to achieve, or try a different angle?\n\n_Technical detail: ${errSnippet}_`;
}

// Friendly verb-phrase for a tool name. Used in the fallback message so we
// don't expose names like "web.scrape" to the customer.
function humanWorkKind(tool: string): string {
  switch (tool) {
    case "vault.search":            return "search your notes";
    case "vault.read":              return "read a note from your vault";
    case "vault.list":              return "list your vault";
    case "vault.write":             return "save a note to your vault";
    case "vault.edit":              return "edit a note in your vault";
    case "vault.scan_docs":         return "scan documents in your vault";
    case "research.deep":           return "research the topic";
    case "research.multiperspective": return "investigate the topic from multiple angles";
    case "web.fetch":               return "read the webpage";
    case "web.scrape":              return "open the page in a browser";
    case "web.firecrawl":           return "fetch the page via Firecrawl";
    case "web.search":              return "search the web";
    case "brave.list_tabs":
    case "brave.read_tab":
    case "brave.search_tabs":       return "read your open Brave tabs";
    case "github.list_repos":
    case "github.read_repo":
    case "github.get_file":         return "pull from GitHub";
    case "github.create_issue":     return "open a GitHub issue";
    case "fs.read_external":        return "read the file";
    case "fs.list_external":        return "list the folder";
    case "ollama.generate":         return "draft a response";
    case "peer.delegate":           return "hand the work off to a peer";
    case "peer.review":             return "ask a peer to review the draft";
    case "quality.check":           return "quality-check the draft";
    case "security.scan":           return "security-scan the draft";
    case "skill.draft":
    case "skill.fetch_remote":
    case "skill.load":
    case "skill.list":
    case "skill.suggest":           return "look up a skill playbook";
    default:                        return "complete this part of the task";
  }
}

// Rescue synth — runs when the LLM synth call threw OR returned blank. Builds
// a coherent answer directly from the evidence by digesting each successful
// step's result. NOT just a "Ran N steps" stub — that's user-hostile after a
// long wait. We surface the actual content (sources, answers, paths) and
// honestly flag what failed so the user knows where the work stopped.
function fallbackSynthesis(task: string, p: Plan, runs: StepRun[], synthError?: string): string {
  const ok = runs.filter(r => r.ok);
  const failed = runs.filter(r => !r.ok);
  const parts: string[] = [];
  // Use the bare user request in the headline — the enriched task is prefixed
  // with persona framing + interpretation/deliverable blocks that look like
  // garbage to the customer. parseUserRequestFromTask peels those off.
  const headlineTask = parseUserRequestFromTask(task).slice(0, 200);

  // Single-step research success + synth failure is the most common shape:
  // the search step already produced a usable answer, the LLM rendering on
  // top failed (429, transport, etc.). Lift that answer directly instead of
  // burying it under "Partial result / What worked / What failed" framing.
  if (ok.length === 1 && failed.length === 0 && /^research\./.test(ok[0].step.tool)) {
    const direct = compactStepSummary(ok[0]).trim();
    if (direct.length >= 40) {
      return `${direct}\n\n---\n_The synthesis step couldn't render this cleanly${synthError ? ` (${synthError.slice(0, 80)})` : ""}, so here's the research result directly. Ask again for a polished version._`;
    }
  }

  parts.push(`## Partial result\n\nThe synthesis step didn't complete cleanly${synthError ? ` (\`${synthError.slice(0, 100)}\`)` : ""}, so here is the raw evidence we gathered for: **${headlineTask}**`);

  if (ok.length > 0) {
    parts.push(`### What worked`);
    for (let i = 0; i < ok.length; i++) {
      const r = ok[i];
      parts.push(`**Step ${i + 1} — ${r.step.label ?? r.step.tool}**\n${compactStepSummary(r)}`);
    }
  } else {
    parts.push(`### What worked\n\n_No steps completed successfully._`);
  }

  if (failed.length > 0) {
    parts.push(`### What failed`);
    for (const r of failed) {
      parts.push(`- **${r.step.label ?? r.step.tool}** — ${(r.error ?? "no error message").slice(0, 200)}`);
    }
  }

  parts.push(`---\n_Auto-generated rescue summary. Try the task again — the next attempt may have the model available._`);
  return parts.join("\n\n");
}

// Per-step digest used by the rescue path. Pulls the most readable part of
// each tool's result (answer / text / title / path / snippets) — never raw
// JSON unless every more-readable shape failed.
function compactStepSummary(r: StepRun): string {
  const result: any = r.result;
  if (result == null) return "_(no output)_";
  if (typeof result === "string") return result.slice(0, 800);
  if (typeof result.answer === "string" && result.answer.trim().length > 0) {
    return result.answer.slice(0, 800);
  }
  if (typeof result.text === "string" && result.text.trim().length > 0) {
    return result.text.slice(0, 800);
  }
  if (typeof result.path === "string") return `Wrote/read: \`${result.path}\``;
  if (Array.isArray(result.results) && result.results.length > 0) {
    return result.results.slice(0, 5).map((h: any, idx: number) =>
      `${idx + 1}. ${h.title ?? h.path ?? h.url ?? "(item)"} — ${(h.snippet ?? h.preview ?? "").slice(0, 160)}`
    ).join("\n");
  }
  if (Array.isArray(result.sources) && result.sources.length > 0) {
    return result.sources.slice(0, 5).map((s: any, idx: number) =>
      `${idx + 1}. [${s.title ?? s.url ?? "source"}](${s.url ?? ""})`
    ).join("\n");
  }
  try {
    const json = JSON.stringify(result);
    return "```\n" + json.slice(0, 500) + (json.length > 500 ? "…" : "") + "\n```";
  } catch { return "_(unprintable result)_"; }
}

// Resolve $step_N or $step_N.path.to.value references in args
function resolveArgs(args: Record<string, any>, runs: StepRun[]): Record<string, any> {
  const resolved: Record<string, any> = {};
  for (const [k, v] of Object.entries(args ?? {})) resolved[k] = resolveValue(v, runs);
  return resolved;
}

function resolveValue(v: any, runs: StepRun[]): any {
  if (typeof v !== "string") return v;
  // Whole-string reference: "$step_2" or "$step_2.field.0.x"
  const whole = v.match(/^\$step_(\d+)(\..+)?$/);
  if (whole) {
    const idx = Number(whole[1]);
    const path = whole[2] ?? "";
    const base = runs[idx]?.result;
    if (base === undefined) return v;
    return path ? deepGet(base, path) : base;
  }
  // Embedded $step_N inside a longer string
  return v.replace(/\$step_(\d+)(\.[a-zA-Z0-9_.-]+)?/g, (_, n, p) => {
    const base = runs[Number(n)]?.result;
    if (base === undefined) return "";
    const target = p ? deepGet(base, p) : base;
    return typeof target === "string" ? target : JSON.stringify(target).slice(0, 4000);
  });
}

function deepGet(obj: any, path: string): any {
  const parts = path.replace(/^\./, "").split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[/^\d+$/.test(part) ? Number(part) : part];
  }
  return cur;
}

function extractJson(s: string): any {
  // Strip code fences if present
  const fenced = s.match(/```(?:json)?\s*([\s\S]+?)```/);
  const raw = fenced ? fenced[1] : s;
  // Find first {...} balanced enough to parse
  const open = raw.indexOf("{");
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        const slice = raw.slice(open, i + 1);
        try { return JSON.parse(slice); } catch { return null; }
      }
    }
  }
  return null;
}

void primitives;
