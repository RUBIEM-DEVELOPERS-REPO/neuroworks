---
name: competitor-summary
description: Tight competitor summary — who they are, what they do better, what we do better, positioning notes. Lighter than competitive-analysis.
applies_to: [analyze, research, summarize]
---

# Skill: Competitor summary

## Goal

Sales or product reads a 1-page summary, knows the competitor's positioning, where they beat us, where we beat them, and how to talk about them in front of a customer.

## When this fires (vs `competitive-analysis`)

- **competitor-summary** — quick 1-page reference for sales / product on a single competitor or 2-3 named ones.
- **competitive-analysis** — full landscape with comparison matrix, recommendations, threat monitoring.

If the customer asks "summarise competitors" → this skill. If they ask "build a competitive analysis" → the deeper one.

## Process

1. **Pull the competitor's literal positioning** from their site, not your interpretation. "We're the AI inbox for sales teams" — quote it.
2. **Identify 2-3 things they do better than us.** Honest. If you list nothing here, you're not paying attention.
3. **Identify 2-3 things WE do better.** Concrete, customer-facing differences — not feature-flagged advantages no buyer asks about.
4. **One-line sales talking point.** What to say when a customer mentions them.
5. **What we don't know yet.** Be explicit about gaps — pricing, lock-in terms, hidden weaknesses.

## Output shape

```
## Competitor summary — <Competitor name>

**Category:** <Direct / adjacent / substitute>
**Headcount + funding:** <if known — Series X, ~N employees>
**Public positioning (quoted):** "<verbatim from their landing page>"

## What they do better than us
1. <Concrete advantage — feature, distribution, brand>
2. <...>
3. <...>

## What we do better
1. <Concrete advantage — customer outcome, ergonomics, price, focus>
2. <...>
3. <...>

## Pricing (best knowledge)
- Entry: <$X / month or "opaque, contact sales">
- Mid-tier: <...>
- Enterprise: <...>
- Source: <pricing page accessed YYYY-MM-DD / customer feedback / industry reports>

## Sales talking point

> When a customer mentions <competitor>, say:
> "<One-line that acknowledges the strength + redirects to our strength + ends with a question>"

Example:
> "<Competitor>'s great if you're optimising for X — what we hear from customers like you who tried them is Y. What matters most for your team here?"

## What we don't know
- <Specific gap — e.g. "What's their enterprise contract length?">
- <Specific gap — e.g. "Do they have a Slack integration?">

## Sources
- <Their site, dated>
- <Recent funding announcement / news, dated>
- <Customer-call notes where they were mentioned, dated>
```

## Rules

- **Quote their positioning verbatim.** Your summary of their pitch is biased; their own words aren't.
- **Both sides honest.** A summary with zero "what they do better" reads like marketing fluff.
- **Sales talking point is question-ending** — keep the conversation about the customer, not the competitor.
- **Date your data.** Pricing pages and positioning shift quarterly.
- **Surface gaps.** A summary that pretends to know everything is the failure mode.

## Pitfalls

- Stale data — competitor summaries rot fast. Annotate the date prominently.
- Listing every feature comparison — the salesperson wants 2-3 differentiators, not a feature matrix.
- Bashing the competitor in the talking point — customers can tell, and it damages YOUR brand.
- Confusing the competitor's MARKETING claim with reality — quote it, don't assert it as fact.
- Missing the "what we don't know" section — sales walks in over-confident.
