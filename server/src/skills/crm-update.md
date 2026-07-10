---
name: crm-update
description: Turn raw call notes into structured CRM-ready fields the rep can paste straight into HubSpot / Salesforce / Pipedrive.
applies_to: [draft-other, summarize]
---

# Skill: CRM update from call notes

## Goal

The rep paste-applies the fields and the CRM record is now accurate. No "I'll get back to you on the BANT bit".

## Process

1. **Extract the canonical CRM fields the rep will need updated.** These vary slightly by CRM but the universal set is: contact role, company, deal stage, next step, deal size estimate, close-date estimate, qualification (BANT/MEDDIC), competitor mentioned.
2. **Quote the source line for each field.** If you wrote "deal size: $80K", attach the literal quote from notes that justifies it ("...we'd want to roll this out across all 4 regions..." → 80K).
3. **Flag inferences.** When the field isn't directly stated but you derived it, mark `(inferred)`.
4. **Surface what's MISSING.** If notes don't cover budget, say so explicitly — that's a discovery gap to close on the next call.
5. **Suggest concrete next-step.** Not "follow up next week" — "Send the security overview deck by EOD Friday, propose discovery call w/ CISO for week of X".

## Output shape

```
## CRM update — <Account> · <Call date>

### Contact
- Primary: <Name>, <Role>, <email if mentioned>
- Other attendees: <Name(s)>

### Deal
- Stage: <Discovery | Qualification | Proposal | Negotiation | Closed-Won | Closed-Lost>
- Size estimate: $X (inferred — "<quote>")
- Close date estimate: <YYYY-MM-DD or "Q3 2026">
- Champion: <Name>
- Economic buyer: <Name or "unknown">

### Qualification (MEDDIC)
- Metric: <quantified pain or success metric>
- Economic buyer: <name + how confirmed>
- Decision criteria: <how they'll choose>
- Decision process: <who signs, in what order>
- Identify pain: <what's broken today>
- Champion: <internal advocate>

### Next step
- Owner: <Rep name>
- Action: <Specific, single-sentence>
- Due: <YYYY-MM-DD>

### Gaps (close on next call)
- <What we don't know yet>
- <...>

### Source quotes
- Field: <Quote> ([transcript line N])
```

## Rules

- **Every non-trivial field cites a source line.** Rep will get audited; "I made it up" doesn't fly.
- **Never invent budget figures.** "$50K-100K" inferred from "we'd roll out across N regions × Y users" is fine; "$80K" with no math behind it is not.
- **Stage choice is binary.** If you can't pick one stage with confidence, write "Discovery" and explain why upgrade is premature.
- **Always include the gaps section.** A perfectly-populated record with no gaps is the failure mode — discovery is never complete after one call.

## Pitfalls

- Padding fields you don't have data for ("Competitor: probably Salesforce" — drop it unless mentioned).
- Stuffing prose into the Next-step field — the field is one action, owner, date.
- Forgetting that BANT/MEDDIC is YOUR framework; the prospect doesn't speak in those terms. Translate.
- Promoting deal stage prematurely because the call was positive — stage moves on commitment, not enthusiasm.
