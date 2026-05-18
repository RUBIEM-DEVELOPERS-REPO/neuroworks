---
name: comparison
description: Side-by-side analysis of two (or three) things — same dimensions, honest trade-offs, ends with a recommendation under stated constraints.
applies_to: [analyze, research]
---

# Skill: Comparison

## Goal

The customer is choosing between options. Show what's different on the dimensions that matter, then say which to pick under what conditions. A comparison that doesn't end with a recommendation under stated constraints is just a list.

## Process

1. **Identify the decision dimensions.** What does the customer actually trade off? Cost, speed, accuracy, lock-in, learning curve, ecosystem, fit-for-purpose. Pick 4-6 that matter for THIS decision — don't list every possible attribute.
2. **Gather evidence for each option on each dimension.** Vault first if either option appears in the customer's notes (they've already thought about it). Web for current versions, pricing, recent reviews.
3. **Use the SAME source standard for both/all sides.** If you cite the vendor's own marketing page for option A, do the same for option B — or use independent reviewers for both. Asymmetric sourcing produces biased comparisons.
4. **State trade-offs in real units.** "Option A is faster" → "Option A serves p95 in 40ms vs B's 180ms".
5. **Name the recommendation explicitly + the constraint under which it holds.** "Pick A if you optimise for cost; pick B if you optimise for ecosystem maturity." Not "it depends".

## Output shape

```
# <Thing A> vs <Thing B>

**TL;DR:** <One sentence with the recommendation and the constraint.>

## At a glance

| Dimension | <A> | <B> |
|---|---|---|
| Cost | $X/mo | $Y/mo |
| Speed | ... | ... |
| ... | ... | ... |

## Where they diverge

### <Dimension that matters most>
<2-4 sentences. Concrete numbers. Source where useful.>

### <Next dimension>
<...>

## Where they're equivalent
<One paragraph or a few bullets — these don't drive the decision but should be acknowledged.>

## Hidden costs / risks

- **<A>:** <thing the marketing doesn't say>
- **<B>:** <thing the marketing doesn't say>

## Recommendation

- **Pick <A>** if <constraint that favors A>.
- **Pick <B>** if <constraint that favors B>.
- **Neither** if <constraint that rules out both> — consider <alternative>.

## Sources
[1] ...
[2] ...
```

## Rules

- **3 options max.** A 5-way comparison is a research report, not a comparison.
- **Symmetric structure.** Every dimension treated the same way for every option. Asymmetric sections signal bias.
- **Disclose your priors.** If the customer's vault or earlier conversation reveals a preference, name it ("you're leaning toward A — here's whether that holds up").
- **Surface lock-in.** Migration cost is often the hidden tiebreaker. Always mention it if it exists.

## Pitfalls

- Hand-wavy "X is better at Y" without numbers.
- Pretending the dimensions are independent when they aren't (cost and feature set usually correlate).
- Defaulting to whatever's newer/trendier without weighing fit.
- Concluding "they're both great" — the customer asked you to pick. Pick under a constraint.
