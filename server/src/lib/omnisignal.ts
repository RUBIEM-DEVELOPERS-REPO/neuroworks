// Omnisignal — multi-source intelligent data acquisition.
//
// This is the front-end of the ADRS data pipeline (the "Omnisignal Intelligent
// Data Scraping" + "Local Intellinexus Data" layer in the architecture): it
// pulls raw signal from many source kinds, normalizes each into a uniform
// record stream with provenance, and hands them to ADRS (adrs.publishDataset)
// to be hashed, scored, resolved into golden records, and published as a
// dataset agents learn from.
//
// Mirrors the omnis-signal "Scraper Hub" concepts (Source → scrape →
// normalized Record → publish) but is NeuroWorks-native: it reuses the
// existing web client, company data sources, document extractor, and vault
// index instead of standing up Playwright/Postgres/Redis.
//
// Source kinds:
//   web_search  — a search query → top results (title, url, snippet)
//   web_page    — fetch + extract text from one or more URLs
//   db          — a read-only query against a connected company data source
//   local_file  — extract text from a local document
//   vault       — search the knowledge vault

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { searchWeb, smartFetch } from "./web-client.js";
import { getSourceByLabel, runQuery } from "./data-sources.js";
import { extractDocText } from "./doc-extractor.js";
import { searchVault } from "./vault.js";
import { publishDataset, type PublishResult } from "./adrs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const SOURCES_PATH = resolve(STATE_DIR, "omnisignal-sources.json");

const MAX_PAGE_TEXT = 4000;   // chars of extracted text kept per page record
const MAX_PAGES = 20;         // cap web_page urls per acquisition
const MAX_RECORDS = 5000;     // hard cap on a single acquisition

export type OmniSourceKind = "web_search" | "web_page" | "db" | "local_file" | "vault";

// A reusable, saved source (like a Scraper Hub source). Optional — acquisitions
// can also pass ad-hoc specs without saving.
export type OmniSource = {
  id: string;
  name: string;
  category: string;        // telecom | banking | education | … (free-form tag)
  kind: OmniSourceKind;
  query?: string;          // web_search / vault query, or db SQL
  urls?: string[];         // web_page
  sourceLabel?: string;    // db (label of a connected data source)
  path?: string;           // local_file
  limit?: number;
  createdAt: string;
  lastAcquiredAt?: string;
};

// One acquisition request. Either reference a saved source by id, or describe
// it inline.
export type OmniSpec = {
  sourceId?: string;
  kind?: OmniSourceKind;
  category?: string;
  query?: string;
  urls?: string[];
  sourceLabel?: string;
  path?: string;
  limit?: number;
};

export type OmniRecord = Record<string, unknown>;
export type SourceReport = { source: string; kind: string; category: string; count: number; error?: string };
export type AcquireResult = { records: OmniRecord[]; report: SourceReport[]; total: number };

// ── Source registry ─────────────────────────────────────────────────────────

