---
name: email-triage
description: Triage an inbox into three buckets — act now, wait, drop — with one-line rationale per item. The "first 5 minutes of the day" skill, not a draft-reply skill.
applies_to: [direct-answer, summarize, draft-other]
---

# Skill: Email triage

## Goal

The operator opens the inbox, runs through the triage, and KNOWS the
order of operations: what to do next (act now), what to set a reminder on
(wait), and what to ignore (drop). Not a draft-reply task — this is the
sort-before-replying step.

## Process

1. **Categorise every message.** Three buckets:
   - **Act now** — sender expects a response from the operator within
     24h OR there's a decision/action only the operator can make.
   - **Wait** — needs a response but not urgent (next week is fine), OR
     the operator is waiting on someone else to act first.
   - **Drop** — notifications, newsletters, autoreplies, FYI cc's, marketing.
2. **One-line rationale.** Each item gets a sentence explaining why it's
   in that bucket. The rationale is the load-bearing artefact — the bucket
   alone isn't actionable without it.
3. **Score the "Act now" bucket by impact + urgency.** Top of the list is
   "highest impact, fastest deadline". This is the order the operator
   should actually clear them.
4. **Surface anything ambiguous.** If a message could go either way (could
   wait, could be act-now), call it out — let the operator decide.

## Output shape

```
# Inbox triage — <Operator> · <YYYY-MM-DD>

## Act now (<N>)
1. **<Sender — Subject>** — <one-line rationale>. <deadline if any>
2. <...>

## Wait (<N>)
- **<Sender — Subject>** — <why it can wait>; <when to revisit>
- <...>

## Drop (<N>)
- <high-level summary, e.g. "12 marketing emails, 8 PR notifications, 3 LinkedIn">

## Ambiguous (<0-3>)
- **<Sender — Subject>** — could be <X> or <Y>; you decide
```

## Rules

- **Bucket on the SENDER + ASK, not the tone.** A friendly note with a
  Friday deadline is still act-now.
- **Drop the autoreply churn.** Out-of-offices, undeliverable bounces,
  delivery confirmations — all drop, no need to list individually.
- **Act-now never exceeds 7.** If you have 12 candidates, you haven't
  triaged hard enough. The whole point is forcing prioritisation.
- **Cite the deadline if stated.** "Please reply by Thursday" gets quoted —
  the operator needs the literal date.

## Pitfalls

- Drafting replies inside the triage. This is sorting, not writing — keep
  separate, the operator wants to scan first.
- Mixing personal + professional. Triage one inbox at a time.
- Marking newsletters as "wait" because you might read later. They're
  drop; the operator can dig them out if needed.
- Filling "Act now" with low-impact CCs to look thorough.
