---
name: email-writing
description: Professional email format, tone, and structure. Use for any draft-email intent.
applies_to: [draft-email]
---

# Skill: Email writing

## Goal

An email that lets the recipient act or understand without a follow-up — scannable, but with enough SUBSTANCE to actually be useful. Concise ≠ empty: brevity is about cutting filler, never about cutting information.

## Format

```
Subject: <8 words or fewer, action-oriented>

Hi <name>,

<1-2 sentence opening — state the purpose in the first line. No "I hope this finds you well" unless culturally required>.

<Body: 2-4 short paragraphs OR 3-5 bullets. Lead with the most important thing. Each paragraph one idea.>

<Action line: "Could you confirm X by Friday?" — make the ask explicit and time-boxed>

<Sign-off>,
<Your first name>
```

## Tone register

| Recipient | Tone | Example opener |
|---|---|---|
| Executive / external client | Formal | "Sharing the Q4 update — bottom line: we'll ship on time." |
| Internal peer | Collegial | "Quick one — we're slipping the Q4 launch by a week." |
| Direct report | Direct + warm | "Heads up: Q4 launch moves to Nov 22." |

## Substance — every line must carry information

The fastest way to waste a recipient's time is a status with no content. **"Task A – Completed" tells them nothing.** Each point must answer "so what?" — the outcome, the number, the artifact, the blocker, or the next step.

| Underwhelming (don't) | Useful (do) |
|---|---|
| Task A – Completed. | Migrated the 12k customer records to the new schema; spot-checked 50, all clean. Link: <…> |
| Task B – In progress. | Drafted 4 of 6 onboarding emails; the last two need the legal disclaimer — expect to finish by 4pm. |
| Task C – Completed. | Fixed the login redirect bug (dropped session token on Safari); deployed to prod, verified with a test account. |

Rule of thumb: if the recipient could have predicted the sentence without reading it, it adds no value — add the specific detail that they could NOT have guessed.

### Status / report email — required shape

```
Hi <name>,

<One-line summary: the headline — what got done and the one thing that matters.>

**Completed**
- <Item> — <what it achieved / the result + a link or number where relevant>.

**In progress**
- <Item> — <how far along, what's left, expected finish>.

**Blocked / needs you**
- <Item> — <the blocker + the specific decision or input you need, by when>.

<Next step or what happens tomorrow.>

Best regards,
<Name>
```

If a section is empty, omit it — don't pad. But never reduce a real item to a bare label.

## Recipients (resolve real addresses)

- **Never invent an address.** If the user named the recipient by NAME or ROLE ("email Godswill", "send it to the project lead") and did NOT give a literal address, resolve their real email from the org directory FIRST — call `users.lookup` (one person) or `users.list` (browse), then send to what comes back.
- **No placeholders, ever.** `name@example.com`, `[project lead email]`, `recipient@email.com` and the like are NOT addresses — `email.send` will reject them. Only use a literal address when the user explicitly provided one.
- **Can't resolve it?** If the directory has no match, say so and ask for the address — don't guess or fall back to an example domain.

## Rules

- **No preamble.** Output the email itself, not "Here's the email I'd send."
- **One ask per email.** If there are three asks, write three emails OR make the asks a numbered list.
- **Subject is the email.** If the recipient only reads the subject, they should still know what changed.
- **Specificity over hedging.** "We'll deliver Nov 22" beats "We're targeting late November."
- **Right-size, don't truncate.** As short as possible, as long as the content needs. A simple note may be three lines; a status report or hand-off carries the specifics (results, numbers, links, blockers, next steps). Never strip an email down to content-free labels to hit a word count. Only when it would genuinely run long (multi-page) does it become a doc with a short email pointing to it.

## Pitfalls

- **Bare-label status emails** ("Task A – Completed. Task B – In progress.") — underwhelming and useless; attach the outcome/number/next step to every item.
- "Just wanted to circle back" → use "Following up on X — any update?"
- Burying the ask in paragraph 4 → put it in the first line.
- Apologising twice → once is enough.
- Closing with "Let me know if you have any questions" — say what specifically you want feedback on.
- Confusing brevity with emptiness — cut filler words, never the substance.
