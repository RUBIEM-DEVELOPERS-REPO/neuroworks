---
name: ux-critique
description: How to critique a UX flow against the user's job-to-be-done, name accessibility issues, and propose concrete fixes (not personal taste).
applies_to: [review, draft-other]
---

# Skill: UX critique

## Goal

A critique another designer / PM / engineer can act on. Anchored to user behaviour, not personal taste. Calls out specific friction points with specific fixes.

## Structure

```
## Critique — <Surface / flow being reviewed>

### User goal
<One sentence: what is the user trying to accomplish? Use their words, not the team's.>

### What works
- <Specific element + why it serves the user goal>
- <…>

### Friction points
For each:
- **Where:** the screen / step / interaction
- **Friction:** what makes it harder than it needs to be (cognitive load, hidden state, ambiguous CTA, wait state, etc.)
- **Why this matters:** anchored to the user goal
- **Recommendation:** specific fix, not "consider improving"

### Accessibility flags
- <Specific WCAG-grade issue: contrast, focus order, keyboard nav, screen-reader label, motion>
- <…>
(If a11y was already addressed, say so explicitly — don't omit the section.)

### Unhappy paths
- <Path the design doesn't explicitly handle: error state, empty state, partial data, slow load, offline, permission denied>
- <…>

### Rationale summary
<One paragraph: WHY these recommendations, anchored to the user goal. A critique without rationale survives no review meeting.>
```

## Rules

- **Anchor every critique to the user goal.** If you can't tie it to what the user is trying to do, it's taste — leave it out or label it "personal taste".
- **Name the screen and the step.** "The CTA is confusing" is useless; "Step 3, the 'Connect Source' screen — the primary button reads 'Continue' but invites the user to skip" is actionable.
- **Friction has a category.** Cognitive load / hidden state / ambiguous affordance / wait state / decision overload / required field that should be optional. Categorising sharpens the fix.
- **Recommendation is specific.** "Use 'Skip for now' as the secondary action" beats "make the secondary action clearer".
- **Accessibility is a baseline, not a section to skip.** Even if the design is mostly accessible, flag what's still weak (focus order on modal close, screen reader labels for icon buttons, motion-safe alternatives).
- **Unhappy paths get explicit handling.** Empty states, error states, slow loads, permission denied — design must answer these, or the critique should name them.

## Rules: what NOT to do

- **No "I'd prefer".** Subjective taste poisons critique. Anchor to the user goal.
- **No "make it more intuitive".** Vague. Replace with a specific friction + fix.
- **No "consider exploring".** Hedging that makes the critique uncritiqueable.
- **Don't critique what isn't in scope.** A modal review isn't the place to redesign the nav.

## Pitfalls

- **Personal taste dressed up as user-centred.** "Users will be confused by this colour" — without evidence, it's taste.
- **Skipping the "what works" section.** Critique that's all negative gets dismissed. Lead with what's good — it earns the right to flag what's not.
- **A11y as afterthought.** Adding "and check a11y" at the end signals it wasn't really considered.
- **No prioritisation.** A list of 15 frictions without weighting is paralysing. Mark the top 3 if there are many.
- **Forgetting unhappy paths.** Designs that only handle the happy path break in production for real users.
