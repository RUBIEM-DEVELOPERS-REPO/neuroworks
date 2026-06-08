import { Router } from "express";
import { PROVIDERS, listConnections, addConnection, removeConnection, testConnection, testAllConnections } from "../lib/integrations.js";

// Integrations API — the user connects external services so agents can act on
// them. Secret values are encrypted at rest by the lib and NEVER returned here;
// responses only carry which secret fields are held, plus non-secret config.

export const integrationsRouter = Router();

// Provider catalog — what can be connected and which fields each needs.
integrationsRouter.get("/catalog", (_req, res) => res.json({ providers: PROVIDERS }));

// Connected services (redacted — no secret values).
integrationsRouter.get("/", (_req, res) => res.json({ connections: listConnections() }));

// Add a connection. body: { providerId, label?, values: { field: value } }
integrationsRouter.post("/", (req, res) => {
  try {
    const providerId = String(req.body?.providerId ?? "");
    const label = String(req.body?.label ?? "");
    const values = (req.body?.values && typeof req.body.values === "object") ? req.body.values as Record<string, string> : {};
    const connection = addConnection(providerId, label, values);
    res.json({ connection });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Test ALL connections at once (used by the "Test all" button). Defined before
// the :id route so "test-all" isn't captured as an id.
integrationsRouter.post("/test-all", async (_req, res) => {
  try {
    res.json({ results: await testAllConnections() });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// Non-destructive auth test for a connection.
integrationsRouter.post("/:id/test", async (req, res) => {
  try {
    res.json(await testConnection(String(req.params.id)));
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

integrationsRouter.delete("/:id", (req, res) => {
  const ok = removeConnection(String(req.params.id));
  if (!ok) return res.status(404).json({ error: "connection not found" });
  res.json({ ok: true });
});
