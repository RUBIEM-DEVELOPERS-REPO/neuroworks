---
name: landscape-scan
description: Fast read of who's in a market / category — players, segments, recent moves — when the customer needs orientation, not a deep competitive teardown.
applies_to: [research, analyze]
---

# Skill: Landscape scan

## Goal

In 250-400 words, answer "who's playing in this market, what are they doing, where's the action?" — enough orientation for the customer to know who to look at next.

## When this skill fires

- "What's the landscape for X?"
- "Who's playing in X?"
- "What are the main approaches to X?"
- "Map the market for X"
- "Who are the real competitors for X?" (when this is a scan, not a full competitive analysis)

A landscape scan is LIGHTER than `competitive-analysis` — fewer dimensions, no recommendations, no comparison matrix. Use full competitive-analysis when the customer needs to make a positioning decision.

## Process

1. **Define the market boundary in one sentence.** "The market for AI agents that solo founders use to run their business" beats "AI agents". Vague boundaries produce useless scans.
2. **Run `web.search` for the category name + "landscape" / "comparison" / "competitors".** Read a recent landscape post or category overview to anchor your search.
3. **Search again for the 3-5 leading players directly** to confirm they're real, current, and positioned how the landscape post describes them.
4. **For each player, fetch their landing page (`smartFetch`) to grab their literal positioning** — quote them, don't summarise them.
5. **Spot recent moves.** New funding, new product, acquisition, departure of a key person. Skim recent news for each player.
6. **Identify the white space** — what's NOT being served, or being served poorly.

## Output shape

```
# Landscape: <market — narrowed to a specific segment>

**Scanned:** <YYYY-MM-DD> · **Sources:** <count>

## Market boundary
<One sentence defining the segment you scanned.>

## Players

### Established
- **<Name>** — "<their own positioning, quoted>" [1]. Founded YEAR. Recent: <one-line>. [2]
- **<Name>** — ...

### Newer / fast-moving
- **<Name>** — "<positioning>" [3]. Recent: <funding / launch / hire>. [4]

### Adjacent / substitute
- **<Name>** — <one-line on why they sometimes win this buyer instead>

## Segmentation
<2-3 sentences on how the market is sliced — by buyer size, by use case, by deployment model, by price band. Name the slice that's most relevant to the customer.>

## Recent moves
- <Event — date — source> [5]
- <Event — date — source> [6]

## White space / what's missing
- <Capability or segment no one's serving well — and one-line on why>
- <...>

## What to dig into next
- <Specific player or angle that warrants a full competitive analysis>

## Sources
1. [Title — outlet, date](url)
2. ...
```

## Rules

- **Maximum 5-7 players named.** A scan is orientation; if you can't pick the 5 that matter, you don't understand the market well enough yet.
- **Quote positioning verbatim from each player's site.** Their words, not yours.
- **Date every claim about recent moves.** "Recent" is meaningless without a date.
- **End with "what to dig into next".** A scan that doesn't tell the customer where to look next is half-done.
- **No recommendations on what WE should do.** Recommendations belong in a competitive analysis or strategy memo, not a scan.

## Pitfalls

- Listing 15 players because you found them — pick the 5 that drive the market.
- Using your training-data memory of the market instead of fresh search — markets shift; players you remember may have pivoted, been acquired, or shut down.
- Inventing segmentation that the market doesn't actually use.
- Mistaking adjacent players for direct ones (every "AI" company isn't a competitor to every other "AI" company).
- Skipping the white-space section — that's often the most useful part of the scan.
