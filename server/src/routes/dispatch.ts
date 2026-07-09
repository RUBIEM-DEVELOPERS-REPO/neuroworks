import { Router, type Request, type Response, type NextFunction } from "express";
import {
  createApiKey, listApiKeys, revokeApiKey, verifyApiKey, keyHasScope,
  ALL_SCOPES, type ApiKeyRecord, type ApiKeyScope,
} from "../lib/api-keys.js";
import { dispatchTask, publicJobView, ownerOfJob, checkDispatchRate } from "../lib/dispatch.js";

// Two surfaces share this file:
//   /api/v1/dispatch*  — EXTERNAL. API-key bearer auth. originGuard exempts the
//                        /api/v1/ prefix (see origin-guard.ts) because these
//                        are authenticated machine calls, not browser requests.
//   /api/dispatch-keys — LOCAL. Goes through the normal originGuard, so only
//                        the operator's UI can mint/list/revoke keys.

export const dispatchRouter = Router();        // mounted at /api/v1/dispatch
export const dispatchKeysRouter = Router();    // mounted at /api/dispatch-keys

// ── API-key auth middleware ─────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { apiKey?: ApiKeyRecord }
  }
}

function requireKey(scope: ApiKeyScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.get("authorization") ?? "";
    const m = auth.match(/^Bearer\s+(\S+)$/i);
    const token = m ? m[1] : (req.get("x-api-key") ?? "");
    const rec = token ? verifyApiKey(token) : null;
    if (!rec) return res.status(401).json({ error: "unauthorized", message: "Provide a valid API key as 'Authorization: Bearer nw_…'." });
    if (!keyHasScope(rec, scope)) return res.status(403).json({ error: "forbidden", message: `Key lacks required scope "${scope}".` });
    req.apiKey = rec;
    next();
  };
}

// ── External dispatch surface (v1) ──────────────────────────────────────────

// POST /api/v1/dispatch — run a task as an async job. Returns { jobId }.
dispatchRouter.post("/", requireKey("dispatch:write"), (req, res) => {
  // Per-key throttle so one key can't flood the pipeline.
  const rate = checkDispatchRate(req.apiKey!.id);
  if (!rate.ok) {
    res.setHeader("Retry-After", String(rate.retryAfter));
    return res.status(429).json({ error: "rate_limited", message: `Dispatch rate limit of ${rate.limit}/min exceeded. Retry in ${rate.retryAfter}s.`, retryAfter: rate.retryAfter });
  }
  const task = String(req.body?.task ?? "").trim();
  if (!task) return res.status(400).json({ error: "bad_request", message: "Body must include a non-empty 'task'." });
  if (task.length > 8000) return res.status(400).json({ error: "bad_request", message: "'task' exceeds 8000 chars." });

  const callbackUrl = req.body?.callbackUrl ? String(req.body.callbackUrl) : undefined;
  const idempotencyKey = req.get("idempotency-key") ?? (req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined);
  const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : undefined;

  const { jobId } = dispatchTask(req.apiKey!.id, { task, callbackUrl, idempotencyKey, metadata });
  res.status(202).json({ jobId, status: "accepted", poll: `/api/v1/dispatch/${jobId}` });
});

// GET /api/v1/dispatch/:jobId — poll status + result (own jobs only).
dispatchRouter.get("/:jobId", requireKey("dispatch:read"), (req, res) => {
  const owner = ownerOfJob(req.params.jobId);
  if (owner && owner !== req.apiKey!.id) return res.status(404).json({ error: "not_found" });
  const view = publicJobView(req.params.jobId);
  if (!view) return res.status(404).json({ error: "not_found", message: "Unknown job (or the server restarted while it ran)." });
  res.json(view);
});

// ── Local key-management surface (operator only, via originGuard) ────────────

dispatchKeysRouter.get("/", (_req, res) => {
  res.json({ keys: listApiKeys() });
});

dispatchKeysRouter.post("/", (req, res) => {
  const label = String(req.body?.label ?? "").trim();
  if (!label) return res.status(400).json({ error: "label is required" });
  const reqScopes: ApiKeyScope[] = Array.isArray(req.body?.scopes)
    ? req.body.scopes.filter((s: any): s is ApiKeyScope => ALL_SCOPES.includes(s))
    : ALL_SCOPES;
  const { key, token } = createApiKey(label, reqScopes);
  // token is returned ONCE — the UI must surface it for the operator to copy.
  res.json({ key, token });
});

dispatchKeysRouter.delete("/:id", (req, res) => {
  const ok = revokeApiKey(req.params.id);
  if (!ok) return res.status(404).json({ error: "key not found" });
  res.json({ ok: true });
});
