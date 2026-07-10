---
name: debugging-help
description: How to help someone diagnose an error or unexpected behavior — find the root cause, not a workaround; verify before recommending.
applies_to: [code, review]
---

# Skill: Debugging help

## Goal

Identify the **root cause** of the customer's bug or unexpected behavior. A working fix that doesn't explain *why* the bug existed is a workaround, not a fix — and workarounds resurface later as worse bugs.

## Process

1. **Read the error verbatim first.** Don't paraphrase the message in your head. The literal text + stack trace are the most information you'll get.
2. **Reproduce or simulate before guessing.** If you can run the code, run it. If the customer can, ask them for the exact command + observed output. "I bet it's X" without verification is the slowest path.
3. **Isolate the smallest failing case.** A 200-line repro hides the bug. Strip it down until removing one more line makes it pass. The thing you can't remove is the bug.
4. **Look at the change boundary.** Most bugs were introduced by a recent change. `git log -p` on the affected file, or `git bisect` if the regression has multiple suspect commits.
5. **Read the failing function AND its callers.** Bugs often live where the function meets the rest of the system: bad inputs, wrong contracts, race conditions.
6. **Form a hypothesis. Test it.** Don't apply a fix until the hypothesis predicts the observed behavior end-to-end. If the test confirms the hypothesis, the fix is straightforward.
7. **Fix the cause, not the symptom.** If a null check would suppress the error, ask why the value is null in the first place.

## What to ask the customer

When the context is thin, ask before guessing:
- **Exact error text** (full stack trace if available)
- **Reproduction command** — what they ran
- **Expected vs actual behavior**
- **Last known good state** — was this working before? what changed?
- **Environment** — versions, OS, configuration if relevant

Skip these only when the error message + code already make the cause obvious.

## Output shape

```
**What's happening:** <one-sentence diagnosis>

**Why it's happening:** <2-4 sentences. The actual mechanism — which variable holds what, which call returns what, where the contract breaks.>

**Evidence:** <line numbers, log lines, or a minimal repro. Show why you believe the diagnosis.>

**Fix:**
```code
<the fix — minimal, applied at the root cause>
```

**Verification:** <how to confirm the fix works. Commands, test cases, expected output.>

**Related risks:** <other places the same bug pattern might exist — optional but valuable.>
```

## Rules

- **No "should be fine" claims without running it.** If you didn't verify, say so explicitly: "I haven't run this, but the diagnosis predicts <X> — please confirm by <command>."
- **Quote the error.** Don't say "the parse error" — name it: "the `Unexpected token <` at line 42".
- **Show the cause, not the absence of the symptom.** "Adding `?` makes it work" is not an explanation. "The value is undefined when X — adding `?` hides that" is.
- **Workarounds vs fixes.** If a workaround is the right answer (rare third-party bug, deadline), say so — and file a follow-up to revisit.

## Common bug families to consider

- **Null/undefined contracts:** a function returning `undefined` instead of throwing, callers not handling it
- **Async ordering:** `await` missing, race conditions, promise chains that swallow errors
- **Off-by-one:** loop bounds, slice indices, half-open vs inclusive ranges
- **Encoding / serialization:** wrong charset, JSON.parse on non-JSON, missing `JSON.stringify` before send
- **Identity vs equality:** `==` vs `===`, object identity in a `Map` key, comparison of dates as objects
- **State leakage:** module-level singletons in tests, cached results across requests
- **Permission / sandbox:** the code is right, the environment refuses it

## Pitfalls

- "Try clearing the cache / restarting / reinstalling" — last resort, not a first answer.
- Fixing the test instead of the code.
- Recommending an unrelated refactor while debugging — separate concerns.
- Guessing the fix without proposing how the customer should verify it.
