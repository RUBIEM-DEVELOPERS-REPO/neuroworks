---
name: fact-check
description: Verifying a specific claim against the web — gather supporting AND opposing evidence, weigh sources, return a verdict.
applies_to: [research, verify]
---

# Skill: Fact-check

## Goal

Given a claim, determine whether the evidence supports it, partially supports it, contests it, or refutes it. Show the work — the customer should see both sides, not just your conclusion.

## Process

1. **State the claim precisely.** Reframe it as a single sentence with no weasel words. If the original was vague ("AI agents are taking over"), pin it down ("By end of 2025, AI agents replace at least 30% of customer-support roles in tech companies") — and tell the customer that's what you're checking.
2. **Run TWO searches in parallel.**
   - Supporting: the claim phrased as a fact (`"AI agents replace customer support 2025"`).
   - Opposing: the claim negated or with debunk words (`"AI customer support hype overstated"`, `"agent adoption slow 2025"`).
3. **Fetch the top 2-3 sources from each side.** Use `smartFetch` for live content; never quote a search snippet without opening the page.
4. **Weight sources by credibility.** Primary > academic > major outlet > trade press > blog > forum. A single primary source can outweigh five secondary ones.
5. **Look for the specific number / claim, not topic-adjacent prose.** "AI is changing support" doesn't support "AI replaces 30% of support roles".
6. **Issue a verdict.**

## Verdict scale

| Verdict | When to use |
|---|---|
| **Supported** | Multiple credible sources affirm the claim with specific evidence |
| **Partially supported** | The general direction is right but the magnitude / scope is overstated |
| **Contested** | Credible sources on both sides; the field hasn't settled |
| **Unsupported** | No credible source affirms the specific claim |
| **Refuted** | Credible sources directly contradict the claim |

## Output shape

```
**Claim (as checked):** <precise restatement>

**Verdict:** <Supported / Partially supported / Contested / Unsupported / Refuted>

**Evidence in favor:**
- <Specific point + source [1]>
- <Specific point + source [2]>

**Evidence against:**
- <Specific point + source [3]>
- <Specific point + source [4]>

**What the strongest counter-argument is:** <one sentence>

**Sources:**
1. [Title — outlet, date](url)
2. ...
```

## Rules

- **Verdict before evidence.** The customer's eye lands on the verdict; show your work after.
- **Quote, don't paraphrase.** A 10-word direct quote with attribution is worth a paragraph of paraphrase.
- **Don't fold ambiguity into "supported".** "Partially supported" exists for a reason — use it.
- **Note recency.** A 2019 source about 2025 predictions is not the same as a 2025 source.
- **Refuse impossible claims gracefully.** Predictions about the future ("AI will replace 50% of jobs by 2030") can't be fact-checked — only assessed for plausibility. Say so.

## Pitfalls

- Sourcing both sides from the same outlet → looks like balance, isn't.
- Quoting an opinion piece as evidence for a factual claim.
- Hedging the verdict to avoid offending the asker — be honest; the customer asked because they want truth.
- Forgetting to actually read the page (`web.scrape` → snippet only) and miscopying the headline as the claim.
