---
name: support-escalation
description: Identify tickets that need to escalate beyond L1 support — why each one, who should own it, and what the SLA risk is.
applies_to: [analyze, review]
---

# Skill: Support escalation triage

## Goal

Manager reads the escalation list, knows in 60 seconds which tickets need eyes today and who's the right owner, with enough context to act without re-reading the ticket.

## Process

1. **Apply the escalation triggers explicitly.** Triggers are:
   - **Data loss / data exposure / billing error** — auto-escalate, P0.
   - **Customer named "leaving" / "cancelling" / "VP" / "CEO" / "Twitter"** — relationship risk, escalate.
   - **Ticket aging past SLA** (>24h on a P1, >4h on a P0).
   - **Same-customer 3+ tickets in 7 days** — pattern of issues, retention risk.
   - **Compliance / security / legal language** — auto-escalate to legal.
   - **Ambiguity that L1 can't resolve in 2 back-and-forths** — needs eng / product owner.
2. **For each escalation: state WHY (trigger), WHO (team/role), and SLA RISK** (how long until we breach or lose the customer).
3. **Suggest the immediate next action** — not a multi-step plan, the single thing that unblocks resolution.
4. **Flag the customer's recent history** — paying tier, ARR, account health, any pending renewals.

## Output shape

```
## Escalation list — <YYYY-MM-DD>

**Summary:** <N tickets flagged from <M reviewed>>; <X high-risk (data/billing/legal)>, <Y retention risk>, <Z SLA-aging>.

## Critical — escalate today

### #<ticket id> · <customer> · <ARR if known>
- **Trigger:** <Which rule fired — quote the specific language if relevant>
- **Owner:** <Team / role — e.g. "Eng on-call + CSM @<name>">
- **SLA risk:** <Breached / <time> remaining / customer churn risk>
- **Customer context:** <Account tier, ARR, recent history — any pending renewal?>
- **Next action:** <Single concrete step>
- **Latest update from L1:** <One-line of what's been tried>

### #<ticket id> · <customer>
<...>

## Watch — re-check today, escalate tomorrow if no progress

### #<ticket id> · <customer>
- **Trigger:** <reason>
- **Owner:** L1 with manager visibility
- **What to verify by EOD:** <one item>

## Pattern alerts (same customer, multiple tickets)

- **<Customer>** — <N tickets in <window>> — themes: <cluster summary> — Recommend: CSM call.

## Customer-mention risk (named external escalation channels)

- #<ticket id> — customer mentioned "<channel — Twitter / LinkedIn / press / regulator>"

## What's NOT on this list (and why)

- <Routine billing / how-to / cosmetic — handled by L1>
- <Aging but low-severity tickets — flagged for triage, not escalation>
```

## Rules

- **Triggers, not vibes.** Each escalation cites a specific rule that fired. "Just feels urgent" doesn't make the list.
- **Owner is a name or role, not a team.** "Eng" is not actionable; "Eng on-call (current rotation: Sam)" is.
- **SLA risk is quantified.** "Aging" is vague; "breached 2h ago" or "3h remaining" is actionable.
- **Customer context matters for prioritisation.** A $500K ARR customer with a renewal in 30 days outranks the same ticket from a free user.
- **List what's NOT escalated** so the manager knows the triage was complete.

## Pitfalls

- Escalating EVERYTHING because the queue is long — the value is in calibration, not volume.
- Missing the cross-ticket pattern (one customer, 6 tickets, all "looks fine" individually).
- Forgetting that public-channel mentions (Twitter / press) compress SLA dramatically — those need same-hour ownership.
- Listing the trigger but not the next action — manager has to re-read the whole ticket to figure out what to do.
- Treating compliance / security mentions as "L2 problem" — those go straight to legal / security, not engineering escalation.
