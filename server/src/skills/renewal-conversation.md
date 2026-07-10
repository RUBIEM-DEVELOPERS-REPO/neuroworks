---
name: renewal-conversation
description: Prep the renewal conversation — pull usage data + outcomes delivered + relationship signals + competing options, then script the call.
applies_to: [draft-memo, summarize]
---

# Skill: Renewal conversation

## Goal

The CSM (or AE) walks into the renewal call with a clear read on whether
this customer renews easily, renews with a price negotiation, or
churns — and the talking points for each.

## Process

1. **Pull usage data** via `db.query` if CRM/product DB connected — DAU,
   feature adoption, last-login, support tickets.
2. **Pull outcomes delivered.** What did the customer achieve in the
   contract period? This is what justifies the renewal price.
3. **Pull relationship signals.** Last QBR, NPS / CSAT, sponsor change,
   recent support escalations.
4. **Identify renewal class:**
   - **Easy** — high usage, sponsor still here, outcomes clear → renew
     at list, possibly upsell.
   - **Negotiation** — middling usage OR sponsor change OR macro headwind
     → expect price push, prepare counters.
   - **At-risk** — low usage OR support friction OR competitor mentioned
     → save call, not renewal call.
5. **Script the call** matched to class. Don't ask renewal questions in
   a save-call shape, and vice versa.

## Output shape

```
# Renewal prep — <Customer> · contract ends <YYYY-MM-DD>

## Status: <Easy / Negotiation / At-risk>

## Numbers
- Contract: $<value>/year (or $<value>/month × <months>)
- Usage trend: <up / flat / down> over <window>
- Power users: <N> active / <M> seats
- Sponsor: <Name> (still here? yes/no/changed)
- Support tickets last 90 days: <count> (sentiment: <pos/neutral/neg>)
- Outcomes delivered: <2-3 concrete wins, dated>

## What the customer might say
1. "We're going to renew" — <response>
2. "We need a discount" — <response calibrated to renewal class>
3. "We're evaluating <competitor>" — <response>
4. "Things changed, we need less" — <response>

## What we want to come out with
- <Renewal at <terms>>
- <Or: documented expansion path to be revisited in 60 days>
- <Or: save plan with named milestones>

## Risks
- <Specific risk, e.g. "sponsor moved to a different team", with the
  evidence>
- <…>

## Asks
- <Specific ask the operator should make: 12-month renewal, multi-year,
  case study consent, ref-customer agreement, etc.>
```

## Class-specific scripts

### Easy renewal — open with confidence
"We've seen <outcome 1> and <outcome 2> over the past year. We'd like to
lock in another <12 months / multi-year>. What's the procurement timing
your side?"

### Negotiation — open with outcomes, hold the price
"<Outcome 1, dated>. <Outcome 2>. We're proposing the same terms — we
think it's worked. What's your view on next year?"

If they push: "Help me understand — is it the price, the scope, or
timing?" Address whichever they name. Don't pre-discount.

### At-risk — open with empathy, not the contract
"Before we get to the renewal, I want to understand where you're at.
You've had <specific friction>. What would have to be true in the next
90 days for this to feel right?"

## Rules

- **No surprise renewal.** If the customer is surprised by the contract
  date, the CSM failed. Surface the date 90 days out.
- **Outcomes before pricing.** Always.
- **Don't discount preemptively.** Wait for them to push, then negotiate
  the SHAPE (term, scope, term length) not just the number.
- **Multi-year + discount > one-year + discount.** Always trade something.

## Pitfalls

- Treating every renewal as a save call — overweighting risk language
  that creates anxiety where there was none.
- Pre-discounting on a flat conversation. Trains the customer to ask
  for more next year.
- Skipping the "what changed" question. Sponsor change is the #1
  hidden churn cause.
- Renewing without an expansion conversation. Renewals are also
  expansion opportunities — bring one if usage supports it.
