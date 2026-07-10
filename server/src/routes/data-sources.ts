// Company data sources — database connections + company-knowledge folder.
//
// Database connections persist in .neuroworks/data-sources.json (outside
// the vault since the connection string carries credentials). The full
// connection string never leaves this server — list/get redact the password
// before sending to the UI. Agents reach a source by id via the db.*
// primitives, which load the full connection from the registry server-side.
//
// Company knowledge lives in the vault under _company/. The route below
// just lists what's there; uploads go through /api/uploads which already
// handles binary extraction + sidecar generation.

import { Router } from "express";
import {
  listSources,
  getSource,
  addSource,
  removeSource,
  runQuery,
  describeSource,
  redactConnection,
  type DataSourceKind,
} from "../lib/data-sources.js";
import { listVault, getVaultHealth } from "../lib/vault.js";
import {
  listDepartmentData, listDepartments, addDepartmentDatum,
  updateDepartmentDatum, removeDepartmentDatum,
} from "../lib/department-data.js";
import { ingestDepartmentData } from "../lib/doc-ingest.js";

export const dataSourcesRouter = Router();

dataSourcesRouter.get("/", (_req, res) => {
  const items = listSources().map(s => ({ ...s, connection: redactConnection(s.connection, s.kind) }));
  res.json({ sources: items });
});

// IMPORTANT: /company-files must be declared BEFORE the /:id routes below,
// or Express matches "company-files" as a source id and returns 404.
dataSourcesRouter.get("/company-files", (_req, res) => {
  const h = getVaultHealth();
  if (!h.exists) {
    return res.json({ entries: [], note: `vault unreachable: ${h.reason ?? "unknown"}` });
  }
  try { res.json({ entries: listVault("_company") }); }
  catch (e: any) {
    // Folder doesn't exist yet — that's fine, just report empty.
    res.json({ entries: [], note: e?.message ?? "no _company folder yet" });
  }
});

// ─── Department-specific company data ───────────────────────────────────
// Declared BEFORE the /:id routes so "departments" isn't matched as a source
// id. GET lists all (optionally filtered by ?department=), POST adds, PATCH
// edits, DELETE removes. Agents read this via the company.department_data
// primitive.
dataSourcesRouter.get("/departments", (req, res) => {
  const dept = typeof req.query.department === "string" ? req.query.department : undefined;
  res.json({ departments: listDepartments(), data: listDepartmentData(dept) });
});

dataSourcesRouter.post("/departments", (req, res) => {
  try {
    const datum = addDepartmentDatum({
      department: String(req.body?.department ?? ""),
      title: String(req.body?.title ?? ""),
      content: String(req.body?.content ?? ""),
    });
    res.json({ datum });
  } catch (e: any) { res.status(400).json({ error: e?.message ?? String(e) }); }
});

// Scan an uploaded document (any type) for department-specific facts and add
// them. Body: { filename, contentBase64, department? }. Declared before /:id.
dataSourcesRouter.post("/departments/import", async (req, res) => {
  try {
    const filename = String(req.body?.filename ?? "").trim();
    const contentBase64 = String(req.body?.contentBase64 ?? "");
    const departmentHint = req.body?.department ? String(req.body.department).trim() : undefined;
    if (!filename || !contentBase64) return res.status(400).json({ error: "filename and contentBase64 are required" });

    const entries = await ingestDepartmentData({ filename, contentBase64, departmentHint });
    const added = entries.map(e => addDepartmentDatum(e));
    res.json({ scanned: entries.length, added });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? String(e) });
  }
});

dataSourcesRouter.patch("/departments/:id", (req, res) => {
  const updated = updateDepartmentDatum(String(req.params.id), {
    department: req.body?.department !== undefined ? String(req.body.department) : undefined,
    title: req.body?.title !== undefined ? String(req.body.title) : undefined,
    content: req.body?.content !== undefined ? String(req.body.content) : undefined,
  });
  if (!updated) return res.status(404).json({ error: "department datum not found" });
  res.json({ datum: updated });
});

dataSourcesRouter.delete("/departments/:id", (req, res) => {
  const ok = removeDepartmentDatum(String(req.params.id));
  if (!ok) return res.status(404).json({ error: "department datum not found" });
  res.json({ ok: true });
});

dataSourcesRouter.post("/", (req, res) => {
  try {
    const label = String(req.body?.label ?? "").trim();
    const kind = String(req.body?.kind ?? "").trim() as DataSourceKind;
    const connection = String(req.body?.connection ?? "").trim();
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 500) : undefined;
    const department = req.body?.department ? String(req.body.department).trim().slice(0, 80) : undefined;
    const readonly = req.body?.readonly !== false;
    if (!label) return res.status(400).json({ error: "label required" });
    if (!["postgres", "mysql", "sqlite", "mssql", "mongodb"].includes(kind)) return res.status(400).json({ error: "kind must be postgres | mysql | sqlite | mssql | mongodb" });
    if (!connection) return res.status(400).json({ error: "connection required" });
    if (label.length > 100) return res.status(400).json({ error: "label too long (max 100 chars)" });
    if (connection.length > 1000) return res.status(400).json({ error: "connection too long (max 1000 chars)" });
    const ds = addSource({ label, kind, connection, notes, department, readonly });
    res.json({ source: { ...ds, connection: redactConnection(ds.connection, ds.kind) } });
  } catch (e: any) { res.status(400).json({ error: e?.message ?? String(e) }); }
});

dataSourcesRouter.delete("/:id", (req, res) => {
  const ok = removeSource(String(req.params.id));
  if (!ok) return res.status(404).json({ error: "source not found" });
  res.json({ ok: true });
});

dataSourcesRouter.post("/:id/test", async (req, res) => {
  const src = getSource(String(req.params.id));
  if (!src) return res.status(404).json({ error: "source not found" });
  try {
    if (src.kind === "mongodb") {
      // No SQL — prove connectivity by listing collections instead.
      const schema = await describeSource(src);
      res.json({ ok: true, rowCount: schema.tables.length });
    } else {
      const r = await runQuery(src, "SELECT 1 AS ok", 1);
      res.json({ ok: true, rowCount: r.rowCount });
    }
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? String(e) });
  }
});

dataSourcesRouter.post("/:id/query", async (req, res) => {
  const src = getSource(String(req.params.id));
  if (!src) return res.status(404).json({ error: "source not found" });
  const sql = String(req.body?.sql ?? "").trim();
  if (!sql) return res.status(400).json({ error: "sql required" });
  const limit = Math.min(1000, Math.max(1, Number(req.body?.limit) || 200));
  try { res.json(await runQuery(src, sql, limit)); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? String(e) }); }
});

dataSourcesRouter.get("/:id/schema", async (req, res) => {
  const src = getSource(String(req.params.id));
  if (!src) return res.status(404).json({ error: "source not found" });
  try { res.json(await describeSource(src)); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? String(e) }); }
});
