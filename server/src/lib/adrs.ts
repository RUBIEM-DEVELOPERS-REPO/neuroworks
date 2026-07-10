// ADRS — AI Data Readiness System pipeline.
//
// This is NeuroWorks' main data pipeline. It takes raw records (from a company
// data source, an upload, a scrape, or inline JSON) and runs them through the
// ADRS stages, then PUBLISHES a versioned dataset into the vault as three
// machine-ready artifacts (ML CSV, knowledge-graph JSONL, RAG chunks) plus a
// knowledge-pack card. Because the artifacts live in the vault they're indexed
// by vault-index, so agents LEARN from every published dataset via retrieval —
// the published dataset shows up as a knowledge pack (see knowledge-packs.ts).
//
// Stage map (mirrors the ADRS architecture diagram):
//   1. Normalization Engine        — canonicalise keys, trim/clean values, coerce types
//   2. Cryptographic Hashing       — SHA-256 per record + a Merkle-style batch root hash
//   3. Confidence Scoring          — completeness score per record (0..1)
//   4. HITL Validation gate        — records below the threshold are flagged for review
//   5. Entity Resolution           — dedup by hash, merge duplicates into a Golden Record
//   6. Dataset Publishing          — write CSV + JSONL + RAG chunks + pack card to the vault
//   7. Autonomous Feedback Loop    — published artifacts re-enter the vault index for agents
//
// Deterministic + dependency-free (node crypto + fs) so it runs in the free
// local core (Approach D) with no API keys.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { writeVaultFile } from "./vault.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const REGISTRY_PATH = resolve(STATE_DIR, "datasets.json");

// Vault folder that holds every published dataset. Lives under the vault so the
// index picks it up and the Knowledge browser can open the artifacts.
export const DATASETS_DIR = "_datasets";

export type AdrsRecord = Record<string, unknown>;

export type StageReport = {
  stage: string;
  in: number;
  out: number;
  note: string;
};

export type DatasetManifest = {
  id: string;
  name: string;
  sector?: string;
  source: string;
  createdAt: string;
  rawCount: number;        // input records
  recordCount: number;     // golden records published
  reviewQueue: number;     // records flagged for HITL review
  avgConfidence: number;   // mean confidence of published records (0..1)
  rootHash: string;        // batch root hash (tamper-evident provenance anchor)
  fields: string[];        // union of golden-record field names
  stages: StageReport[];
  outputs: { csv: string; jsonl: string; rag: string; card: string };
};

export type PublishInput = {
  name: string;
  records: AdrsRecord[];
  sector?: string;
  source?: string;
  keyField?: string;            // entity-resolution merge key; falls back to full-hash dedup
  confidenceThreshold?: number; // default 0.6
};

// ── Registry (manifests live outside the vault — derived metadata) ──────────

function loadRegistry(): DatasetManifest[] {
  try {
    if (!existsSync(REGISTRY_PATH)) return [];
    const parsed = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveRegistry(list: DatasetManifest[]): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(list, null, 2), { encoding: "utf8" });
}

