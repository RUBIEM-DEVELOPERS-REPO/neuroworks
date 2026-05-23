---
name: benchmark-lookup
description: Find an industry / market benchmark on the web, ground each number in a dated source, present as a table with a clear takeaway.
applies_to: [research, analyze]
---

# Skill: Benchmark lookup

## Goal

Answer a "what's typical" / "what's industry standard" / "what's best in class" question with NUMBERS that come from named, dated sources — not from your training memory.

## When this skill fires

Any task that uses any of these phrasings is a benchmark lookup:
- "What's the industry benchmark for X?"
- "What do typical / best-in-class companies do for X?"
- "What are the standard ranges for X?"
- "Compare our X against the market"
- "Where should our X sit?"

Your training knowledge of these numbers is almost certainly stale. Web FIRST.

## Process

1. **Pin the metric.** Don't answer "what's the benchmark" without first writing down: which metric, which segment (B2B SaaS / B2C / enterprise / SMB / specific vertical), which company size band, which time period. Vague benchmarks are useless.
2. **Search for the named report.** Industry benchmarks usually come from a small set of recurring sources — go directly:
   - **SaaS metrics:** OpenView SaaS Benchmarks, SaaStr State of SaaS, KeyBanc SaaS Survey, Bessemer State of the Cloud
   - **Engineering:** Stack Overflow Developer Survey, DORA State of DevOps, JetBrains State of Developer Ecosystem
   - **Compensation:** Levels.fyi, Glassdoor, Robert Half salary guides
   - **Marketing:** HubSpot Marketing Statistics, MarketingProfs, Content Marketing Institute
   - **Sales:** Gong State of Sales, Salesloft, Outreach benchmark reports
   - **Customer success:** Gainsight, ChurnZero benchmark reports
3. **Fetch the report directly via `smartFetch`.** Don't quote a TechCrunch summary of the report; fetch the report itself.
4. **Pull the specific table or chart that addresses the question.** Quote the number AND the exact bucket it applies to (e.g. "NDR for $10-50M ARR SaaS: 110-120% [1, Table 4]").
5. **Triangulate where the number matters.** If the benchmark drives a decision, get TWO sources from different reports. A single 2022 report cited in 2026 is shaky.

## Output shape

```
**Benchmark question:** <precise — metric, segment, size band, period>

**TL;DR:** <one sentence — the median + the relevant range + the source>

## Numbers

| Segment | <Metric> | Source | As of |
|---|---|---|---|
| Best-in-class | X% | [1] OpenView 2024 | 2024-Q4 |
| Median | Y% | [1] | 2024-Q4 |
| Bottom quartile | Z% | [1] | 2024-Q4 |
| (Different cohort) | A% | [2] KeyBanc 2024 | 2024-Q3 |

## How to interpret
<2-4 sentences. What drives the variance, what the customer should pay attention to, where the benchmark is most/least applicable to their case.>

## Caveats
- <Source dated 2024 — assume +/- on the absolute level for 2026>
- <Sample skewed toward <segment> — adjust if you're <other segment>>
- <Different methodology between [1] and [2] explains the gap>

## Sources
1. [Title — outlet, date](url) — <one-line on methodology / sample size>
2. [Title — outlet, date](url) — <one-line>
```

## Rules

- **Every number cites a source AND a date.** "Median NDR is ~110%" without [N] and a year is useless.
- **Name the report by title and publisher.** "OpenView 2024 SaaS Benchmarks" beats "industry data". Reader needs to judge credibility without clicking.
- **State the cohort.** "$10-50M ARR B2B SaaS" beats "SaaS companies". Benchmarks vary 2-3× across cohorts.
- **Two sources for any number that drives a decision.** One report can be wrong / biased / methodologically odd.
- **Caveats are mandatory.** Most benchmarks come with sampling/methodology gotchas. Surface them; don't hide them.

## Pitfalls

- Quoting a 2021 benchmark in 2026 without flagging the gap.
- Citing a vendor's marketing page as a benchmark (their numbers are best-case examples, not population data).
- Conflating cohorts ("SaaS NDR is 110%" — for which size band? PLG or sales-led? Net of what?).
- Citing your training-data memory and dressing it up as "industry standard" — the failure mode this skill exists to prevent.
- Giving one number when the customer needs a range. Benchmarks are distributions, not points.
