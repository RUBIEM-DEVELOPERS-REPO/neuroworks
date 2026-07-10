---
name: risk-register
description: Maintain a project / company risk register — name each risk, score it, name the owner, name the mitigation, surface what's changed since last review.
applies_to: [draft-memo, draft-other]
---

# Skill: Risk register

## Goal

A leader opens the register and sees the small number of risks that
actually matter — each with a current state, an owner, and a mitigation
plan. Old risks that aren't real anymore are retired. New risks aren't
missed.

## Scoring

Each risk gets two scores 1-3:

| Likelihood | Score | Means |
|---|---|---|
| Low | 1 | <25% in the next quarter |
| Med | 2 | 25-60% |
| High | 3 | >60% |

| Impact | Score | Means |
|---|---|---|
| Low | 1 | Annoying, recovered in a week |
| Med | 2 | Quarter-defining setback |
| High | 3 | Existential / strategy-changing |

**Risk level = L × I.** 1-2 = monitor. 3-4 = active mitigation. 6-9 =
executive attention.

## Process

1. **Carry over the prior register.** What's still live, what got
   resolved, what changed score.
2. **Add new risks.** From recent incidents, near-misses, partner news,
   competitor moves, regulatory changes, key hires/departures.
3. **For each risk:**
   - One-line description
   - L × I = score
   - Owner (single name)
   - Mitigation plan + status
   - Trigger (what makes us escalate)
4. **Retire risks that no longer apply.** With a one-line note so the
   audit trail is intact.
5. **Surface CHANGES since last review.** Don't make the reader diff
   manually.

## Output shape

```
# Risk register — <Project / Company> · <YYYY-MM-DD>

## Top risks (score ≥ 6 — exec attention)

### <Risk name> — score 6 (L=2, I=3)
- **What:** <one-line description>
- **Owner:** <Name>
- **Mitigation:** <current plan, status, % done>
- **Trigger:** <when we escalate further>
- **Change since last review:** <new / score up / score down / unchanged>

### <Risk name> — <…>

## Active risks (score 3-5 — managed)

| # | Risk | Score | Owner | Mitigation | Status |
|---|---|---|---|---|---|
| 1 | <…> | 4 | <…> | <…> | on-track |
| 2 | <…> | 5 | <…> | <…> | slipping |

## Monitoring (score 1-2 — no action)

- <Risk> — <one line on why we keep watching>

## Retired this period

| Risk | Why retired | When |
|---|---|---|
| <…> | <Resolved / no longer applicable> | <date> |

## What's changed since <prior date>
- ↑ <Risk X> went from 4 to 6 (<reason>)
- ↓ <Risk Y> retired (<reason>)
- + <Risk Z> added (<reason>)
```

## Rules

- **One owner per risk.** "The leadership team" is not an owner.
- **Mitigation has a percentage or a date.** Vague mitigations look
  like wishes.
- **Retire ruthlessly.** A register with 40 stale risks loses signal.
- **Triggers are mandatory for score ≥ 6.** Without an escalation
  trigger, the risk lives forever.

## Pitfalls

- Inflation. Every risk at score 5 is the same as every risk at score
  3 — useless. Score honestly.
- Listing risks without owners — invites bystander effect.
- Forgetting the change-since column. The change IS the signal.
- Treating the register as an audit artefact instead of a live tool —
  if no one looks at it weekly, it stops working.
