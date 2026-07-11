---
title: Business model and sustainability
audience: AI Grand Challenge 2026 adjudicators
track: Track 3 — Development
maps_to: Section 9 (Business Model and Sustainability), Section 4 rubric (Business Model and Edge Feasibility)
version: 1.0.0
date: 2026-07-11
---

# NeuroWorks — Business model and sustainability

## 1. Who this is for

**End users** — operators (a small business owner, a department head, an
institution's admin staff) who need an AI workforce that does real work:
research, drafting, data queries, email, reconciliation, scheduling — not
just a chat window. The 12 built-in sector packs (fintech, agriculture,
health, education, retail, development/NGO, mining, tourism, public sector,
and others — `server/src/lib/sector-packs.ts`) name the intended
Zimbabwe-market user base explicitly.

**Customers** — whoever commissions or pays for the deployment. In practice
this splits three ways, and the model is deliberately built to serve all
three without a different product for each:
- **A single operator** running it on their own machine for free (the
  "free local core" — see below). No customer relationship at all; this is
  the on-ramp.
- **A business or institution** paying for cloud-tier model access at scale
  once local-only capacity isn't enough for their task volume.
- **A platform integrator** dispatching tasks into a NeuroWorks instance
  from their own system via the external API (`POST /api/v1/dispatch`, an
  SDK, a CLI, or an MCP server) — NeuroWorks becomes infrastructure another
  product sits on top of, not something the end user interacts with
  directly.

## 2. Revenue and sustainability model

**Free local core, paid escalation** — not a freemium gate on features, a
genuine cost architecture. Every installation runs Ollama (a free,
open-weight local model) by default and requires zero API keys to start.
Cloud models (Claude via Anthropic/OpenRouter) are an *optional* escalation
path the planner reaches for only when task complexity crosses a threshold
it can't reliably clear locally — this is not a marketing claim, it's a
routing decision made in code (`server/src/lib/llm.ts`, `models.ts`) on
every single call.

This is the direct answer to the rubric's own inference-cost warning: the
product is not "free until it needs the API key you must eventually pay
for" — it is genuinely free-capable, with a real, working degradation path
back to local-only if a deployment ever needs to cut cloud spend to zero
(flip `NEUROWORKS_OR_FALLBACK_OLLAMA` off, or simply don't set an API key at
all).

**Sustainability paths, not mutually exclusive:**
- **Public-good / self-hosted** — an operator or institution runs their own
  instance, on their own hardware, paying only their own optional cloud
  inference bill (if any). No dependency on a NeuroWorks-run service to
  keep operating.
- **Managed relay (planned, not yet built)** — a hosted layer for the
  pieces that are hard to self-host correctly (outbound email sending,
  payment collection), metered and billed, while the core stays
  self-hostable. This is a stated architectural goal, not yet shipped —
  disclosed here as planned, not claimed as done.
- **Institutional licence / support contract** — for an institution wanting
  a supported deployment rather than a self-managed one.

## 3. Real operating cost — actual measured numbers, not estimates

NeuroWorks tracks real per-call token usage and cost for every LLM call it
makes (`server/src/lib/cost-tracker.ts`) — as of tonight this pulls actual
billed token counts from the provider's own usage response, not a
character-count estimate (a real bug: the estimate was undercounting spend
by ~19% before this was fixed on 2026-07-11, concentrated in calls with
provider-side extended thinking that's billed but never returned as visible
text). The numbers below are read directly from that live tracker, not
projected.

**Cost-tiering in practice, measured over a 10-day window (2026-07-03 to
2026-07-11):**

| | Calls | Share | Cost |
|---|---|---|---|
| Free (local Ollama + free-tier OpenRouter) | 640 | 62.7% | $0.00 |
| Paid (Claude, cloud tier) | 381 | 37.3% | $8.31 |
| **Total** | **1,021** | **100%** | **$8.31** |

**A single fully-documented day** (2026-07-10, per that day's own
self-reflection): 29 completed tasks, $3.03 in cloud spend that day —
**≈$0.10 per task**, blended across whatever mix of free-local and
paid-cloud calls those 29 tasks actually needed. This is a real, single-day
figure, not an average smoothed across a mix of light and heavy days; it's
presented as one honest data point, not a universal per-task cost claim.

**Cost controls already built in**, not just planned: a hard circuit
breaker trips to local-only after repeated cloud failures or when provider
credits run out (`openrouter.ts`), a daily-quota breaker prevents
retry-storming a rate-limited free tier, and the newly-built unattended
reflection-action loop caps its own overnight spend at a hard per-run
dollar ceiling (`--max-budget-usd`) — cost governance is a first-class
concern in the architecture, not an afterthought bolted on for this
proposal.

## 4. Pilot pathway

- **First real users**: the operator's own production website database is
  already connected (read-only) as of 2026-07-11 — a real external system,
  not a demo fixture, is already in the loop.
- **What success looks like for a pilot**: a named operator (fintech, NGO,
  or public-sector unit, per the sector packs already built) runs
  NeuroWorks against their own data for a defined task set (e.g. weekly
  reconciliation, applicant screening, customer correspondence drafting)
  for 4–6 weeks; success is measured on task completion rate, time saved
  vs. the prior manual process, and cloud-spend-per-task staying within a
  target band.
- **Not yet done, stated honestly**: no named pilot customer or signed
  agreement exists yet. This is the single biggest gap between "technically
  ready" and "commercially validated," and is not overstated here.

## 5. Licensing and IP

See the [Asset and Licence Register](asset-and-licence-register.md) for the
full position. In brief: NeuroWorks' own code is proprietary to its
authors; POTRAZ is granted rights to evaluate, demonstrate, and pilot the
submission for public-interest purposes as part of the Grand Challenge;
commercial use, procurement, or institutional adoption beyond the Challenge
requires a separate agreement.
