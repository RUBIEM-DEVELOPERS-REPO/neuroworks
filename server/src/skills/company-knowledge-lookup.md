---
name: company-knowledge-lookup
description: Find an answer in the operator's company knowledge base (vault `_company/` folder). Combine vault.search across both `_company/` and the wider vault, then synthesise a grounded answer with the source paths.
applies_to: [direct-answer, summarize]
---

# Skill: Company-knowledge lookup

## When to use this

The user asks about something specific to their company — policies, brand
voice, product positioning, internal playbooks, contracts, decks, named
employees, prior projects. The answer should NOT come from the public web.

## Process

1. **Search `_company/` first** with `vault.search` using 2-4 keyword
   variations. Company knowledge is uploaded under that folder by design.
2. **If no hit, widen to the full vault** — the answer may live in
   `2-Permanent/` or `0-Inbox/` if not yet promoted into `_company/`.
3. **Read the top 2-3 matches** with `vault.read`. Don't reason from
   preview snippets — they're often misleading without full context.
4. **Synthesise, with citations.** Every factual claim cites at least one
   vault path. Without a citation, drop the claim or label it inference.
5. **Surface what's MISSING** — if a sub-question wasn't answered, say so
   explicitly. The operator will want to know what to add to `_company/`.

## Output shape

```
**Answer:** <one-paragraph, grounded response>

**Evidence:**
- `<vault/path/to/file.md>` — <what this source contributes>
- `<another path>` — <...>

**Gaps:**
- <Sub-question with no vault answer — suggests something to add to `_company/`>
```

## Rules

- **Vault paths are absolute proof of provenance.** A claim with no path
  attached is an assertion; an assertion is at best B-grade.
- **Don't fabricate file names.** Only cite paths returned by vault.search /
  vault.read. The user will click them.
- **Prefer `_company/` over the public web.** If the question's about the
  operator's own product, web research is almost always wrong.
- **Don't paraphrase confidential text into the public summary.** If a
  contract clause matters, quote it inside backticks — don't rewrite.

## Pitfalls

- Searching once with one keyword, missing the doc — try synonyms.
- Reading 10 files when 2 would have answered — bloats context, slows the
  synth step.
- Treating `_company/` as the only source — `2-Permanent/` often has older,
  promoted-from-inbox knowledge that's still authoritative.
- Returning a draft answer with no citations — equivalent to making it up.
