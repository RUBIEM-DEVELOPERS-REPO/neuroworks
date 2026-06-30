import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { config } from "../config.js";

export type CostRecord = {
  jobId: string;
  model: string;
  backend: "ollama" | "openrouter" | "minimax";
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
  "openrouter/small": 0.00015,   // gpt-4o-mini, claude-haiku tier
  "openrouter/medium": 0.003,    // gpt-4o, claude-sonnet tier
  "openrouter/large": 0.015,     // claude-opus, gpt-4.5 tier
  minimax: 0.0002,
};
const COST_PER_1K_OUTPUT: Record<string, number> = {
  ollama: 0,
  "openrouter/small": 0.0006,
  "openrouter/medium": 0.015,
  "openrouter/large": 0.075,
  minimax: 0.0002,
};

function costTier(model: string): string {
  if (model.startsWith("minimax") || model.startsWith("MiniMax")) return "minimax";
  if (/opus|gpt-4\.5|gpt-4-?turbo|claude-3-5-sonnet|claude-opus/i.test(model)) return "openrouter/large";
  if (/gpt-4o(?!-mini)|claude-sonnet|claude-3-haiku|llama-3-70b|mixtral/i.test(model)) return "openrouter/medium";
  return "openrouter/small";
}

function estimateCost(model: string, backend: string, inputTokens: number, outputTokens: number): number {
  if (backend === "ollama") return 0;
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
  const full = aggregatePath();
  if (!existsSync(full)) return { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, callCount: 0, byModel: [], byDay: [], recentCalls: [] };
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, callCount: 0, byModel: [], byDay: [], recentCalls: [] };
  }
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
  const detectedBackend = /^minimax[-/]/i.test(lcModel) ? "minimax" : lcModel.includes("/") ? "openrouter" : "ollama";
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
