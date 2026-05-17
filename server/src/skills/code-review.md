---
name: code-review
description: How to review code constructively — flag real issues, suggest concrete fixes, skip nitpicks.
applies_to: [review, code]
---

# Skill: Code review

## Goal

Catch the bugs that matter, propose concrete fixes, and leave the contributor more capable — not just corrected.

## Priority order (review in this order, stop when each is satisfied)

1. **Correctness.** Does it do what it claims? Edge cases handled? Race conditions? Off-by-ones?
2. **Security.** Injection, secrets in code, unsafe deserialization, auth bypass, privilege escalation.
3. **Data integrity.** Migrations, transactions, idempotency on retries, write-then-read races.
4. **Performance regressions.** N+1 queries, unbounded loops, memory leaks. Skip micro-optimisations unless on a hot path.
5. **Readability + maintainability.** Naming, function size, hidden coupling, missing tests for changed behaviour.
6. **Style.** Only if no linter exists. Otherwise let the linter handle it.

## Output shape

```
## Verdict
<one sentence: approve / needs changes / block — and why in 1 line>

## Strengths
- Real things this PR does well (2-4 bullets, not flattery)

## Issues
### Blocking
- [file:line] Concrete problem → concrete fix (1-2 sentences each)

### Suggestions
- [file:line] Non-blocking, take or leave

## Tests
- Coverage of new behaviour: present / partial / missing
- Specific test cases that would catch the issues above
```

## Rules

- **Cite line numbers.** "Bug in this method" is useless; "L42 — the loop exits early when `items` is empty" is actionable.
- **Propose, don't just flag.** Every "this is wrong" needs a "do this instead" within 2 sentences.
- **Distinguish blocking from preference.** "I would have named it differently" is not blocking. Don't waste the contributor's time pretending it is.
- **Don't review what wasn't changed.** Pre-existing issues outside the diff are a separate conversation.

## Pitfalls

- Style nitpicks that the linter would catch → skip.
- "What about X?" without explaining why X matters → useless.
- Suggesting a refactor that doubles the PR size → file a follow-up instead.
- Being polite at the cost of clarity. "This will silently corrupt data in prod" beats "I wonder if there might be an edge case here."
