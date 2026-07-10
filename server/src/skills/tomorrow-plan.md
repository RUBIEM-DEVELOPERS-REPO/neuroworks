---
name: tomorrow-plan
description: Build tomorrow's work plan from today's unfinished tasks + calendar + standing priorities — prioritised, time-boxed, realistic.
applies_to: [plan, draft-other]
---

# Skill: Tomorrow's work plan

## Goal

User wakes up tomorrow with a single-page plan: what to do first, what to ship, what to defer, with realistic time estimates that match the actual day available.

## Process

1. **Take stock of what carries over.** Tasks not finished today, especially the ones that BLOCK others tomorrow.
2. **Pull tomorrow's calendar.** Subtract meetings + buffer (15min before each for prep, 5min after for follow-ups) from the working day. The remaining is your actual capacity.
3. **Identify the ONE thing.** What's the single most important task to ship tomorrow? It gets the protected morning slot.
4. **Time-box ruthlessly.** Don't list 8 hours of work for a 4-hour-available day; defer the rest with notes.
5. **Group by ENERGY type** — deep work (focused, no interruptions), shallow work (calls, replies, admin), creative work. Match to time-of-day patterns.
6. **End with an EOD verification** — what does "done with tomorrow" look like?

## Output shape

```
# Tomorrow — <YYYY-MM-DD (weekday)>

**Available focus time:** <N hours> (subtracting <M hours of meetings>)
**The ONE thing:** <Single most important task / deliverable>

## Morning (deep work — protect this)

**Block: <Time start> – <Time end>** (<duration>)
- **<Task 1 — the ONE thing>** — <time estimate> — <why this gets the morning slot>
- (If time after): <Task 2 — also deep work> — <time>

## Meetings + transitions

| Time | Meeting | Prep needed |
|---|---|---|
| 10:00–10:30 | <Meeting name> | <One-line prep — read X, decide Y> |
| 13:00–13:45 | <Meeting name> | <One-line prep> |
| ... | | |

## Afternoon (shallow work — replies, follow-ups, admin)

**Block: <Time start> – <Time end>** (<duration>)
- [ ] <Task — 15min>
- [ ] <Task — 30min>
- [ ] <Task — 10min>
- [ ] <Task — 5min>

## Stretch (if morning runs long)

- <Task that can slip a day without breaking anything>
- <Task that can slip a day without breaking anything>

## Deferred (NOT tomorrow — explicit list, not silent drop)

- <Task> — <Why deferred — "no calendar room", "waiting on Sam's reply", "needs review meeting first">
- <Task> — <Why deferred>

## Blocked / waiting

- <Task> — Waiting for: <person / event / decision>

## End-of-day verification

By EOD tomorrow, "done" looks like:
1. <Specific shipped artifact — e.g. "PRD v2 sent to <stakeholder>">
2. <Specific decision — e.g. "Closed vendor comparison with a pick">
3. <Specific outcome — e.g. "Inbox at zero for P1 customer threads">

## Notes for tomorrow-me

- <Anything that won't be obvious cold — e.g. "Slack thread re: Project X has context — read before standup">
- <Energy note — e.g. "Long week; protect lunch for a real break">
- <Standing reminder — e.g. "Submit timesheet by 5pm Friday">
```

## Rules

- **Capacity-honest.** A 4-hour-available day gets ~4 hours of work scheduled, not 8.
- **Defer explicitly, don't silently drop.** Tasks not on tomorrow's list go in the "deferred" section with a reason.
- **The ONE thing is protected.** Morning slot, no meetings, no email triage first.
- **Group by energy.** Don't mix deep and shallow in the same block.
- **End-of-day verification is concrete.** "Make progress on X" is not done; "X v2 sent to Y" is.

## Pitfalls

- Padding the list to look "ambitious" — guarantees the user ends tomorrow demoralised.
- Ignoring meeting prep — 30 minutes of prep before a critical meeting is the meeting's success / failure.
- Mixing deep work into the afternoon shallow block — both suffer.
- Forgetting waiting-on items — those go on the radar so they don't get lost.
- Missing the EOD verification — without it, "done" is vague and tomorrow's recap is fuzzy.
