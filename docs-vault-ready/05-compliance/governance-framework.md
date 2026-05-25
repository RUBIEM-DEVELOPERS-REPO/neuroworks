---
title: Compliance & governance framework
audience: security + ops + compliance
version: 0.2.0
tags: [compliance, governance, audit, rollback, data-boundaries, risk-scoring]
---

# NeuroWorks compliance & governance framework

> Five pillars: **deployment boundary**, **data boundary**, **action gates**,
> **audit trail**, **rollback**. Every external action falls under at least
> one pillar; sensitive actions fall under all five.

## 1. Deployment boundary

### Loopback-only network

The server binds explicitly to `127.0.0.1`:

```ts
app.listen(config.port, "127.0.0.1", ...)
```

There is no `0.0.0.0` or external interface listener. The server is
unreachable from outside the host machine — no port forwards, no
reverse proxies, no public IPs.

### Origin guard

Even loopback HTTP requests are filtered by `originGuard` middleware
(`server/src/lib/origin-guard.ts`). Allowed origins:

- `http://127.0.0.1:7470` — the web UI
- `http://127.0.0.1:7473`, `7474`, `7475` — managed worker peers

This defends against:

- **DNS rebinding** — an attacker's domain resolving to 127.0.0.1
  carries the attacker's domain in the Host header, which the guard
  rejects.
- **Cross-origin POSTs** — a malicious website POSTing JSON to
  loopback via `text/plain` (bypassing CORS preflight) is blocked by
  the Origin check.

### No outbound exfiltration by default

The agent's planner can only call HTTPS URLs through `web.fetch` /
`web.search`, both gated by:

- **SSRF gate** — `CLAWBOT_WEB_ALLOW_PRIVATE` must be set explicitly
  to allow requests to private IP ranges (10.0.0.0/8, 172.16/12,
  192.168/16, 169.254/16, ::1, fc00::/7).
- **No credentials by default** — `web.fetch` does NOT carry
  authentication unless explicitly configured per-host via env vars.

## 2. Data boundary

### Vault path scoping

`writeVaultFile(relPath, content)` resolves every write against the
vault root (`VAULT_PATH`, default `D:\Main brain`). Any resolved path
that escapes the root via `..` or absolute prefix is rejected with
`VaultPathOutsideRoot`.

### Sensitive-path refusal

`assertSafeExternalPath(absPath)` blocks reads / writes of:

- `.env`, `.env.*`
- `.ssh/`, `id_rsa`, `id_ed25519`, `*.pem`, `*.key`
- `.aws/credentials`, `.aws/config`
- `.docker/config.json`
- `.git-credentials`
- `package.json` files containing credential-like fields

Lifting requires `CLAWBOT_FS_UNRESTRICTED=1`. The lift itself is logged
on every fs operation, so out-of-policy uses are traceable.

### Vault security refusal

Every `writeVaultFile` call runs through `VaultSecurityRefusal` BEFORE
hitting disk. High-severity matches (`type: "api-key"`,
`"private-key"`, `"oauth-token"`, etc.) block the write entirely. The
job log records the finding type but never the matched bytes — so a
secret that almost-leaked doesn't get persisted in the audit trail
either.

### Context upload TTL

Documents staged via `POST /api/uploads` with `target: "context"` live
in `.neuroworks/context-uploads/` for `CLAWBOT_CONTEXT_UPLOAD_TTL_MS`
(default 1 h). Every upload request triggers a `gcContextDir()` sweep
that removes anything past TTL. The TTL is hard-enforced — there's no
"keep alive" mechanism.

## 3. Action gates

### Approval gate (human-in-the-loop)

Templates carrying side effects beyond the vault boundary mark
themselves `requiresApproval: true`. The chat / template runner
creates the job with `status: "awaiting-approval"` and returns
without executing. A human must click Approve on `/approvals` (which
calls `POST /api/templates/jobs/:id/approve`) before the executor
takes over.

Templates that default to `requiresApproval: true`:

