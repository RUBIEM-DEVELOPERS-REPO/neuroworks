---
name: pricing-proposal
description: Turn customer requirements into a structured pricing proposal with options, trade-offs, and the rationale that justifies each price.
applies_to: [draft-memo, draft-other]
---

# Skill: Pricing proposal

## Goal

The customer reads the proposal once and can decide. They see what they're
getting, what it costs, what the cheaper alternative looks like, and what
the upsell looks like — all in one document.

## Process

1. **Extract the requirements.** Use the discovery notes, the RFP, or
   whatever the customer sent. Cluster into MUST / SHOULD / NICE.
2. **Map to tiers.** Three-option default (cheap / mid / premium); two
   if the gap between cheap and mid is small.
3. **Price each tier.** Don't bury the number. Each tier gets a one-line
   "for whom this is right" so the customer self-selects.
4. **State what's included AND what's not.** "Not included" is half the
   value — saves the awkward scope-creep conversation later.
5. **Add the success criteria.** What does success look like in 90 days
   under each tier?
6. **End with the recommendation** — the proposing party should have a
   view on which tier this customer should pick.

## Output shape

```
# Pricing proposal — <Customer> · <YYYY-MM-DD>

## What you told us you need
- <Cluster 1 — MUST>
- <Cluster 2 — SHOULD>
- <Cluster 3 — NICE>

## Three ways forward

### Option A — <Label> · $<price>
**Right for:** <one-line on who this is for — e.g. "teams that need X
running by Q3 without a procurement cycle">

**Included**
- <Capability>
- <Capability>
- <Capability>

**Not included** (call out the gaps)
- <Feature / service the customer asked for but isn't in this tier>
- <…>

**Success in 90 days looks like**
- <Specific, measurable outcome>

### Option B — <Label> · $<price>
<Same shape>

### Option C — <Label> · $<price>
<Same shape>

## Our recommendation
> <One sentence — which option for this customer and why>

## Terms
- Payment: <upfront / monthly / annual>
- Term: <12 months / month-to-month / etc.>
- Cancellation: <30 days / quarterly / etc.>
- Renewal: <auto-renew / opt-in>

## Next step
- We'd like to <book a kickoff call / receive a PO / start work>
- Decision needed by: <date>
- Point of contact your side: <name>
```

## Rules

- **Show the price.** Pricing proposals that bury the number look like
  they're trying to hide it.
- **Trade-offs are mandatory.** Each tier has a clear thing it doesn't
  do — that's how the customer picks.
- **No more than 3 options.** Four is paralysis.
- **The recommendation isn't optional.** Sales reps who hide their view
  push the choice work onto the customer.

## Pitfalls

- Vague scope. "Implementation support" is not a deliverable; "5 hours
  of implementation kickoff, plus 90 days of Slack support" is.
- Same value prop across all tiers. The middle option should clearly
  be different from the cheap option.
- Loading the cheap option with so many exclusions it becomes a non-
  starter — looks manipulative.
- Forgetting to state success criteria. The customer measures success
  in their language; you need to translate.
