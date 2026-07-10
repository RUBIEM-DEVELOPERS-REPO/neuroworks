---
name: commit-message-writing
description: How to write a commit message that reads well in git log AND tells future-you why the change exists.
applies_to: [code]
---

# Skill: Commit message writing

## Goal

A commit message is the breadcrumb a future developer follows when `git blame` lands on this line. Make it useful at that moment.

## Format

```
<type>: <imperative subject — under 70 chars>

<Optional body. Wrap at 72 chars. Explain WHY, not WHAT.
The diff already shows what. The body explains the motivation,
the trade-off, and the context the diff can't carry.>

<Optional footer: refs / breaking / co-author>
```

### Type prefixes (Conventional Commits, widely supported)

| Prefix | When |
|---|---|
| `feat:` | New user-visible capability |
| `fix:` | Bug fix |
| `refactor:` | Code change with no behavior change |
| `perf:` | Performance improvement |
| `docs:` | Documentation only |
| `test:` | Tests only |
| `build:` | Build system, deps, tooling |
| `ci:` | CI configuration |
| `chore:` | Routine maintenance (version bumps, file moves) |

A trailing `!` flags a breaking change: `feat!: switch auth to JWT`.

## Subject line rules

- **Imperative mood.** "Add X" / "Fix Y" — reads like the project commands itself. Not "Added X" or "Adding X".
- **No trailing period.** It's a subject, not a sentence.
- **Specific verb + concrete object.** "Fix typo in README" beats "Update docs".
- **Under 70 chars.** Git tooling truncates longer.

## Body rules (when to include)

Include a body when:
- The WHY isn't obvious from the diff
- The change has a non-obvious trade-off
- The fix references an external issue, ticket, or incident
- A future bisect will land here and need to know what was attempted

Skip the body when:
- Trivial change (typo, version bump, dependency upgrade)
- The subject already says enough

## Examples

Good:
```
fix: handle empty headers in receipt parser

Receipts from vendor X arrive with no Content-Type header. The
parser was treating absence as "binary" and refusing to read them.
This change defaults to text/plain when the header is absent.

Fixes #482.
```

Less good (vague subject, no body):
```
fixed bug
```

Good (trivial change, no body needed):
```
docs: fix broken link in CONTRIBUTING.md
```

## Rules

- **One logical change per commit.** A commit that does "fix X and refactor Y" can't be reverted cleanly.
- **No "WIP" / "save progress" in the main branch.** Squash before merge or amend during review.
- **Don't reference commit hashes that haven't merged yet.** They'll change on rebase.
- **Co-author trailers for pairs/agents:** add `Co-Authored-By: <name> <email>` lines at the end.

## Pitfalls

- "Misc fixes" / "various improvements" → the worst possible bisect target.
- Subject longer than 70 chars truncates in `git log --oneline` and GitHub UI.
- Past-tense subjects ("Added X") fight with the rest of the project's history.
- Long body with no real WHY — if you can't articulate the motivation, the commit might be doing the wrong thing.
