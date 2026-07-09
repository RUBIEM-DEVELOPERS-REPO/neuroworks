import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { config } from "../config.js";

export type CostRecord = {
  jobId: string;
  model: string;
  backend: "ollama" | "openrouter" | "minimax" | "anthropic";
  profile: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ts: string;
};

export type CostSummary = {
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  byModel: { model: string; costUsd: number; calls: number }[];
  byDay: { date: string; costUsd: number; calls: number }[];
  recentCalls: CostRecord[];
};

const COST_REL = "_neuroworks/cost.jsonl";
const AGGREGATE_REL = "_neuroworks/cost-summary.json";

// Approximate cost per 1K tokens (USD) per backend/model tier.
// Ollama local is free but we track ~$0 to distinguish from paid.
const COST_PER_1K_INPUT: Record<string, number> = {
  ollama: 0,
  "openrouter/small": 0.00015,   // gpt-4o-mini tier
  "openrouter/medium": 0.003,    // gpt-4o tier
  "openrouter/large": 0.015,     // gpt-4.5 tier
  // Anthropic direct — official per-MTok pricing ÷ 1000 (fable $10/$50,
  // opus 4.x $5/$25, sonnet $3/$15, haiku 4.5 $1/$5).
  "anthropic/fable": 0.010,
  "anthropic/opus": 0.005,
  "anthropic/sonnet": 0.003,
  "anthropic/haiku": 0.001,
  minimax: 0.0002,
};
const COST_PER_1K_OUTPUT: Record<string, number> = {
  ollama: 0,
  "openrouter/small": 0.0006,
  "openrouter/medium": 0.015,
  "openrouter/large": 0.075,
  "anthropic/fable": 0.050,
  "anthropic/opus": 0.025,
  "anthropic/sonnet": 0.015,
  "anthropic/haiku": 0.005,
  minimax: 0.0002,
};

function costTier(model: string): string {
  if (model.startsWith("minimax") || model.startsWith("MiniMax")) return "minimax";
  // Native Claude model ids (Anthropic BYO provider) — priced by family.
  if (/^claude-fable|^claude-mythos/i.test(model)) return "anthropic/fable";
  if (/^claude-opus/i.test(model)) return "anthropic/opus";
  if (/^claude-sonnet/i.test(model)) return "anthropic/sonnet";
  if (/^claude-haiku/i.test(model)) return "anthropic/haiku";
  if (/opus|gpt-4\.5|gpt-4-?turbo|claude-3-5-sonnet|claude-opus/i.test(model)) return "openrouter/large";
  if (/gpt-4o(?!-mini)|claude-sonnet|claude-3-haiku|llama-3-70b|mixtral/i.test(model)) return "openrouter/medium";
  return "openrouter/small";
}

function estimateCost(model: string, backend: string, inputTokens: number, outputTokens: number): number {
  if (backend === "ollama") return 0;
  // OpenRouter ":free" models cost nothing — don't misreport them as paid.
  if (/:free\b/i.test(model)) return 0;
  const tier = backend === "minimax" ? "minimax" : costTier(model);
  const inputRate = COST_PER_1K_INPUT[tier] ?? COST_PER_1K_INPUT["openrouter/small"];
  const outputRate = COST_PER_1K_OUTPUT[tier] ?? COST_PER_1K_OUTPUT["openrouter/small"];
  return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
}

function costPath(): string {
  return resolve(config.vaultPath, COST_REL);
}

function aggregatePath(): string {
  return resolve(config.vaultPath, AGGREGATE_REL);
}

export function recordCost(record: CostRecord): void {
  const full = costPath();
  try { mkdirSync(join(full, ".."), { recursive: true }); } catch { /* tolerate */ }
  appendFileSync(full, JSON.stringify(record) + "\n", "utf8");
}

// Cheap, best-effort recorder wired into the central LLM dispatch so EVERY
// model call is counted. Only appends a JSONL line (the summary aggregates on
// read), so it's safe on the hot path. Was previously dead: trackLlmCall
// existed but nothing called it, so the Cost page always showed zero.
export function recordLlmCost(model: string, outputText: string, inputText: string, systemText?: string, profile = "none", jobId = "adhoc"): void {
  try {
    const inputTokens = Math.ceil(((inputText?.length ?? 0) + (systemText?.length ?? 0)) / 4);
    const outputTokens = Math.ceil((outputText?.length ?? 0) / 4);
    const lc = (model ?? "").toLowerCase();
    // Native Claude ids ("claude-fable-5") have NO slash — without this branch
    // they were misfiled as "ollama" and recorded at $0 (the bug that hid all
    // Fable spend from the Cost page).
    const backend: CostRecord["backend"] = /^minimax[-/]/i.test(lc) ? "minimax"
      : /^claude-/i.test(lc) ? "anthropic"
      : lc.includes("/") ? "openrouter" : "ollama";
    const costUsd = estimateCost(model, backend, inputTokens, outputTokens);
    recordCost({ jobId, model, backend, profile, inputTokens, outputTokens, costUsd, ts: new Date().toISOString() });
  } catch { /* cost tracking is best-effort — never break a real LLM call */ }
}

