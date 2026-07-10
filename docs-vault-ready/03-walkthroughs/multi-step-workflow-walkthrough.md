---
title: Walkthrough — Multi-step workflow with approval gates and multi-agent collaboration
audience: end-users + admins
version: 0.2.0
tags: [walkthrough, demo, workflows, approval, multi-agent]
duration_min: 12
---

# Walkthrough — Launching v0.2.0 with the team

> Scenario: a small launch team uses NeuroWorks to coordinate the v0.2.0
> announcement end-to-end — research, drafting, review, vault capture,
> and a final publish step that goes through a human approval gate.

This is a click-by-click script (with the API calls each click maps to)
that you can run live on a local NeuroWorks instance to demonstrate every
moving part: natural-language intake, multi-agent collaboration, approval
gates, context uploads, audit logs, and rollback.

## Cast

| Persona | Role | Step they own |
|---|---|---|
| **Maya** | Marketing Manager | Launch announcement + 3 social variants |
| **Drew** | Account Executive | Customer talking points for top 10 accounts |
| **Sam** | Software Engineer | Engineering changelog distilled from commits |
| **Logan** | Contracts Reviewer | Customer-facing terms diff (T&Cs, SLA) |
| **clawbot** | Generalist + orchestrator | Final all-hands brief + approval routing |

## Prerequisites

- NeuroWorks running on `127.0.0.1:7471`, web on `127.0.0.1:7470`
- Vault path reachable (`D:\Main brain` mounted)
- A worker peer reachable on `:7473` (auto-spawned on first delegate; or
  start manually with `pnpm secondary` from `server/`)

## Step 1 — Drop the launch brief as context (00:00 – 00:30)

**Click:** open `/chat`, click the 📎 paperclip, leave the toggle on
`context`, select `launch-brief-v020.pdf` (or any PDF).

**What happens:**
- Browser converts the file to base64 in 32 KB chunks (avoids the
  `String.fromCharCode` arg-stack limit).
- `POST /api/uploads` lands at `routes/uploads.ts` → file is staged at
  `.neuroworks/context-uploads/<uuid>__launch-brief-v020.pdf`, TTL 1 h.
- Server eagerly runs `extractDocText(filePath)` so the chips show
  "4,213 chars" immediately.
- Returns `{ contextId, hasExtractedText: true, extractedChars: 4213 }`.
- A green chip appears above the chat input — removable with ✕.

**Show:** open the job-log inspector after sending the next message —
look for `folded 1 attachment into task: launch-brief-v020.pdf (4213 chars)`.

## Step 2 — Auto-routed research (00:30 – 02:30)

**Type into Chat (with the chip still attached):**

> Read the attached launch brief and produce a 5-bullet executive summary
> covering the codename, owner, launch dates, budget, and the SOC-2 risk.

**What happens:**
- `chat.ts` sees no active persona; the auto-router scans the task. The
  brief mentions "research" + "executive summary" — the router doesn't
  see a strong specialist signal, so it falls through to clawbot.
- Planner runs `vault.read` (if relevant notes exist) + the attachment
  text already in the prompt + `peer.review` for quality.
- Final answer surfaces with the codename, owner, dates, budget, SOC-2
  risk — all echoed from the attachment text.

**Show:** open `/results/:jobId` → the **Evidence** panel lists the
attachment alongside any vault hits.

## Step 3 — Multi-agent team dispatch (02:30 – 06:00)

**Click:** `/team` (left nav).

**Fill out:**
- **Team brief:** `Launching NeuroWorks v0.2.0 on 2026-06-02. Each role
  drafts their slice for the all-hands brief. Use the attached launch
  brief as primary evidence.`
- Click 📎, attach the same `launch-brief-v020.pdf`.
- Add four employees via the picker:
  - **Maya** (Marketing Manager) — per-role: "Headline + 3 social
    variants (LinkedIn / X / Slack) with the CTA."
  - **Drew** (Account Executive) — per-role: "Talking points for the
    top 10 accounts; flag any deal at risk if the SOC-2 date slips."
  - **Sam** (Software Engineer) — per-role: "Engineering changelog
    distilled from the commit messages; call out anything that needs an
    upgrade note."
  - **Logan** (Contracts Reviewer) — per-role: "Customer-facing T&Cs /
    SLA diff for the new features; redline anything we can't ship without
    legal's sign-off."

**Click:** `Dispatch to team (4)`.

**What happens:**
- `POST /api/team` with the four tasks, each carrying the same
  `attachments: [{ contextId }]` and per-role content stitched together
  (`Team brief: …` + `Your part as [Maya · Marketing Manager]: …`).
