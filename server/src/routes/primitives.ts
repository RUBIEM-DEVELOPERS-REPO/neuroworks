import { Router } from "express";
import { primitives, findPrimitive, type Primitive } from "../lib/primitives.js";

// Primitives bridge — exposes a CURATED subset of clawbot's agent primitives
// over HTTP so an external agent (Hermes, via the MCP bridge in mcp/clawbot-
// mcp.mjs) can call clawbot's real tools: vault grounding, connectors (→ AIIA),
// integrations, web reads, and read-only payment status. Execution happens here
// in the LIVE server, so the real vault path + encrypted connector secrets are
// used. NOT exposed: money-moving (payment.link) or destructive writes
// (vault.edit/write/append, web.interact) — see ALLOWLIST.
//
// Scope is "grounding + connectors + AIIA". Override with CLAWBOT_MCP_TOOLS
// (comma-separated primitive names) if you need a different set.

export const primitivesRouter = Router();

const DEFAULT_ALLOWLIST = [
  // Vault grounding (read-only)
  "vault.search", "vault.read", "vault.scan_docs", "vault.list", "vault.find_by_tag",
  // Connectors → company systems incl. AIIA. connector.call still respects each
  // connector's own writeEnabled gate (AIIA is read-only), so this can't write
  // unless the operator explicitly enabled writes on that connector.
  "connector.list", "connector.describe", "connector.call",
  // Integrations directory (read-only — never returns secrets)
  "integration.list",
  // Web reads
  "web.search", "web.fetch", "web.scrape", "web.firecrawl",
  // Document text extraction (read-only)
  "doc.ocr",
  // Payments — status/reporting only (NOT payment.link which charges)
  "payment.status", "payment.list",
];

function allowlist(): Set<string> {
  const env = (process.env.CLAWBOT_MCP_TOOLS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  return new Set(env.length ? env : DEFAULT_ALLOWLIST);
}

function toInputSchema(p: Primitive) {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const a of p.args) {
    properties[a.name] = { type: a.type, description: a.description };
    if (a.required) required.push(a.name);
  }
  return { type: "object" as const, properties, required };
}

// GET /api/primitives — the tool catalog the MCP bridge advertises to Hermes.
primitivesRouter.get("/", (_req, res) => {
  const allow = allowlist();
  const tools = primitives
    .filter(p => allow.has(p.name))
    .map(p => ({ name: p.name, description: p.description, readonly: p.readonly, inputSchema: toInputSchema(p) }));
  res.json({ tools });
});

// POST /api/primitives/call — body: { name, args }. Runs the primitive's real
// handler in the live server. Allowlist-gated.
primitivesRouter.post("/call", async (req, res) => {
  const name = String(req.body?.name ?? "");
  const args = (req.body?.args && typeof req.body.args === "object") ? req.body.args as Record<string, any> : {};
  if (!allowlist().has(name)) {
    return res.status(403).json({ error: `primitive "${name}" is not exposed over the bridge (not in the allowlist)` });
  }
  const prim = findPrimitive(name);
  if (!prim) return res.status(404).json({ error: `unknown primitive "${name}"` });
  try {
    const result = await prim.handler(args);
    res.json({ ok: true, name, result });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e), name });
  }
});