- `publish-folder` — pushes to GitHub
- Any template with a `network.send` / `email.send` / `crm.write` step
  (none ship by default; pattern documented in the [API
  reference](../04-api-reference/api-and-integrations.md#adapter-pattern-for-new-integrations-gmail--crm--erp))

### Lane gate (persona authority)

Before running the planner, `checkLaneFit(persona, taskText)` runs a
1-2 s LLM check: is this task within the persona's lane? If not,
the chat returns an inline refusal with a hand-off recommendation,
short-circuiting the entire pipeline. The lane refusal is logged with
the reason and the suggested-hire persona.

Skipped for:
- `clawbot` (the generalist — no lane to police)
- Very short queries (< 25 chars)
- Continuation turns inside a thread (the prior turn committed the lane)

### Quality gate

After synthesis, every non-trivial answer runs through `quality.check`:

- `factuality_risk` — claims grounded in evidence vs. floating
- `citation_coverage` — fraction of claims with an evidence anchor
- `persona_fit` — output shape matches the persona's signature

A composite `score < 0.75` OR `pass: false` triggers the
quality-rescue path (large OpenRouter tier). If the rescue scores
higher, the rescued draft replaces the original; otherwise the
original is kept and the failure is recorded in the job log.

### Peer review gate

After quality, non-trivial drafts go to `peer.review` on a different
clawbot for a second opinion. Verdicts: `good` / `needs-work` /
`bad`. A `needs-work` or `bad` verdict triggers the review-driven
retry loop (v0.2.0): re-synthesise with the reviewer's issues as
explicit revision instructions, re-review, swap if the retry clears.

### Security scan gate

`security.scan` runs over every drafted answer BEFORE it's surfaced
to the customer or written to the vault. High-severity findings block
the response. Medium / low findings are reported alongside the answer
so the customer can decide.

## 4. Audit trail

See the dedicated [Audit trails & job logs](../02-user-guides/audit-trails-and-job-logs.md)
admin guide for the operational details. Compliance-relevant points:

- **Two stores:** in-memory job table (fast lookup) + git-backed vault
  session journals (long-term retention).
- **Append-only by design** — jobs never get edited; retries spawn
  new jobs with `retryOf: <originalJobId>` linkage.
- **Every gate decision logged:** routing reason, lane refusal, quality
  score + issues, security findings, peer review verdict, rescue path
  taken, attachment fold, persona auto-route.
- **Git history is the source of truth** — every vault write goes
  through `commitAndPush` so the vault repo's git log is a tamper-
  evident audit trail (signed commits if configured).

### Nightly self-reflection

`POST /api/reflection/run` runs nightly at `CLAWBOT_REFLECTION_HOUR`
(default 02:00). It surfaces:

- Per-kind task volumes + success rates
- Patterns in failure messages (groups errors by root cause)
- Latency outliers
- A natural-language "what went well / what went wrong / what to try
  next" summary from the large OR tier

Reflections land in `_neuroworks/reflections/<date>.md`. The
2026-05-24 reflection itself flagged the `D:\Main brain` ENOENT
pattern as the root cause of 33 template failures — the system finds
its own broken gates and reports them.

## 5. Rollback

### Job retry

`POST /api/templates/jobs/:id/retry` spawns a new job with the same
inputs PLUS the `retry-different-approach` skill loaded. The new job's
planner is biased to take a fundamentally different angle (structure,
scope, first move). The original job + result are preserved; no
in-place edits.

### Vault rollback

The vault is a git repo. Every batched commit groups N writes (4 s
debounce coalesce). To undo:

```bash
# From the vault directory
git log --oneline -10           # find the commit to revert
git revert <sha>                # creates a new revert commit
git push                        # propagate (if syncing remotely)
```

Deletions in the Knowledge browser are also git commits, so
"accidentally deleted" is recoverable via `git checkout <sha> -- <path>`.

### Persona rollback

`DELETE /api/personas/:id` returns `{ deleted: true, removedTemplates: N }`
so you know exactly how many starter templates were cleaned up. The
persona's past jobs remain (audit invariant); only the
forward-looking persona record + its templates are removed.

### Settings rollback

All operational config is via env vars (`.env`). No DB-resident
config means rolling back a misconfiguration is a `git checkout
.env` away (the .env is per-host and gitignored; back up your own).

### Auto-spawn rollback

If a managed worker peer ends up in a bad state, `POST
/api/peers/worker/stop` kills it cleanly; the next chat / team task
will auto-respawn one via `ensureWorker({ waitForReady: true })`.
There's no persistent worker state to leak between instances.

## 6. Risk scoring (per-job)

Each job carries an implicit risk score via the QA gates:

| Signal | Weight | Interpretation |
|---|---|---|
| `quality.score` | 0–1 | Composite of factuality + citation + persona fit |
| `quality.factuality_risk` | 0–1 (invert) | Claim-evidence gap |
| `security.findings[severity=high]` | block | Hard refusal |
| `security.findings[severity=medium]` | warn | Surface alongside answer |
| `review.verdict` | good/needs-work/bad | Peer second opinion |
| `rooted.pass` | bool | Citations + URLs + vault refs present |
| `requiresApproval` | bool | Human-in-the-loop required |

A job that scored ≥ 0.75 on quality, passed security, got a `good`
peer review, and was context-rooted is "low risk" — eligible for
auto-vault-capture. Anything else is surfaced with the QA chips
visible so the customer sees the trade-off before acting on the
output.

## 7. Compliance reporting templates

Bundled templates for typical compliance asks:

- **`run-reflection`** — on-demand re-run of the nightly self-audit.
  Output is a markdown summary that can be attached to incident reviews.
- **`compliance-check`** (skill) — auto-checks any drafted contract /
  policy against a checklist of standard clauses (GDPR, SOC-2, MFN,
  liability cap, indemnity).
- **Reflection diff** — compare two reflections side-by-side to see
  delta in failure patterns over time (manual via vault file diff).

## 8. Defaults summary

| Setting | Default | Lift via |
|---|---|---|
| Network bind | `127.0.0.1` | (not configurable — security invariant) |
| Origin allow-list | `127.0.0.1:7470,7473,7474,7475` | `origin-guard.ts` source edit |
| Vault edit | OFF | `CLAWBOT_VAULT_EDIT=1` |
| Web private IPs | blocked | `CLAWBOT_WEB_ALLOW_PRIVATE=1` |
| Sensitive paths | blocked | `CLAWBOT_FS_UNRESTRICTED=1` |
| Context upload TTL | 1 h | `CLAWBOT_CONTEXT_UPLOAD_TTL_MS` |
| Approval gate | per-template `requiresApproval` | (not bypassable) |
| Reflection | nightly @ 02:00 | `CLAWBOT_REFLECTION=0` to disable |
| Worker auto-spawn | ON | `CLAWBOT_AUTO_SPAWN_WORKER=0` |
| Max workers | 3 | `CLAWBOT_MAX_WORKERS` |

Every lift requires an explicit env var; nothing defaults open. If a
gate is impeding legitimate work, opening it is one env var + a server
restart — and the lift is logged on first use.
