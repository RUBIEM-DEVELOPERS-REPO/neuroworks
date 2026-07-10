---
name: process-mapping
description: Document an as-is / to-be business process — actors, ordered steps, decisions, handoffs, pain points, and the redesigned flow with expected gains.
applies_to: [draft-doc, draft-other, process-map]
---

# Skill: As-is / to-be process map

## Goal

A reader sees how the process works TODAY (with its waste), how it SHOULD work, and exactly what changes between the two — with the gain quantified.

## Structure

```
# Process map — <Process name>
**Trigger:** <what starts it> · **Outcome:** <what "done" looks like> · **Owner:** <role>

## Actors / systems
- <role or system> — <what they do in this process>

## As-is (current state)
1. [<Actor>] <step> — <system used> — ~<time/SLA>
2. [<Actor>] **Decision:** <condition?> → if yes → step 3, if no → step 5
3. [<Actor>] <step>  ⚠ **Pain:** <delay / rework / manual handoff / error>
…

### Pain points & waste
| # | Step | Problem | Impact (time / cost / risk) |
|---|---|---|---|

## To-be (redesigned)
1. [<Actor/automation>] <step>  ✅ <what changed>
…

### What changed & why
- <step removed / automated / merged> → <expected gain>

## Expected gains
| Metric | As-is | To-be |
|---|---|---|
| Cycle time | <X> | <Y> |
| Handoffs | <N> | <M> |
| Manual touches | <N> | <M> |

## Risks of the change + mitigations
- <change> → <risk> → <mitigation>
```

## Rules

- **Number every step and name the actor** in brackets. A step with no owner is where work stalls.
- **Mark decisions explicitly** with both branches — that's where exceptions hide.
- **Flag waste on the as-is**, don't just describe it (delay, rework, handoff, duplicate entry, waiting, over-processing).
- **To-be ties each change to a gain.** Redesign without a measurable why is reorganising for its own sake.
- **Keep notation plain** (numbered steps + decisions). Don't require a BPMN tool to read it.

## Pitfalls

- Mapping the to-be without first being honest about the as-is — you optimise a fantasy.
- Missing exception paths — the "what if it's rejected?" branch is usually the real work.
- No baseline metrics — then "improved" is unprovable.
- Boiling the ocean — map one process end-to-end, not the whole department.
