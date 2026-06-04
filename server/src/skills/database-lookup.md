---
name: database-lookup
description: Answer a business question by querying the operator's company database. Discover the source via db.list_sources, learn the schema via db.schema, write a read-only SQL query via db.query, then narrate the result.
applies_to: [direct-answer, summarize, draft-other]
---

# Skill: Database lookup

## When to use this

The user asks something whose answer lives in their own data — sales, deals,
customers, employees, orders, inventory, support tickets, time tracking. If
the answer is in a SaaS dashboard, it's also in the underlying database the
operator probably connected.

## Process

1. **Discover** — call `db.list_sources` first. Without a source id you
   cannot query. If the list is empty, tell the user no DB is connected and
   point them at the Company data page (`/data-sources`) to register one.
2. **Pick the right source.** Use the `label` + `notes` field. If two sources
   could plausibly answer (e.g. "Prod CRM" and "Staging CRM"), ask the user
   rather than guess.
3. **Learn the schema.** Call `db.schema(source_id)` once. Cache the table
   list in your reasoning; do NOT call schema again for the same source in
   the same plan.
4. **Write ONE read-only query.** SELECT / WITH / SHOW / EXPLAIN / DESCRIBE
   only. Engine-aware quoting:
   - Postgres / MySQL: `"table_name"` or backticks for MySQL identifiers.
   - SQLite: PRAGMA for column info, no schema prefix needed.
5. **Cap rows server-side.** Add `LIMIT 200` (the runner caps at 200 anyway
   but explicit limits make slow queries cheaper).
6. **Narrate the result.** Don't dump rows raw. Pull out the headline number
   ("top customer by revenue is Acme at $42K"), the shape ("8 of the top 10
   are mid-market"), and the caveats ("data only covers the last 30 days").

## Query patterns

| Question | Pattern |
|---|---|
| "How many X this month?" | `SELECT COUNT(*) FROM x WHERE created_at >= date_trunc('month', now())` |
| "Top N by Y" | `SELECT a, SUM(b) AS total FROM t WHERE … GROUP BY a ORDER BY total DESC LIMIT N` |
| "Trend over time" | `SELECT date_trunc('week', created_at) AS wk, COUNT(*) FROM t GROUP BY wk ORDER BY wk` |
| "Who owns the most X?" | `SELECT owner, COUNT(*) FROM t GROUP BY owner ORDER BY 2 DESC LIMIT 10` |

## Output shape

```
**Answer:** <headline number / fact in one sentence>

**Detail:**
- <Two-to-five bullet points giving texture: top entries, shape, comparison>
- <...>

**Query:**
\`\`\`sql
<the SQL you ran>
\`\`\`

**Caveats:**
- Source: <label> (`<source_id>`)
- <Anything the query doesn't cover — date range, soft-deletes, missing joins>
```

## Rules

- **Never write or modify data.** The runner enforces read-only on most
  sources; do not test the limit. If the user asks for an UPDATE, refuse and
  suggest they run it directly in their admin tool.
- **Surface the SQL.** The operator's data team will audit; opaque answers
  erode trust.
- **One query per plan, ideally.** If the question genuinely needs three
  queries (e.g. count + breakdown + delta), do all three but consolidate the
  output into one narrative.
- **Quote the source id.** So a follow-up question can re-use it without
  re-discovering.

## Pitfalls

- Asking for schema, then asking again — wastes a round trip.
- Joining tables you didn't verify exist (planner hallucinations).
- Showing raw rows when the user asked for a summary.
- Forgetting timezone — `now()` in Postgres returns server-local time, not
  the operator's; clarify if the answer depends on it.
