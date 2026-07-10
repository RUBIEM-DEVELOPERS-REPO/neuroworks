---
name: procurement-request
description: Build a structured procurement request from a stated need — justification, options, total cost, suggested approver, risks.
applies_to: [draft-other, plan]
---

# Skill: Procurement request

## Goal

Procurement / finance approves (or denies) in one read, without bouncing the request back for more info.

## Process

1. **Restate the NEED precisely.** Not "we need a CRM" — "we need a CRM that supports our 8-person sales team, integrates with Slack + HubSpot data, and stays under $30K/year".
2. **List 2-3 options seriously evaluated.** Single-vendor requests look like back-pocket deals; multi-option requests look professional and give procurement leverage.
3. **Total cost (TCO over the relevant horizon)** — sticker + onboarding + training + implementation. See vendor-comparison skill.
4. **Justify the spend in business terms** — what problem this solves, what it unblocks, what the cost of NOT doing it is.
5. **Suggest the approver.** Based on amount, department, urgency — name the role.
6. **Surface risks** — vendor stability, switching cost, regulatory implications, security posture.

## Output shape

```
# Procurement request — <Item / service>

**Requestor:** <Name / role / team>
**Date:** <YYYY-MM-DD> · **Need-by:** <YYYY-MM-DD if time-sensitive>
**Estimated TCO (Year 1):** <$X>
**Estimated TCO (3-year):** <$Y>
**Suggested approver:** <Role / individual based on amount band>

## The need

<2-3 sentences. What problem this solves. Who has the problem. Why now.>

## Options evaluated

| Vendor | Year-1 TCO | Strengths | Weaknesses | Risk |
|---|---|---|---|---|
| **<Vendor A — RECOMMENDED>** | $X | <2-3 bullets> | <1-2 bullets> | Low/Med/High |
| <Vendor B> | $Y | ... | ... | ... |
| <Vendor C> | $Z | ... | ... | ... |

## Recommendation

**<Vendor A>.** Reasons:
1. <Reason 1 — quantified>
2. <Reason 2 — risk-adjusted>
3. <Reason 3 — fit>

## Total cost breakdown (recommended option)

| Line item | Amount | Notes |
|---|---|---|
| License / subscription (year 1) | $X | <e.g. "8 seats @ $300/mo"> |
| Onboarding / setup | $X | <one-time> |
| Implementation effort | $X | <e.g. "~40 eng-hours @ $rate"> |
| Training | $X | <e.g. "8 hrs × 8 people"> |
| **Year-1 TCO** | **$total** | |
| Year-2+ annual | $X | <indicate any price-lock terms> |

## Business justification

<3-5 sentences. What this unblocks. What the cost of NOT acting is. Tie to a goal / OKR if possible.>

## Risks + mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| <Vendor stability — Series X startup> | Low | <Contract clause, data export commitment> |
| <Lock-in — proprietary data format> | Medium | <Negotiate quarterly export, retain right to terminate> |
| <Security / compliance — handles customer data> | Low | <SOC2 confirmed, DPA signed> |

## Negotiation asks before signing

1. <Specific term to push — e.g. "Cap year-2 increase at 5%">
2. <Specific term — e.g. "30-day no-fault termination in year 1">
3. <Specific term — e.g. "Free seat for finance/ops admin user">

## Approval flow

1. <Approver 1 — role — by when>
2. <Approver 2 — role — by when>
3. <Final signer — role>

## Attached
- Quote PDFs from each vendor
- Reference call notes (if applicable)
- Security questionnaire responses
- Comparison detail (link to full vendor-comparison)
```

## Rules

- **Multi-option, not single-vendor.** Single-vendor requests get bounced.
- **TCO not sticker price.** Procurement KNOWS the hidden costs and will challenge a missing breakdown.
- **Business justification ties to a real goal.** "We need this" is not a justification; "this saves 200 sales hours per quarter, recovering ~$X in capacity" is.
- **Suggest the approver** based on amount band — most companies have spend thresholds.
- **Risks are honest.** Pretending there are no risks reads as immature.

## Pitfalls

- Missing the "options evaluated" — looks like a back-pocket vendor deal.
- Lowballing TCO to get under an approval threshold — gets caught at renewal.
- Forgetting the negotiation list — procurement does this work twice as well with a starting list.
- Vague "this will improve productivity" justifications — quantify or drop the claim.
- Listing risks without mitigations — reads as scaremongering rather than rigor.