export function listDatasets(): DatasetManifest[] {
  return loadRegistry().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDataset(id: string): DatasetManifest | undefined {
  return loadRegistry().find(d => d.id === id);
}

export function deleteDataset(id: string): boolean {
  const list = loadRegistry();
  const next = list.filter(d => d.id !== id);
  if (next.length === list.length) return false;
  saveRegistry(next);
  return true;
}

// ── Stage 1: Normalization Engine ───────────────────────────────────────────

function canonicalKey(k: string): string {
  return k.trim().toLowerCase().replace(/[\s.]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function coerce(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const t = v.trim().replace(/\s+/g, " ");
    if (t === "" || /^(n\/?a|null|none|-)$/i.test(t)) return null;
    // Numeric-looking strings → numbers (keeps CSVs ML-ready).
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
    return t;
  }
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function normalizeRecord(rec: AdrsRecord): AdrsRecord {
  const out: AdrsRecord = {};
  for (const [k, v] of Object.entries(rec)) {
    const key = canonicalKey(k);
    if (!key) continue;
    out[key] = coerce(v);
  }
  return out;
}

// ── Stage 2: Cryptographic Hashing ──────────────────────────────────────────

function hashRecord(rec: AdrsRecord): string {
  // Sort keys so logically-identical records hash equal regardless of column order.
  const sorted = Object.keys(rec).sort().map(k => [k, rec[k]]);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

// Merkle-style fold over the per-record hashes → a single tamper-evident root
// for the whole batch (the "immutable digital barcode" in the diagram).
function rootHashOf(hashes: string[]): string {
  if (hashes.length === 0) return createHash("sha256").update("empty").digest("hex");
  let layer = [...hashes].sort();
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i];
      const b = layer[i + 1] ?? a; // odd node duplicates up
      next.push(createHash("sha256").update(a + b).digest("hex"));
    }
    layer = next;
  }
  return layer[0];
}

// ── Stage 3: Confidence Scoring ─────────────────────────────────────────────
// Completeness against the dataset-wide field universe. A record that fills
// every known column scores 1.0; sparse rows score lower and get gated by HITL.

function scoreConfidence(rec: AdrsRecord, fieldUniverse: string[]): number {
  if (fieldUniverse.length === 0) return 0;
  let filled = 0;
  for (const f of fieldUniverse) {
    const v = rec[f];
    if (v !== null && v !== undefined && v !== "") filled += 1;
  }
  return Math.round((filled / fieldUniverse.length) * 1000) / 1000;
}

// ── Stage 5: Entity Resolution → Golden Record ──────────────────────────────
// Group by keyField (or by full-record hash when no key). Within a group, the
// highest-confidence record is the base; nulls are backfilled from the rest.
// One Golden Record per entity.

type Scored = { rec: AdrsRecord; hash: string; confidence: number; review: boolean };

function goldenRecords(rows: Scored[], keyField?: string): Scored[] {
  const groups = new Map<string, Scored[]>();
  for (const r of rows) {
    const key = keyField && r.rec[keyField] != null ? `k:${String(r.rec[keyField])}` : `h:${r.hash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const golden: Scored[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => b.confidence - a.confidence);
    const base = { ...group[0].rec };
    for (const dup of group.slice(1)) {
      for (const [k, v] of Object.entries(dup.rec)) {
        if ((base[k] === null || base[k] === undefined || base[k] === "") && v != null && v !== "") {
          base[k] = v;
        }
      }
    }
    const hash = hashRecord(base);
    golden.push({ rec: base, hash, confidence: group[0].confidence, review: group[0].review });
  }
  return golden;
}

// ── Output serialisers ──────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: AdrsRecord[], fields: string[]): string {
  const lines = [fields.map(csvCell).join(",")];
  for (const r of rows) lines.push(fields.map(f => csvCell(r[f])).join(","));
  return lines.join("\n") + "\n";
}

// Knowledge-graph JSONL: one node per golden record + one edge per non-null
// field value (entity → attribute value). Simple, but real relational structure
// an agent or downstream tool can traverse.
function toGraphJsonl(rows: Scored[], fields: string[], keyField: string | undefined, datasetId: string): string {
  const out: string[] = [];
  rows.forEach((r, i) => {
    const id = keyField && r.rec[keyField] != null ? `${datasetId}:${String(r.rec[keyField])}` : `${datasetId}:${r.hash.slice(0, 12)}`;
    const label = keyField && r.rec[keyField] != null ? String(r.rec[keyField]) : `record-${i + 1}`;
    out.push(JSON.stringify({ type: "node", id, label, props: r.rec, confidence: r.confidence, hash: r.hash }));
    for (const f of fields) {
      if (f === keyField) continue;
      const v = r.rec[f];
      if (v === null || v === undefined || v === "") continue;
      out.push(JSON.stringify({ type: "edge", from: id, rel: f, to: String(v) }));
    }
  });
  return out.join("\n") + "\n";
}

// RAG-ready chunks: one markdown section per golden record. vault-index treats
// the whole file as a searchable doc; the per-record headings keep retrieval
// previews legible.
function toRagMarkdown(name: string, rows: Scored[], fields: string[]): string {
  const head = `# ${name} — RAG chunks\n\n> Published dataset. Each section is one golden record an agent can retrieve.\n`;
  const chunks = rows.map((r, i) => {
    const body = fields
      .filter(f => r.rec[f] !== null && r.rec[f] !== undefined && r.rec[f] !== "")
      .map(f => `- **${f}**: ${r.rec[f]}`)
      .join("\n");
    return `## Record ${i + 1}\n${body}\n\n_confidence: ${r.confidence} · hash: ${r.hash.slice(0, 12)}_`;
  });
  return head + "\n" + chunks.join("\n\n") + "\n";
}

function packCard(m: DatasetManifest, sampleFields: string[]): string {
  return `# ${m.name} — Dataset Knowledge Pack

> Published by the Intellinexus data pipeline. Agents learn from this dataset via vault
> retrieval — search for its subject and the records below surface as context.

## Provenance & audit
- **Dataset id**: \`${m.id}\`
- **Source**: ${m.source}
- **Sector**: ${m.sector ?? "general"}
- **Published**: ${m.createdAt}
- **Batch root hash** (tamper-evident): \`${m.rootHash}\`
- **Records**: ${m.recordCount} golden (${m.rawCount} raw in) · **avg confidence**: ${(m.avgConfidence * 100).toFixed(1)}%
- **HITL review queue**: ${m.reviewQueue} record${m.reviewQueue === 1 ? "" : "s"} flagged below confidence threshold

## Fields
${m.fields.map(f => `- \`${f}\``).join("\n")}

## Pipeline stages
| Stage | In | Out | Note |
|---|---|---|---|
${m.stages.map(s => `| ${s.stage} | ${s.in} | ${s.out} | ${s.note} |`).join("\n")}

## Machine-ready outputs
- **ML CSV** — \`${m.outputs.csv}\`
- **Knowledge-graph JSONL** — \`${m.outputs.jsonl}\`
- **RAG chunks** — \`${m.outputs.rag}\`

## How agents use this
The RAG chunks and this card are indexed in the vault. Any agent answering a
question in this domain retrieves the golden records as grounding. Sample fields:
${sampleFields.map(f => `\`${f}\``).join(", ")}.
`;
}

// ── The pipeline ────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "dataset";
}

export type PublishResult = { manifest: DatasetManifest };

// Run the full ADRS pipeline over `records` and publish the dataset.
export function publishDataset(input: PublishInput): PublishResult {
  const threshold = input.confidenceThreshold ?? 0.6;
  const raw = Array.isArray(input.records) ? input.records : [];
  const stages: StageReport[] = [];

  // 1. Normalization
  const normalized = raw.map(normalizeRecord).filter(r => Object.keys(r).length > 0);
  stages.push({ stage: "Normalization", in: raw.length, out: normalized.length, note: "canonical keys, trimmed + type-coerced values" });

  // Field universe (post-normalization) drives confidence + CSV columns.
  const fieldSet = new Set<string>();
  for (const r of normalized) for (const k of Object.keys(r)) fieldSet.add(k);
  const fieldUniverse = [...fieldSet];

  // 2. Cryptographic hashing
  const hashed: Scored[] = normalized.map(rec => ({ rec, hash: hashRecord(rec), confidence: 0, review: false }));
  const rootHash = rootHashOf(hashed.map(h => h.hash));
  stages.push({ stage: "Cryptographic Hashing", in: normalized.length, out: hashed.length, note: `SHA-256 per record; batch root ${rootHash.slice(0, 12)}…` });

  // 3. Confidence scoring + 4. HITL gate
  let reviewQueue = 0;
  for (const h of hashed) {
    h.confidence = scoreConfidence(h.rec, fieldUniverse);
    h.review = h.confidence < threshold;
    if (h.review) reviewQueue += 1;
  }
  stages.push({ stage: "Confidence Scoring", in: hashed.length, out: hashed.length, note: `completeness over ${fieldUniverse.length} fields` });
  stages.push({ stage: "HITL Validation", in: hashed.length, out: hashed.length - reviewQueue, note: `${reviewQueue} flagged below ${threshold} confidence` });

  // 5. Entity resolution → golden records
  const golden = goldenRecords(hashed, input.keyField ? canonicalKey(input.keyField) : undefined);
  stages.push({ stage: "Entity Resolution", in: hashed.length, out: golden.length, note: input.keyField ? `merged on "${input.keyField}"` : "deduplicated by record hash" });

  // Recompute the published field universe from golden records (merge may add columns).
  const goldenFieldSet = new Set<string>();
  for (const g of golden) for (const k of Object.keys(g.rec)) goldenFieldSet.add(k);
  const fields = [...goldenFieldSet];

  const avgConfidence = golden.length
    ? Math.round((golden.reduce((s, g) => s + g.confidence, 0) / golden.length) * 1000) / 1000
    : 0;

  // 6. Publish artifacts to the vault.
  const id = `${slugify(input.name)}-${Date.now().toString(36)}`;
  const base = `${DATASETS_DIR}/${id}`;
  const outputs = {
    csv: `${base}/dataset.csv`,
    jsonl: `${base}/graph.jsonl`,
    rag: `${base}/rag.md`,
    card: `${base}/00-${slugify(input.name)}.md`,
  };

  const manifest: DatasetManifest = {
    id,
    name: input.name,
    sector: input.sector,
    source: input.source ?? "inline",
    createdAt: new Date().toISOString(),
    rawCount: raw.length,
    recordCount: golden.length,
    reviewQueue,
    avgConfidence,
    rootHash,
    fields,
    stages,
    outputs,
  };

  writeVaultFile(outputs.csv, toCsv(golden.map(g => g.rec), fields));
  writeVaultFile(outputs.jsonl, toGraphJsonl(golden, fields, input.keyField ? canonicalKey(input.keyField) : undefined, id));
  writeVaultFile(outputs.rag, toRagMarkdown(input.name, golden, fields));
  writeVaultFile(outputs.card, packCard(manifest, fields.slice(0, 8)));

  stages.push({ stage: "Dataset Publishing", in: golden.length, out: golden.length, note: "CSV + JSONL + RAG + pack card written to vault" });

  // 7. Register (the vault watcher re-indexes the new files → agents can learn).
  const list = loadRegistry();
  list.push(manifest);
  saveRegistry(list);

  return { manifest };
}

// Convenience used by the route + primitive: turn DB/CSV query rows into a dataset.
export function publishFromRows(name: string, rows: AdrsRecord[], opts: Partial<PublishInput> = {}): PublishResult {
  return publishDataset({ name, records: rows, ...opts });
}

export function vaultDatasetsRoot(): string {
  return resolve(config.vaultPath, DATASETS_DIR);
}
