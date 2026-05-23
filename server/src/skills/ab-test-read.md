---
name: ab-test-read
description: How to read an A/B test honestly — name the CI, MDE, sample size, peeking risks; verdict ship / don't ship / inconclusive.
applies_to: [review, plan, draft-report]
---

# Skill: A/B test read

## Goal

A short, honest read of an A/B test result that a PM / engineering lead / executive can act on. Doesn't hide statistical limits. Verdict is one of: ship, don't ship, inconclusive (keep running / new test).

## Structure

```
# A/B test read — <Test name>

## Verdict
**Ship / Don't ship / Inconclusive — <one line on why>.**

## Setup
- **Hypothesis:** <what we expected and why, BEFORE the test>
- **Metric:** <primary metric, definition>
- **Guardrails:** <metrics we'd monitor for regressions>
- **Allocation:** <50/50 / 90/10 / etc; reason>
- **Run window:** <start → end, calendar days, business days>

## Results
| Arm | n | Metric | Lift vs control | 95% CI |
|---|---|---|---|---|
| Control | <…> | <…> | — | — |
| Variant | <…> | <…> | <…> | [<low>, <high>] |

**Power check:** With n=<…> per arm and observed baseline, the MDE we could detect at 80% power was <…>%. The observed lift was <…>% — <inside / outside> our MDE.

**Guardrail check:** <metric A> moved <…>%, <metric B> moved <…>%. Both within tolerance / one exceeded.

## Caveats
- **Multiple peeking?** <If we looked daily without correction, p-values are inflated — flag it.>
- **Novelty effects?** <If the test was short, the lift might fade as the variant stops feeling new.>
- **Day-of-week / seasonality?** <Did the window cover at least one full weekly cycle? Holiday distortions?>
- **Selection bias?** <Are the arms comparable demographically? Any allocation bug?>
- **Network effects?** <Could variants leak between users (shared spaces, viral mechanics)?>

## Interpretation
<One paragraph: assuming the caveats are managed, what does the result mean for the user / business?>

## Recommendation
<One concrete next step: ship to 100%, ship behind feature flag, extend the test, design a follow-up to isolate <unknown>.>
```

## Rules

- **Verdict first.** "Ship", "Don't ship", or "Inconclusive". Hedging that bypasses the verdict is the most common failure mode.
- **Always name the MDE.** "We expected to detect a 2% lift with 80% power" is the honest framing. Observed lifts SMALLER than MDE = noise.
- **Always name the CI.** A point estimate without confidence interval is dishonest. CIs that span zero = inconclusive, period.
- **Flag peeking explicitly.** If we looked at p-values before the test ended without Bonferroni / sequential correction, p-values are inflated.
- **Check guardrails before celebrating.** A 5% lift in conversion with a 10% lift in support tickets is not a win.
- **Distinguish statistical significance from practical significance.** A 0.3% lift that's statistically significant at huge sample sizes may not be worth shipping.
- **State the run window.** "Ran 14 days" beats "ran for a while". Include whether it covered a full weekly cycle.

## Pitfalls

- **Reporting only the variant's lift.** Without control + CI, the lift is meaningless.
- **Hiding negative guardrails.** "Conversion up 4%, but bounce rate also up 8%" — the bounce rate matters.
- **Calling a test "won" mid-run.** Daily peeking + no correction = high false-positive rate. Stop the celebration until the run window completes.
- **Conflating two arms.** "We added a button AND a banner" — can't attribute the lift to either.
- **Ignoring novelty effects on short tests.** A 2-day "win" often fades by week 3.
- **Skipping the recommendation.** "Stats look good" is not a recommendation. "Ship to 100% rollout starting Tuesday, monitor support volume daily for the first 5 business days" is.
- **No hypothesis stated upfront.** Without a pre-registered hypothesis, the test result is hindsight rationalisation.
