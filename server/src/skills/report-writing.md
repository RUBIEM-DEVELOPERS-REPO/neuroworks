---
name: report-writing
description: Multi-section professional report — executive summary, body sections, recommendations. Use when the customer needs more than a brief but less than a whitepaper.
applies_to: [draft-report]
---

# Skill: Report writing

## Goal

A report is read top-to-bottom by an exec who skims the first 200 words, and bottom-to-top by their analyst who reads everything. Both should land on the same conclusion.

## Structure

```
# <Title — concrete subject + period, e.g. "Q3 Pipeline Review">

**Author:** <name> · **Date:** <YYYY-MM-DD> · **Audience:** <who this is for>

## Executive summary
<3-5 sentences. The whole story. Numbers, not adjectives. End with the recommendation, italicised.>

## Background
<Why we wrote this. What question prompted it. What's at stake.>

## Findings
### Finding 1: <headline that's a full sentence>
<Evidence in paragraph form. Cite specific numbers, sources, quotes. 1-3 paragraphs.>

### Finding 2: <…>
<…>

## Analysis
<What the findings mean together. Trade-offs. Surprises. Cross-cutting themes.>

## Recommendations
1. <Specific action — owner — by when>
2. <…>

## Open questions / risks
- <Question we couldn't answer with current data>
- <Risk that could invalidate the conclusion>

## Appendix
<Raw data tables, source list, methodology notes. Skippable.>
```

## Rules

- **Findings are headlines, not categories.** "Revenue grew 12% on enterprise expansion" beats "Revenue".
- **Every number has a source.** Either inline `(source: Q3 OKR sheet, row 14)` or numbered citations to an appendix.
- **Recommendations have owners.** A recommendation without a name attached is a wish list, not a plan.
- **Length cap.** 800-1500 words for the main body. Appendix can be longer; the body cannot.
- **Markdown structure is part of the deliverable.** Bosses skim by header — make headers do the skimming for them.

## Tone

Declarative. Past tense for findings ("Q3 conversion fell 4 points"), present for analysis ("the slowdown reflects pricing pressure"), imperative for recommendations ("Cut the trial gate to 14 days by Nov 15").

## Pitfalls

- Hedging language in the exec summary ("appears to suggest", "may indicate") → say what you think.
- Burying the recommendation in the analysis section → put it in its own section.
- Listing 12 recommendations → cut to 3-5; otherwise the reader does the cutting and picks wrong.
- No "open questions" section → makes the report look more certain than it is.
