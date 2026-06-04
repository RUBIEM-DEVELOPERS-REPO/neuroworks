---
name: eod-handoff
description: End-of-day handoff note — what shipped today, what's still open, what tomorrow needs to pick up. Written so a colleague (or future-you) can pick up the thread cold.
applies_to: [draft-memo, draft-other]
---

# Skill: End-of-day handoff

## Goal

A short note written at the end of a working session so the **next session
(yours or someone else's) can pick up cold**. Captures state that lives only
in the operator's head before it evaporates.

## Format

```
# <Operator> — EOD <Day, YYYY-MM-DD>

## Shipped today
- <Concrete, verifiable — PR merged, doc sent, deal closed>
- <...>

## Open with state
- **<Thread / project>** — where it sits right now, the next concrete step, who's waiting on what
- <...>

## Tomorrow's first move
- <The single first thing to do tomorrow morning — the cold-start instruction>

## Notes for whoever picks this up
- <Anything that's in the operator's head but not in the artefacts — a name, a number, a "be careful of X">
- <...>
```

## Rules

- **"Open with state" is the load-bearing section.** A bullet that says only "still working on X" is useless. Each item needs: *where it sits*, *next concrete step*, *who's waiting*. Three pieces or drop the bullet.
- **"Tomorrow's first move" is one thing.** Not three. The operator (or successor) should be able to open this note tomorrow and start typing with no further thought.
- **"Notes for whoever picks this up" is the head-state dump.** Stuff that's obvious to the operator today but won't be obvious in a week — names, prior decisions, why something was done that way. This section is why the handoff exists.
- **Shipped means shipped.** Same rule as status updates — merged, sent, signed. Move "almost" items to "Open with state".

## Length

100-300 words. A handoff longer than a status update is hiding indecision.

## Tone

Declarative, near-stenographic. No reflection, no narrative. The reader is a
cold pickup — they need facts, not feelings.

## Pitfalls

- "Continued working on X" → useless without state. Either name the state or drop the line.
- Skipping "Notes for whoever picks this up" → the whole point of the handoff was this section.
- "Tomorrow: keep going" → not a first move. Name the concrete first 15 minutes.
- Listing everything you touched today → bury the signal. Only what *shipped* and what's *open*.
