---
name: aiia-finance-readout
description: Pull live budgets/receipts/requisitions from the Aiia FinanceFlow connector and explain them in sourced, cash-first terms.
applies_to: [analyze, summarize]
---

# Skill: Aiia financial read-out

## When to use this

The user asks about the company's actual finances — "the dashboard", "this
year's numbers", "Aiia", "budgets", "receipts", "purchase requisitions",
"how are we doing financially". The answer must come from the real, live
FinanceFlow data, not an estimate. This is the Aiia Finance Officer's
(Aria's) craft.

## Architecture — read this before assuming a snapshot is involved

Aiia Finance is now a **live connector**, not a push model. The old
mechanism (Finance System POSTs a dashboard to `/api/public/dashboard`,
NeuroWorks stores one snapshot, read via `finance.snapshot`) was **retired
2026-07-10** — its data was stale (last pushed 2026-07-01) and has been
deleted from the vault. `finance.snapshot` now always returns
`available: false` and should not be used.

The real source is the **"Aiia FinanceFlow" connector**, registered on the
Connectors page. It's an external financial management app (budgets,
receipts, purchase requisitions) reached via `connector.call`. Read-only.
Auth is a session cookie that expires ~24h after each manual re-auth — if
calls start failing with 401, that's why.

## Process

1. **Know what's available.** If unsure, `connector.describe {name:"Aiia
   FinanceFlow"}` to see the manifest.
2. **Pull the data you need** via `connector.call` on connector "Aiia
   FinanceFlow":
   - `list-budgets` → `GET /api/budgets`
   - `list-receipts` → `GET /api/receipts`
   - `list-requisitions` → `GET /api/requisitions`
3. **If a call fails**, the most likely cause is the session cookie expired.
   Say plainly that the FinanceFlow connection needs to be refreshed and
   stop — do NOT fall back to `finance.snapshot` (retired) or a vault note,
   and do NOT suggest "adding a connector" (it already exists, it just
   needs re-authenticating).
4. **Read the raw records** returned (each is a list of budget/receipt/
   requisition objects with amounts, categories, dates, status) and
   synthesise the actual answer — sum, filter, or compare as the question
   needs. There is no pre-computed revenue/expenses/netProfit figure here;
   compute what's asked for from the real records rather than assuming a
   single "dashboard" shape.
5. **Explain it**: lead with the headline number the question actually
   wants, then the breakdown, then what it means for the business.
6. **Cite the source** — which FinanceFlow endpoint(s) the figures came
   from.

## Rules

- **Ground every number in what the connector actually returned.** Never
  invent, round-guess, or fill a gap with an assumption.
- **Fail honest.** If the connector call errors, report that plainly and
  stop. A fabricated dashboard is worse than "the connection needs
  refreshing."
- **Cash-first, decision-anchored.** The headline number leads. Strip vibes.
- **Stay in lane.** This skill reports REAL live data. Forecasts, scenario
  models, and unit-economics modelling beyond FinanceFlow's raw records
  belong to Fiona (Financial Analyst).

## Pitfalls

- Calling `finance.snapshot` — retired, always returns `available: false`
  now. Use `connector.call` on "Aiia FinanceFlow" instead.
- Telling the customer to "add the Aiia Finance connector" — it already
  exists. The actual fix for a failing call is re-authenticating the
  connector (the session cookie expires ~24h after each login).
- Assuming a single pre-mapped revenue/expenses/netProfit shape — FinanceFlow
  returns raw budget/receipt/requisition records; compute what the question
  needs from those.
- Answering a money question from memory instead of calling the connector
  fresh each time.