function loadSources(): OmniSource[] {
  try {
    if (!existsSync(SOURCES_PATH)) return [];
    const parsed = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveSources(list: OmniSource[]): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(SOURCES_PATH, JSON.stringify(list, null, 2), { encoding: "utf8" });
}

export function listSources(): OmniSource[] {
  return loadSources().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSource(id: string): OmniSource | undefined {
  return loadSources().find(s => s.id === id);
}

export function addSource(input: Omit<OmniSource, "id" | "createdAt">): OmniSource {
  const list = loadSources();
  const s: OmniSource = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
  list.push(s);
  saveSources(list);
  return s;
}

export function removeSource(id: string): boolean {
  const list = loadSources();
  const next = list.filter(s => s.id !== id);
  if (next.length === list.length) return false;
  saveSources(next);
  return true;
}

function markAcquired(id: string): void {
  const list = loadSources();
  const s = list.find(x => x.id === id);
  if (s) { s.lastAcquiredAt = new Date().toISOString(); saveSources(list); }
}

// ── Acquisition ─────────────────────────────────────────────────────────────

function specFromSource(s: OmniSource): OmniSpec {
  return { sourceId: s.id, kind: s.kind, category: s.category, query: s.query, urls: s.urls, sourceLabel: s.sourceLabel, path: s.path, limit: s.limit };
}

// Resolve a spec (which may reference a saved source) and acquire its records.
async function acquireOne(spec: OmniSpec): Promise<{ records: OmniRecord[]; label: string; kind: string; category: string; error?: string }> {
  let s = spec;
  if (spec.sourceId) {
    const saved = getSource(spec.sourceId);
    if (saved) s = { ...specFromSource(saved), ...spec, kind: saved.kind };
  }
  const kind = s.kind;
  const category = s.category ?? "general";
  const label = s.sourceId ? (getSource(s.sourceId)?.name ?? s.sourceId) : (s.query ?? s.path ?? (s.urls?.[0]) ?? kind ?? "source");
  const acquiredAt = new Date().toISOString();
  const tag = (r: OmniRecord): OmniRecord => ({ ...r, _source: label, _category: category, _acquiredAt: acquiredAt });

  try {
    if (kind === "web_search") {
      if (!s.query) throw new Error("web_search needs a query");
      const r = await searchWeb(s.query, Math.min(20, s.limit ?? 8));
      const records = r.results.map(h => tag({ title: h.title, url: h.url, snippet: h.snippet }));
      return { records, label, kind, category };
    }
    if (kind === "web_page") {
      const urls = (s.urls ?? []).slice(0, MAX_PAGES);
      if (urls.length === 0) throw new Error("web_page needs at least one url");
      const records: OmniRecord[] = [];
      for (const url of urls) {
        try {
          const f = await smartFetch(url, { allowBrowser: true });
          records.push(tag({ url, title: f.title ?? "", content_type: f.contentType, text: (f.text ?? "").trim().slice(0, MAX_PAGE_TEXT) }));
        } catch (e: any) {
          records.push(tag({ url, error: String(e?.message ?? e).slice(0, 200) }));
        }
      }
      return { records, label, kind, category };
    }
    if (kind === "db") {
      if (!s.sourceLabel || !s.query) throw new Error("db needs sourceLabel + query");
      const src = getSourceByLabel(s.sourceLabel);
      if (!src) throw new Error(`no connected data source labelled "${s.sourceLabel}"`);
      const r = await runQuery(src, s.query, Math.min(MAX_RECORDS, s.limit ?? 1000));
      return { records: r.rows.map(row => tag(row)), label, kind, category };
    }
    if (kind === "local_file") {
      if (!s.path) throw new Error("local_file needs a path");
      const ex = await extractDocText(s.path);
      const text = (ex.text ?? "").trim();
      return { records: [tag({ path: s.path, chars: text.length, text: text.slice(0, MAX_PAGE_TEXT) })], label, kind, category };
    }
    if (kind === "vault") {
      if (!s.query) throw new Error("vault needs a query");
      const hits = searchVault(s.query, Math.min(MAX_RECORDS, s.limit ?? 50));
      return { records: hits.map(h => tag({ path: h.path, line: h.line, preview: h.preview })), label, kind, category };
    }
    throw new Error(`unknown source kind "${kind}"`);
  } catch (e: any) {
    return { records: [], label, kind: kind ?? "?", category, error: String(e?.message ?? e).slice(0, 300) };
  }
}

// Acquire across many specs/sources, returning a merged, provenance-tagged
// record stream plus a per-source report.
export async function acquire(specs: OmniSpec[]): Promise<AcquireResult> {
  const records: OmniRecord[] = [];
  const report: SourceReport[] = [];
  for (const spec of specs) {
    const r = await acquireOne(spec);
    if (spec.sourceId) markAcquired(spec.sourceId);
    report.push({ source: r.label, kind: r.kind, category: r.category, count: r.records.length, error: r.error });
    for (const rec of r.records) {
      if (records.length >= MAX_RECORDS) break;
      records.push(rec);
    }
  }
  return { records, report, total: records.length };
}

// One-shot: acquire from sources, then run the ADRS pipeline and publish a
// dataset agents can learn from. This is the Omnisignal → ADRS bridge.
export async function acquireAndPublish(
  name: string,
  specs: OmniSpec[],
  opts: { sector?: string; keyField?: string; confidenceThreshold?: number } = {},
): Promise<{ acquisition: AcquireResult; published?: PublishResult; note?: string }> {
  const acquisition = await acquire(specs);
  if (acquisition.records.length === 0) {
    return { acquisition, note: "no records acquired — nothing published" };
  }
  const published = publishDataset({
    name,
    records: acquisition.records,
    sector: opts.sector,
    source: "omnisignal",
    keyField: opts.keyField,
    confidenceThreshold: opts.confidenceThreshold,
  });
  return { acquisition, published };
}

export const SOURCE_KINDS: { kind: OmniSourceKind; needs: string; description: string }[] = [
  { kind: "web_search", needs: "query", description: "Search the web → top results (title, url, snippet)." },
  { kind: "web_page", needs: "urls[]", description: "Fetch + extract text from one or more URLs." },
  { kind: "db", needs: "sourceLabel + query", description: "Read-only query against a connected company data source." },
  { kind: "local_file", needs: "path", description: "Extract text from a local document (PDF/DOCX/etc.)." },
  { kind: "vault", needs: "query", description: "Search the knowledge vault." },
];
