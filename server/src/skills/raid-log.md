---
name: raid-log
description: Maintain a RAID log — Risks, Assumptions, Issues, Dependencies — each with owner, status, action, and what changed since last review.
applies_to: [draft-other, plan, raid-log]
---

# Skill: RAID log

## Goal

A project lead sees, in one place, the live risks, the assumptions the plan rests on, the issues hurting today, and the cross-team dependencies — each owned and moving.

## The four registers

- **Risk** — might happen, would hurt. Has likelihood × impact + mitigation. (Future, uncertain.)
- **Assumption** — taken as true for planning; if false, the plan shifts. Has a validation owner + date.
- **Issue** — already happening and hurting. Has an action + owner + target resolution. (Present, certain.)
- **Dependency** — needs something from another team/vendor. Has a who, a what, and a need-by date.

## Output shape

```
# RAID log — <Project> · <YYYY-MM-DD>

## Risks
| ID | Risk | L×I | Mitigation | Owner | Status | Δ since last |
|---|---|---|---|---|---|---|
| R1 | <…> | 6 | <…> | | open | new |

## Assumptions
| ID | Assumption | Impact if false | Validate by | Owner | Status |
|---|---|---|---|---|---|
| A1 | <vendor API ready by M2> | slips launch | <date> | | unvalidated |

## Issues
| ID | Issue | Impact now | Action | Owner | Target | Status |
|---|---|---|---|---|---|---|
| I1 | <env down> | blocks QA | <fix> | | <date> | in progress |

## Dependencies
| ID | We need | From | By | Owner (ours) | Status |
|---|---|---|---|---|---|
| D1 | signed DPA | Legal | M1 | | chasing |
```

## Rules

- **Don't conflate risk and issue.** A risk that materialised becomes an issue — move it, don't leave it as a "risk".
- **Assumptions have a validation owner + date** — an unvalidated assumption is a risk in disguise.
- **Dependencies name the other party and a need-by date** — vague "waiting on X" stalls projects.
- **Every row has an owner and a status**; retire closed rows with a note (keep the audit trail).
- **Show what changed since last review** — the delta is the point of a recurring log.

## Pitfalls

- Risks and issues mixed together — hides what's actually on fire.
- Assumptions never validated — the plan quietly rests on guesses.
- Dependencies without a need-by date — discovered late as blockers.
- A static log no one updates — RAID only works as a living, reviewed artefact.
