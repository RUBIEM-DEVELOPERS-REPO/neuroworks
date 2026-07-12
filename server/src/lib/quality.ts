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
  category?: "accuracy" | "relevance" | "tone" | "completeness" | "formatting" | "localization" | "other";
  // Language the flagged output was actually IN, as observed by the operator
  // flagging it — not inferred (a persona's language pin can change after the
  // job ran, and the org default can differ from what a specific job used).
  // Lets Quality Dashboard / Mission Control filter to "Shona/Ndebele outputs
  // flagged for improvement" for the native-speaker review process.
  language?: "en" | "sn" | "nd";
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
// The thumbs up/down the operator actually clicks on answers (ResultPanel →
// POST /api/feedback) land in a SEPARATE file, written by routes/feedback.ts.
// Until 2026-07-12 the Quality page read only quality.jsonl — whose write
// path (POST /api/quality/flag) has no UI control wired to it — so the page
// showed zeros while 13 real ratings sat in feedback.jsonl. Reads below merge
// both files; the two stores share a record shape (feedback.jsonl just never
// carries category/language).
const FEEDBACK_REL = "_neuroworks/feedback.jsonl";
const AGGREGATE_REL = "_neuroworks/quality-summary.json";

function qualityPath(): string {
  return resolve(config.vaultPath, QUALITY_REL);
}

function feedbackPath(): string {
  return resolve(config.vaultPath, FEEDBACK_REL);
}

function aggregatePath(): string {
  return resolve(config.vaultPath, AGGREGATE_REL);
}

function readJsonlFlags(full: string): QualityFlag[] {
  if (!existsSync(full)) return [];
  try {
    return readFileSync(full, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l))
      .filter((r: any) => r && typeof r.jobId === "string" && (r.rating === "up" || r.rating === "down"));
  } catch {
    return [];
  }
}

// Every read path goes through this merge. For the same jobId in BOTH files,
// all records are kept (they're independent events in a timeline), sorted
// oldest→newest like a single JSONL would be.
function readAllFlags(): QualityFlag[] {
  return [...readJsonlFlags(qualityPath()), ...readJsonlFlags(feedbackPath())]
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

export function flagQuality(flag: QualityFlag): void {
  const full = qualityPath();
  try { mkdirSync(join(full, ".."), { recursive: true }); } catch { /* tolerate */ }
  appendFileSync(full, JSON.stringify(flag) + "\n", "utf8");
  updateAggregate();
}

function updateAggregate(): void {
  try {
    const flags = readAllFlags();
    if (flags.length === 0) return;
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

// Computed LIVE from the merged stores on every call — the on-disk aggregate
// only refreshed when POST /api/quality/flag wrote (never when a thumb landed
// in feedback.jsonl), so it was permanently stale for the path operators
// actually use. Files are a few KB; recomputing beats caching a lie.
export function getQualitySummary(): QualitySummary {
  const flags = readAllFlags();
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
  return {
    totalFlags: total,
    upvotes,
    downvotes,
    rate: total > 0 ? upvotes / total : 1,
    topCategories,
    recentFlags: flags.slice(-20).reverse(),
  };
}

export function getQualityFlags(since?: string): QualityFlag[] {
  const flags = readAllFlags();
  if (since) {
    const sinceTs = new Date(since).getTime();
    return flags.filter(f => new Date(f.ts).getTime() >= sinceTs);
  }
  return flags;
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
