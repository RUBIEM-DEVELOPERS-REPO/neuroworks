---
name: product-spec
description: Product Requirements Document (PRD) — what we're building, who for, why now, what success looks like.
applies_to: [plan, draft-report, draft-other]
---

# Skill: Product spec (PRD)

## Goal

Before engineers and designers commit time, the PM writes down what's being built, for whom, and why. A good PRD makes the next conversation be about HOW, not WHAT.

## Format

```
# <Feature / product name> — Product Spec

**PM:** <name> · **Eng lead:** <name> · **Design:** <name>
**Status:** Draft | In review | Approved | Building | Shipped
**Target ship:** <YYYY-MM-DD or quarter>

## Summary
<3-5 sentences. The change in plain English. A non-technical exec should follow this section.>

## Problem
<Who experiences what pain, today, with what frequency / severity. Quote a user or cite a metric. If you can't articulate a specific user with a specific pain, don't build the feature yet.>

## Why now
<Why this Q, not the next one. A market shift, a customer ask reaching critical mass, a dependency unblocking, a competitive pressure. Without "why now", the feature gets deprioritised in favor of louder asks.>

## Target users
- **Primary:** <one specific persona — role, size, context>
- **Secondary:** <other personas who benefit but aren't the design target>
- **Not for:** <users we're explicitly not optimising for — bound the scope>

## User stories
- As <persona>, I want <capability> so that <outcome>.
- As <persona>, I want <capability> so that <outcome>.
- As <persona>, I want <capability> so that <outcome>.

## Requirements

### Must-have (for v1 ship)
- <Requirement — concrete, testable>
- <Requirement>

### Should-have (post-launch)
- <Requirement>

### Won't-have (this version)
- <Explicitly out of scope. Surfaces tradeoffs leadership might otherwise argue about later.>

## User flow
<Description or diagram of the happy path. 3-7 steps. What does the user click / type / see at each step.>

## Edge cases & error states
- What happens when <X is empty / Y times out / Z is offline>?
- What happens for the first-time user vs the returning user?

## Success metrics
- **Primary (north star):** <metric — current → target — measured how — by when>
- **Secondary:** <metric>
- **Guardrail (must not regress):** <metric — e.g. p95 latency, support load>

## Open questions
- <Question — owner to resolve by when>
- <Question>

## Risks
- <Risk + mitigation>

## Out of scope / later
- <Thing we considered but cut — and why>

## Appendix
- Designs: <link>
- Research: <link>
- Related docs / past attempts: <link>
```

## Rules

- **One problem per PRD.** "Improve onboarding AND add notifications" → two PRDs.
- **Quantify the problem.** "Users complain" → "X% of trial users drop in step 3" (with the source).
- **Stories follow the format.** "As <persona>, I want <thing> so that <outcome>" — the "so that" is the test of whether the story is real.
- **Must-have / Should-have / Won't-have is the scope contract.** Without it, the engineering team scopes for you.
- **Guardrail metrics are non-negotiable.** Without them, you ship features that improve one number while quietly breaking another.
- **Status drives behavior.** "Draft" = critique welcome; "Approved" = stop redesigning, start building.

## Length

Small feature: 400-800 words.
Major feature / new product: 1500-3000 words.
If you're past 3000 words, split into a product spec + a separate design doc.

## Pitfalls

- Solution-first PRDs — start with the problem, not "we'll add a button that…".
- No "why now" — feature shelved when something louder appears.
- "All users want this" → no specific persona, no real testable hypothesis.
- Success metrics that can't be measured ("delight users") — pick something dashboardable.
- Skipping the "Won't have" section — leadership debates scope after work has started.
