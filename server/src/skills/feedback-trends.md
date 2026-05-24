---
name: feedback-trends
description: Analyse customer feedback (surveys, NPS, reviews, sales call notes) — sentiment, recurring themes, product implications.
applies_to: [analyze, summarize]
---

# Skill: Customer feedback trends

## Goal

Product / leadership reads ONE page and sees: what customers love, what's hurting, what's emerging, and what to actually do about it.

## Process

1. **Sample, don't analyse all.** With more than ~50 pieces of feedback, work from a stratified sample (recent + by tier + by source) rather than treating every line as data.
2. **Tag each piece of feedback with sentiment + theme + intensity.** Sentiment: positive / negative / neutral. Theme: a short noun phrase ("onboarding friction", "Slack integration", "pricing"). Intensity: 1-5 based on language strength.
3. **Cluster themes — combine near-duplicates.** "Onboarding is confusing" and "I didn't know what to do after signup" are one theme.
4. **Rank themes by frequency × intensity.** Single-mention high-intensity feedback flags emerging issues; high-frequency low-intensity is the steady churn risk.
5. **Cross-check against product roadmap.** Themes that are already being shipped get noted; themes that aren't are the real signal.
6. **Distinguish "venting" from "feature request" from "deal-killer".** Each routes differently.

## Output shape

```
## Customer feedback trends — <Period> · <N items, M sources>

**Sources:** <e.g. "NPS Q1 survey (n=312), Intercom Q1 reviews (n=42), sales-call notes (n=18)">

## Headline

<2-3 sentences. The single most important shift this period — positive or negative. The thing the exec who only reads the first paragraph needs to know.>

## Sentiment shift

| Period | Positive | Negative | Neutral | NPS |
|---|---|---|---|---|
| Last period | X% | X% | X% | XX |
| This period | X% | X% | X% | XX |
| Δ | ±X | ±X | ±X | ±X |

## Top themes — what customers love

1. **<Theme>** — mentioned ~N times. Example: "<quote>"
2. **<Theme>** — ...

## Top themes — what's hurting

1. **<Theme>** — mentioned ~N times, intensity ~X/5. Example: "<quote>". *<Roadmap status: in flight / not planned / shipped Q2>*
2. **<Theme>** — ...

## Emerging signals (low volume, high intensity)

- **<Theme>** — N mentions but worth watching because <reason>. Example: "<quote>"

## Product implications

| Theme | What customers want | Suggested response |
|---|---|---|
| <Theme> | <In their words> | <Ship X / write doc Y / change pricing Z / acknowledge in next release notes> |

## Quotes worth pinning

> "<Powerful quote — concise, representative, attributable to tier/segment if useful>"

> "<Another>"

## Caveats

- Sample skewed toward <segment> — adjust if <other-segment> matters more.
- N items isn't statistically significant for <theme> — treat as anecdotal until next period.
```

## Rules

- **Sentiment + theme + intensity — all three.** Sentiment alone hides which themes carry the weight.
- **Cross-check against roadmap.** A theme that's already being shipped is reassurance, not a call to action.
- **Quote, don't paraphrase the powerful lines.** Specifics beat summaries — quotes are what land in a board deck.
- **Distinguish venting from requests.** Venting needs acknowledgement, not a feature ticket.
- **Surface what's MISSING** too — themes customers AREN'T raising that you'd expect (e.g. "no one's complaining about pricing" is data).

## Pitfalls

- Weighting recent high-emotion feedback (post-outage, post-launch) as if it's the new normal.
- Counting feedback from competitor's plants / abuse / off-topic — clean the data first.
- Reporting NPS without distribution — a 50 NPS with 60% promoters + 10% detractors is healthier than 50 NPS with 70% promoters + 20% detractors.
- Acting on emerging signals before they cluster — false-positive risk.
- Generic "improve UX" recommendations — name the SPECIFIC change.
