---
title: API reference — endpoints, integrations, permission-aware access
audience: developers + integrators
version: 0.2.0
tags: [api, sdk, integrations, gmail, crm, erp, permissions]
---

# API reference — endpoints, integrations, permission-aware access

> All endpoints are loopback-only (`127.0.0.1:7471`) and gated by the
> origin guard. External integrations are explicit, scope-bounded, and
> audit-logged.

## Base URL

```
http://127.0.0.1:7471
```

All requests must carry `Origin: http://127.0.0.1:7470` (the web UI's
origin) or `Origin: http://127.0.0.1:7473` (the worker peer's origin) —
the origin guard blocks everything else. This is the DNS-rebinding +
cross-origin-POST defence; see [Compliance & governance](../05-compliance/governance-framework.md#origin-guard).

`Content-Type: application/json` for all POST bodies (`text/plain` also
accepted on `/api/chat/save-session` for navigator.sendBeacon).

## Core endpoints

### Health & status

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | `{ ok, name, role, version, model, openrouter, port, ready, missing, inflightJobs, peers }` |
| GET | `/api/status/llm` | `{ ollama: {ok,model,error?}, openrouter: {enabled,ok,model,error?}, primary }` |
| GET | `/api/status/vault` | `{ lastCommit, totalCommits, coalescedSavings, pendingWrites, inFlight, debounceMs, aheadBy, aheadByAt }` |

### Chat

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/chat` | `{ messages: [{role,content}], attachments?: [{contextId}], persona? }` | `{ kind, text, jobId?, templateId?, activePersona?, personaAutoRouted?, brainHits? }` |
| POST | `/api/chat/save-session` | `{ sessionId, messages }` | `{ saved, path, sessionId }` |

`messages[]` is the full conversation context (last 50 by default). The
last entry must be `role: "user"`.

`attachments` are resolved via `resolveContextAttachment(contextId)` and
folded into the planner's task as primary evidence.

`persona` (optional) overrides the active persona for this task only.
Useful for programmatic callers that know the right role up-front. If
omitted, the auto-router decides.

### Team dispatch

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/team` | `{ tasks: [{persona?, content, attachments?}] }` | `{ kind: "team-task", tasksDispatched, tasks: [{taskIndex, persona, personaAutoRouted, jobId, route}] }` |

Up to 12 tasks per call. Each task fires as an independent job through
`planAndExecute`; poll `/api/tasks/jobs/:id` for each returned `jobId`.

`route` values:
- `explicit` — caller specified `persona`
- `auto` — auto-router picked a confident match
- `active` — fell back to the currently-active persona
- `primary` — no persona, runs as generalist

### Uploads

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/uploads` | `{ filename, contentBase64, target, vaultFolder?, mimeType? }` | `{ ok, target, contextId?, vaultPath?, bytes, hasExtractedText?, extractedChars?, ttlSeconds? }` |
| GET | `/api/uploads/context/:contextId` | — | `{ contextId, filename, bytes, uploadedAt, text, extractError? }` |

`target: "context"` stages the file under `.neuroworks/context-uploads/`
with TTL 1 h. Subsequent chat or team calls reference it via
`attachments: [{contextId}]`.

`target: "vault"` imports into the knowledge vault under `vaultFolder`
(default `0-Inbox`). Goes through `importBinaryIntoVault` which handles
PDF / DOCX / XLSX text extraction + sidecar generation.

**Caps:** 25 MB JSON body, 20 MB decoded payload, 200-char filename
after sanitisation. Larger docs should be staged on disk and pointed
to via `fs.read_into_vault` instead.

### Personas

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/api/personas` | — | List + active id |
| POST | `/api/personas` | `{ name, jobDescription, tone? }` | LLM-extracts role / description / responsibilities |
| POST | `/api/personas/preview` | `{ jobDescription }` | Preview without saving |
| POST | `/api/personas/:id/activate` | — | Set active |
| POST | `/api/personas/deactivate` | — | Clear active (auto-router takes over) |
| DELETE | `/api/personas/:id` | — | Cleans up tagged templates |
| POST | `/api/personas/:id/refresh-templates` | — | Re-draft starter templates |
| GET | `/api/personas/:id/templates` | — | Starter templates for this persona |

### Templates

| Method | Path | Returns |
|---|---|---|
| GET | `/api/templates` | `{ roles, templates }` |
| POST | `/api/templates/run/:id` | `{ jobId, requiresApproval, status }` |
| GET | `/api/templates/jobs` | `{ jobs }` |
| GET | `/api/templates/jobs/:id` | Full structured job |
| POST | `/api/templates/jobs/:id/approve` | Flip to running |
| POST | `/api/templates/jobs/:id/reject` | Flip to rejected |
| POST | `/api/templates/jobs/:id/retry` | Spawn a retry job with `retry-different-approach` skill loaded |

### Knowledge (vault)

| Method | Path | Returns |
|---|---|---|
| GET | `/api/brain/tree?path=` | Directory listing |
| GET | `/api/brain/file?path=` | File content |
| GET | `/api/brain/search?q=` | Full-text search across the vault |
| GET | `/api/brain/digest/latest` | Most recent daily digest |
| POST | `/api/brain/promote` | Move a draft from `0-Inbox` to a curated folder |

### Reflection

| Method | Path | Returns |
|---|---|---|
| GET | `/api/reflection` | List of past reflections |
| POST | `/api/reflection/run` | `{ date, path, stats, reflection, generatedAt, modelUsed }` |
| GET | `/api/reflection/:date` | Specific reflection markdown |

### Peers + worker pool

| Method | Path | Returns |
|---|---|---|
| GET | `/api/peers` | Self + registered peers + auto-discovered peers |
| GET | `/api/peers/worker` | Managed worker pool: `{running, managed, url?, port?, pid?, uptimeMs?}` |
| POST | `/api/peers/worker/start` | Spawn an extra managed worker |
| POST | `/api/peers/worker/stop` | Stop managed workers |
| POST | `/api/peers/register` | Manually register a peer URL |
| POST | `/api/peers/discover` | Re-scan localhost for peers |

### Skills

| Method | Path | Returns |
|---|---|---|
| GET | `/api/skills` | Loaded skills with `{name, description, source, applies_to, bodyChars}` |
| GET | `/api/skills/:name` | Full body of one skill |

## External integrations

NeuroWorks uses an **explicit-only** integration model. There is NO
automatic external network access; every external surface is a typed
primitive the planner can choose, and each primitive has an explicit
scope + permission gate.

### Currently available primitives (web + git + LLM)

| Primitive | Reaches | Permission gate |
|---|---|---|
| `web.fetch` | Any HTTPS URL | SSRF gate via `NEUROWORKS_WEB_ALLOW_PRIVATE`; blocks private IP ranges by default |
| `web.search` | DuckDuckGo HTTP → Bing HTTP → DDG Playwright → Bing Playwright | Same SSRF gate |
| `research.deep` | Web + vault | Both gates apply |
| `vault.read` / `vault.write` / `vault.scan_docs` | `D:\Main brain` (configurable) | `assertSafeExternalPath` blocks `.env`, `.ssh`, `.aws` |
| `fs.find_in` / `fs.read_into_vault` | Downloads / Desktop / Documents | `NEUROWORKS_FS_UNRESTRICTED` to lift the sensitive-path gate |
| `github.api` | api.github.com | `GITHUB_TOKEN` env var |
| `ollama.generate` | Local Ollama (`OLLAMA_HOST`) | Loopback by default |
| `openrouter.generate` | OpenRouter API | `OPENROUTER_API_KEY` env var |
| `peer.review` / `peer.delegate` | Registered peer clawbots | Origin guard on the peer side |

### Adapter pattern for new integrations (Gmail / CRM / ERP)

To add an integration (e.g. Gmail), the recipe is:

1. **Implement an adapter** in `server/src/lib/integrations/<name>.ts`
   that wraps the third-party SDK. Adapters MUST:
   - Read credentials only from `.env` (never from user input).
   - Implement a `withScope(scopeKey, fn)` wrapper that checks
     `process.env.NEUROWORKS_INT_<NAME>_<SCOPE>=1` before allowing the
     operation. Granular: `NEUROWORKS_INT_GMAIL_READ=1`,
     `NEUROWORKS_INT_GMAIL_SEND=1` are separate.
   - Log every call to the job log including the scope key, the
     operation, and a redacted summary of the payload.
2. **Register as a primitive** in `server/src/lib/primitives.ts` with a
   typed schema, a `handler` that calls the adapter, and a `requires`
   array of env keys. The planner then sees the primitive only when its
   env keys are set.
3. **Lane-gate it** by adding a refusal clause to the relevant persona's
   `responsibilities` so out-of-lane personas can't trigger it.
4. **Approval-gate destructive operations** — any adapter operation
   that creates / modifies / sends external state (gmail.send,
   crm.update, erp.write) should be marked `requiresApproval: true`
   on the wrapping template so the human-in-the-loop gate applies.

### Permission-aware access patterns

- **Scope-keyed env vars:** `NEUROWORKS_INT_<NAME>_<SCOPE>=1` is the unit
  of permission. Set the ones you want, leave the rest unset. No
  per-user RBAC (single-machine product), but the pattern carries over
  cleanly when running multiple workers as different OS users.
- **Loopback-only network:** the server binds to `127.0.0.1` only.
  External clients can't reach NeuroWorks; only the local web UI and
  registered peers can.
- **Origin guard:** even loopback requests are filtered by Origin
  header to defend against DNS rebinding.
- **Approval gates:** templates with `requiresApproval: true` hold in
  `awaiting-approval` until a human approves on `/approvals`. The
  approval action itself is audit-logged.
- **Vault security refusal:** any vault write containing high-severity
  secret patterns (API keys, private keys, etc.) is blocked at the
  `writeVaultFile` boundary — even if the LLM tried to write it.

## SDK example

There's no separate SDK package; everything is HTTP. Minimal Node.js
example using the team dispatch:

```js
async function dispatchTeam(brief, employees, attachments = []) {
  const tasks = employees.map(e => ({
    persona: e.personaId,
    content: `Team brief:\n${brief}\n\nYour part as ${e.role}:\n${e.task}`,
    attachments,
  }));
  const r = await fetch("http://127.0.0.1:7471/api/team", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "http://127.0.0.1:7470",
    },
    body: JSON.stringify({ tasks }),
  });
  const { tasks: dispatched } = await r.json();
  // Poll each jobId for completion
  return Promise.all(dispatched.map(d => pollJob(d.jobId)));
}

async function pollJob(id, maxMs = 600_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const r = await fetch(`http://127.0.0.1:7471/api/tasks/jobs/${id}`,
      { headers: { Origin: "http://127.0.0.1:7470" } });
    const job = await r.json();
    if (["succeeded", "failed", "rejected"].includes(job.status)) return job;
    await new Promise(res => setTimeout(res, 2000));
  }
  throw new Error(`poll timeout for ${id}`);
}
```

## Rate limits + budgets

Per-job soft budgets are enforced inside `planAndExecute`:

- **Max plan steps:** 12
- **Per-step timeout:** 90 s for LLM-bound steps, 30 s for tool calls
- **Total job timeout:** 600 s (chat dispatch) / 900 s (team dispatch)
- **OpenRouter wave dispatch:** batches of 3-4 to avoid rate-limit
  saturation (matters for team dispatches > 4 tasks)

No external rate limiter; the loopback-only deployment model means
there's no abusive-traffic shape to defend against.

## Versioning

NeuroWorks uses sequential semver minor bumps. Breaking changes to
response shapes are called out in the release notes; in v0.2.0 we
added two non-breaking fields:
- `personaAutoRouted` on `/api/chat` response (nullable)
- `kind: "team-task"` on the new `/api/team` response

Both are additive; existing clients work without modification.

## Data pipeline (Intellinexus)

The AI Data Readiness System publishes hashed, scored, golden-record datasets
into the vault as ML CSV + knowledge-graph JSONL + RAG chunks. Published
datasets are indexed for agent retrieval and appear as knowledge packs.

| Method | Path | Body / Returns |
|---|---|---|
| GET | `/api/datasets` | `{ datasets: [...] }` — manifests (records, confidence, root hash, stages, outputs) |
| GET | `/api/datasets/:id` | `{ dataset }` |
| GET | `/api/datasets/:id/output/:kind` | raw artifact (`csv` \| `jsonl` \| `rag` \| `card`) |
| POST | `/api/datasets/publish` | `{ name, sector?, keyField?, records[] }` **or** `{ name, sourceLabel, query }` → `{ ok, dataset }` |
| DELETE | `/api/datasets/:id` | `{ ok }` (drops the manifest; vault artifacts remain) |

Agent primitives: `data.publish`, `data.list_datasets` (both in the MCP allowlist).

## External agent dispatch (orchestration layer)

Other systems dispatch agents into NeuroWorks. These endpoints authenticate
with an API key (not the origin guard) — `/api/v1/` is exempt from the
Host/Origin allow-list because key auth is strictly stronger.

| Method | Path | Auth | Body / Returns |
|---|---|---|---|
| POST | `/api/v1/dispatch` | `Authorization: Bearer nw_…` (`dispatch:write`) | `{ task, callbackUrl?, idempotencyKey?, metadata? }` → `202 { jobId, status, poll }` |
| GET | `/api/v1/dispatch/:jobId` | Bearer (`dispatch:read`) | `{ jobId, status, answer, error?, startedAt, finishedAt }` (own jobs only) |
| GET | `/api/dispatch-keys` | origin guard (operator) | `{ keys: [...] }` (no secrets) |
| POST | `/api/dispatch-keys` | origin guard | `{ label, scopes? }` → `{ key, token }` (token shown once) |
| DELETE | `/api/dispatch-keys/:id` | origin guard | `{ ok }` (revoke) |

- **Idempotency**: send `Idempotency-Key` (header or body). A repeat from the
  same key returns the original `jobId`.
- **Webhooks**: when `callbackUrl` is set, NeuroWorks POSTs the result on
  completion with `X-NeuroWorks-Signature: sha256=<hmac>` (set
  `NW_WEBHOOK_SIGNING_SECRET`). Callback targets are SSRF-guarded — private /
  loopback addresses are blocked unless `NW_WEBHOOK_ALLOW_PRIVATE=1`.

## Omnisignal (data acquisition for Intellinexus)

Omnisignal gathers raw signal from many source kinds and feeds it into the Intellinexus
pipeline. Source spec shape: `{kind, ...}` where kind is `web_search` (query),
`web_page` (urls[]), `db` (sourceLabel+query), `local_file` (path), or `vault`
(query).

| Method | Path | Body / Returns |
|---|---|---|
| GET | `/api/omnisignal/kinds` | `{ kinds: [{ kind, needs, description }] }` |
| GET | `/api/omnisignal/sources` | `{ sources: [...] }` — saved source registry |
| POST | `/api/omnisignal/sources` | `{ name, kind, category?, query?, urls?, sourceLabel?, path? }` → `{ source }` |
| DELETE | `/api/omnisignal/sources/:id` | `{ ok }` |
| POST | `/api/omnisignal/acquire` | `{ sources: [spec…] }` → `{ records, report, total }` (read; no publish) |
| POST | `/api/omnisignal/publish` | `{ name, sources: [spec…], sector?, keyField? }` → `{ acquisition, published }` (acquire → Intellinexus) |

Each acquired record is tagged with provenance (`_source`, `_category`,
`_acquiredAt`) that survives the pipeline into the published dataset.

Agent primitives: `omnisignal.acquire` (read), `omnisignal.publish` (acquire →
publish) — both in the MCP allowlist.

## Models — local pull + bring-your-own APIs

Manage local Ollama models and plug in cloud model APIs you already use.

| Method | Path | Body / Returns |
|---|---|---|
| GET | `/api/models` | installed models + per-profile recommendations |
| POST | `/api/models/default` | `{ name }` — set runtime default |
| GET | `/api/models/catalog` | curated pullable models + `installed` flags |
| POST | `/api/models/pull` | `{ name }` → SSE progress (`progress`/`done`/`error`) |
| DELETE | `/api/models/installed/:name` | remove a local model |
| GET | `/api/models/providers` | BYO providers (keys redacted) + kinds |
| POST | `/api/models/providers` | `{ kind, model, apiKey, label?, baseUrl? }` → activates it |
| POST | `/api/models/providers/:id/activate` | switch active provider |
| DELETE | `/api/models/providers/:id` | remove (reverts to env config) |

Provider keys are encrypted at rest (`.neuroworks/model-providers.json`) and
applied to the runtime LLM router immediately (OpenAI-compatible chat API), so
no restart or `.env` edit is needed. `openai` / `openrouter` / `groq` /
`together` / `custom` (any OpenAI-compatible base URL) are supported.

## Client integration modes (dispatch)

Four ways for other systems to dispatch agents in, all over `/api/v1/dispatch`:

| Mode | Where | Use |
|---|---|---|
| REST + webhook | `/api/v1/dispatch` | Any language; poll or receive an HMAC-signed callback. |
| SDK | `sdk/neuroworks.mjs` (+ `.d.ts`) | Node/browser: `new NeuroWorks({baseUrl,apiKey}).run(task)`. |
| CLI | `tools/nw.mjs` | `nw dispatch "…" --wait`, `nw result <id>`, `nw keys:create`. |
| MCP server | `server/mcp/neuroworks-dispatch-mcp.mjs` | Tools `dispatch_task` / `get_dispatch_result` / `wait_for_result` for any MCP host (Claude Desktop, etc.). Env: `NEUROWORKS_API_KEY`, `NEUROWORKS_BASE`. |

All authenticate with an API key (`nw_…`); the MCP/CLI/SDK are thin clients over
the REST surface, so tenancy, idempotency, and webhooks apply uniformly.
