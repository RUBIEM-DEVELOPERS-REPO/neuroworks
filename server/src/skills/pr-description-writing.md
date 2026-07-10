---
name: pr-description-writing
description: How to write a pull request description that reviewers can approve quickly — explain the WHY, summarise the WHAT, give them a test plan.
applies_to: [code, review, draft-other]
---

# Skill: PR description writing

## Goal

A reviewer who has never seen this branch should understand, in 60 seconds: *why this change exists, what it does, and how to verify it didn't break anything*. The PR description sells the change to its first reader; if it doesn't, the PR sits.

## Format

```
## Summary
<1-3 sentences. The point of the change. Lead with the WHY (the user-visible problem, the bug, the architecture pressure), then the WHAT in plain English.>

## What changed
- <Each notable change in one line. Reference files or modules but not line numbers (they shift).>
- <If there's a structural change, name it: "Extracted the parser into its own module."

## Why this approach
<Optional but valuable for non-trivial changes. 2-4 sentences on the trade-off you picked vs alternatives. Future reviewers and your future self will thank you.>

## How to verify
- [ ] <Specific test scenario reviewer can run>
- [ ] <Edge case worth poking>
- [ ] <Behavior that should NOT have changed — regression check>

## Screenshots / output
<For UI: before/after screenshots. For CLI: paste of relevant output. For data changes: a diff or a sample row.>

## Notes for reviewers
<Optional. Anything you want a sharp eye on. "I'm not sure about the rate-limit constant — happy to change." Better than getting nits in PR comments.>

## Related
- Issue: <link>
- Earlier PR / doc: <link>
```

## Rules

- **Title is a sentence, not a category.** "Fix timezone bug in receipt rendering" beats "Bug fix".
- **Imperative mood in the title.** "Add X" / "Fix Y" / "Refactor Z" — matches commit messages and merge-button defaults.
- **WHY before WHAT.** A reviewer who knows why a change exists can spot mistakes faster than one who only knows what changed.
- **Test plan is not optional.** Even one checked box ("Verified locally on dev environment, x.com renders correctly") moves a PR forward.
- **No vague hedges.** "Should fix the bug" → "Fixes the bug; reproduce via X, observe Y becomes Z".
- **Link the issue.** A PR without an issue link is a lone artifact; with one, it's a story.

## Length

Trivial change (typo, dependency bump): 1-3 lines is fine. Don't pad.
Standard feature / bugfix: 100-300 words.
Architectural change: include a brief design rationale or link to a design doc.

## Pitfalls

- "Refactored the code" with no description of what or why → reviewer has to read the diff cold.
- A test plan with one item ("ran the test suite") — that's CI's job. Name what's specifically worth checking.
- Burying breaking changes in the middle of a list — call them out in the summary with a 🚨 or `BREAKING:` prefix.
- "WIP" PRs with no description — at minimum say what you're trying to do so people don't review the wrong shape.
