---
name: competitive-analysis
description: Structured analysis of competitors (or alternatives) — what they do, where they win, where we win, what to watch.
applies_to: [analyze, research]
---

# Skill: Competitive analysis

## Goal

Produce a clear-eyed view of where the customer's product / company / proposal sits relative to alternatives. The reader should walk away knowing: who the real competitors are, what each does better, what we do better, and what to watch.

## Process

1. **Define the competitive set honestly.** Three buckets — direct competitors (same buyer, same problem), adjacent (same buyer, related problem), substitutes (different mechanism that solves the same pain). Skipping "substitutes" is a common mistake.
2. **For each competitor, gather primary evidence.** Their site, pricing page, changelog, public social, recent funding, recent hires (LinkedIn). Avoid relying on analyst reports — they lag and are sponsor-biased.
3. **Rank on the dimensions the BUYER cares about.** Not the dimensions you wish they cared about. If buyers care about price + integrations, lead with those — don't bury them under "innovation".
4. **Find each competitor's unfair advantage.** Distribution, capital, network effects, brand, IP, lock-in — one of these usually drives their position.
5. **Be honest about our weaknesses.** Hiding them in the analysis means leadership operates on false confidence.

## Output shape

```
# Competitive analysis: <market / category>

**Date:** <YYYY-MM-DD> · **Author:** <name>

## TL;DR
<3-5 sentences. Where we sit, where we win, where the real threat is, what to watch.>

## The competitive set

### Direct
- <Competitor A> — <one-line positioning>
- <Competitor B> — <one-line positioning>

### Adjacent
- <Competitor C> — <one-line positioning>

### Substitutes
- <Approach D> — <one-line positioning>

## Comparison

| Dimension | Us | A | B | C |
|---|---|---|---|---|
| Pricing | $X starter | $Y | $Z | free |
| Onboarding time | 1 day | 1 week | 4 hours | 1 month |
| Key integration | <X> | <Y> | <Z> | none |
| ... | ... | ... | ... | ... |

## Per-competitor profile

### <Competitor A>
- **Positioning:** <how they describe themselves>
- **Strengths:** <2-3 things they do better than us>
- **Weaknesses:** <2-3 things we do better>
- **Unfair advantage:** <distribution / capital / lock-in / network>
- **Recent moves:** <pricing changes, launches, hires in last 6 months>
- **What we'd lose to them:** <kind of buyer / context>

### <Competitor B>
<...>

## Where we win
- <Dimension>: <why and for whom>
- <Dimension>: <why and for whom>

## Where we lose (today)
- <Dimension>: <why — and whether we should close the gap, sidestep, or cede>

## Threats to monitor
- <Competitor X funding a feature we shipped — could become table-stakes within Q4>
- <Adjacent player Y entering our category — early signal: <hire / announcement>>
- <Substitute approach Z gaining traction — track <indicator>>

## Recommendations
1. <Specific positioning / product / pricing move — owner — by when>
2. <...>

## Sources
[1] <competitor pricing page — accessed YYYY-MM-DD>
[2] <funding announcement>
[3] <changelog>
```

## Rules

- **No marketing voice describing competitors.** Use their literal positioning then describe what they actually do.
- **Pricing is on the page.** If you can't find it after 5 minutes of searching, that's data — note it ("contact sales only — opaque").
- **Date every source.** Competitive landscapes shift quarterly; an analysis without dates rots invisibly.
- **Honest assessment over flattering one.** A competitive analysis that concludes "we're winning everywhere" doesn't get used; leadership knows it's wrong.
- **Recommend, don't just describe.** Analysis without recommendations is a brain dump.

## Pitfalls

- Cherry-picking dimensions that flatter us — leadership sees through it instantly.
- Listing every feature in a matrix — the matrix becomes unreadable. 5-8 dimensions max.
- Treating analyst quadrants as ground truth.
- Ignoring substitutes (no-code, spreadsheets, "do nothing") — these win quietly.
- Stale data — a 2024 analysis used in 2026 misleads more than no analysis.
