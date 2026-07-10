---
name: planning-doc
description: How to write a project plan that the team can actually execute against.
applies_to: [plan]
---

# Skill: Planning doc

## Goal

A doc that lets the team start work on Monday without another planning meeting.

## Structure

```
# <Project name>

## Goal
<One sentence. The outcome, not the activity. "Ship v2 dashboard with 99.9% uptime" not "build v2 dashboard".>

## Why now
<2-3 bullets — what triggered this, what's the cost of waiting, what's the cost of doing it wrong>

## Non-goals
<What this plan explicitly does NOT cover. Scope discipline lives here.>

## Approach
<3-5 sentences on the high-level shape. Not the steps — the strategy.>

## Steps
1. **<Phase name>** — <what gets done, owner, target date>
   - Sub-step (if needed)
   - Sub-step
2. **<Phase name>** — <…>
3. **<Phase name>** — <…>

## Risks + mitigations
- **<Risk>**: <Why it could happen> · _Mitigation:_ <what we'll do>
- <…>

## Dependencies
- <External thing we need: API access, vendor sign-off, hardware, sign-off>
- <…>

## Definition of done
- [ ] <Concrete, measurable check>
- [ ] <…>

## Next checkpoint
<Date + format: "Demo to stakeholders on 2026-06-12" / "Async update in #project channel">
```

## Rules

- **Goal is an outcome, not an activity.** "Reduce checkout abandonment by 15%" beats "redesign checkout flow".
- **Steps are assignable.** "Marketing handles launch" → who specifically, by when?
- **Risks need mitigations.** A list of risks without mitigations is just anxiety.
- **DoD is checkable.** "User testing complete" is vague. "5 users complete checkout in < 90s" is checkable.
- **One next checkpoint.** Plans that don't have a next sync date die in the first week.

## Sizing rule of thumb

- Plan length ≈ project length in weeks ÷ 2 pages. A 4-week project = 2-page plan. A 6-month project = 12-page plan (and probably needs a separate brief on top).
- More than that and you're planning the planning — start executing.

## Pitfalls

- Optimistic time estimates. Add 30%. Add another 30% for anything involving a vendor or another team.
- "Phase 1: research" with no exit criteria — define what "research done" looks like.
- Mixing goal + approach in the same section.
- Omitting non-goals. The scope creep that kills the project is the thing you didn't say no to upfront.
