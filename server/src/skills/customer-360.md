---
name: customer-360
description: Build a one-page profile of a customer / account by combining DB facts (db.query) with internal knowledge (vault.search on _company/). The shape an account exec, CSM, or exec uses before a meeting.
applies_to: [direct-answer, summarize, draft-memo]
---

# Skill: Customer 360

## Goal

In under 60 seconds of read time, the operator can walk into a meeting
knowing who they're talking to, what's happening on the account, what's
risky, and what the last touchpoint was. Mixes structured DB facts (deal
size, stage, contract dates) with unstructured vault notes (call summaries,
playbook for this segment, contract gotchas).

## Process

1. **Resolve the account.** From the request, extract the canonical name.
   If ambiguous ("Acme" could be three customers), ask before continuing.
2. **DB pull (one query if possible)** via `db.list_sources` → `db.query`:
   - Most recent deal stage + value
   - Open opportunities count
   - Last activity date
   - Renewal / contract end date if exposed
3. **Vault pull** via `vault.search`:
   - `_company/` for the playbook on this account's segment / tier
   - `2-Permanent/` for prior call notes, briefs, decisions
4. **Risk read.** Cross-reference the DB facts against the playbook. If
   the playbook says "renewal at 90 days; we touch monthly" and the DB
   shows last activity 45 days ago, the risk is real — call it out.
5. **Open the file.** End with one suggested next step the operator can
   take in the next 10 minutes.

## Output shape

```
# <Account name> — Customer 360 · <YYYY-MM-DD>

## Who
- Industry: <…>
- Tier / segment: <…>
- Primary contact: <Name, Role> — <last touch>

## What's happening
- Active deal(s): <Name, stage, value, owner>
- Recent activity: <…> (<date>)
- Contract / renewal: <date or "n/a">

## Risks
- <Specific concern with the evidence — DB fact OR vault note path>
- <…>

## What to know going in
- <Playbook callout or prior-call insight that the operator should reference>

## Next step (10 min)
- <One concrete action with owner + due>

## Sources
- DB: <source_label> (`<source_id>`) — query: <one-line description>
- Vault: `<path>`, `<path>`
```

## Rules

- **Every risk cites a fact OR a path.** "Renewal risk" with no evidence is
  noise.
- **Tier matters.** A strategic-tier account gets a deeper read than a
  long-tail SMB account. Adjust depth, not shape.
- **No fluff.** "It's important to maintain the relationship" — drop. The
  operator knows.
- **If DB is empty for this account, say so.** "Account exists in vault
  notes but no record in CRM" is a meaningful finding.

## Pitfalls

- Treating DB stale data as live — surface the last_updated timestamp.
- Mixing two same-name accounts — always anchor on customer_id.
- Suggesting a generic next step ("send follow-up") — give the specific
  outcome you want from it.
- Forgetting the playbook — that's the only place segment-specific guidance
  lives.
