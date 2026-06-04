---
name: standup-summary
description: Turn yesterday's commits + meeting notes + ticket updates into a 3-line standup update (yesterday / today / blockers). For solo or async-team standups.
applies_to: [summarize, draft-other]
---

# Skill: Standup summary

## Goal

The operator pastes one line into Slack and it captures yesterday's
progress, today's plan, and any blockers. The team reads in 10 seconds.

## Process

1. **Yesterday** — pull from: git log (last 24h commits by the operator),
   calendar (yesterday's meetings), the jobs journal (work delegated to
   agents). Convert to OUTCOMES, not activities.
2. **Today** — pull from: calendar (today's meetings), open tasks in the
   personas's queue, anything the operator named as "next up" yesterday.
3. **Blockers** — anything waiting on someone else. Be specific —
   blockers without an owner are gripes.

## Output shape (the actual standup message)

```
**Yesterday:** <Outcome 1>; <Outcome 2>.
**Today:** <Outcome to ship>; <Decision to make>.
**Blockers:** <Specific waiting-on + owner> / none.
```

That's it. Three lines. Send.

## Longer shape (when written report needed)

```
# Standup — <Operator> · <YYYY-MM-DD>

## Yesterday
- <Outcome — what landed, not what you worked on>
- <Outcome>

## Today
- <Outcome aiming to ship>
- <Decision needed>

## Blockers
- **Waiting on <Name>** — <what for, since when>
- <or: "None">

## Risks (only if material)
- <Specific risk to this week's commitments>
```

## Rules

- **Outcomes over activities.** "Shipped the auth refactor" beats
  "worked on auth refactor."
- **Three lines max** for the chat version. Standup isn't a status
  report.
- **Blockers MUST name the owner.** "Blocked on review" is missing
  half the data; "Blocked on Sarah's API review since Monday" is
  actionable.
- **Don't list every commit.** One outcome per workstream is plenty.

## Pitfalls

- Activity-narrating: "Spent the morning in meetings." Nobody can act
  on this.
- Burying blockers at the end so they look smaller. Lead with them if
  they're material.
- Vague "today" — "continue work on X" implies no plan. Name a concrete
  delivery.
- Writing the standup AFTER the day. Standups are at the start so the
  team can adapt.
