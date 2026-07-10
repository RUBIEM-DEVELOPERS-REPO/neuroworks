---
name: incident-post-mortem
description: Blameless post-mortem after a production incident — timeline, root cause, customer impact, and action items the team will actually follow up on.
applies_to: [draft-report, draft-other, review, plan]
---

# Skill: Incident post-mortem

## Goal

After an incident, write a document that (a) tells the org what happened in honest detail, (b) identifies the root cause without blaming individuals, and (c) commits the team to specific follow-ups that reduce the chance of recurrence.

## Format

```
# Post-mortem: <Incident title — system + symptom + date>

**Date of incident:** <YYYY-MM-DD>
**Authors:** <names>
**Status:** Draft | Review | Final
**Severity:** SEV1 | SEV2 | SEV3 (see your org's scale)

## Summary
<3-5 sentences. What broke, who noticed, what was the customer impact, how long it lasted, what fixed it. The whole story for someone who only reads this paragraph.>

## Customer impact
- **Affected users / accounts:** <count or %>
- **Affected functionality:** <what stopped working>
- **Workarounds available during incident:** <yes/no, what they were>
- **Data loss / corruption:** <yes/no — be precise>
- **Revenue / SLA impact:** <if quantifiable>

## Timeline (UTC)
| Time | Event |
|---|---|
| 14:02 | Deploy of v2.4 to production |
| 14:08 | Error rate on /checkout climbs from 0.1% → 12% |
| 14:11 | First customer reports in #support |
| 14:14 | On-call paged (auto-page on error-rate threshold) |
| 14:17 | On-call acknowledges, opens incident channel |
| 14:23 | Rollback initiated |
| 14:31 | Error rate returns to baseline |
| 14:45 | Incident declared resolved |

## Root cause
<2-4 paragraphs. The MECHANISM — the literal sequence of how the bug or misconfiguration produced the observed failure. Be specific: which line of code, which config value, which race condition.

Distinguish proximate cause ("the deploy") from root cause ("the v2.4 PR changed the receipt parser's null-handling — the new code path threw on empty headers, which production saw immediately because vendor X always omits Content-Type").>

## Contributing factors
- <Factor 1 — what made the impact worse or detection slower>
- <e.g. "Pre-prod tests don't cover empty-header inputs">
- <e.g. "No canary deploy — the bad version hit 100% traffic immediately">

## What went well
- <Detection time was X minutes — under target>
- <Rollback runbook was clear and worked>
- <Communication in #status was clear>

## What didn't go well
- <No alert fired for X minutes after the deploy>
- <The runbook didn't mention vendor X's behavior>
- <Two engineers ran conflicting fixes simultaneously>

## Action items
| # | Action | Owner | Due | Severity |
|---|---|---|---|---|
| 1 | Add empty-header test fixture for receipt parser | @alex | Nov 25 | Must |
| 2 | Configure canary deploys for /checkout service | @sam | Dec 5 | Should |
| 3 | Update runbook with vendor X edge cases | @priya | Nov 22 | Must |

## Lessons learned
<Optional. Cross-cutting takeaways — what we'll do differently across teams, not just on this incident.>
```

## Rules

- **Blameless.** Describe what happened, not who's at fault. "Engineer X pushed bad code" → "the change wasn't caught by pre-prod tests because…". The system enabled the human action.
- **Timeline in UTC** (or always-state the timezone). Future readers in other timezones need to reconcile against their own dashboards.
- **Root cause is mechanical.** "Lack of testing" is not a root cause; it's a contributing factor. The root cause is the specific mechanism by which the failure occurred.
- **Action items must have owners, due dates, and severity.** "Must / Should / Nice-to-have". Without all three, items rot in a backlog.
- **No conjecture as fact.** If you don't know, say "we don't yet know X — investigation continues" and put it as an action item.
- **Customer impact is in customer language.** "0.1% → 12% error rate" is one thing; "for 23 minutes, roughly 8,000 checkout attempts failed" is the language stakeholders need.

## Length

SEV1: 1500-3000 words.
SEV2: 800-1500 words.
SEV3: 300-700 words.

Avoid padding for length — if the incident was short and contained, the post-mortem can be too.

## Pitfalls

- "It was a one-off" / "this won't happen again" without an action item — the doc disappears, the bug returns.
- Burying customer impact in section 8 — it should be in the first 200 words.
- Action items so vague they can never be marked done ("improve monitoring").
- Naming individuals as the cause — destroys psychological safety for next time.
- Skipping "what went well" — only listing failures makes the team defensive.
