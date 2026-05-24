---
name: cv-screening
description: Score CVs against a JD — ranked shortlist with reasons FOR and concerns AGAINST, plus what to dig into at the screen.
applies_to: [review, analyze]
---

# Skill: CV screening

## Goal

The hiring manager opens this report and knows in 60 seconds which 3 candidates to screen first and which to skip — with reasons that survive an EEO audit.

## Process

1. **Pull the JD's MUST-HAVES vs NICE-TO-HAVES.** If the JD doesn't separate them, infer from the "required" vs "preferred" section. Three must-haves max — more than that and you're not actually screening.
2. **For each CV, score on the must-haves first.** Missing a must-have → automatic "not fit"; surface it explicitly.
3. **For candidates that pass must-haves, weigh nice-to-haves + signals.** Years at level, scope of past work, leadership signals, industry overlap.
4. **Note red flags neutrally.** "Switched jobs every 12 months" is data, not a judgment — let the hiring manager weigh it.
5. **Recommend one of: SCREEN / MAYBE / PASS.** Default to MAYBE only when truly on the fence.

## Output shape

```
## CV screening — <Role> · <Date>

**Must-haves (from JD):**
1. <Must-have 1>
2. <Must-have 2>
3. <Must-have 3>

## Ranked shortlist

### 1. <Candidate name> — **SCREEN**
- **Why screen first:** <One sentence on the strongest signal>
- **Must-haves met:** ✓✓✓ (all three)
- **Standout signals:** <2-3 bullets — past role scope, named companies, public artifacts>
- **Concerns to probe:** <1-2 questions to ask at the screen>
- **Red flags (neutral):** <e.g. 14-month average tenure, 2024 layoff>

### 2. <Candidate name> — **SCREEN**
<...>

### 3. <Candidate name> — **MAYBE**
- **Why on the fence:** <one sentence>
- **Must-haves met:** ✓✓✗ (missing <which>)
- **Standout signals:** <bullets>
- **Concerns to probe:** <questions>

### Passed over
- **<Candidate name>** — **PASS** — Reason: <one sentence, factual, not value-laden>
- **<Candidate name>** — **PASS** — Reason: <...>

## Notes for the hiring manager
- <Adjacent role observation, e.g. "Two strong candidates are over-leveled for the IC role">
- <Pipeline gap, e.g. "No women in the top 5 — broaden sourcing">
- <What we'd need to make a decision faster — e.g. "Reorder must-haves to drop X if open to remote">
```

## Rules

- **Reasons must be JOB-RELATED.** Never reference age, family, accent, country of origin, university prestige in isolation. If you wouldn't say it in front of a lawyer, drop it.
- **Quote the resume for any strong claim.** "Led a team of 12" — quote the line.
- **Don't infer skills from titles.** "Senior Engineer at FAANG" doesn't mean "knows Kafka" unless the resume says it.
- **Distinguish data from judgment.** Years at company = data. "Career hopper" = judgment.
- **Surface the pipeline gap.** A screen that just ranks the resumes without naming the gap (e.g. "no senior candidates in batch") is half the job.

## Pitfalls

- Pattern-matching on brand-name companies instead of the actual role's scope.
- Penalising career breaks without checking the reason (parental leave, education, layoff).
- Promoting a "MAYBE" to "SCREEN" because the batch is thin — say "we need to source more" instead.
- Using vague rationale ("strong fit") — every recommendation cites a specific signal.
