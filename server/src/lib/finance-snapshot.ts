// Finance snapshot store — the ingest side of the company Finance System link.
//
// The external Finance System PUSHES its dashboard figures to NeuroWorks
// (POST /api/public/dashboard or its /sync alias); we normalise them to a
// stable 5-field shape and persist the latest snapshot. Aria (the Aiia Finance
// Officer persona) and the "Aiia Finance" connector then READ this snapshot
// (GET /api/public/dashboard) instead of reaching out to a live host — so the
// figures are always the real numbers the Finance System last sent, and there
// is no unreachable-host failure.
//
// State lives in .neuroworks/finance-snapshot.json (a mounted volume in the
// container), so a restart or redeploy keeps the last-known figures.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "../config.js";

const SNAPSHOT_REL = "_neuroworks/finance-snapshot.json";
const HISTORY_REL = "_neuroworks/finance-sync.jsonl";

// The 5 canonical fields every consumer can rely on. The Finance System may
// name its keys differently — we alias generously so a reasonable payload maps
// without the sender having to match our vocabulary exactly.
export type FinanceMapped = {
  revenue: number | null;
  expenses: number | null;
  netProfit: number | null;
  cashBalance: number | null;
  outstanding: number | null;
};

export type FinanceSnapshot = {
  mapped: FinanceMapped;
  currency: string | null;
  period: string | null;   // e.g. "2026" or "2026-06" — whatever the sender labels the figures with
  source: string;          // "dashboard" | "sync" | free-form sender id
  receivedAt: string;      // ISO timestamp we stored it
  raw: Record<string, unknown>; // the untouched payload, so nothing is lost even if a key wasn't mapped
};

// Alias tables — first present, numeric-coercible key wins. Lower-cased match.
const ALIASES: Record<keyof FinanceMapped, string[]> = {
  revenue: ["revenue", "totalrevenue", "income", "totalincome", "turnover", "sales", "grossrevenue"],
  expenses: ["expenses", "totalexpenses", "costs", "totalcosts", "spend", "expenditure", "opex"],
  netProfit: ["netprofit", "profit", "net", "netincome", "surplus", "bottomline", "ebit"],
  cashBalance: ["cashbalance", "cash", "cashonhand", "bankbalance", "balance", "cashposition", "liquidity"],
  outstanding: ["outstanding", "receivables", "outstandinginvoices", "accountsreceivable", "ar", "artotal", "owed", "debtors"],
};

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // Tolerate "R 1,234.50", "$1.2m", "1 234" — strip currency/grouping.
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Build a lower-cased flat view of the payload so aliasing is case-insensitive
// and reaches one level into a nested { data: {...} } / { dashboard: {...} }.
function flatten(payload: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const eat = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = k.toLowerCase();
      if (v && typeof v === "object" && !Array.isArray(v)) {
        // one level of nesting: keep the container's own scalars AND recurse
        if (!(key in flat)) flat[key] = v;
        eat(v as Record<string, unknown>);
      } else if (!(key in flat)) {
        flat[key] = v;
      }
    }
  };
  eat(payload);
  return flat;
}

export function mapFinanceFields(payload: Record<string, unknown>): FinanceMapped {
  const flat = flatten(payload);
  const pick = (keys: string[]): number | null => {
    for (const k of keys) {
      if (k in flat) {
        const n = toNumber(flat[k]);
        if (n !== null) return n;
      }
    }
    return null;
  };
  const mapped: FinanceMapped = {
    revenue: pick(ALIASES.revenue),
    expenses: pick(ALIASES.expenses),
    netProfit: pick(ALIASES.netProfit),
    cashBalance: pick(ALIASES.cashBalance),
    outstanding: pick(ALIASES.outstanding),
  };
  // Derive net profit if the sender gave revenue + expenses but no explicit net.
  if (mapped.netProfit === null && mapped.revenue !== null && mapped.expenses !== null) {
    mapped.netProfit = mapped.revenue - mapped.expenses;
  }
  return mapped;
}

function snapshotPath(): string { return resolve(config.vaultPath, SNAPSHOT_REL); }
function historyPath(): string { return resolve(config.vaultPath, HISTORY_REL); }

export function saveFinanceSnapshot(payload: Record<string, unknown>, source: string): FinanceSnapshot {
  const flat = flatten(payload);
  const currency = (typeof flat["currency"] === "string" ? String(flat["currency"]) : null);
  const period = (["period", "year", "month", "quarter", "asof", "asat"]
    .map(k => flat[k]).find(v => v !== undefined && v !== null));
  const snap: FinanceSnapshot = {
    mapped: mapFinanceFields(payload),
    currency: currency ? currency.toUpperCase() : null,
    period: period !== undefined && period !== null ? String(period) : null,
    source,
    receivedAt: new Date().toISOString(),
    raw: payload,
  };
  const full = snapshotPath();
  try { mkdirSync(dirname(full), { recursive: true }); } catch { /* tolerate */ }
  writeFileSync(full, JSON.stringify(snap, null, 2), "utf8");
  // Append-only history so we can see the sync cadence + trend later.
  try { appendFileSync(historyPath(), JSON.stringify({ at: snap.receivedAt, source, mapped: snap.mapped, period: snap.period, currency: snap.currency }) + "\n", "utf8"); } catch { /* best-effort */ }
  return snap;
}

export function getFinanceSnapshot(): FinanceSnapshot | null {
  const full = snapshotPath();
  if (!existsSync(full)) return null;
  try { return JSON.parse(readFileSync(full, "utf8")) as FinanceSnapshot; }
  catch { return null; }
}
