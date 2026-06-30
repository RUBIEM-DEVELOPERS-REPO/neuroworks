---
name: project-plan
description: Build a project plan — objective, scope, phases, milestones with dates, dependencies, owners, resources, and the critical path.
applies_to: [draft-doc, plan, project-plan]
---

# Skill: Project plan

## Goal

A sponsor sees what will be delivered, by when, by whom, and what could derail it — concrete enough to track against, not a wish list of dates.

## Structure

```
# Project plan — <Project>
**Objective:** <the outcome + how we'll know it's done.>
**Sponsor:** <name> · **PM:** <name> · **Target end:** <date>

## Scope
- In: <deliverables> · Out: <explicitly excluded>

## Milestones
| # | Milestone | Owner | Target date | Depends on | Done = |
|---|---|---|---|---|---|
| M1 | <kickoff / design signed off> | | | — | <criterion> |
| M2 | <build complete> | | | M1 | |
| M3 | <launch> | | | M2 | |

## Phases & key tasks
### Phase 1 — <name> (<dates>)
- [ ] <task> — <owner> — <est> — needs <dep>

## Dependencies & critical path
- <the chain of tasks that, if any slips, slips the end date>

## Resources
- People (allocation %), budget, tools, external vendors

## Risks (top 3-5)
| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|

## Governance
- Status cadence: <weekly> · escalation path · change-control rule
```

## Rules

- **Milestones are outcomes with a "done =" criterion**, not activities. "Design signed off" beats "work on design".
- **Every task/milestone has an owner and an estimate.** Dateless, ownerless plans don't get delivered.
- **Make dependencies explicit and identify the critical path** — that's what you protect; slack elsewhere is fine.
- **Buffer the uncertain work**; don't plan to 100% utilisation.
- **Scope-out is stated** — the plan is also a boundary.
- **Define the status cadence + change rule** up front so scope creep has a process.

## Pitfalls

- A Gantt of activities with no acceptance criteria — "busy" ≠ "done".
- Hidden dependencies that surface as last-minute blockers.
- No critical path — every slip feels equally urgent (or equally ignorable).
- Planning at full utilisation — the first sick day breaks the schedule.
- Owner = "the team" — diffuse ownership = no ownership.