- Server's `routes/team.ts` builds four jobs, pins each persona's
  `personaSystemSuffix` at dispatch time (no global active-persona
  race), and fires `void runJob(...)` for each.
- The worker pool sees 4 incoming jobs against a cap of 3 — the auto-
  spawn kicks in:
  - Jobs 1-2 land on the primary (inflight 0 → 2)
  - Jobs 3-4 land on the worker peer (inflight 0 → 2)
  - As Job 1 completes, the pool sees peer.inflight ≥ 1 and may spawn
    an extra worker via `ensureExtraWorker`.
- Live polling updates each row every 2 s — status pills go from
  `pending` → `running` → `succeeded`.

**Show:**
- The four-row results panel populates incrementally.
- Click `Activity (N)` on any row to see the planner's step log for that
  persona.
- Open `Full result →` for the structured view including peer review
  verdict and quality scores.

## Step 4 — Approval gate (06:00 – 08:00)

**Click:** the result link for Maya's launch announcement. Copy the
announcement text.

**Click:** back to `/chat`. Type:

> publish the folder C:\Users\Arthur Magaya\Desktop\v0.2.0-launch-bundle

**What happens:**
- The regex action router matches `publish-folder` template.
- `publish-folder` is marked `requiresApproval: true` — the job is
  created with status `awaiting-approval` and does NOT execute.
- Chat returns "I've queued a Publish folder task — it needs your
  approval before running. Open the Approvals page."

**Show:**
- The Tasks page shows the job in `awaiting-approval` (orange badge).
- Open `/approvals` — the job is listed with full input parameters.
- Click `Approve` → `POST /api/templates/jobs/:id/approve` flips status
  to `running` and the executor takes over.
- Click `Reject` instead to demonstrate that path: status flips to
  `rejected`, audit log records who rejected and when.

## Step 5 — Vault capture and audit trail (08:00 – 10:00)

**Show:**
- Open `/knowledge/0-Inbox` — the new launch bundle landed.
- Files have frontmatter: `tags: [curated, agent-output]`, `persona`,
  `jobId`, `verdict`.
- Open `_neuroworks/sessions/<sessionId>.md` — the entire chat thread is
  there, message-by-message, with linked job ids.
- Open `_neuroworks/jobs/<short-jobId>.md` — full structured job snapshot
  including the QA gates, plan, runs, and final answer.

**API:** the same data is reachable via:
- `GET /api/tasks/jobs/:id` — current in-memory job
- `GET /api/brain/file?path=_neuroworks/sessions/<sessionId>.md` — vault
  copy
- `GET /api/reflection` — list of nightly self-audits

## Step 6 — Rollback / undo (10:00 – 12:00)

**Demonstrate the rollback paths:**

- **Job-level rollback:** click `Retry` on any completed job → a new job
  fires with the same inputs but the planner takes a different angle
  (the retry-intent detector loads the `retry-different-approach`
  skill). Original job and result are preserved.
- **Vault-write rollback:** every vault commit goes through the
  `commit-queue` with a 4 s debounce. To undo the last commit,
  run from the vault directory: `git revert HEAD` (the vault is a git
  repo). Customers can also rename / delete files via the Knowledge
  browser; deletions are themselves git commits, so nothing is truly
  lost.
- **Persona-level rollback:** an experimental persona that turned out
  badly can be deleted via `DELETE /api/personas/:id` — the response
  includes `removedTemplates` count. Their tagged starter templates are
  cleaned up in the same transaction.
- **Reflection-driven rollback:** the nightly reflection flags templates
  with high failure rates (`add-note 13/13 failed`). The action is
  always "deactivate the template" not "wipe the data" — a one-line
  edit to `templates.ts` removes the template from the picker while
  preserving any past jobs that used it.

## Wrap-up checklist

- ✅ Natural-language intake (Step 2)
- ✅ Document upload as one-shot context (Step 1)
- ✅ Multi-agent dispatch with parallel sub-agents (Step 3)
- ✅ Approval gate (Step 4)
- ✅ Audit trail in both in-memory and git-backed vault (Step 5)
- ✅ Multiple rollback mechanisms (Step 6)

Total runtime, no waiting around: ~12 minutes.

## Talk-track tips

- **Open by typing into chat without an active persona** — the audience
  sees the system reason about who should take the task.
- **Show the job log live** — open `/results/:jobId` in a second tab
  while a team dispatch is running; the `Activity` panel updates every
  2 s.
- **Demonstrate a refusal** — activate Logan (Contracts) then type
  "write me a SQL query to count active users". The lane gate refuses
  with a hand-off to Sam.
- **Trigger a quality rescue** — paste a question with a known
  hallucination trap; watch the log show `quality.check failed (0.62)
  — re-synthesising with the large model` followed by the rescued
  draft scoring higher.
