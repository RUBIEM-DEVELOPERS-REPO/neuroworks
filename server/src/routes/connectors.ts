import { Router } from "express";
import {
  listConnectors, getConnectorPublic, addConnector, updateConnector,
  removeConnector, testConnector, callConnector,
} from "../lib/connectors.js";

// Company-system connectors API — the operator registers external HTTP APIs
// (an existing in-house system, a SaaS REST API, …) that agents may call.
// Secrets are encrypted at rest by the lib and NEVER returned here; responses
// carry only the auth scheme + a boolean "secretSet".

export const connectorsRouter = Router();

// Auth schemes the UI can offer — small static catalog so the form can render
// the right fields without hardcoding them client-side.
const AUTH_TYPES = [
  { type: "none", label: "No auth", fields: [] },
  { type: "bearer", label: "Bearer token", fields: [{ name: "token", label: "Token", secret: true }] },
  { type: "apiKey", label: "API key", fields: [
    { name: "in", label: "Send in", secret: false }, { name: "name", label: "Param name", secret: false }, { name: "value", label: "Key", secret: true },
  ] },
  { type: "basic", label: "Basic auth", fields: [{ name: "username", label: "Username", secret: false }, { name: "password", label: "Password", secret: true }] },
  { type: "header", label: "Custom header", fields: [{ name: "name", label: "Header name", secret: false }, { name: "value", label: "Header value", secret: true }] },
];

connectorsRouter.get("/catalog", (_req, res) => res.json({ authTypes: AUTH_TYPES }));

connectorsRouter.get("/", (_req, res) => res.json({ connectors: listConnectors() }));

// Add a connector. body: { label, baseUrl, description?, auth?, headers?, endpoints?, writeEnabled? }
connectorsRouter.post("/", (req, res) => {
  try {
    res.json({ connector: addConnector(req.body ?? {}) });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Test-by-id route is defined under :id below. Describe a single connector
// (full manifest, no secrets) — what an agent reads to understand the system.
connectorsRouter.get("/:id", (req, res) => {
  const c = getConnectorPublic(String(req.params.id));
  if (!c) return res.status(404).json({ error: "connector not found" });
  res.json({ connector: c });
});

connectorsRouter.patch("/:id", (req, res) => {
  try {
    const c = updateConnector(String(req.params.id), req.body ?? {});
    if (!c) return res.status(404).json({ error: "connector not found" });
    res.json({ connector: c });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

connectorsRouter.delete("/:id", (req, res) => {
  const ok = removeConnector(String(req.params.id));
  if (!ok) return res.status(404).json({ error: "connector not found" });
  res.json({ ok: true });
});

connectorsRouter.post("/:id/test", async (req, res) => {
  try {
    res.json(await testConnector(String(req.params.id)));
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// Manual invoke (operator "try it" button). body: { method?, path, query?, body?, headers? }
connectorsRouter.post("/:id/call", async (req, res) => {
  try {
    const b = req.body ?? {};
    const result = await callConnector(String(req.params.id), {
      method: b.method, path: String(b.path ?? ""), query: b.query, body: b.body, headers: b.headers,
    });
    res.json({ result });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
