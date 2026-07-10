---
name: meeting-notes
description: How to structure meeting notes that get read, get acted on, and survive a week.
applies_to: [summarize, draft-memo, draft-other]
---

# Skill: Meeting notes

## Goal

A doc that someone who missed the meeting can read in 60 seconds and know exactly what was decided, who owns what, and when the next checkpoint is.

## Output shape

```
# <Meeting topic> — <YYYY-MM-DD>

**Attendees:** <names>
**Absent:** <names — only if relevant>
**Purpose:** <one line>

## Decisions
- [ ] <Decision, with the reasoning in 1 clause> · _Owner: <name>_
- [ ] <…>

## Action items
- [ ] <Action> — **<owner>** by <date>
- [ ] <Action> — **<owner>** by <date>

## Discussion (optional, only when context will matter later)
- <One bullet per substantive thread — what was discussed, where we landed (or didn't)>

## Open questions
- <Unresolved thing that needs an answer before the next meeting>

## Next checkpoint
<Date + who's driving>
```

## Rules

- **Decisions ≠ discussion.** If it was decided, it goes in Decisions. If it was talked about and parked, it goes in Open questions. If it was kicked to next meeting, it goes in Next checkpoint.
- **Every action has an owner and a date.** No "the team will look into it." That's not an action item.
- **Use checkboxes** so the doc is also a tracker for the follow-up meeting.
- **Skip the discussion section by default.** Add it only when context will be lost without it.
- **Names first letter capital, dates absolute.** "by Mon" rots. "by 2026-05-24" doesn't.

## Pitfalls

- Transcribing the conversation → write notes, not a transcript.
- Listing topics without conclusions → every bullet ends in a decision OR is parked in Open questions.
- Vague owners ("the team", "we") → name a person.
- Missing the next checkpoint → meetings without a follow-up cadence die.
