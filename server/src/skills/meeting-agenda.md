---
name: meeting-agenda
description: How to write a meeting agenda that earns its 30 minutes — clear desired outcome, time-boxed items, named owners, pre-reads.
applies_to: [plan, draft-other]
---

# Skill: Meeting agenda

## Goal

A meeting with no agenda is a meeting that produces no decisions. A good agenda tells everyone, before the meeting: *what we're deciding, what they need to read, and what their role is.*

## Format

```
# <Meeting title> — <YYYY-MM-DD, HH:MM-HH:MM TZ>

**Owner:** <name> · **Required:** <attendees> · **Optional:** <attendees>

## Desired outcome
<One sentence. "By the end of this meeting we will have <decided / aligned on / produced> X." If you can't articulate this, the meeting probably shouldn't happen.>

## Pre-read
- [<title>](<link>) — <est. read time, e.g. "5 min">
- <Optional but recommended: any data dashboard people should glance at>

## Agenda
| Time | Item | Owner | Type |
|---|---|---|---|
| 0-5 | Context recap | <name> | Inform |
| 5-15 | <Specific decision needed> | <name> | Decide |
| 15-25 | <Specific item> | <name> | Discuss |
| 25-30 | Action items + owners | <owner> | Wrap |

## Decision(s) needed
1. <The literal question that needs an answer by end of meeting.>
2. <If a second decision is on the table, name it; if not, this section is one line.>

## Out of scope
- <Thing we will NOT debate today — link to where it lives>

## After the meeting
- Notes / decisions will be posted to: <link>
- Next meeting: <date or "TBD pending outcome">
```

## Item types

- **Inform** — share context. Nobody needs to act. Cap at 5 minutes; longer probably belongs in a doc.
- **Discuss** — surface views, surface disagreement. Doesn't have to conclude with a decision, but should conclude with a "we'll either decide by <date> or here's the framing for next time".
- **Decide** — produce a concrete decision. Has an owner. Has a default if the room can't agree (status quo, escalation, deadline).
- **Brainstorm** — generate options. Rare in operational meetings; common in planning. Don't combine with "decide" in the same item.

## Rules

- **Desired outcome is non-optional.** If the agenda has no outcome, the meeting is a status update — make it async.
- **Items are time-boxed.** Even loosely (5/10/15/30 min). Untimed agendas drift.
- **One decision per item.** Two decisions in 10 minutes = neither gets made.
- **Required vs optional matters.** "Optional" people are not on the hook for the decision — clarifying that prevents post-meeting "I wasn't asked".
- **Pre-reads have read times.** "Read this 30-page doc" without an estimate ensures nobody reads it.
- **Out-of-scope section.** Heads off the most common derailment.

## When to NOT have the meeting

A meeting agenda forces this question. You probably don't need a meeting if:
- The desired outcome is "share status" — write a doc.
- All required attendees have already aligned in chat / docs.
- The decision-maker can decide alone after reading the pre-read.
- It's recurring with no specific agenda this week — cancel this instance.

## Output shape for a recurring meeting (e.g. weekly leadership)

Keep a living template; fill in fresh decisions / discussion items per week:

```
## Recurring sections
- (5) Round-the-table: blockers + asks
- (15) Topic for this week: <decided Monday>
- (5) Action item review from last week

## Topic queue (for upcoming weeks)
- <Topic — proposed by — when>
- <Topic — proposed by — when>
```

## Pitfalls

- "FYI / Sync up / Touch base" titles — they signal no agenda existed.
- 60-minute meetings with no time-boxed items — drift to 60 minutes regardless of content.
- Required attendee list of 12 people — the more required attendees, the less the meeting decides.
- Pre-read posted 30 minutes before — nobody reads it. Post 24-48 hours ahead.
- No "action items + owners" wrap-up slot — decisions evaporate.
