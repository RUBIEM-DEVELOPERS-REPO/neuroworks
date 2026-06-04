---
name: action-item-extraction
description: Turn raw meeting notes (or a transcript) into a clean list of action items — each with an owner, a due date, and a one-line "what done looks like".
applies_to: [summarize, draft-other]
---

# Skill: Action-item extraction

## Goal

The meeting ends. Within 30 minutes, attendees have a clear list of
what they personally agreed to. No "I thought you were doing that" two
weeks later.

## Process

1. **Scan the notes for COMMITMENT verbs.** "I'll send", "we'll book",
   "let me check", "we need to decide". These are the load-bearing
   signals.
2. **For each commitment, extract:**
   - **Owner** — exactly one name. "Team" is not an owner.
   - **Action** — one verb, one outcome. "Send the spec by Friday".
   - **Due** — a date, even if approximate ("end of week"). No date =
     it won't happen.
   - **What done looks like** — one line. "Spec posted in #product-eng
     with approvals from X + Y".
3. **Separate DECISIONS from ACTIONS.** Decisions get logged
   separately — they don't need an owner-with-deadline shape.
4. **Surface anything that was DISCUSSED but not OWNED.** The most
   common failure mode of a meeting is leaving things in this state.
5. **Flag IMPLICIT commitments.** If someone said "I should probably
   talk to Sarah", surface that as an action even if it wasn't
   explicitly committed — let the operator confirm.

## Output shape

```
# Action items — <Meeting title> · <YYYY-MM-DD>

## Decisions made
1. <Decision in one sentence — what's now true going forward>
2. <…>

## Action items

| # | Owner | Action | Due | Done = |
|---|---|---|---|---|
| 1 | <Name> | <Verb + outcome> | <Date> | <One line> |
| 2 | <…> | <…> | <…> | <…> |

## Discussed, not owned (needs follow-up)
- <Topic that came up without a clear next step>
- <…>

## Implicit / weak commitments (please confirm)
- **<Name>** seemed to agree to <X> — confirm in writing
- <…>
```

## Rules

- **One name per owner.** "Sarah + Tom" gets split into two items, or
  one of them is the single accountable owner.
- **No actions without a date.** Even rough ("end of week", "next sprint")
  beats nothing.
- **The action verb matters.** "Look into" produces nothing; "Send the
  proposal" produces a thing.
- **Cite the source line.** "@10:32 — `Sarah: I'll grab that`" so the
  owner can verify later.

## Pitfalls

- Turning every "good idea, we should…" into an action. Filter for
  COMMITMENT, not enthusiasm.
- Forgetting decisions. Decisions are as valuable as actions and easier
  to lose track of.
- Leaving the action verb vague. "Discuss with X" is not an action;
  "Get X's sign-off by Friday" is.
- Action items with no "done = " — invites different interpretations.
