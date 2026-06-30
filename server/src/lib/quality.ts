import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "../config.js";

export type QualityFlag = {
  jobId: string;
  rating: "up" | "down";
  note?: string;
  persona?: string;
  template?: string;
  score?: number;
  category?: "accuracy" | "relevance" | "tone" | "completeness" | "formatting" | "other";
  ts: string;
};

export type QualitySummary = {
  totalFlags: number;
  upvotes: number;
  downvotes: number;
  rate: number; // 0-1 satisfaction rate
  topCategories: { category: string; count: number }[];
  recentFlags: QualityFlag[];
};

const QUALITY_REL = "_neuroworks/quality.jsonl";
const AGGREGATE_REL = "_neuroworks/quality-summary.json";

function qualityPath(): string {
  return resolve(config.vaultPath, QUALITY_REL);
}

function aggregatePath(): string {
  return resolve(config.vaultPath, AGGREGATE_REL);
}

export function flagQuality(flag: QualityFlag): void {
  const full = qualityPath();
  try { mkdirSync(join(full, ".."), { recursive: true }); } catch { /* tolerate */ }
  appendFileSync(full, JSON.stringify(flag) + "\n", "utf8");
  updateAggregate();
}

function updateAggregate(): void {
  const full = qualityPath();
  if (!existsSync(full)) return;
  try {
    const lines = readFileSync(full, "utf8").trim().split("\n").filter(Boolean);
    const flags: QualityFlag[] = lines.map(l => JSON.parse(l));
    const upvotes = flags.filter(f => f.rating === "up").length;
    const downvotes = flags.filter(f => f.rating === "down").length;
    const total = upvotes + downvotes;

    const catCount = new Map<string, number>();
    for (const f of flags) {
      if (f.category) catCount.set(f.category, (catCount.get(f.category) ?? 0) + 1);
    }
    const topCategories = [...catCount.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const agg: QualitySummary = {
      totalFlags: total,
      upvotes,
      downvotes,
      rate: total > 0 ? upvotes / total : 1,
      topCategories,
      recentFlags: flags.slice(-20).reverse(),
    };
    writeFileSync(aggregatePath(), JSON.stringify(agg, null, 2), "utf8");
  } catch { /* ignore corrupt data */ }
}

export function getQualitySummary(): QualitySummary {
  const full = aggregatePath();
  if (!existsSync(full)) return { totalFlags: 0, upvotes: 0, downvotes: 0, rate: 1, topCategories: [], recentFlags: [] };
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return { totalFlags: 0, upvotes: 0, downvotes: 0, rate: 1, topCategories: [], recentFlags: [] };
  }
}

export function getQualityFlags(since?: string): QualityFlag[] {
  const full = qualityPath();
  if (!existsSync(full)) return [];
  try {
    const lines = readFileSync(full, "utf8").trim().split("\n").filter(Boolean);
    const flags: QualityFlag[] = lines.map(l => JSON.parse(l));
    if (since) {
      const sinceTs = new Date(since).getTime();
      return flags.filter(f => new Date(f.ts).getTime() >= sinceTs);
    }
    return flags;
  } catch {
    return [];
  }
}

export function getLowQualityRuns(threshold = 0.5, minFlags = 3): { task: string; count: number; rate: number }[] {
  const flags = getQualityFlags();
  const byPersona = new Map<string, QualityFlag[]>();
  for (const f of flags) {
    const key = f.persona ?? "unknown";
    if (!byPersona.has(key)) byPersona.set(key, []);
    byPersona.get(key)!.push(f);
  }
  const result: { task: string; count: number; rate: number }[] = [];
  for (const [persona, pf] of byPersona) {
    if (pf.length < minFlags) continue;
    const down = pf.filter(f => f.rating === "down").length;
    const rate = 1 - (down / pf.length);
    if (rate < threshold) {
      result.push({ task: persona, count: pf.length, rate });
    }
  }
  return result.sort((a, b) => a.rate - b.rate);
}
