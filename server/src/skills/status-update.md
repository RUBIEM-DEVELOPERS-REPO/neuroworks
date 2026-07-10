---
name: status-update
description: Weekly / standup status update format — shipped, in-flight, blocked, asks. The kind of update a manager can absorb in 30 seconds.
applies_to: [draft-memo, draft-other]
---

# Skill: Status update

## Goal

The reader (your manager / cross-functional partner) should know in 30 seconds: what got done, what's at risk, and what they need to do. No padding, no marketing voice.

## Format

```
# <Name> — <Week of YYYY-MM-DD>  *(or: Day, Sprint N, etc.)*

## Shipped
- <Concrete output + link if there's a PR / doc / commit>
- <...>

## In flight
- <Workstream — % done or expected ship date — owner if not you>
- <...>

## Blocked / needs decision
- **<Issue>** — what's stuck, what unblocks it, who I'm waiting on
- <...>

## Asks for <reader>
- <Specific thing you need from them, with a deadline>
- <...>

## Highlights / lowlights *(optional, 1-2 each)*
- 🟢 <Thing worth flagging up>
- 🔴 <Thing worth flagging up>

## Next week
- <Top 2-3 priorities>
```

## Rules

- **Shipped means shipped.** Merged, deployed, signed, sent. Not "almost done", not "PR open". Move "almost" items to "In flight".
- **In flight items have a date or a percentage.** "Working on X" without a marker is invisible work. "X — 60%, ship Tuesday" is real.
- **Blocked items must name the unblocker.** "Blocked on infra" is useless. "Blocked on infra — waiting on [@person] to provision Postgres by Wed" is actionable.
- **Asks are the only place the reader takes action.** Make them obvious: bold the thing, deadline the ask.
- **No filler.** "Continued to work on" / "Made progress on" → if there's nothing concrete, drop the line entirely. A short status update is a strong signal.
- **Same structure week-to-week.** Predictable shape = readable in 30 seconds. Don't reinvent the format.

## Length

200-400 words. A status update that takes longer to write than to read is bloated.

## Tone

Declarative, past tense for Shipped, present for In flight, future for Next week. No "I think", "I believe", "hopefully" — say what's happening or don't say it.

## Pitfalls

- Listing every task you touched → bury the signal.
- Padding "Shipped" with non-shipped items → erodes manager's trust.
- No "Asks" section → reader doesn't know what you need from them.
- Surprises in the next week's update that should have been flagged this week — escalate early.
- Marketing voice ("super excited to announce") → keep it neutral.
