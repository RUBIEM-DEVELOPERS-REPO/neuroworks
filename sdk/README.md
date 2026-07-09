# NeuroWorks dispatch SDK

A tiny, dependency-free client for dispatching agent tasks into NeuroWorks over
the `/api/v1/dispatch` API. Works in Node 18+ and modern browsers.

## Install

Copy `neuroworks.mjs` (and `neuroworks.d.ts` for TypeScript) into your project,
or import it directly.

## Usage

```js
import { NeuroWorks } from "./neuroworks.mjs";

const nw = new NeuroWorks({
  baseUrl: "http://127.0.0.1:7471",   // your NeuroWorks host
  apiKey: process.env.NW_API_KEY,     // mint via POST /api/dispatch-keys
});

// Fire-and-forget + poll:
const { jobId } = await nw.dispatch("Summarise today's sales", {
  metadata: { source: "billing-app" },
  idempotencyKey: "sales-2026-07-01",   // repeats return the same jobId
});
const result = await nw.waitFor(jobId);
console.log(result.status, result.answer);

// Or one-liner (dispatch + wait):
const r = await nw.run("Draft a welcome email for a new customer");
console.log(r.answer);
```

### Webhook callbacks

Pass `callbackUrl` and NeuroWorks POSTs the result there on completion, signed
with `X-NeuroWorks-Signature: sha256=<hmac>` (when `NW_WEBHOOK_SIGNING_SECRET`
is set on the server):

```js
await nw.dispatch("Reconcile the June ledger", { callbackUrl: "https://your-app/webhooks/nw" });
```

Verify the signature on your side (Node):

```js
import { verifyWebhook } from "./neuroworks.mjs";
const ok = await verifyWebhook(process.env.NW_WEBHOOK_SIGNING_SECRET, rawBody, req.headers["x-neuroworks-signature"]);
if (!ok) return res.status(401).end();
```

## API

| Method | Description |
|---|---|
| `new NeuroWorks({ baseUrl?, apiKey })` | Create a client. |
| `dispatch(task, opts?)` | Start a task → `{ jobId, status }`. |
| `result(jobId)` | Current status + answer. |
| `waitFor(jobId, { timeoutMs?, intervalMs? })` | Poll until done. |
| `run(task, opts?)` | `dispatch` + `waitFor` in one call. |
| `verifyWebhook(secret, rawBody, header)` | Verify a webhook HMAC (Node only). |

`opts`: `{ callbackUrl?, idempotencyKey?, metadata?, timeoutMs?, intervalMs? }`.

## Other integration modes

- **CLI** — `tools/nw.mjs` (`nw dispatch "…" --wait`).
- **MCP server** — `server/mcp/neuroworks-dispatch-mcp.mjs` exposes `dispatch_task`
  / `get_dispatch_result` / `wait_for_result` to any MCP host (Claude Desktop, etc.).

See `docs-vault-ready/04-api-reference/` for the full endpoint reference.
