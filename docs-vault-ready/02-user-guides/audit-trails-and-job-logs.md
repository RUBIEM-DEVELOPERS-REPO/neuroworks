---
title: Admin guide — Audit trails and job logs
audience: admins
version: 0.2.0
tags: [admin-guide, audit, logs, jobs, compliance]
---

# Admin guide — Audit trails and job logs

> Every task creates a job. Every job carries a complete log of the
> planner's choices, the tools it ran, the evidence it cited, the QA
> gates it passed, and the final answer. Nothing is invisible.

## What gets logged

For every job (chat task, template run, team dispatch, scheduled digest),
the system records:

| Field | What it captures |
|---|---|
| `id` | UUID — the job handle every UI surface uses |
| `kind` | Categorical tag: `insights:general-task`, `knowledge:add-note`, `peer:delegate`, etc. |
| `template` | Template id when the job ran from a template |
| `title` | Human-readable label shown on Tasks page |
| `inputs` | Whatever the caller passed (task text, persona id, attachments, intent extraction, routing decision) |
| `log[]` | Time-stamped entries from the planner + executor + curator |
| `status` | `pending` / `running` / `succeeded` / `failed` / `rejected` |
| `startedAt` | First-run timestamp (ISO) |
| `completedAt` | Terminal-state timestamp |
| `result` | Structured: `answer`, `plan`, `runs`, `review`, `quality`, `security`, `curation`, `budgets`, `skillUsed`, `skillScore` |
| `requiresApproval` | Was an approval gate involved? |

## Where logs live

Two complementary stores:

- **In-memory job table** — fast lookup by `jobId`. Survives until server
  restart. Backs `GET /api/tasks/jobs/:id` and the live polling UI.
- **Vault session journals** — every chat thread auto-saves its full
  message history to `_neuroworks/sessions/<sessionId>.md` after each
  exchange (3 s debounce). Survives forever; queryable via the
  Knowledge browser.

## Reading a job log

Open `/results/:jobId` for the full structured view. Key entries:

```
[2026-05-25T09:00:00.000Z] auto-routed to persona "marketing-manager" (score=3, matched=launch announcement, social media post, brand voice)
[2026-05-25T09:00:00.001Z] folded 2 attachments into task: launch-brief.pdf (4213 chars), positioning-deck.docx (2104 chars)
[2026-05-25T09:00:00.500Z] planner: 4 steps queued (vault.read, research.deep, ollama.generate, peer.review)
[2026-05-25T09:00:08.200Z] step 1/4 vault.read → 12 hits
[2026-05-25T09:00:24.100Z] step 3/4 ollama.generate → 1843 chars
[2026-05-25T09:01:09.300Z] step 4/4 peer.review → verdict=good, confidence=0.9
[2026-05-25T09:01:09.400Z] curation: captured to vault at 0-Inbox/202605250901-curated-launch-blurb.md
```

Every line tells you what the agent decided AND why — the routing reason,
the skill it picked, the rescue path it took, the QA verdict.

## Routing decisions

When a task gets delegated to a peer worker (the persona-shifter or an
auto-spawned extra worker), the log captures the routing decision verbatim:

```
[2026-05-25T09:00:00.005Z] delegating to peer worker@7473 (inflight=0 vs local inflight=2 — peer wins)
[2026-05-25T09:00:00.006Z] Why I delegated: worker
```

You can also see the routing decision attached to the job inputs as
`delegatedTo: "http://127.0.0.1:7473"` for filtering on the Activity page.

## QA gates

The job log records every QA decision the agent made:

- `quality.check passed (78%) and security is clean — peer review skipped` —
  draft cleared the GOOD bar (score ≥ 0.75 + pass=true + security clean).
- `quality.check failed (score=0.62, issues: ungrounded claim about LTV; missing CTA) — re-synthesising with the large model` —
  OpenRouter rescue kicked in.
- `peer review verdict=needs-work (Contact details inconsistent; minor filler) — retrying with reviewer's issues as guidance before returning to user` —
  review-driven retry loop fired.
- `retry cleared peer review (verdict=good, confidence=0.85); using retry as final answer` —
  retry succeeded; user sees only the clean verdict.

## Approval gates

Templates that touch external state (`publish-folder` to GitHub,
`run-digest` that emails out, anything with `requiresApproval: true`) hold
in `awaiting-approval` until a human clicks Approve on `/approvals`. The
job log records:

```
[2026-05-25T09:00:00.000Z] task created from chat · waiting on human approval
[2026-05-25T09:02:14.330Z] approved by admin · resuming
[2026-05-25T09:02:14.331Z] running publish-folder with path=C:\...
```

## Reflection (nightly self-audit)

`startReflectionScheduler` runs `POST /api/reflection/run` nightly at
`CLAWBOT_REFLECTION_HOUR` (default 02:00 local). The reflection:

1. Reads the last 24 h of jobs from the in-memory table.
2. Computes per-kind stats (totals, ok, failed, latency, error patterns).
3. Sends the stats to the large OpenRouter tier with a "what went well /
   what went wrong / what to try next" prompt.
4. Writes the markdown summary to `_neuroworks/reflections/<date>.md` in
   the vault.

Browse all past reflections at `GET /api/reflection` or on the Results
page under "Reflections".

## Manual export

`GET /api/tasks/jobs` returns the full in-memory job table; pipe to a
file for offline audit:

```bash
curl -s -H "Origin: http://127.0.0.1:7470" \
  http://127.0.0.1:7471/api/tasks/jobs > jobs-snapshot-$(date +%F).json
```

For longer-term retention, the vault session journals are the authoritative
record — they're git-committed (`commitAndPush` after every save) so the
full audit trail lives in your knowledge repo's git history.

## Security boundaries

The audit trail itself is bounded:

- **Loopback only** — all API endpoints bind to `127.0.0.1` and the
  origin guard blocks requests with non-`127.0.0.1:7470` Origin headers.
  Audit logs aren't reachable from outside the machine.
- **Secrets never logged** — `VaultSecurityRefusal` blocks any vault
  write that contains high-severity secret patterns; the security finding
  itself is logged but the matched bytes are not.
- **Path traversal blocked** — `assertSafeExternalPath` refuses to read /
  write `.env`, `.ssh`, `.aws/credentials`, etc. even when explicitly
  requested.
