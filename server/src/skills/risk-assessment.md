---
name: risk-assessment
description: How to surface real risks in a plan, proposal, or change — name them concretely, rate severity honestly, propose a mitigation.
applies_to: [review, plan]
---

# Skill: Risk assessment

## Goal

Produce a list of risks the customer can actually act on. Each entry is a specific failure mode, not a generic worry, with a severity rating and a concrete mitigation. Generic risk lists ("communication", "scope creep") are noise; specific ones unlock decisions.

## What counts as a risk

A risk is **a specific bad outcome + the conditions that would cause it**. "Latency might be high" is not a risk. "If the third-party API rate-limits us under 50 RPS, p95 will exceed 2s during the morning peak" is a risk.

## Process

1. **Enumerate failure modes by category.** Pick from: technical, schedule, scope, dependency, vendor, organizational, regulatory, security, reputational. Don't list categories that don't apply.
2. **For each candidate, ask: how would I know it's happening?** If you can't name an early-warning signal, the "risk" is too vague — sharpen it or cut it.
3. **Rate severity × likelihood.** Use a 3-grain scale (Low / Medium / High for each axis) — finer scales give false precision.
4. **Propose ONE mitigation per risk.** Specific, owned, dated where possible. Two-page mitigation plans = not a mitigation.
5. **Flag risks where the right answer is "accept it, here's why".** Not every risk is worth mitigating; that's a legitimate decision and worth recording.

## Output shape

```
# Risk assessment: <subject>

**Top risks** *(the ones that drive the recommendation):*
1. <Risk in one sentence — likelihood × severity rating>
2. ...

## Detailed risks

### R1 — <short title>
- **What could happen:** <specific outcome>
- **Trigger:** <conditions that cause it>
- **Likelihood:** Low / Medium / High — <one-line why>
- **Severity:** Low / Medium / High — <one-line why>
- **Early-warning signal:** <what we'd see before it bites>
- **Mitigation:** <concrete action — owner — by when>
- **Residual risk after mitigation:** <what's left>

### R2 — <...>
<...>

## Risks we're explicitly accepting
- <Risk> — <why mitigation cost > expected damage>

## Open / unknowns
- <Thing we don't know enough about to assess>
```

## Severity × Likelihood matrix

|              | Low likelihood | Medium | High |
|--------------|---|---|---|
| **Low severity**    | ignore | monitor | mitigate cheaply |
| **Medium severity** | monitor | mitigate | mitigate + plan B |
| **High severity**   | mitigate | mitigate + plan B | reconsider the plan |

## Rules

- **No generic risks.** "Scope creep" → "Marketing's launch announcement assumes feature X ships Nov 22, but the dependency on vendor Z is unconfirmed."
- **One mitigation per risk.** If your mitigation needs sub-mitigations, the risk is actually a cluster — split it.
- **Cite if possible.** If a risk comes from prior experience or a published failure, link to it.
- **Don't sandbag.** Inflating severity to look thorough or deflating it to look optimistic both destroy trust.

## Pitfalls

- Listing 30 risks → readers stop at 5 and you've lost the signal.
- Mitigations with no owner / no date → wishes, not plans.
- "Risks: communication, alignment, timing" — meaningless without specifics.
- Treating "we should communicate clearly" as a mitigation for any risk — it isn't.