function aggregate(records: CostRecord[]): CostSummary {
  const totalCostUsd = records.reduce((s, r) => s + r.costUsd, 0);
  const totalInputTokens = records.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutputTokens = records.reduce((s, r) => s + r.outputTokens, 0);
  const byModelMap = new Map<string, { costUsd: number; calls: number }>();
  const byDayMap = new Map<string, { costUsd: number; calls: number }>();
  for (const r of records) {
    const m = byModelMap.get(r.model) ?? { costUsd: 0, calls: 0 };
    m.costUsd += r.costUsd; m.calls++; byModelMap.set(r.model, m);
    const day = r.ts.slice(0, 10);
    const d = byDayMap.get(day) ?? { costUsd: 0, calls: 0 };
    d.costUsd += r.costUsd; d.calls++; byDayMap.set(day, d);
  }
  return {
    totalCostUsd, totalInputTokens, totalOutputTokens, callCount: records.length,
    byModel: [...byModelMap.entries()].map(([model, v]) => ({ model, costUsd: v.costUsd, calls: v.calls })).sort((a, b) => b.costUsd - a.costUsd),
    byDay: [...byDayMap.entries()].map(([date, v]) => ({ date, costUsd: v.costUsd, calls: v.calls })).sort((a, b) => a.date.localeCompare(b.date)),
    recentCalls: records.slice(-50).reverse(),
  };
}

// Legacy: writes the aggregate snapshot to disk. Kept for compatibility, but
// getCostSummary now aggregates from raw records so the Cost page is always
// live even without this being called.
function rebuildAggregate(): void {
  const full = costPath();
  if (!existsSync(full)) return;
  try {
    const lines = readFileSync(full, "utf8").trim().split("\n").filter(Boolean);
    const records: CostRecord[] = lines.map(l => JSON.parse(l));
    const totalCostUsd = records.reduce((s, r) => s + r.costUsd, 0);
    const totalInputTokens = records.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = records.reduce((s, r) => s + r.outputTokens, 0);

    const byModelMap = new Map<string, { costUsd: number; calls: number }>();
    const byDayMap = new Map<string, { costUsd: number; calls: number }>();
    for (const r of records) {
      const m = byModelMap.get(r.model) ?? { costUsd: 0, calls: 0 };
      m.costUsd += r.costUsd;
      m.calls++;
      byModelMap.set(r.model, m);

      const day = r.ts.slice(0, 10);
      const d = byDayMap.get(day) ?? { costUsd: 0, calls: 0 };
      d.costUsd += r.costUsd;
      d.calls++;
      byDayMap.set(day, d);
    }

    const agg: CostSummary = {
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      callCount: records.length,
      byModel: [...byModelMap.entries()].map(([model, v]) => ({ model, costUsd: v.costUsd, calls: v.calls })).sort((a, b) => b.costUsd - a.costUsd),
      byDay: [...byDayMap.entries()].map(([date, v]) => ({ date, costUsd: v.costUsd, calls: v.calls })).sort((a, b) => a.date.localeCompare(b.date)),
      recentCalls: records.slice(-50).reverse(),
    };
    writeFileSync(aggregatePath(), JSON.stringify(agg, null, 2), "utf8");
  } catch { /* ignore corrupt data */ }
}

export function getCostSummary(): CostSummary {
  // Aggregate live from the raw records so the Cost page reflects every call
  // (the old path read a snapshot that nothing rebuilt → always zero).
  return aggregate(getCostRecords());
}

export function getCostRecords(since?: string): CostRecord[] {
  const full = costPath();
  if (!existsSync(full)) return [];
  try {
    const lines = readFileSync(full, "utf8").trim().split("\n").filter(Boolean);
    const records: CostRecord[] = lines.map(l => JSON.parse(l));
    if (since) {
      const sinceTs = new Date(since).getTime();
      return records.filter(r => new Date(r.ts).getTime() >= sinceTs);
    }
    return records;
  } catch {
    return [];
  }
}

// Wraps an LLM call to track cost. Callers replace their llmGenerate / llmGenerateWithMeta
// call with this wrapper. Estimates tokens from string length ÷ 4 (same heuristic as llm.ts).
export async function trackLlmCall<T extends { text: string; model: string }>(
  jobId: string,
  call: () => Promise<T>,
  profile: string,
  inputText: string,
  systemText?: string,
): Promise<T> {
  const inputTokens = Math.ceil((inputText.length + (systemText?.length ?? 0)) / 4);
  const result = await call();
  const outputTokens = Math.ceil(result.text.length / 4);
  const lcModel = result.model.toLowerCase();
  // Same native-Claude-id rule as recordLlmCost — "claude-fable-5" has no
  // slash and was misfiled as free local ollama here too.
  const detectedBackend = /^minimax[-/]/i.test(lcModel) ? "minimax"
    : /^claude-/i.test(lcModel) ? "anthropic"
    : lcModel.includes("/") ? "openrouter" : "ollama";
  const costUsd = estimateCost(result.model, detectedBackend, inputTokens, outputTokens);
  const record: CostRecord = {
    jobId,
    model: result.model,
    backend: detectedBackend,
    profile,
    inputTokens,
    outputTokens,
    costUsd,
    ts: new Date().toISOString(),
  };
  recordCost(record);
  rebuildAggregate();
  return result;
}
