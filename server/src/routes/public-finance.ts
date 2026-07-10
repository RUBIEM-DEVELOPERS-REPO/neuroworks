// Public Finance System ingest + read surface.
//
//   POST /api/public/dashboard   — accept a Finance System push, store it, return the mapped snapshot
//   POST /api/public/sync        — exact alias of the above (same handler)
//   GET  /api/public/dashboard   — return the live snapshot with all 5 mapped fields
//
// These are the endpoints the company Finance System calls to keep NeuroWorks'
// figures current. They're mounted under /api/public and exempted from the
// browser origin-guard (server-to-server, no cross-origin browser model) — see
// origin-guard.ts. Writes are optionally protected by a shared secret:
// set FINANCE_SYNC_TOKEN and the Finance System must send it as
// `Authorization: Bearer <token>` (or `X-Finance-Token: <token>`). Unset =
// open ingest (matches the "public" framing for a trusted-network deploy).

import { Router } from "express";
import { getFinanceSnapshot, saveFinanceSnapshot, mapFinanceFields, type FinanceMapped } from "../lib/finance-snapshot.js";

export const publicFinanceRouter = Router();

const SYNC_TOKEN = (process.env.FINANCE_SYNC_TOKEN ?? "").trim();

function writeAuthorized(req: any): boolean {
  if (!SYNC_TOKEN) return true; // no token configured → open ingest
  const bearer = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "").trim();
  const header = String(req.headers["x-finance-token"] ?? "").trim();
  return bearer === SYNC_TOKEN || header === SYNC_TOKEN;
}

// The 5 fields, always present in the response (null when the Finance System
// hasn't sent that figure) so consumers can render a stable shape.
function emptyMapped(): FinanceMapped {
  return { revenue: null, expenses: null, netProfit: null, cashBalance: null, outstanding: null };
}

function ingest(source: string) {
  return (req: any, res: any) => {
    if (!writeAuthorized(req)) {
      return res.status(401).json({ ok: false, error: "unauthorized", message: "Set Authorization: Bearer <FINANCE_SYNC_TOKEN> (or X-Finance-Token) to push finance data." });
    }
    const payload = req.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ ok: false, error: "bad_payload", message: "Expected a JSON object body with the finance figures." });
    }
    try {
      const snap = saveFinanceSnapshot(payload, source);
      const mappedCount = Object.values(snap.mapped).filter(v => v !== null).length;
      return res.json({ ok: true, source, receivedAt: snap.receivedAt, mapped: snap.mapped, mappedCount, currency: snap.currency, period: snap.period });
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: "store_failed", message: e?.message ?? String(e) });
    }
  };
}

// POST /api/public/dashboard — store pushed Finance System data.
publicFinanceRouter.post("/dashboard", ingest("dashboard"));
// POST /api/public/sync — exact alias, same behaviour.
publicFinanceRouter.post("/sync", ingest("sync"));

// GET /api/public/dashboard — live snapshot with all 5 mapped fields.
publicFinanceRouter.get("/dashboard", (_req, res) => {
  const snap = getFinanceSnapshot();
  if (!snap) {
    return res.json({
      ok: true,
      empty: true,
      message: "No finance data received yet. The Finance System should POST to /api/public/dashboard (or /api/public/sync).",
      mapped: emptyMapped(),
      receivedAt: null,
      currency: null,
      period: null,
    });
  }
  return res.json({ ok: true, empty: false, mapped: snap.mapped, currency: snap.currency, period: snap.period, source: snap.source, receivedAt: snap.receivedAt, raw: snap.raw });
});

// GET /api/public/sync — convenience read alias so either path returns the snapshot.
publicFinanceRouter.get("/sync", (_req, res) => {
  const snap = getFinanceSnapshot();
  return res.json(snap ? { ok: true, empty: false, mapped: snap.mapped, currency: snap.currency, period: snap.period, source: snap.source, receivedAt: snap.receivedAt } : { ok: true, empty: true, mapped: emptyMapped() });
});

// Re-export for any internal caller that wants to normalize without HTTP.
export { mapFinanceFields };
