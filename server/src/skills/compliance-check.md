---
name: compliance-check
description: Scan a document for compliance risks and surface items that need legal or manager approval before it ships.
applies_to: [review, analyze]
---

# Skill: Compliance check

## Goal

The reviewer reads ONE page, knows which clauses / sentences are red-flag, why, and who needs to sign off — without needing to be a lawyer.

## Process

1. **Identify the doc type first** — contract, marketing claim, customer-facing data-handling statement, privacy policy, HR policy, public communication. Different doc types have different risk catalogs.
2. **Run through the doc-type's standard risk catalog.** Examples:
   - **Marketing claims:** unsubstantiated superlatives ("the fastest"), competitor disparagement, regulatory claims (HIPAA / GDPR / SOC2 without proof), affiliate disclosure gaps.
   - **Contracts:** auto-renewal terms, liability caps, IP assignment, MFN clauses, exclusivity, governing law.
   - **Customer comms:** uptime / SLA promises, refund commitments, data-handling claims, security claims.
   - **HR docs:** protected-class language, at-will overrides, classification (1099 vs W2) signals.
3. **For each finding, classify severity** — HIGH (don't ship without legal sign-off), MEDIUM (manager approval + flag for legal review), LOW (note + ship).
4. **Quote the exact text** that triggered the flag. Reviewer needs to find it in seconds.
5. **Suggest a safer rewrite** for LOW and MEDIUM findings. HIGH findings get "stop and route to legal" instead of a quick rewrite.

## Output shape

```
## Compliance review — <Doc title> · <YYYY-MM-DD>

**Doc type:** <contract / marketing / customer comm / HR policy / privacy policy>

**Verdict:** <SHIP AS IS / SHIP WITH EDITS / DO NOT SHIP WITHOUT APPROVAL>

**Summary:** <One sentence: total flags by severity, who needs to sign off.>

## HIGH severity — needs legal sign-off

### Finding 1 — <one-line headline>
- **Quote:** "<exact text from the doc>" (section / line N)
- **Why:** <Plain-English reason — what regulation / risk this triggers>
- **Action:** Route to <legal / GC / outside counsel> before ship

### Finding 2 — ...

## MEDIUM severity — needs manager approval

### Finding 1 — <headline>
- **Quote:** "<text>" (section N)
- **Why:** <reason>
- **Suggested rewrite:** "<safer phrasing>"
- **Approver:** <Role>

## LOW severity — note + ship

- "<Quote>" → Suggest: "<rewrite>". Reason: <one line>.
- "<Quote>" → Suggest: "<rewrite>". Reason: <one line>.

## What I couldn't assess
- <Topic that needs a real lawyer, e.g. "Whether this triggers GDPR Article 22 — depends on jurisdiction of customer's users">
- <Topic that needs more context, e.g. "Whether 'SOC2 compliant' claim is accurate — needs ISO confirmation">

**Standard reminder:** This is a compliance triage, not legal advice. HIGH findings require qualified counsel review.
```

## Rules

- **Always include the "not legal advice" reminder.** Treat this like the legal persona's caveat.
- **Severity is conservative.** When in doubt, escalate one tier — wrong-direction errors are unrecoverable (shipped → harm done).
- **Quote, don't paraphrase, the flagged text.** Reviewer must verify in the source.
- **Suggest rewrites only when you're confident.** A bad rewrite is worse than a flag asking for legal review.
- **Name the approver role** — "manager" is too vague; "the legal counsel reviewing customer-facing claims" is actionable.

## Pitfalls

- Marking everything HIGH so legal becomes a rubber stamp — calibrated severity is the value.
- Suggesting rewrites that change the underlying meaning rather than fixing the legal risk.
- Missing implicit claims (a screenshot or graph can be a marketing claim too).
- Forgetting to capture what's MISSING — required disclosures, governing-law clauses, sunset provisions.
- Treating "industry standard" as a defense; it isn't.
