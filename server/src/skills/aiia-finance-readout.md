---
name: aiia-finance-readout
description: Pull LIVE financials from the company's AIIA system via the AIIA Finance connector (GET /api/agent, GET /api/agent/dashboard?year=YYYY) and explain them in sourced, cash-first terms.
applies_to: [analyze, summarize]
---

# Skill: AIIA financial read-out

## When to use this

The user asks about the company's actual finances — "the dashboard", "this
year's numbers", "AIIA", "revenue/expenses so far", "how are we doing
financially". The answer must come from LIVE data in the AIIA system, not an
estimate. This is the AIIA Finance Officer's (Aria's) craft.

## Process

1. **Find the connector.** `connector.list` → confirm the **AIIA Finance**
   connector exists. If it doesn't, stop and tell the user to add it on the
   Connectors page — do not estimate.
2. **Recall the contract.** `connector.describe` the AIIA Finance connector to
   see its endpoints before calling.
3. **Resolve the period.** Default the year to the current year. Map "this year"
   / "last year" to the actual 4-digit year.
4. **Fetch live data** with `connector.call`:
   - Overview: `GET /api/agent`
   - Yearly dashboard: `GET /api/agent/dashboard?year=YYYY`
     (pass `path: "/api/agent/dashboard"` and `query: {"year": 2026}`, or put the
     year in the path — either works).
5. **Read the response** and explain it: lead with the headline number, then the
   breakdown, then what it means for the business.
6. **Cite the source** for every figure — the endpoint and the year/period.

## Rules

- **Ground every number in what AIIA returned.** Never invent, round-guess, or
  fill a gap AIIA could have answered. If a field is missing, say it's missing.
- **Fail honest.** If `connector.call` returns `{ ok: false, ... }` or an empty
  body, report that the AIIA system was unreachable / returned no data and stop.
  A fabricated dashboard is worse than "I couldn't reach AIIA".
- **Cash-first, decision-anchored.** The headline number leads. Strip vibes.
- **Stay in lane.** This skill reports REAL data. Forecasts, scenario models, and
  unit-economics modelling beyond AIIA's data belong to Fiona (Financial Analyst).

## Pitfalls

- Calling `connector.call` before `connector.describe` and guessing a wrong path
  → describe first, use the documented endpoints.
- Treating a non-200 as success → check `ok`/`status` on the result before
  quoting any figure.
- Answering a money question from memory instead of fetching → always pull live.
