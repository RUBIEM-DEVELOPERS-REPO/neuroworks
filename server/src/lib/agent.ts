import { findPrimitive, humanStepLabel, primitivesPromptCatalog, primitives } from "./primitives.js";
import { ollamaGenerate } from "./ollama.js";

export type PlanStep = { tool: string; args: Record<string, any>; rationale?: string; label?: string };
export type Plan = { steps: PlanStep[]; summary?: string; waves?: number[][] };
export type StepRun = { step: PlanStep; ok: boolean; result?: any; error?: string; durationMs: number; startedAt?: number };

export type AgentResult = {
  task: string;
  plan: Plan;
  runs: StepRun[];
  answer: string;
  hadWrites: boolean;
};

const PLAN_SYSTEM = `You are a task planner for clawbot. The user gives a task in plain English; you output ONLY a JSON object describing tool steps. No prose, no markdown fences.

Output schema:
{"steps":[{"tool":"<tool-name>","args":{<key>:<value>,...},"rationale":"why"}],"summary":"one sentence about the plan"}

Rules:
- Use ONLY tools from the catalog. Invented tools are an error.
- Reference an earlier step's output via the literal placeholder "$step_<i>" (0-indexed) optionally with a path. Example: {"path":"$step_0.matches.0.path"}.
- Independent steps (no $step_ ref between them) run as parallel sub-agents — when the task naturally splits, prefer separate independent steps over one big serial chain. Example: searching the vault AND fetching a GitHub file are independent and should be two parallel steps.
- Keep plans minimal — 1 to 6 steps suits most tasks.
- Don't write files unless the task explicitly asks for it.
- If the task can't be fulfilled with the catalog, output {"steps":[]}.

EXAMPLES:
Task: "find notes about Cognify and tell me what they say"
Plan:
{"steps":[
  {"tool":"vault.search","args":{"query":"Cognify"},"rationale":"find relevant notes"},
  {"tool":"vault.read","args":{"path":"$step_0.matches.0.path"},"rationale":"read the top match in full"}
],"summary":"Search for Cognify, read the top match."}

Task: "what's in the README of the clawbot repo"
Plan:
{"steps":[
  {"tool":"github.get_file","args":{"owner":"RUBIEM-DEVELOPERS-REPO","name":"clawbot","path":"README.md"},"rationale":"fetch README"}
],"summary":"Fetch clawbot README."}

Task: "summarize this URL: https://example.com/post"
Plan:
{"steps":[
  {"tool":"web.fetch","args":{"url":"https://example.com/post"},"rationale":"fetch page"},
  {"tool":"ollama.generate","args":{"prompt":"Summarize: $step_0.text","system":"Summarize the input concisely."},"rationale":"summarize"}
],"summary":"Fetch URL, summarize."}

Task: "compare what my vault says about Cognify with what the Cognify GitHub README says"
Plan:
{"steps":[
  {"tool":"vault.search","args":{"query":"Cognify"},"rationale":"find what the vault says (independent)"},
  {"tool":"github.get_file","args":{"owner":"topoteretes","name":"cognee","path":"README.md"},"rationale":"fetch the README (independent — runs in parallel)"},
  {"tool":"ollama.generate","args":{"prompt":"Vault hits:\n$step_0.matches\n\nREADME:\n$step_1.content\n\nWrite a short comparison.","system":"Compare two sources concisely."},"rationale":"synthesize once both are in"}
],"summary":"Pull both sources in parallel, then compare."}

Tool catalog:
`;

