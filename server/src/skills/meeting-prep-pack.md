---
name: meeting-prep-pack
description: Assemble everything the operator needs before a meeting — attendees + their context, prior interactions, the goal, the open questions, what success looks like.
applies_to: [draft-memo, summarize, direct-answer]
---

# Skill: Meeting prep pack

## Goal

The operator opens the prep pack 5 minutes before the meeting and is
fully oriented: who's in the room, what they want, what we've already
agreed, what's on the table now. The meeting starts at minute zero — no
"so to catch everyone up…" preamble.

## Process

1. **Pull the meeting metadata** (title, attendees, agenda if any) from
   the calendar entry.
2. **For each external attendee**, surface:
   - Role + company
   - Prior interactions with us (CRM hit or vault hit)
   - Anything unusual you noticed (recent press, role change, mutual
     contact, prior topic of interest)
3. **For each internal attendee**, surface what they're responsible for
   relative to the topic. Avoids the "wait, who owns X again?" moment.
4. **State the goal of the meeting in one sentence.** If you can't, the
   meeting is poorly scoped — flag it.
5. **List open questions / decisions on the table.** What does the
   operator NEED to come out with?
6. **Surface anything that should be settled BEFORE the meeting.**
   Pre-reads needed, approvals to chase, missing data.

## Output shape

```
# Prep — <Meeting title> · <YYYY-MM-DD HH:MM>

## Goal (one sentence)
> <What the operator wants out of this meeting>

## Room

### Their side
- **<Name>** — <Role>, <Company>
  - Prior context: <one-line on past interactions or vault references>
  - Watch for: <one-line on style, hot button, or recent change>
- **<Name>** — <…>

### Our side
- **<Name>** — owns <area>
- **<Name>** — <…>

## What we've already agreed
- <Bulleted prior commitments / decisions from previous meetings>
- Source: `<vault path>` / CRM record `<id>`

## What's open / what we need to decide today
1. <Concrete decision or question>
2. <…>

## Pre-meeting checks
- [ ] <Send the X deck by <time>>
- [ ] <Confirm Y with finance>
- [ ] <Check Z is in the room — escalation contact>

## After-meeting follow-ups (draft now, polish later)
- <One-line on what we'll commit to send>
```

## Rules

- **Cite paths and CRM IDs.** A prep pack with no sources is hard to
  trust under time pressure.
- **One-sentence goal.** If the goal needs two sentences, it's two
  meetings or it's unfocused — say so.
- **Watch-for lines are useful even when vague.** "Direct, doesn't like
  slides" beats no information.
- **Don't restate the agenda.** Calendar already has that. Add value.

## Pitfalls

- Reading like a Wikipedia page about each attendee. Operator wants
  context for THIS meeting, not a CV.
- Forgetting to say what success looks like. The whole pack is in
  service of one outcome — name it.
- Padding "What we've already agreed" with everything from the last
  year. 3-5 lines max — the ones still load-bearing.
