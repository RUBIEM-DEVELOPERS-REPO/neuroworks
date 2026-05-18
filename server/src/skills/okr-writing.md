---
name: okr-writing
description: How to write OKRs (Objectives and Key Results) that drive focus instead of becoming an annual reporting tax.
applies_to: [plan, draft-other]
---

# Skill: OKR writing

## Goal

An OKR set the reader can use to decide what to work on this week. If it's just an annual report card, the OKRs were written wrong.

## Format

```
# <Team> OKRs — <Quarter, e.g. Q4 2025>

## Objective 1: <Inspiring, qualitative statement of where we want to be by end of period>

**Why it matters:** <1-2 sentences. The strategic context — why this objective is the one we picked.>

**Key Results:**
- KR1.1 — <metric: from X to Y, by when, measured how>
- KR1.2 — <metric: from X to Y, by when, measured how>
- KR1.3 — <metric: from X to Y, by when, measured how>

**Initiatives (the work we'll do to move the KRs):**
- <Project — owner — target ship>
- <Project — owner — target ship>

---

## Objective 2: <...>

...
```

## Rules

### Objectives

- **Qualitative + inspiring.** "Become the default tool for X" beats "Grow revenue 20%".
- **3-5 per team max.** More objectives = no priorities.
- **Owned by the team, not "the company".** A team-level OKR has someone accountable for it.

### Key Results

- **Outcome-shaped, not output-shaped.** Outcome: "lift activation rate from 22% → 35%". Output: "ship 4 features". Output KRs hide failed projects; outcome KRs don't.
- **Each KR has a baseline and a target.** "Improve X" is not a KR. "X from 22% to 35%" is.
- **Each KR has a measurement source.** "Where do we look on Monday to see the number?" — name it.
- **3-5 KRs per Objective.** Each KR should pull in the same direction; if they conflict, the Objective is too broad.
- **Time-bounded.** "By end of Q4" is implicit but ideally stated.
- **Ambitious but possible.** Rule of thumb: a 60-70% achievement on a stretch KR is a win; a 100% achievement is a sign the KR was too easy.

### Initiatives

- The work *under* a KR. Not the KR itself.
- Each initiative has an owner and a target date.
- If an initiative doesn't move any KR, it doesn't belong on this list — push it to a backlog.

## Example (good)

```
## Objective 1: Make onboarding the strongest moment of the new-user journey

**Why it matters:** Trial-to-paid conversion has stalled at 14% for three quarters. Internal research shows users who reach the "first share" event convert at 41%. The onboarding flow is the gate.

**Key Results:**
- KR1.1 — Trial → paid conversion from 14% → 22% (measured: Stripe + Mixpanel, weekly)
- KR1.2 — % new users reaching "first share" within 7 days from 28% → 50%
- KR1.3 — Median time-to-first-share from 4.2 days → 24 hours

**Initiatives:**
- Redesign step 3 of the onboarding flow — @sam — ships Nov 10
- "First share" nudge email (day 2, day 5) — @priya — ships Nov 20
- A/B test the empty-state CTA — @alex — running through Dec 1
```

## Example (bad — common mistakes)

```
## Objective 1: Improve onboarding   ← vague, no inspiring direction

**Key Results:**
- KR1.1 — Ship onboarding redesign   ← output, not outcome
- KR1.2 — Increase activation   ← no baseline, no target, no source
- KR1.3 — Hire 2 onboarding specialists   ← that's a project, not a KR
```

## Rules of writing the doc

- **Top of the doc names the strategic context** the OKRs are downstream of (the company OKRs, the quarterly theme).
- **Each OKR has a single owner** (a person, not "the team") who reports on it weekly.
- **Mid-quarter check-in beats end-of-quarter review.** A doc without a check-in cadence rots.
- **Track separately from initiatives.** A KR can be at 80% even if the named initiative slipped — that's the KR system working.

## Pitfalls

- Writing OKRs at the start of the quarter and never reading them again.
- KRs that are just project ship dates ("launch v2") — those are roadmap items, not OKRs.
- Too many KRs → all of them get partial attention.
- Objectives that are actually projects ("redesign onboarding") — that's an initiative, not an Objective.
- KRs the team doesn't actually control (e.g. company-wide revenue for a small team) — pick a KR you can move.
