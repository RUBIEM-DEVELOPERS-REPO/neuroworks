---
name: research-deep
description: How to do solid research that grounds claims in real evidence — vault first, web second, no hand-waving.
applies_to: [research, summarize, explain, analyze]
---

# Skill: Deep research

## Goal

Produce a short answer that the user can trust, with every substantive claim traceable to a source.

## When the web is REQUIRED (not optional)

If the task contains ANY of these signals, the answer MUST be grounded in fresh web evidence — your training knowledge alone is not enough:

- **Look-up verbs:** "look up", "find out", "research", "investigate", "dig into", "what's the current state of", "what's the latest on"
- **Recency markers:** "latest", "recent", "current", "now", "as of 20XX", "in 2025", "in 2026", "this year", "this quarter"
- **Benchmark / industry asks:** "industry-typical", "benchmark", "what's standard", "what do real companies do", "what's best in class", "comparable"
- **Named entities the user doesn't expect you to know cold:** product names, company names, public people, specific reports, pricing pages, changelogs
- **"According to" phrasing:** when the customer asks you to ground claims in attributable sources

When you spot any of these, do NOT answer from training alone. Run `research.deep` (or `web.search` → `smartFetch`) FIRST, then synthesise.

## Process

1. **Vault first.** Search the user's notes (`vault.search`) before going to the web. The user's own notes are higher-trust than any web source for topics they've thought about. Read the top 1-3 matches with `vault.read`.
2. **Web when needed.** If ANY of the signals above are in the task — OR the vault has no coverage — run `web.search`, then fetch the top 3 results in parallel via `smartFetch`. Three sources is the floor for any claim about market, benchmark, or current state. More for contested topics.
3. **Cite everything.** Every substantive sentence ends with `[N]` (web source number) or `[vault:path/to/note.md]`. Unsourced sentences = hallucination risk; either find a source or drop the claim.
4. **Date every source.** Publication date matters. "Per OpenView 2024 SaaS report [1]" beats "per OpenView [1]" because the reader knows whether the claim is fresh.
5. **Name the entities.** When you cite, name the source: "Stripe's API docs [2]" not "the documentation [2]". The reader should be able to judge source quality without clicking.
6. **Resolve contradictions.** When two sources disagree, NAME the disagreement and say which way the evidence leans. Don't paper over.
7. **Capture.** Write a 0-Inbox note via `vault.write` so the next research run finds it.

## Output shape

```
**Bottom line:** <one sentence with the answer — grounded in the strongest source>

## What we know
- Claim 1 [1]
- Claim 2 [2][vault:2-Permanent/note.md]
- Claim 3 — per X 2025 report [3]

## Where sources disagree
- <Source A says X [1]; Source B says Y [4]. Lean toward A because <reason>.>
- (Skip this section if all sources agree.)

## Open questions
- Thing we couldn't pin down — needs <specific next step>

## Sources
1. [Title — outlet, 2025-MM-DD](url) *(primary | major outlet | trade press | blog)*
2. [Title — outlet, date](url)
3. [Title — outlet, date](url)
```

## Rules

- **Three sources minimum** for any claim about market state, benchmarks, or current practice. One source = one perspective.
- **Primary > major outlet > trade press > blog > forum.** A pricing page beats a TechCrunch summary of the pricing page.
- **No "according to industry research"** without naming the report. "Per OpenView 2024 SaaS Benchmarks" is fine; "industry research shows" is not.
- **No claim without a date.** "X grew" is meaningless; "X grew 30% Q1→Q3 2025 [2]" is a claim.
- **If sources are thin, say so plainly in the Bottom line** — don't dress up weak evidence as strong.

## Pitfalls

- Quoting a search snippet without reading the actual page → wrong claims.
- One source = one perspective. Aim for 3 minimum on contested topics.
- Going straight to web when the vault has the answer.
- Citing your training data ("typically", "generally") and presenting it as research — that's the failure mode this skill exists to prevent.
- Skipping the date because "it's recent" — readers can't verify what they can't see.
