import { Router } from "express";
import { listDatasets, getDataset, deleteDataset, publishDataset } from "../lib/adrs.js";
import { getSourceByLabel, runQuery } from "../lib/data-sources.js";
import { readVaultFile } from "../lib/vault.js";

export const datasetsRouter = Router();

// List published datasets (manifests only — artifacts live in the vault).
datasetsRouter.get("/", (_req, res) => {
  res.json({ datasets: listDatasets() });
});

datasetsRouter.get("/:id", (req, res) => {
  const d = getDataset(req.params.id);
  if (!d) return res.status(404).json({ error: "dataset not found" });
  res.json({ dataset: d });
});

// Fetch one of a dataset's machine-ready outputs (csv | jsonl | rag | card).
datasetsRouter.get("/:id/output/:kind", (req, res) => {
  const d = getDataset(req.params.id);
  if (!d) return res.status(404).json({ error: "dataset not found" });
  const kind = req.params.kind as keyof typeof d.outputs;
  const rel = d.outputs[kind];
  if (!rel) return res.status(400).json({ error: `unknown output "${req.params.kind}" (csv|jsonl|rag|card)` });
  try {
    const content = readVaultFile(rel);
    const type = kind === "csv" ? "text/csv" : kind === "jsonl" ? "application/x-ndjson" : "text/markdown";
    res.type(type).send(content);
  } catch (e: any) {
    res.status(503).json({ error: `could not read ${rel}: ${e?.message ?? e}` });
  }
});

// Publish a dataset through the ADRS pipeline. Accepts inline rows OR a
// company data source + query.
datasetsRouter.post("/publish", async (req, res) => {
  try {
    const { name, sector, keyField, confidenceThreshold } = req.body ?? {};
    if (!name || typeof name !== "string") return res.status(400).json({ error: "name is required" });

    let rows: Record<string, unknown>[] = [];
    let source = "inline";
    if (req.body?.sourceLabel && req.body?.query) {
      const src = getSourceByLabel(String(req.body.sourceLabel));
      if (!src) return res.status(404).json({ error: `no data source labelled "${req.body.sourceLabel}"` });
      const r = await runQuery(src, String(req.body.query), 5000);
      rows = r.rows;
      source = `data-source:${req.body.sourceLabel}`;
    } else if (Array.isArray(req.body?.records)) {
      rows = req.body.records;
      source = req.body?.source ? String(req.body.source) : "inline";
    } else {
      return res.status(400).json({ error: "provide records[] OR sourceLabel + query" });
    }
    if (rows.length === 0) return res.status(400).json({ error: "no rows to publish" });

    const { manifest } = publishDataset({
      name, records: rows, sector, source, keyField,
      confidenceThreshold: typeof confidenceThreshold === "number" ? confidenceThreshold : undefined,
    });
    res.json({ ok: true, dataset: manifest });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

datasetsRouter.delete("/:id", (req, res) => {
  const ok = deleteDataset(req.params.id);
  if (!ok) return res.status(404).json({ error: "dataset not found" });
  res.json({ ok: true });
});
