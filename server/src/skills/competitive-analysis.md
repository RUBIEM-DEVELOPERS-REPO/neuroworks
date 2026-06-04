---
name: competitive-analysis
description: Structured analysis of competitors (or alternatives) — what they do, where they win, where we win, what to watch.
applies_to: [analyze, research]
---

# Skill: Competitive analysis

## Goal

Produce a clear-eyed view of where the customer's product / company / proposal sits relative to alternatives. The reader should walk away knowing: who the real competitors are, what each does better, what we do better, and what to watch.

## Web is required

Competitor data goes stale within weeks. Pricing pages change, features ship, funding rounds happen. NEVER write a competitive analysis from training knowledge alone — for every competitor named, fetch at least their pricing page AND their most recent changelog or blog/press release. If you can't find current data on a competitor, say so explicitly in their profile (the absence is data).

## Process

1. **Define the competitive set honestly.** Three buckets — direct competitors (same buyer, same problem), adjacent (same buyer, related problem), substitutes (different mechanism that solves the same pain). Skipping "substitutes" is a common mistake.
2. **For each competitor, fetch primary evidence via `smartFetch`:**
   - Their pricing page (or note "contact sales — opaque")
   - Their changelog / "what's new" page if they have one
   - Their most recent funding announcement (Crunchbase / TechCrunch / press release)
   - Their hiring page or recent LinkedIn job posts (signals investment direction)
   Avoid analyst reports as your only source — they lag 6-18 months and are sponsor-biased.
3. **Rank on the dimensions the BUYER cares about.** Not the dimensions you wish they cared about. If buyers care about price + integrations, lead with those — don't bury them under "innovation".
4. **Find each competitor's unfair advantage.** Distribution, capital, network effects, brand, IP, lock-in — one of these usually drives their position.
5. **Be honest about our weaknesses.** Hiding them in the analysis means leadership operates on false confidence.
6. **Cite every concrete claim.** "Vercel charges $20/seat [1]" — not "Vercel is reasonably priced".

## Output shape

```
# Competitive analysis: <market / category>

**Date:** <YYYY-MM-DD> · **Author:** <name>

## Bottom line
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
| Pricing (starter) | $X | $Y [1] | $Z [2] | free |
| Onboarding time | 1 day | 1 week [3] | 4 hours | 1 month |
| Key integration | <X> | <Y> [1] | <Z> | none |
| ... | ... | ... | ... | ... |

## Per-competitor profile

### <Competitor A>
- **Positioning:** <how they describe themselves — quoted from their site> [1]
- **Strengths:** <2-3 things they do better than us> [1][2]
- **Weaknesses:** <2-3 things we do better>
- **Unfair advantage:** <distribution / capital / lock-in / network>
- **Recent moves:** <pricing changes, launches, hires in last 6 months> [3]
- **What we'd lose to them:** <kind of buyer / context>

### <Competitor B>
<...>

## Where we win
- <Dimension>: <why and for whom>
- <Dimension>: <why and for whom>

## Where we lose (today)
- <Dimension>: <why — and whether we should close the gap, sidestep, or cede>

## Threats to monitor
- <Competitor X funding a feature we shipped — could become table-stakes within Q4> [4]
- <Adjacent player Y entering our category — early signal: <hire / announcement>> [5]
- <Substitute approach Z gaining traction — track <indicator>>

## Recommendations
1. <Specific positioning / product / pricing move — owner — by when>
2. <...>

## Sources
1. [<Competitor A> pricing page — accessed YYYY-MM-DD](url)
2. [<Competitor A> changelog — accessed YYYY-MM-DD](url)
3. [<Funding announcement> — outlet, date](url)
```

## Rules

- **Every competitor profile cites at least their pricing page AND one current signal** (changelog, funding, hire). One source per competitor is too few.
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
- Citing a competitor's marketing claims (their site says "best in class") as fact — those are positioning, not evidence.
