---
name: testing-strategy
description: How to decide what to test, at which layer, with what trade-offs. Not how to write tests — how to plan a testing approach for a system or feature.
applies_to: [code, plan]
---

# Skill: Testing strategy

## Goal

A pragmatic testing plan: which tests matter, where they live, and what they don't cover. Avoid the two failure modes — too few tests (breakage in production) and too many tests of the wrong shape (slow CI, brittle, low signal).

## The pyramid (and when to break it)

```
            ┌─────────────┐
            │   E2E /     │   few
            │   user-     │
            │ flow tests  │
            ├─────────────┤
            │ Integration │   some
            │   tests     │
            ├─────────────┤
            │  Unit tests │   many
            └─────────────┘
```

The pyramid is a default, not a rule. **Test at the layer where the bugs actually happen.**

- For a stateless library: heavy unit, light integration.
- For a CRUD app: thin unit, heavy integration (against a real DB).
- For a CLI: heavy "scripted end-to-end" (run the binary, assert output).
- For a UI: a handful of E2E happy-path + visual regression beats 50 unit tests of components in isolation.

## Decide per layer

### Unit tests
- **What they're for:** algorithms, parsers, formatters, business logic with clear inputs and outputs.
- **What they're NOT for:** asserting that a function calls another function (mocking everything = testing the mocks).
- **Coverage target:** No fixed number. Cover **branches that matter**: edge cases, boundary conditions, error paths.

### Integration tests
- **What they're for:** module boundaries, contracts between services, anything involving a real DB or file system.
- **Run against real dependencies when feasible.** Mocked DBs hide schema-migration bugs. Use a test DB instance or container.
- **Slow is OK if they catch real bugs.** Slow AND trivially mockable = unit test instead.

### End-to-end tests
- **What they're for:** critical user journeys (signup, checkout, the 3-5 flows your business cannot lose).
- **Treat as expensive.** 5-15 E2E tests is plenty for most products.
- **Run in CI on every PR for critical flows.** Nightly for the long tail.

## Output shape (a testing plan for a feature)

```
# Testing strategy: <feature / system>

## What we'll cover

### Critical (must work; bug = revert)
- <Scenario> — tested at: <layer> — <test name or location>

### Important (bug = hot-fix within 24h)
- <Scenario> — tested at: <layer>

### Nice-to-have (bug = next sprint)
- <Scenario> — tested at: <layer>

## What we're NOT covering (and why)
- <Scenario — too rare to be worth the maintenance cost>
- <Scenario — relies on third-party we can't reliably test>
- <Browser X — out of scope; we publish a support matrix>

## Test infrastructure
- **Unit:** <framework, where they live, how to run>
- **Integration:** <DB strategy, fixture management, parallel safety>
- **E2E:** <browser/runner, env, frequency, who owns flake triage>

## Performance / load
- <If applicable: SLOs, baseline run, regression detection>

## Open questions
- <Thing we haven't decided>
```

## Rules

- **Test at the boundary you'd debug at.** If a customer reports a bug, where would you check first? Put a test there.
- **A test that's never failed is suspect.** Either it's tautological (testing the framework) or never exercised. Drop it or strengthen the assertion.
- **A flaky test is worse than no test.** Either fix the flake (make the test deterministic) or delete it. Flaky tests train the team to ignore CI.
- **No tests for code that doesn't exist yet.** Don't write tests for hypothetical future features.
- **Each test fails for one reason.** A test that asserts 12 things doesn't tell you what broke.
- **Tests are code too.** Refactor them. Name them so the failure message explains the bug.

## Test naming conventions

Format: `<unit under test>_<scenario>_<expected behavior>`

```
parseHeaders_emptyInput_returnsEmptyObject()
parseHeaders_malformedLine_throws()
parseHeaders_duplicateKey_keepsLast()
```

Or sentence-style for BDD: `"parseHeaders returns an empty object when given an empty string"`. Either works; pick one and apply consistently.

## When to STOP adding tests

- You've covered every critical path
- You've covered the failure modes the customer would notice
- Adding the next test costs more in maintenance than it saves in caught bugs

The marginal value of test #200 is far below the marginal cost.

## Pitfalls

- 100% coverage as a goal — measures the wrong thing. A high-coverage suite of trivial tests catches no real bugs.
- Mocking the database in tests that integrate with the database. The mock can't catch schema-drift, migration, or query-plan bugs.
- Snapshot tests as a substitute for assertions — they pass on garbage and the team updates them mechanically.
- E2E tests that depend on real third-party APIs without a recording / replay layer — guaranteed flake.
- Letting "manual QA" replace tests for repeatable scenarios.
