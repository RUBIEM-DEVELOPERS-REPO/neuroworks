---
name: p-and-l-summary
description: Turn raw P&L data (from db.query or an uploaded sheet) into a one-page summary — revenue trend, gross margin, biggest costs, variance vs plan, "what changed" callouts.
applies_to: [summarize, draft-memo, direct-answer]
---

# Skill: P&L summary

## Goal

A leader reads the summary in 90 seconds and knows: did the business
make more money this period than last, where it came from, where it
went, and what's different from plan.

## Process

1. **Pull the data.** If a finance DB is registered, use `db.query`
   against the relevant tables (rev, cogs, opex, headcount). Otherwise
   read the uploaded spreadsheet.
2. **Compute the standard rows:**
   - Revenue (by segment if available)
   - COGS
   - Gross profit + gross margin %
   - Opex (by major bucket: R&D, S&M, G&A)
   - Operating income + operating margin %
   - Net income (if relevant)
3. **Compute the comparisons:** vs prior period, vs same period last
   year, vs plan/budget.
4. **Identify the 2-3 biggest variances** and EXPLAIN them. Don't just
   show the number — name the why.
5. **Surface anything UNUSUAL.** One-time gains/losses, accruals, FX
   effects, customer concentration.

## Output shape

```
# P&L summary — <Period> · generated <YYYY-MM-DD>

## Headline numbers

| Metric | Actual | Prior period | YoY | vs Plan |
|---|---|---|---|---|
| Revenue | $<X> | $<X> (<+/-N%>) | <+/-N%> | <+/-N%> |
| Gross profit | $<X> (<N%> margin) | <margin trend> | <…> | <…> |
| Opex | $<X> | <+/-N%> | <…> | <…> |
| Operating income | $<X> (<N%> margin) | <…> | <…> | <…> |

## What's working
- <Specific line item that beat plan, with the $ and why>
- <…>

## What's not
- <Specific line item that missed plan, with the $ and why>
- <…>

## Biggest variances vs plan

### <Line item> — <$ variance> ( <% variance>)
- **What happened:** <specific>
- **Driver:** <root cause>
- **Forward-looking:** <one-time or ongoing?>

### <…>

## One-time items / call-outs
- <Anything that distorts the read — restructuring, FX, one-time deal>
- <…>

## What the operator should know
- <2-3 lines on the read of the period — not a victory lap, not a
  doom message, the honest take>
```

## Rules

- **Show the margins, not just the dollars.** A revenue beat with a
  margin miss is a different story than a beat with margin expansion.
- **Always compare to plan.** Without a plan baseline, beating prior
  is meaningless.
- **Explain the variances.** Numbers without explanation invite the
  wrong story.
- **Cite the source.** "Source: finance DB query at <timestamp>" so the
  reader can audit.

## Pitfalls

- Reading like an accounting export. The reader wants the story, not
  the data dump.
- Hiding the bad news. If the period missed, lead with the miss.
- Skipping non-recurring items. A one-time gain that lifts the period
  hides the underlying trend.
- Over-explaining variances <5%. Noise level — focus on material
  movements.
