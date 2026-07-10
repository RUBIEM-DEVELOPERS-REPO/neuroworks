---
name: design-doc
description: Full technical design doc (RFC) for non-trivial engineering work — problem, options, recommended approach, rollout, open questions.
applies_to: [code, plan, draft-report, draft-other]
---

# Skill: Design doc (RFC)

## Goal

Before significant engineering work starts, write down the design so it can be reviewed, challenged, and approved on paper rather than in code. A good design doc surfaces disagreements early when they're cheap to resolve, not in week 3 when someone has already built the wrong thing.

## Format

```
# <System or feature name> — Design Doc

**Authors:** <names> · **Reviewers:** <named individuals, not "the team"> · **Status:** Draft | In review | Approved | Implemented | Superseded
**Last updated:** <YYYY-MM-DD>

## Overview
<2-4 sentences. The problem and the proposed solution in plain English. A non-engineer should follow this section.>

## Goals
- <What this design needs to achieve. Specific, measurable.>
- <Goal 2>

## Non-goals
- <What this explicitly does NOT solve. Bound the work.>
- <Non-goal 2>

## Context / background
<Why are we doing this NOW? What changed? What's the current state of the system? Links to relevant prior docs, incidents, customer requests.>

## Proposal
<The actual design. Multiple subsections expected.>

### Architecture
<Diagram if helpful (ASCII or linked image). The components, where they live, how data flows.>

### Data model
<Schemas, types, indexes. Be explicit about what's new vs. what reuses existing models.>

### API / contract
<Endpoint signatures, message shapes, function interfaces. Show the smallest example that makes the design concrete.>

### Behavior
<What happens on the happy path. What happens on each error path. What happens on retry, on partial failure, under load.>

## Alternatives considered

### Option A — <name> (recommended)
<2-4 paragraphs. The chosen design's properties.>

### Option B — <name> (rejected)
- **Pros:** ...
- **Cons:** ...
- **Why rejected:** <specific reason>

### Option C — <name> (rejected)
<...>

### Do nothing
<What happens if we don't ship this. Sometimes the answer is "fine" — and that's important to record.>

## Trade-offs
<What we're accepting. Latency vs cost. Simplicity vs flexibility. Speed of shipping vs long-term maintenance. Name them honestly.>

## Rollout plan
1. <Step — when — how to verify>
2. <Step>
3. <Cutover / feature flag / migration>

## Observability
- **Metrics:** <what we'll graph>
- **Logs:** <what we'll log>
- **Alerts:** <what would page>

## Security & privacy
<Threat model deltas. New attack surfaces. PII flow. Auth/authz changes.>

## Open questions
- <Thing we haven't decided>
- <Thing we don't know yet — owner to find out by when>

## Appendix
<Diagrams, benchmark results, code sketches, related links.>
```

## Rules

- **Goals before solution.** A design doc that doesn't define "won" can't be evaluated.
- **Non-goals are mandatory.** Without them, scope grows in review.
- **Reviewers are named individuals.** "Team-wide review" → no review. Name 2-4 specific people who must sign off.
- **Alternatives section is the heart of the doc.** Anyone can propose a solution; a good design doc shows the considered ones.
- **Open questions are mandatory.** A doc with no open questions is either trivial or hiding uncertainty.
- **Status drives behavior.** "Draft" means feedback welcome; "Approved" means stop redesigning, start building.
- **One design per doc.** Bundling 3 features into one design doc makes each impossible to approve independently.

## Length

Standard feature: 1000-2500 words.
Foundational system: 2500-5000 words.
If you're past 5000 words, you have multiple design docs hiding in one — split.

## Pitfalls

- Solution-first writing — readers don't trust the design if the problem wasn't framed first.
- Pretending only one option was considered.
- Skipping rollout plan because "we'll figure that out" — that's where most ships die.
- No observability section — leads to systems that can't be debugged in production.
- "Approved" status with major open questions unresolved.
