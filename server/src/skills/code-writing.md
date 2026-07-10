---
name: code-writing
description: How to write code that gets merged — match the codebase, do the minimum, name things well, and ship working output not pseudocode.
applies_to: [code]
---

# Skill: Code writing

## Goal

Working code that fits the existing codebase, solves the actual problem, and a reviewer would approve on the first pass.

## Process

1. **Read before writing.** Open 2-3 nearby files first. Match the project's style (semicolons, naming, error handling, import patterns). The customer's codebase has conventions that override your defaults.
2. **Do the minimum.** A bug fix doesn't need a refactor. A one-shot script doesn't need helpers. Three similar lines beat a premature abstraction. Don't add features the customer didn't ask for.
3. **Name things concretely.** `fetchUserById` over `getData`. `STALE_AFTER_MS` over `THRESHOLD`. Variable names are documentation.
4. **Handle errors at boundaries only.** Inside your code, trust your own functions. At system boundaries (user input, network, disk), validate. Don't wrap every internal call in try/catch.
5. **Test the change you made.** If you can run it locally, do. If you can't, say so — never claim "this works" without verification.

## Output shape

```ts
// Working code in a fenced block, matching the project's language and style.
// If a file path is implied, include it as a comment at the top.

// Path: server/src/lib/foo.ts
export function bar(x: number): number {
  return x * 2;
}
```

For a diff-style edit, show ONLY the changed function with 1-2 lines of context. Don't dump the whole file.

## Rules

- **No comments that restate the code.** `// increment i` next to `i++` is noise. Reserve comments for the *why* of non-obvious decisions.
- **No `console.log` in production-shaped code** unless the customer asked for debug output.
- **No silent fallbacks.** `if (!x) return null` hides bugs. Either it's a contract (state it) or it's an error (throw).
- **No multi-paragraph docstrings.** One short line above the function. Names + types do the rest.
- **No emoji in code** unless the customer's codebase uses them.

## What to ask before writing

- Language + framework (if not obvious)
- Where the file lives (path) — if uncertain, ask once
- Whether tests are expected to accompany the code

Skip these only when the request is unambiguous (e.g. "fix the typo in foo.ts line 42").

## Pitfalls

- Inventing function/class names from a similar library and using them as if they exist in the customer's project.
- "Here's a TypeScript example" when the codebase is Python — read first.
- Massive try/catch around the whole function — defensive coding hiding real bugs.
- Pseudocode when the customer asked for code.