export async function plan(task: string, personaSystemSuffix?: string): Promise<Plan> {
  const sys = PLAN_SYSTEM + primitivesPromptCatalog() + (personaSystemSuffix ? `\n\nPersona context (follow this when planning):\n${personaSystemSuffix}` : "");
  const out = await ollamaGenerate(`Task: ${task}`, sys);
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

export async function executePlan(p: Plan, push: (msg: string) => void, onProgress?: (runs: StepRun[]) => void): Promise<{ runs: StepRun[]; hadWrites: boolean }> {
  const runs: StepRun[] = p.steps.map(step => ({ step, ok: false, durationMs: 0 }));
  let hadWrites = false;
  for (const step of p.steps) {
    const tool = findPrimitive(step.tool)!;
    if (!tool.readonly) hadWrites = true;
  }
  const waves = p.waves && p.waves.length > 0 ? p.waves : p.steps.map((_, i) => [i]);
  let aborted = false;

  for (let w = 0; w < waves.length; w++) {
    if (aborted) break;
    const ids = waves[w];
    if (ids.length > 1) push(`spinning up ${ids.length} sub-agents in parallel`);
    await Promise.all(ids.map(async (i) => {
      if (aborted) return;
      const step = p.steps[i];
      const tool = findPrimitive(step.tool)!;
      const args = resolveArgs(step.args, runs);
      push(`step ${i + 1}/${p.steps.length}: ${step.label ?? step.tool}`);
      runs[i] = { step, ok: false, durationMs: 0, startedAt: Date.now() };
      onProgress?.([...runs]);
      const t0 = Date.now();
      try {
        const result = await tool.handler(args);
        runs[i] = { step, ok: true, result, durationMs: Date.now() - t0, startedAt: t0 };
      } catch (e: any) {
        runs[i] = { step, ok: false, error: String(e.message ?? e), durationMs: Date.now() - t0, startedAt: t0 };
        push(`  ✗ ${step.label ?? step.tool}: ${e.message ?? e}`);
        aborted = true;
      }
      onProgress?.([...runs]);
    }));
  }
  return { runs, hadWrites };
}

export async function planAndExecute(
  task: string,
  push: (msg: string) => void,
  onProgress?: (patch: Partial<AgentResult> & { phase?: string }) => void,
  opts: { personaSystemSuffix?: string } = {},
): Promise<AgentResult> {
  push(`planning task with local LLM`);
  onProgress?.({ phase: "planning" });
  const p = await plan(task, opts.personaSystemSuffix);
  if (p.steps.length === 0) {
    push(`could not plan with available tools — falling back to direct LLM answer`);
    onProgress?.({ phase: "answering", plan: p });
    const sysFallback = `${opts.personaSystemSuffix ?? ""}\nAnswer in 2-3 sentences. If you can't answer, say what context you'd need from the user's vault or GitHub.`.trim();
    const reply = await ollamaGenerate(`Task: ${task}`, sysFallback);
    return { task, plan: { steps: [] }, runs: [], answer: reply.trim(), hadWrites: false };
  }
  push(`plan: ${p.steps.length} step(s)${p.summary ? ` — ${p.summary}` : ""}`);
  onProgress?.({ phase: "executing", plan: p, runs: [] });

  const { runs, hadWrites } = await executePlan(p, push, (runs) => onProgress?.({ runs: [...runs] }));

  // Synthesize a chat-friendly answer from the step results
  onProgress?.({ phase: "synthesizing", runs });
  const synth = await synthesize(task, p, runs, opts.personaSystemSuffix);
  return { task, plan: p, runs, answer: synth, hadWrites };
}

async function synthesize(task: string, p: Plan, runs: StepRun[], personaSystemSuffix?: string): Promise<string> {
  const succeeded = runs.filter(r => r.ok);
  const failed = runs.filter(r => !r.ok);
  if (succeeded.length === 0) {
    return failed.length > 0 ? `I tried, but step ${runs.indexOf(failed[0]) + 1} (${failed[0].step.tool}) failed: ${failed[0].error}` : "I couldn't execute any step.";
  }
  const compact = succeeded.map((r, i) => ({ step: i + 1, tool: r.step.tool, result: compactResult(r.result) }));
  const sys = "You are clawbot. Given a user task and the structured results of the steps you executed to fulfill it, write a concise plain-English answer (under 120 words, markdown allowed) that directly addresses the user's task. Cite specific paths or names from the results. Don't mention the planning machinery — speak as the assistant who did the work." + (personaSystemSuffix ? `\n\nPersona: ${personaSystemSuffix}` : "");
  const prompt = `Task: ${task}\n\nStep results:\n${JSON.stringify(compact, null, 2)}\n\nAnswer:`;
  try { return (await ollamaGenerate(prompt, sys)).trim(); }
  catch { return fallbackSynthesis(p, runs); }
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

function fallbackSynthesis(p: Plan, runs: StepRun[]): string {
  const ok = runs.filter(r => r.ok).length;
  return `Ran ${ok}/${p.steps.length} step(s): ${p.steps.map(s => s.tool).join(" → ")}.`;
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
