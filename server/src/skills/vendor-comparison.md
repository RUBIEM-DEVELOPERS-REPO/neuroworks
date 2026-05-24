---
name: vendor-comparison
description: Compare vendor quotes side-by-side and recommend one — cost / risk / fit matrix with a named winner and reason.
applies_to: [analyze, compare, draft-other]
---

# Skill: Vendor comparison + recommendation

## Goal

Procurement / leadership scans one table, sees the totals + the risks, and gets a recommendation they can sign off on without re-doing the analysis.

## Process

1. **Normalise pricing to apples-to-apples.** Strip per-seat vs flat-fee vs usage-based confusion — convert to TCO over the same horizon (12 months default; longer if the contract is multi-year).
2. **List the implicit costs** — onboarding fees, training time, switching cost, integration build, ramp time before value. These often dwarf sticker price.
3. **Score each vendor on 4-6 dimensions** the buyer actually cares about. Usually: total cost, risk (vendor stability + lock-in), fit (does it solve the specific use case), implementation effort, support quality, exit cost.
4. **Make the recommendation explicit.** "Vendor A — because <2 reasons>. We'd lose <thing> vs vendor B but that's <why we don't care>."
5. **Flag what you'd renegotiate.** Quote sheets are starting positions — name 1-3 specific items to push back on.

## Output shape

```
# Vendor comparison: <Category>

**Buyer:** <Team / use case> · **Horizon:** <12 months / 3 years>

## TL;DR
**Recommend: <Vendor X>.** <Two-sentence reason.>

## TCO (normalised, 12-month)

| Line item | Vendor A | Vendor B | Vendor C |
|---|---|---|---|
| Sticker price (year 1) | $X | $Y | $Z |
| Onboarding / setup fee | $X | $Y | $Z |
| Estimated implementation time | N hours @ $rate | ... | ... |
| Training overhead | $X | $Y | $Z |
| **Year-1 TCO** | **$total** | **$total** | **$total** |
| Year-2 onward (annual) | $X | $Y | $Z |

## Comparison matrix

| Dimension (weight) | Vendor A | Vendor B | Vendor C |
|---|---|---|---|
| Cost (25%) | <score / brief> | ... | ... |
| Risk — vendor stability (15%) | <e.g. Series D, profitable> | ... | ... |
| Risk — lock-in (15%) | <data portability, contract length> | ... | ... |
| Fit for use case (25%) | <how well it solves THE specific need> | ... | ... |
| Implementation effort (10%) | <weeks to value> | ... | ... |
| Support quality (10%) | <SLA, named contacts, response time> | ... | ... |
| **Weighted score** | **X.X / 10** | **X.X / 10** | **X.X / 10** |

## Why <recommended vendor>
- <Reason 1 — quantified if possible>
- <Reason 2 — risk-adjusted>
- <Reason 3 — fit signal>

## What we'd give up (vs runner-up)
- <Honest trade-off — feature, support tier, contract term>

## Recommended pushbacks before signing
1. <Specific term to renegotiate — e.g. "Reduce auto-renewal notice from 90 to 30 days">
2. <... — e.g. "Cap year-2 price increase at 5%">
3. <... — e.g. "Add data-portability clause for paid export">

## Sources
- [Vendor A quote PDF, dated YYYY-MM-DD]
- [Vendor B quote PDF, dated YYYY-MM-DD]
- [Reference call notes with <customer> on YYYY-MM-DD]
```

## Rules

- **Total cost > sticker price.** Implementation + training + ramp commonly add 30-100% to year-1 TCO.
- **Weight the dimensions before scoring** — picking weights AFTER you see the scores is how you cheat yourself into a predetermined answer.
- **Cite the quote document** for any price. Verbal quotes don't count; get them in writing first.
- **Recommend ONE.** Comparison docs that say "either is fine" don't help; the buyer wants a decision.
- **Name the renegotiation list.** Procurement saves real money on the second pass.

## Pitfalls

- Comparing on features the buyer didn't ask for — pads the matrix without changing the call.
- Missing the exit cost — switching back is part of total risk.
- Trusting a vendor reference call without confirming they're truly comparable (size / use case / vertical).
- Recommending the cheapest when fit is the actual constraint.
- Forgetting to list what you'd lose with the recommended option — reads like a sales pitch.
