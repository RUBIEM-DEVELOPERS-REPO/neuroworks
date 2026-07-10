---
name: pipeline-review
description: Run a sales pipeline review by querying the company DB for stage / value / age distribution, then narrate what's healthy, what's stuck, and what needs the operator's attention this week.
applies_to: [direct-answer, summarize, draft-memo]
---

# Skill: Pipeline review

## Goal

The operator (rep, manager, exec) sees the pipeline through a focused lens:
not 200 deals, but the 5-10 that need a decision THIS WEEK. Combines
DB-level structure (stage counts, value, age) with judgement (where the
risks cluster).

## Process

1. **Discover the source** with `db.list_sources`. Pick the CRM /
   opportunities database.
2. **One query for the snapshot:**
   ```sql
   SELECT stage, COUNT(*) AS deals, SUM(value) AS pipeline,
          AVG(EXTRACT(EPOCH FROM (NOW() - last_activity)) / 86400) AS avg_days_stale
   FROM opportunities
   WHERE status = 'open'
   GROUP BY stage
   ORDER BY pipeline DESC;
   ```
   Adapt to the actual schema (use `db.schema` first if you don't know it).
3. **One query for the stuck deals** — open > 30 days, no activity in 14:
   ```sql
   SELECT id, name, owner, stage, value, last_activity_date
   FROM opportunities
   WHERE status = 'open'
     AND age(last_activity_date) > interval '14 days'
   ORDER BY value DESC
   LIMIT 20;
   ```
4. **Narrate.** Headline → stage shape → stuck list → suggested moves.

## Output shape

```
# Pipeline review — <Operator / Team> · <YYYY-MM-DD>

## Headline
- Open pipeline: $<X> across <N> deals
- Stage where the money is: <stage> ($<Y>)
- Stuck (no activity 14d+): <N> deals worth $<Z>

## Stage shape
| Stage | Deals | $ | Avg days stale |
|---|---|---|---|
| <…> | <…> | <…> | <…> |

## Stuck — needs a touch this week
1. **<Account>** — <stage>, $<value>, last touched <N> days ago. <One-line on the right next move>
2. <…>

## What's healthy
- <One or two callouts — stage with strong throughput, recently closed-won, etc.>

## Sources
- DB: <source_label> (`<source_id>`)
- Queries: <pipeline-snapshot.sql>, <stuck-deals.sql>
```

## Rules

- **Pipeline value is open-only.** Closed-won goes in a separate revenue
  report; mixing them inflates the number and hides the working pipeline.
- **"Stuck" is a definition, not a vibe.** State the rule you used (open >
  N days OR no activity in M days) so the operator can argue with it.
- **Don't recommend a stage move you can't justify.** The rep owns stage
  changes. You surface signals.
- **Top-N by value, not by name.** Operator only has time for the deals
  that move the number.

## Pitfalls

- Counting closed-lost as pipeline — read the status field every time.
- Ignoring multi-currency — if the CRM holds USD + EUR side by side, say
  what FX you assumed (or flag that you didn't normalise).
- Generic suggestions ("re-engage the prospect") — name the channel and
  the angle. "Send the security one-pager and ask for CISO intro" beats
  "follow up".
