---
name: contract-summary
description: Plain-English summary of a contract / agreement / ToS — parties, term, money, key obligations, risk clauses. NOT legal advice; flags issues for a lawyer.
applies_to: [summarize, read-doc]
---

# Skill: Contract summary

## Goal

The customer has a contract, ToS, NDA, employment offer, or vendor agreement. They want to know what's in it in plain English, what they're agreeing to, and which clauses are unusual enough to flag. **This is not legal advice — it's a reading aid. Always recommend a lawyer for actual review of anything material.**

## Process

1. **Read the whole doc end-to-end.** Contracts hide important terms in clause 17 of 23. Skim once for structure, then read carefully for substance.
2. **Identify the doc type.** Service agreement, NDA, employment contract, SaaS ToS, lease, NDA, etc. Each has standard clauses you'd expect to see; missing ones are notable.
3. **Extract the deal terms in order of "what matters to the customer".** Money, term, obligations, exit, risk allocation.
4. **Flag deviations from typical terms.** "Unusual" is relative to that contract type — a 5-year non-compete is unusual in tech but standard in some industries.
5. **Identify what's NOT in the contract that you'd expect.** Missing termination clause? Missing limitation of liability? Both are notable.

## Output shape

```
# Contract summary: <Type> — <Parties>

**⚠ This is a reading aid, not legal advice. Have a lawyer review anything material.**

## Snapshot
- **Type:** <Service agreement / NDA / Employment offer / SaaS ToS / etc.>
- **Parties:** <Party A> and <Party B>
- **Effective date:** <date or "on signature">
- **Term:** <length + renewal behavior>
- **Money:** <fees, rates, payment terms, late fees>

## What you're agreeing to do
- <Obligation 1 — clause #>
- <Obligation 2 — clause #>

## What the other party is agreeing to do
- <Their obligation 1 — clause #>
- <Their obligation 2 — clause #>

## Exit / termination
- <How either party can terminate>
- <Notice period>
- <What happens to <data / payments / IP> on termination>

## Risk allocation
- **Liability cap:** <amount or "uncapped"> — typical: ~12 months fees
- **Indemnification:** <who indemnifies whom for what>
- **Insurance requirements:** <yes/no, what>
- **Governing law / venue:** <jurisdiction>

## Clauses worth flagging
- **<Clause name, clause #>:** <plain-English explanation. Why it stands out — unusual breadth, one-sided, ambiguous wording.>
- **<Clause name, clause #>:** <...>

## What's missing that I'd expect
- <e.g. "No limitation of liability cap on Party A's exposure">
- <e.g. "No data deletion clause for a SaaS agreement">

## Open questions for the customer / lawyer
- <"The non-compete (cl. 12) restricts you for 24 months — confirm this is acceptable">
- <"Section 4.2 references Schedule B, which isn't attached — request it">
- <"The IP assignment in cl. 8 covers work done outside business hours — uncommon, worth challenging">

## Sources within the doc
- All clause numbers cited above refer to the document as provided.
```

## Things to always flag (across contract types)

| Clause | Why to flag |
|---|---|
| Auto-renewal | Often hidden; the cancellation window can be 30-90 days BEFORE renewal |
| Liability cap | Uncapped or very low caps are both notable |
| IP assignment | Especially in employment / consulting — scope matters |
| Non-compete / non-solicit | Length, geography, scope — many are unenforceable but still chilling |
| Termination for convenience | Asymmetric (only one party can do it) is often unfair |
| Governing law in an unusual jurisdiction | Adds cost to any dispute |
| "Most favoured nation" clauses | Cap your pricing flexibility with others |
| Audit rights | Especially broad ones |
| Confidentiality with no time limit | "In perpetuity" NDAs are atypical and over-broad |
| Force majeure exclusions | "Does not include pandemics" was a 2020-era surprise |
| Indemnification scope | "Anything that touches the work" is too broad |
| Choice of law + arbitration combos | May effectively foreclose litigation |

## Rules

- **Plain English over legalese.** "Indemnify and hold harmless" → "pay for any lawsuits they face because of what you did".
- **Cite the clause number** for every claim. The customer's lawyer will reference back.
- **Don't editorialise.** "This clause is bad" → "This clause is broader than typical because <X>". Let the customer + lawyer decide.
- **Don't replace a lawyer.** Always recommend legal review for anything material. State it clearly at the top.
- **Quote when ambiguity matters.** A clause's exact wording is sometimes the whole point — don't paraphrase the contested parts.

## Pitfalls

- Summarising the "boilerplate" and skipping the clauses that actually allocate risk.
- Treating familiar SaaS ToS as standard everywhere — they vary substantially across vendors.
- "Looks fine to me" — even when it does, the customer needs the summary AS the artifact, not your verdict.
- Hallucinating clause numbers — verify by re-reading.
- Missing schedules / exhibits — flag them as missing; don't assume.
