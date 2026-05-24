---
name: meeting-actions
description: Turn a meeting transcript into a clean action-item table — owner, task, deadline, priority — nothing else.
applies_to: [draft-other, summarize, plan]
---

# Skill: Meeting → action items

## Goal

The reader scans ONE table, knows what they own, what's due when, and what got punted. Zero prose summary.

## Process

1. **Identify decisions vs discussions.** Only DECISIONS produce action items. "We talked about X" is not an action; "Sam will draft the X spec by Friday" is.
2. **Pull owner explicitly.** If the transcript says "we'll handle that" — flag it as `owner: <unassigned>` and surface it at the bottom under "**Needs owner.**" Never silently leave it blank.
3. **Date in absolute form.** "Next Wednesday" → "2026-MM-DD". "By end of week" → next Friday's date. No relative dates in the output.
4. **Priority comes from urgency markers in the transcript** — "blocker", "before launch", "critical" → P0. Default unmarked → P2.
5. **One action per row.** Multi-part actions split into separate rows.

## Output shape

```
## Action items — <meeting name> · <YYYY-MM-DD>

| # | Owner | Action | Deadline | Priority |
|---|---|---|---|---|
| 1 | Sam | Draft auth-rewrite spec | 2026-05-30 | P1 |
| 2 | Priya | Review pricing model with finance | 2026-06-03 | P2 |
| 3 | <unassigned> | Schedule legal review for MFN clause | 2026-06-07 | P1 |

## Needs owner
- Row 3 — schedule legal review (raised but no one volunteered)

## Decisions (no action attached)
- Agreed to delay v2 launch by one week — Priya to communicate

## Parked / next-meeting
- Q4 planning cadence — needs more data
```

## Rules

- **Table-first.** If you can't fit it in the table, it's not an action.
- **Owners are people, not teams.** "Engineering" is not an owner; "Sam (eng lead)" is.
- **No "TBD" deadlines.** If the transcript didn't set one, write `Needs date` and flag in the bottom block.
- **Don't paraphrase the decision into an action.** "Decided to ship v2" is a decision; the action is "Sam confirms ship date Friday".
- **Max 12 actions.** More than that means the meeting had no priorities — name that as a feedback item.

## Pitfalls

- Capturing every "we should" as an action → reader stops trusting the list. Only firm commitments.
- Translating jokes into actions ("Bob volunteered to bring donuts" stays out).
- Missing the side conversation in the transcript chat — scan for `[chat]` markers.
- Forgetting the meeting date in the title — actions without context rot.
