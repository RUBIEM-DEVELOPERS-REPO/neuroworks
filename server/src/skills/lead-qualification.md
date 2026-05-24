---
name: lead-qualification
description: Score a lead — fit, intent, urgency — and recommend the next action. Lighter than MEDDIC, used at top of funnel.
applies_to: [analyze, draft-other, summarize]
---

# Skill: Lead qualification

## Goal

Sales rep reads a one-pager, knows whether this lead is worth a discovery call NOW, later, or never, with the reasoning explicit.

## When this fires (vs `meddic-qualification`)

- **lead-qualification** — top of funnel, pre-discovery. Quick fit + intent + urgency. "Should I call this person?"
- **meddic-qualification** — post-discovery. Deep deal qualification with champion, economic buyer, etc.

## Process

1. **Score FIT** — does the customer match our ICP? Company size, industry, geography, current tech stack. Bucket: HIGH / MEDIUM / LOW / NOT FIT.
2. **Score INTENT** — what signals show they're actively looking? Recent download, demo request, pricing-page visit, hand-raise on a webinar. Bucket: HOT / WARM / COLD.
3. **Score URGENCY** — is there a trigger event? Funding round, exec hire, public commitment, regulatory deadline. Bucket: URGENT (this quarter) / NEAR (next quarter) / LATER / NONE.
4. **Surface OBJECTIONS** you can anticipate from the lead's context — competitor on file, prior failed evaluation, budget constraints visible in news.
5. **Recommend ONE next action.** Discovery call now / nurture sequence / disqualify / hand to partner.

## Output shape

```
## Lead — <Name>, <Title>, <Company>

**Score:** Fit <H/M/L>, Intent <H/W/C>, Urgency <U/N/L/None>
**Recommended next action:** <Discovery call / Nurture / Disqualify / Hand to partner>

## Fit (vs ICP)

- **Company size:** <N employees / $X ARR if known> — <matches / doesn't match ICP band>
- **Industry:** <vertical> — <core / adjacent / not our space>
- **Geography:** <country / region> — <supported / not yet>
- **Tech stack signals:** <e.g. "Uses Salesforce, Slack, Snowflake — full data stack — strong fit">
- **Verdict:** <one sentence on fit overall>

## Intent

- **Source:** <Where did this lead come from — inbound form, event, cold outreach response>
- **Signals:** <recent demo request, pricing page visits N times, downloaded X whitepaper>
- **Verdict:** <Hot / Warm / Cold + one-line reason>

## Urgency / trigger event

- <Specific event in the last 90 days — funding, key hire, public commitment, regulatory deadline>
- <... or "no visible trigger — nurture territory">

## Anticipated objections

- "<Likely objection>" — <how to address> — <source for the assumption>
- "<Likely objection>" — <how to address>

## Next step

**Recommended:** <Discovery call within <window> / Send <specific content> / Add to <nurture campaign> / Disqualify with note "<reason>">

**Talk track for first contact:**
> "<One-sentence opener that ties to their trigger event or stated interest>"

**What to prep before the call:**
- [ ] <Specific page, doc, or demo to prepare>
- [ ] <Question to research>

## What we don't know

- <Specific data we'd want before deeper qualification — budget cycle, internal champion, current vendor>
- <... — fold these into the discovery call agenda>
```

## Rules

- **Three scores, three buckets each.** Anything more granular (1-10 scales) loses calibration.
- **Recommendation is binary-feeling.** Discovery call NOW vs nurture vs disqualify — don't hedge.
- **Trigger event matters more than fit alone.** A perfect-fit lead with no trigger nurtures; an imperfect-fit lead with a regulatory deadline closes.
- **Cite the signal.** "Hot intent" needs a source ("downloaded pricing PDF, then submitted demo form").
- **Always surface what's missing** — first call is where you fill the gaps, not where you pretend you have them filled.

## Pitfalls

- Promoting "warm" to "hot" because the rep wants to call — calibration is the value.
- Disqualifying based on company size without checking parent / subsidiary structure.
- Missing the urgency from a lead's public news (funding, key hire) — those are gold.
- Building the talk track around what we sell instead of the lead's trigger.
- Skipping the objections — first call goes sideways when you walk in blind.
