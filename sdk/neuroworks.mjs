// NeuroWorks dispatch SDK — a tiny, dependency-free client for the external
// agent-dispatch API (/api/v1/dispatch). Works in Node 18+ and modern browsers
// (uses the global fetch). The webhook-signature helper is Node-only.
//
//   import { NeuroWorks } from "./neuroworks.mjs";
//   const nw = new NeuroWorks({ baseUrl: "http://127.0.0.1:7471", apiKey: "nw_..." });
//   const { jobId } = await nw.dispatch("Summarise today's sales");
//   const result = await nw.waitFor(jobId);
//   console.log(result.answer);

export class NeuroWorks {
  /** @param {{ baseUrl?: string, apiKey: string }} opts */
  constructor({ baseUrl = "http://127.0.0.1:7471", apiKey } = {}) {
    if (!apiKey) throw new Error("NeuroWorks: apiKey is required (mint one via POST /api/dispatch-keys)");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  get _headers() {
    return { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * Dispatch a task. Returns { jobId, status } immediately (async).
   * @param {string} task
   * @param {{ callbackUrl?: string, idempotencyKey?: string, metadata?: object }} [opts]
   */
  async dispatch(task, opts = {}) {
    const headers = this._headers;
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    const r = await fetch(`${this.baseUrl}/api/v1/dispatch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ task, callbackUrl: opts.callbackUrl, metadata: opts.metadata }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || j.error || `dispatch failed (${r.status})`);
    return j;
  }

  /** Fetch current status + answer for a job. */
  async result(jobId) {
    const r = await fetch(`${this.baseUrl}/api/v1/dispatch/${encodeURIComponent(jobId)}`, { headers: this._headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || j.error || `result failed (${r.status})`);
    return j;
  }

  /**
   * Poll until the job finishes (or timeout).
   * @param {string} jobId
   * @param {{ timeoutMs?: number, intervalMs?: number }} [opts]
   */
  async waitFor(jobId, { timeoutMs = 120000, intervalMs = 2000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = await this.result(jobId);
      if (v.status === "succeeded" || v.status === "failed") return v;
      if (Date.now() > deadline) return { ...v, timedOut: true };
      await new Promise(res => setTimeout(res, intervalMs));
    }
  }

  /** Convenience: dispatch and wait for the answer in one call. */
  async run(task, opts = {}) {
    const { jobId } = await this.dispatch(task, opts);
    return this.waitFor(jobId, opts);
  }
}

/**
 * Verify a webhook's HMAC signature (Node only). NeuroWorks signs with the
 * secret set as NW_WEBHOOK_SIGNING_SECRET and sends `X-NeuroWorks-Signature:
 * sha256=<hex>`.
 * @param {string} secret  your NW_WEBHOOK_SIGNING_SECRET
 * @param {string} rawBody the exact request body string
 * @param {string} signatureHeader the value of X-NeuroWorks-Signature
 * @returns {Promise<boolean>}
 */
export async function verifyWebhook(secret, rawBody, signatureHeader) {
  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
