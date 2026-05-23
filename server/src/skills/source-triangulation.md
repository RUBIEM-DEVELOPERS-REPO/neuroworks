---
name: source-triangulation
description: Cross-verify a claim across three or more independent sources before treating it as fact. Use whenever a single source could be wrong, biased, or stale.
applies_to: [research, verify, analyze]
---

# Skill: Source triangulation

## Goal

Treat NO claim as fact until three independent sources agree on it. When sources diverge, surface the divergence — don't paper over.

## When this skill fires

- The task asks you to verify a specific claim, number, or event.
- You're building on a single source you found via search (one source = one perspective).
- The topic is contested (politics, market predictions, valuations, "who invented X").
- The customer plans to act on the answer (pricing, hiring, strategy decisions).

## Process

1. **State the claim atomically.** One sentence, one fact. "Stripe processes $1 trillion in payments annually" not "Stripe is doing well".
2. **Find THREE independent sources via `web.search`.** Independent means:
   - Different publishers (not three blogs all citing the same Bloomberg article)
   - Different evidence type ideal (primary doc + analyst + journalism beats three analysts)
   - Different dates ideal (don't let all sources be from a single news cycle)
3. **Fetch each via `smartFetch`** and pull the EXACT sentence supporting the claim. A summary or paraphrase doesn't count.
4. **Compare.** Note where sources agree, where they hedge, where they disagree.
5. **Issue a confidence verdict.**

## Confidence verdicts

| Verdict | When |
|---|---|
| **Confirmed** | ≥3 independent sources agree, ≥1 is primary |
| **Likely true** | ≥3 sources agree but all secondary / no primary found |
| **Disputed** | Sources disagree on the specific claim — surface both |
| **Single-source** | Only one source supports it — flag as needing verification |
| **Unsupported** | No source found |

## Output shape

```
**Claim:** <one atomic sentence>

**Verdict:** <Confirmed / Likely true / Disputed / Single-source / Unsupported>

**Evidence:**
- [1] **Primary** — <Source name, date>: <Direct quote>
- [2] **Secondary** — <Source name, date>: <Direct quote>
- [3] **Tertiary** — <Source name, date>: <Direct quote or paraphrase>

**Where sources agree:** <One sentence>

**Where sources diverge:** <One sentence — what disagrees and why it might>

**What would strengthen the verdict:** <Specific source you wish you had>

**Sources:**
1. [Title — outlet, date](url) *(primary)*
2. [Title — outlet, date](url) *(major outlet)*
3. [Title — outlet, date](url) *(trade press)*
```

## Rules

- **A press release cited by 5 outlets = ONE source.** Wire stories don't multiply.
- **The subject's own marketing page is a primary source for what they CLAIM, not for whether the claim is true.** Stripe's "we process $1T" claim from stripe.com is primary evidence of the claim, not proof of the claim.
- **Tag each source's tier.** Primary, secondary, tertiary — reader needs to weigh them.
- **Quote, don't paraphrase, the supporting sentence.** A paraphrase hides whether the source actually said the thing.
- **A single-source claim is NEVER "confirmed".** Always flag it as "single-source — verify before acting".

## Pitfalls

- Counting two articles that both quote the same press release as two sources.
- Counting a company's own pricing page as multiple sources because they repeat the number on different pages.
- Treating consensus among biased sources as confirmation (three crypto blogs agreeing on a crypto claim isn't triangulation).
- Skipping the "where sources diverge" line — readers want to see the friction, not just the conclusion.
- Cherry-picking the one source that agrees with your prior — list the disagreers too.
