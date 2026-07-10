---
name: user-stories
description: Write user stories with INVEST-quality acceptance criteria (Given/When/Then), edge cases, and a definition of done.
applies_to: [draft-doc, draft-other, user-stories]
---

# Skill: User stories + acceptance criteria

## Goal

A developer can pick up the story and build it without a meeting, and QA can verify it without asking what "done" means. Each story is small, valuable, and testable.

## Format

```
## Story: <short title>
**As a** <role> **I want** <capability> **so that** <benefit>.

### Acceptance criteria
- **Given** <context> **when** <action> **then** <observable outcome>.
- **Given** … **when** … **then** …

### Edge cases / negative paths
- <empty input, max length, unauthorized, duplicate, offline, concurrent edit>

### Out of scope
- <what this story explicitly does NOT cover>

### Definition of done
- code + tests merged · AC verified · docs/telemetry updated · no new lint/sec findings
```

## Rules

- **INVEST:** Independent, Negotiable, Valuable, Estimable, Small, Testable. If a story can't ship a slice of value alone, split it.
- **AC are testable assertions**, not restated story text. Given/When/Then forces an observable outcome.
- **Always include negative paths.** Happy-path-only stories ship bugs.
- **Vertical slices, not layers.** "User can reset password" beats "build the password API".
- **One benefit per story.** If there are two "so that"s, there are two stories.

## Splitting heuristics

- By workflow step, by data variation, by rules vs happy path, by interface (API then UI), by CRUD operation.

## Pitfalls

- AC that just repeat the story sentence — verifies nothing.
- Giant stories ("As a user I want the whole dashboard") — unestimatable.
- Mixing solution detail into the story — say the need, let the team design.
- No definition of done — "done" drifts per developer.
