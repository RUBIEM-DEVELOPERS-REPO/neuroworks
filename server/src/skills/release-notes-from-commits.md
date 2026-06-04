---
name: release-notes-from-commits
description: Turn a range of git commits into customer-facing release notes — grouped by impact (new / improved / fixed / under-the-hood), with the user benefit named per item.
applies_to: [summarize, draft-other]
---

# Skill: Release notes from commits

## Goal

A user opens the release notes and within 30 seconds knows whether the
release matters to them — what's new they can try, what they might have
been waiting for, what's safer / faster / fixed.

## Process

1. **Pull the commit range.** From the prior release tag to HEAD, or
   `--since="<N> days ago"`.
2. **Categorise each commit:**
   - **New** — user-visible new capability
   - **Improved** — better UX of existing feature
   - **Fixed** — bug squashed (mention if it was user-facing or
     internal-only)
   - **Under the hood** — perf, refactors, deps, infrastructure (only
     surface if it changes behaviour, perf, or compatibility)
3. **For each item, name the USER BENEFIT.** "Fixed null deref in X" is
   internal language; "Stops the dashboard from blanking after a long
   idle session" is user language.
4. **Drop the bin.** Internal commits with no user impact don't make
   the notes (revert merges, lint fixes, dep bumps without behaviour
   change, README updates). They DO appear in a "Under the hood" tally
   so the reader sees the change volume.
5. **Lead with the biggest item.** Reader-attention budget is highest
   at the top.

## Output shape

```
# Release notes — v<version> · <YYYY-MM-DD>

## What's new
- **<Feature name>** — <one-line user benefit>. <link to docs if any>
- **<Feature name>** — <…>

## What's improved
- **<Area>** — <what changed and why the user cares>
- <…>

## What's fixed
- **<Area>** — <user-visible symptom that's now gone>
- <…>

## Under the hood
<One paragraph summarising perf wins, infra changes, refactors. Or a
bullet list if there's user-visible perf impact:>
- <X is now N% faster>
- <Y now supports Z>

## Breaking changes — read this if you upgrade
- **<Change>** — what breaks, what to do instead, deadline if any
- <…>

## Known issues
- <Anything user-visible we shipped but didn't fully fix>
- <…>

## Acknowledgements (optional)
- Thanks to <Name>, <Name> for <…>
```

## Rules

- **Lead with USER LANGUAGE.** Internal jargon ("memoized the reducer")
  is meaningless to users. Translate.
- **Bullet 1 in each section is the most important.** Reorder
  accordingly.
- **Breaking changes get their own section.** Burying them invites
  angry users.
- **One sentence per item.** Notes that exceed one sentence per bullet
  don't get read.
- **No commit hashes in the customer-facing notes.** Move them to an
  "Engineering changelog" if you need them.

## Pitfalls

- Dumping every commit. The user doesn't want to see 47 entries; they
  want to see the 8 that matter.
- Hedging ("we believe this should improve…"). Either it does, or
  pull it.
- Treating "improved" as a catch-all when you mean "changed." If the
  change is contentious, call it out separately.
- Forgetting breaking changes because they're "minor." A behaviour
  change is breaking regardless of API stability.
