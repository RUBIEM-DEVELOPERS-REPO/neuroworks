---
name: primary-source-check
description: Prefer primary sources over secondary coverage — go to the pricing page, the docs, the changelog, the regulatory filing, the paper itself.
applies_to: [research, verify, analyze]
---

# Skill: Primary source check

## Goal

Replace "according to a blog summary of a TechCrunch summary of the press release" with "according to the press release" — or better, "according to the SEC filing".

## When this skill fires

Any task where the customer cares about the EXACT facts, not the prevailing narrative:
- Pricing, terms, SLA, compliance claims
- Technical capabilities ("does product X support Y?")
- Financial / valuation / funding facts
- Regulatory / legal / compliance status
- Quotes attributed to a person ("did Sam Altman actually say…")
- Statistics from a named report

## The source hierarchy

```
┌───────────────────────────────────────────────────┐
│ TIER 1 — PRIMARY                                  │
│  • Subject's own page (pricing, docs, changelog)  │
│  • Regulatory filing (SEC 10-K, court records)    │
│  • Peer-reviewed paper / preprint                 │
│  • Official transcript / video of the source      │
│  • The actual contract / API spec / RFC           │
├───────────────────────────────────────────────────┤
│ TIER 2 — STRONG SECONDARY                         │
│  • Major outlet reporting WITH direct quotes      │
│  • Analyst report from a named firm               │
│  • Conference talk video / slides                 │
│  • Verified social post from the subject          │
├───────────────────────────────────────────────────┤
│ TIER 3 — WEAK SECONDARY                           │
│  • Trade press summary without direct quotes      │
│  • Wikipedia (good for orientation, not citation) │
│  • Aggregator pages (Crunchbase profile pages)    │
├───────────────────────────────────────────────────┤
│ TIER 4 — DO NOT CITE                              │
│  • Blogspam / SEO content farms                   │
│  • LLM-generated content presented as journalism  │
│  • Quora / Reddit answers without sourced links   │
│  • PR placements ("sponsored content")            │
└───────────────────────────────────────────────────┘
```

## Process

1. **Identify the primary source for the claim.** For pricing → the pricing page. For "X supports Y" → X's docs. For "X said Y" → the video / transcript. For "X raised $N" → the company's press release OR the filed Form D.
2. **Fetch the primary source via `smartFetch`.** If anti-bot blocks you, fall back to a major-outlet quote, but flag that you couldn't reach primary.
3. **Quote directly.** Primary-source quotes carry far more weight than paraphrase. 10 quoted words beat a paragraph of paraphrase.
4. **Date the primary source.** Pricing pages change; docs evolve. "stripe.com/pricing accessed 2026-05-23" beats "Stripe's pricing".
5. **Use secondary sources only to corroborate or to provide context the primary doesn't have.** Never use them as the headline citation when a primary exists.

## Output shape

When the answer is a single claim:

```
**Claim:** <one sentence>

**Primary source:** [Title — outlet, date](url) *(tier 1)*
> "<direct quote from the primary source — 10-40 words>"

**Secondary corroboration:** [Title — outlet, date](url) *(tier 2)*

**Why this matters:** <one sentence on what the primary lets you say that secondary doesn't>
```

When the answer is a report:

```
Use [N] inline citations. For each [N], tag the tier in the Sources block:
1. [Title — outlet, date](url) *(tier 1 — primary)*
2. [Title — outlet, date](url) *(tier 2 — major outlet)*
```

## Rules

- **Tier-tag every source** in the Sources block. Reader can't weigh sources they can't classify.
- **When you can reach a primary, you must.** If you fall back to tier 2 because tier 1 was blocked, say so: "(Stripe's pricing page returned 403; data via TechCrunch coverage [2])".
- **Quote the primary directly.** Never paraphrase a quote-able primary source — paraphrase is where claims drift.
- **Don't cite Wikipedia as the headline source for a factual claim.** Use it to find the primary, then cite the primary.
- **Blog posts are tier 3 — never the headline source for pricing, technical capabilities, or compliance claims.**

## Pitfalls

- Citing a tweet that quotes a press release that summarises a filing — go to the filing.
- Treating a major outlet's summary as primary because the outlet is reputable. Reputable outlets paraphrase too.
- Citing the company's marketing page as proof of a marketing claim ("we're the leader" — sourced to their site that says they're the leader — circular).
- Forgetting to date the primary. A pricing page is a snapshot, not a permanent fact.
- Falling back to secondary without flagging it — readers should know when you couldn't reach tier 1.
