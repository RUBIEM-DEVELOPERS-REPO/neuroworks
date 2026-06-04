---
name: project-status-rollup
description: Roll up multiple project streams into one report — what shipped, what's on-track, what's slipping, what needs leader attention.
applies_to: [draft-memo, summarize]
---

# Skill: Project status rollup

## Goal

A leader reads the rollup once a week and knows the SHAPE of all
ongoing projects without having to attend every standup. Streams
on-track get a one-line confirmation; streams slipping get the WHY and
the ASK.

## Process

1. **Identify the streams.** Each stream = a named project or workstream
   with an owner.
2. **For each stream, classify status:**
   - **🟢 On-track** — milestones met, no scope changes, owner confident
   - **🟡 At-risk** — minor slippage OR scope creep OR resource concern,
     owner has a plan
   - **🔴 Off-track** — material slippage OR blocked OR scope renegotiation
     needed, owner needs help
3. **Pull what SHIPPED this week** per stream — outcomes, not activities.
4. **Pull what's planned next week** per stream.
5. **For 🟡 and 🔴 streams, name the ASK.** What does the owner need
   from leadership?
6. **End with a cross-cutting view.** Are multiple streams blocked on the
   same upstream? Is hiring slow across the board? Surface patterns.

## Output shape

```
# Status rollup — week of <YYYY-MM-DD>

## Bottom line
<One paragraph — what's the shape this week? Anything material?>

## Streams

### 🟢 On-track ( <N> )
- **<Stream>** (<owner>) — <one-line on what shipped + next milestone>
- <…>

### 🟡 At-risk ( <N> )

#### <Stream> — <owner>
- **Why amber:** <specific cause>
- **Plan:** <what the owner is doing>
- **Ask of leadership:** <specific, time-bound>

#### <…>

### 🔴 Off-track ( <N> )

#### <Stream> — <owner>
- **What's blocking:** <specific>
- **Slip impact:** <on date, scope, budget>
- **Recommended action:** <specific, with owner>
- **Decision needed by:** <date>

## Cross-cutting

- <Pattern across streams, e.g. "3 streams blocked on platform team —
  need to discuss prioritisation">
- <…>

## What changed since last week
- ↑ <Stream X> moved from amber to green (<why>)
- ↓ <Stream Y> moved from green to amber (<why>)
- + <Stream Z> kicked off this week
```

## Rules

- **Status is owned by the owner, not by you.** Cite their report.
- **Green is one line.** Don't pad green streams to look balanced.
- **Amber and red MUST have an ask.** Otherwise leaders read but can't
  help.
- **Surface CHANGES.** "What changed since last week" is the most-read
  section.

## Pitfalls

- All green. No real portfolio is all green. If everything's green,
  ambition is too low or honesty is too low.
- Vague asks ("more support please"). Name the specific thing.
- Missing cross-cutting. Three streams blocked on the same thing IS
  the meeting topic; don't bury it.
- Reading like the project plan. Rollups are about deltas and asks,
  not full plan rehash.
