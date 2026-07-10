---
name: churn-risk-flag
description: Surface accounts likely to churn in the next 60-90 days, by combining product usage signals + relationship signals + macro signals. Names the specific risk per account and the recommended save action.
applies_to: [direct-answer, summarize, draft-memo]
---

# Skill: Churn risk flag

## Goal

The CS leader opens this report once a week and can SEE the accounts
that need attention. Each account gets a risk level, the specific signal
driving it, and a concrete next action.

## Signals (in priority order)

| Signal | Weight | Source |
|---|---|---|
| Usage trend down >30% over 60 days | High | Product DB |
| Sponsor changed in last 90 days | High | CRM / LinkedIn |
| Support ticket sentiment negative | High | Support DB / Zendesk |
| Power-user count dropped | Medium | Product DB |
| No QBR / business review in >180 days | Medium | CRM |
| Competitor mentioned in support / sales tickets | Medium | Support DB |
| Layoffs / restructure at customer | Medium | Public news |
| Last login >30 days for primary user | Low | Product DB |

A High signal alone qualifies; two Mediums also qualify; one Medium does
not (avoid noise).

## Process

1. **Pull the signal sources.** db.query for product + CRM + support.
   vault.search for any qualitative QBR notes.
2. **Score each account.** Apply the weights above. Convert to red /
   amber / green.
3. **Name the SPECIFIC signal driving each flag.** "At risk" alone is
   noise; "Sponsor changed 4 weeks ago, no replacement intro yet" is
   actionable.
4. **Recommend a specific save action per flagged account.** Generic
   "schedule a check-in" is filler.
5. **Surface the green accounts too** as a positive signal — these are
   expansion candidates.

## Output shape

```
# Churn risk — <Operator / Team> · week of <YYYY-MM-DD>

## At-risk this week (need action)

### 🔴 Red — act this week

#### <Customer> — $<ARR>/yr
- **Signal:** <specific, dated>. Source: <CRM record / DB query / ticket>
- **Why it matters:** <one-line on consequence if untouched>
- **Recommended action this week:** <specific, with owner>

#### <…>

### 🟠 Amber — set check-in within 2 weeks

#### <Customer> — $<ARR>/yr
- **Signal:** <…>
- **Recommended action:** <…>

## Healthy (expansion candidates)

| Customer | $ARR | Usage trend | Last QBR | Expansion theme |
|---|---|---|---|---|
| <…> | <…> | <up> | <date> | <feature / seat / module> |

## Trends across the book
- <Macro observation — e.g. "3 of 5 red accounts share the same
  industry — possible market signal">
- <…>

## Sources
- DB: <source_label> (`<source_id>`) — queries: usage, sponsor, support
- Vault: `_company/qbrs/`
```

## Rules

- **Every flag cites a signal.** Without a source, it's a vibe — drop it.
- **Every flag has an action.** "Watch this account" is not an action.
- **Quantify the stake.** $ARR for every flagged account so triage is
  obvious.
- **Don't conflate at-risk with bad customer.** Sometimes the right
  answer is "let them go cleanly" — say so when it applies.

## Pitfalls

- Flagging everything. If half the book is red, the report is noise.
- Generic save actions ("schedule QBR"). Name the specific
  conversation: "Re-establish exec sponsor with their new VP."
- Missing the macro signal. Three red accounts in the same vertical is
  a market move, not three coincidences.
- Ignoring the healthy accounts. The report should also create the
  expansion list.
