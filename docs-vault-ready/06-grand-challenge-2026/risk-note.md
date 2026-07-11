---
title: Risk note
audience: AI Grand Challenge 2026 adjudicators
track: Track 3 — Development
maps_to: Section 8 (Risk Note)
version: 1.0.0
date: 2026-07-11
---

# NeuroWorks — Risk note

Written candidly. Where a risk is mitigated, the mitigation is named and
where it lives in the code, so it can be checked rather than taken on
faith. Where it isn't yet mitigated, that's stated as plainly as the wins.

## 1. Technical risk

**Model hallucination.** Mitigated at three layers, not one: (1) the synth
prompt carries explicit anti-fabrication rules and must cite evidence
inline; (2) `quality.check` scores every non-trivial answer on factuality
risk and citation coverage, triggering a rescue pass on a low score; (3)
`peer.review` gets a second model's opinion on drafts that don't clear a
confidence bar. A fourth layer was added on 2026-07-11 specifically because
this risk note's own drafting process surfaced a gap: when a data-fetch
step failed but the task still had *some* evidence, the synth was never
told the fetch failed, and could answer around the gap rather than
disclosing it. Fixed by injecting an explicit "DATA GAP" note into the
synth prompt whenever a database query fails, forcing the model to state
the gap rather than paper over it (`server/src/lib/agent.ts`).

**API/provider dependency failure.** The architecture's default posture is
local-first (Ollama, no API key required); cloud providers are an optional
escalation. A circuit breaker trips to local-only after repeated cloud
failures, tracks free-tier daily quota exhaustion separately from billing
exhaustion, and both states are visible on `/api/status`. Provider failure
degrades quality, it does not stop the system from functioning.

**Data quality degradation.** The ADRS pipeline's confidence scoring and
HITL review queue (see the [Dataset Statement](dataset-statement.md)) exist
specifically to catch this before publication, not after.

**Latency.** Not fully mitigated — complex multi-step tasks with several
cloud escalations can take tens of seconds to a few minutes. Acknowledged
as a real user-experience cost of the quality/security/governance gate
stack, not hidden.

## 2. Ethical risk

**Bias in model outputs.** Not independently evaluated for this
submission — the underlying models (Claude, Ollama's open-weight models)
carry whatever bias characteristics their own providers document; no
NeuroWorks-specific bias audit has been run. Stated as an open item, not a
solved one.

**Cultural appropriateness of Shona/Ndebele output.** Local-language
support is real and functionally verified (the agent replies fluently and
in the correct persona voice), but has not been reviewed by a native
linguistic authority for cultural appropriateness or dialectal accuracy at
scale. Functional verification and cultural-quality verification are
different bars, and only the first has been cleared.

**Over-reliance on AI.** The governance engine and approval-gate pattern
(§5, human-in-the-loop) exist specifically so a human stays in the loop on
consequential actions rather than the system running unsupervised by
default — but an operator can still choose to trust low-stakes output
without review, which is a genuine adoption-pattern risk no software
control fully closes.

## 3. Data risk

Covered in full in the [Dataset Statement](dataset-statement.md) §3.
Summary: one operator database is connected, read-only, encrypted at rest;
PII in that database (a website's user/payment tables) is the connecting
operator's own data and their responsibility as data controller —
NeuroWorks queries it live per-request and does not copy, export, or
publish it through the pipeline. Provenance on every ADRS-published dataset
is hash-verifiable, not just claimed (§6 of the Dataset Statement).

**Data Protection Act (Chapter 12:07).** Where an operator connects a
database containing Zimbabwean data subjects' personal information, DPA
obligations (lawful basis, data subject rights, breach notification) sit
with that operator as controller. NeuroWorks' technical contribution to DPA
compliance is structural: read-only-by-default connections, encrypted
credential storage, no default data export or third-party transmission,
and a full audit trail of every query run against a connected source. This
is a compliance-supporting architecture, not a claim that NeuroWorks itself
discharges an operator's DPA obligations for them.

## 4. Security risk

**Credential exposure.** Not a theoretical risk for this submission — a
real incident happened during this development cycle: a GitHub personal
access token was inadvertently displayed in a terminal output. It was
caught immediately, flagged, and the token rotated within the same
session, with the affected repo secret updated and the old credential
revoked. This is disclosed here deliberately, as evidence the operational
discipline around credential handling is real and exercised, not just
documented.

**Unauthorised access.** An origin-guard middleware defends against DNS
rebinding and cross-origin POST attacks even on a loopback-only bind
(`server/src/lib/origin-guard.ts`). A separate, off-by-default toggle
(`NEUROWORKS_ENTERPRISE_MODE`) adds real authentication for any deployment
reachable beyond a single trusted machine — disclosed as off-by-default
because the base install assumes single-operator, loopback-only use; a
deployer exposing this beyond one machine must explicitly turn it on, and
the system warns at boot if it's bound wide without it.

**Unsafe code execution.** `code.exec` lets the agent run a short
Python/Node snippet in a subprocess. It is genuinely unsandboxed (runs in
the host process) and is **off by default**, requiring an explicit
`NEUROWORKS_CODE_EXEC=1` environment flag to enable at all
(`server/src/lib/primitives.ts`). This is named here as a real, disclosed
risk for any deployment that turns it on, not a mitigated-and-forgotten
item — an operator choosing to enable it should treat the environment as
trusted.

**Secret leakage into stored content.** Every write to the vault (the
system's persistent memory) is scanned for secret patterns
(`server/src/lib/security.ts`) before it touches disk; a high-severity
match blocks the write outright. Live-tested during this submission cycle
against a planted fake token — detected correctly in under 1ms.

## 5. Adoption risk

**Low digital literacy among target users.** A genuine open risk. The
product's interaction surfaces (chat, CLI, API) assume comfort with a
conversational or command-line interface; no dedicated onboarding flow for
low-digital-literacy users exists yet.

**Institutional resistance.** Not addressed by product design — this is an
organisational-change risk any AI adoption faces, named here rather than
assumed away.

**Inference cost at scale.** Addressed directly and with real measured
data in the [Business Model](business-model.md) §3 — the free-local-core
architecture is the specific mitigation, not a hope that costs stay low.

**Human-in-the-loop as a risk control.** Documented as a deliberate
control, not an incidental feature: templates with side effects beyond the
vault default to `requiresApproval: true` and pause for a human click
before executing; a "hybrid workforce" mode lets a task pause into a
`waiting_on_human` state and resume once a person answers; the governance
engine's pre-execution gate blocks 20 consequential tool calls outright if
they'd violate an accepted org policy, before the action runs, not after.
