---
name: trade-off-memo
description: How to write a short engineering memo that surfaces trade-offs honestly and ends with a defensible recommendation.
applies_to: [plan, decision, draft-other]
---

# Skill: Trade-off memo

## Goal

A short memo the reader can decide from in under 5 minutes. Names the trade-offs honestly, recommends one option, explains the disqualifier for the others.

## Structure

```
# <Decision being made>

## Recommendation
<One sentence: pick X. The recommendation goes FIRST, not buried at the bottom.>

## Context
<One paragraph: what problem are we solving, what constraints are real, what's the deadline / blast-radius shape.>

## Options considered

### Option A — <Short name>
- **What:** one-line description
- **Pros:** 2-4 bullets, concrete
- **Cons:** 2-4 bullets, honest (especially the one that bothers you most)
- **Effort:** S / M / L / XL with brief justification
- **Risk:** specific failure mode, not "could be risky"

### Option B — <Short name>
- (same shape)

### Option C — <Short name>
- (same shape)

## Why we picked <Option X>
<One paragraph: the differentiator. Not "all things considered" — the specific reason this beats the others FOR THIS CONTEXT.>

## What would change our mind
- If <new fact emerges>: revisit
- If <constraint shifts>: option B becomes preferred
(Forces the recommendation to be falsifiable.)

## Test plan / verification
<For technical decisions: how we'd validate this works as expected post-ship. Smoke test, load test, canary criteria.>

## Open questions
- <Specific question to <owner> by <date>>
- <…>
```

## Rules

- **Recommendation first.** Reader should know your verdict in the first sentence. The reasoning supports it; it doesn't lead to it.
- **Trade-offs are HONEST.** The con you'd rather omit is the one that matters most. List it.
- **Specific, not abstract.** "Higher operational cost" → "adds ~$800/mo at current load and an on-call rotation".
- **Compare options on the SAME dimensions.** If Option A has pros/cons/effort/risk, Option B has them too. Asymmetric comparisons hide bias.
- **Disqualifiers, not preferences.** "Why we didn't pick Option B" should name a specific dealbreaker, not "we just liked A better".
- **Falsifiable.** "What would change our mind" makes the memo a decision that can be revisited if context shifts, not a religion.

## Pitfalls

- **The "no real choice" memo.** Lists 3 options where 2 are straw-men. Readers notice. Forces the recommendation to look obvious by rigging the comparison.
- **Buried recommendation.** Memo ends with "more research needed" — that's not a recommendation, that's a draft.
- **Vague effort.** "Medium effort" is meaningless. Quantify: "3 eng-weeks", "1 eng-week to ship the MVP, 2 more to harden".
- **Missing the operational cost.** Engineering focus on code complexity, ignoring on-call burden, observability cost, runbook surface area. Always include op cost in cons.
- **Risk written as "could have issues".** Name the specific failure mode and the mitigation. "Cache invalidation bug under burst writes — mitigated by short TTL + write-through" beats "risky".
- **Skipping "what would change our mind".** Recommendations that can't be falsified can't be revisited cleanly when reality moves.
