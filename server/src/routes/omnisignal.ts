import { Router } from "express";
import {
  listSources, addSource, removeSource, acquire, acquireAndPublish,
  SOURCE_KINDS, type OmniSpec, type OmniSourceKind,
} from "../lib/omnisignal.js";

// Omnisignal — multi-source data acquisition that feeds the ADRS pipeline.
// Mounted at /api/omnisignal.

export const omnisignalRouter = Router();

// Capability discovery — what source kinds exist and what each needs.
omnisignalRouter.get("/kinds", (_req, res) => {
  res.json({ kinds: SOURCE_KINDS });
});

// Saved source registry.
omnisignalRouter.get("/sources", (_req, res) => {
  res.json({ sources: listSources() });
});

omnisignalRouter.post("/sources", (req, res) => {
  const { name, category, kind, query, urls, sourceLabel, path, limit } = req.body ?? {};
  if (!name || !kind) return res.status(400).json({ error: "name and kind are required" });
  if (!SOURCE_KINDS.some(k => k.kind === kind)) return res.status(400).json({ error: `unknown kind "${kind}"` });
  const s = addSource({
    name: String(name),
    category: String(category ?? "general"),
    kind: kind as OmniSourceKind,
    query: query ? String(query) : undefined,
    urls: Array.isArray(urls) ? urls.map(String) : undefined,
    sourceLabel: sourceLabel ? String(sourceLabel) : undefined,
    path: path ? String(path) : undefined,
    limit: typeof limit === "number" ? limit : undefined,
  });
  res.json({ source: s });
});

omnisignalRouter.delete("/sources/:id", (req, res) => {
  const ok = removeSource(req.params.id);
  if (!ok) return res.status(404).json({ error: "source not found" });
  res.json({ ok: true });
});

// Acquire from sources/specs without publishing (a research read).
omnisignalRouter.post("/acquire", async (req, res) => {
  try {
    const specs = normalizeSpecs(req.body);
    if (specs.length === 0) return res.status(400).json({ error: "provide sources[] (specs or {sourceId})" });
    const result = await acquire(specs);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Acquire + run ADRS + publish a dataset.
omnisignalRouter.post("/publish", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const specs = normalizeSpecs(req.body);
    if (specs.length === 0) return res.status(400).json({ error: "provide sources[]" });
    const out = await acquireAndPublish(name, specs, {
      sector: req.body?.sector ? String(req.body.sector) : undefined,
      keyField: req.body?.keyField ? String(req.body.keyField) : undefined,
      confidenceThreshold: typeof req.body?.confidenceThreshold === "number" ? req.body.confidenceThreshold : undefined,
    });
    res.json(out);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

function normalizeSpecs(body: any): OmniSpec[] {
  const raw = Array.isArray(body?.sources) ? body.sources : [];
  return raw.filter((s: any) => s && typeof s === "object");
}
