---
name: unit-economics
description: How to model and present SaaS unit economics — LTV, CAC, payback, gross margin, cohort retention — with assumptions stated upfront.
applies_to: [plan, draft-report, draft-brief]
---

# Skill: SaaS unit economics

## Goal

A short, defensible read of the unit economics that an investor, board member, or CEO can act on. Assumptions stated upfront. Definitions explicit. Recommendation grounded in the numbers.

## Structure

```
# Unit economics — <Business / segment>

## Snapshot (top of the page)
| Metric | Value | Vs benchmark |
|---|---|---|
| ARPA / ACV | $<X>/mo | <benchmark range> |
| Gross margin | <Y>% | <…> |
| CAC | $<Z> | <…> |
| CAC payback | <N> months | <…> |
| LTV (gross) | $<…> | <…> |
| LTV / CAC ratio | <…> | <…> |
| Net dollar retention | <…>% | <…> |

## Assumptions (stated explicitly)
- **CAC definition:** <fully-loaded incl. SDR + AE + marketing programs + tooling, OR paid-only>
- **Churn assumption:** <gross monthly logo churn rate, source>
- **Gross margin definition:** <revenue minus hosting, support, payment processing — list inclusions>
- **Cohort window:** <12-month cohorts, trailing N months>
- **Expansion:** <treated as offset to churn, or layered separately>

## Scenarios (base / bull / bear)
| Scenario | Differentiating assumption | LTV | Payback | LTV/CAC |
|---|---|---|---|---|
| Base | <e.g. 2.5% monthly churn> | $<…> | <…> | <…> |
| Bull | <e.g. 1.5% churn> | $<…> | <…> | <…> |
| Bear | <e.g. 4.0% churn> | $<…> | <…> | <…> |

## Sensitivity (what matters most)
- 1pp change in monthly churn → $<X> in LTV, <Y> months in payback
- 10% change in CAC → <…>
- 5pp change in gross margin → <…>

## What this means
<One paragraph: where are we vs healthy ranges; what's the leverage point; the action this implies.>

## Recommendation
<One sentence: the concrete next step that the numbers justify.>
```

## Rules

- **Assumptions ALWAYS stated upfront.** A model without listed assumptions is unfalsifiable — and unfalsifiable models lose investor trust.
- **Be explicit about CAC definition.** Fully-loaded vs paid-only differs by 2-5×. Reporting "CAC payback 8 months" with unclear definition is misleading.
- **Net new MRR ≠ revenue growth.** Expansion + churn are layered effects; report them separately for legibility.
- **Healthy SaaS ranges (rough, 2025-2026):** Gross margin 75-85%; CAC payback under 12 months for SMB / under 18 for mid-market / under 24 for enterprise; LTV/CAC 3+; NDR 100%+ (110%+ is best-in-class for PLG/mid-market).
- **Show base/bull/bear.** A single point estimate hides uncertainty. The bear case is the one investors check first.
- **Sensitivity over precision.** "1pp change in churn = $X in LTV" is more useful than a 3-decimal LTV number.
- **Recommendation tied to the leverage point.** If churn is the biggest sensitivity, the recommendation is about churn — not "we should grow faster".

## Pitfalls

- **Vague CAC.** "CAC is around $300" without a definition is unfalsifiable. Name what's included.
- **Cherry-picked cohorts.** Reporting the best-performing cohort as representative. Always show the cohort range, not a single number.
- **Confusing gross retention with net.** GRR ignores expansion; NDR includes it. Mixing them silently is a credibility kill.
- **Ignoring contribution margin.** GM alone doesn't tell you payback if support + onboarding costs are heavy.
- **No sensitivity = no honesty.** A model with a single point estimate hides which assumption is load-bearing.
- **Recommendation that ignores the model.** Numbers say churn is the leverage point; recommendation is "let's add more outbound". Mismatch.
