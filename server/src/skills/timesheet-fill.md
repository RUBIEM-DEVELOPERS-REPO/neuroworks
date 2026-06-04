---
name: timesheet-fill
description: Use the operator's calendar + jobs journal + recent commits to draft a weekly timesheet — project, hours, category — ready to paste into the company's time-tracking tool.
applies_to: [summarize, draft-other]
---

# Skill: Timesheet fill

## Goal

The operator stops manually reconstructing their week on Friday afternoon.
The skill pulls together a defensible timesheet from calendar entries +
agent jobs run + git commits, and hands it over for review + submission.

## Process

1. **Pull the calendar** for the period via `calendar.activity` /
   `calendar.read_today`. Convert each event into a time block.
2. **Pull the agent activity.** Jobs the operator dispatched + their
   duration count as worked time (gated — only if the operator was
   actively in the chat thread).
3. **Pull git commits** if the operator's email is known. Commits anchor
   "what was actually worked on" against meeting-heavy days.
4. **Map blocks to projects.** Project mapping comes from `_company/
   project-codes.md` if present, otherwise the operator confirms.
5. **Bucket categories** — typical: client work, internal work,
   meetings, training, admin, PTO.
6. **Total to the expected weekly hours** (default 40h; configurable).
   Surface gaps explicitly.

## Output shape

```
# Timesheet — <Operator> · week of <Monday YYYY-MM-DD>

## Summary

| Category | Hours | % |
|---|---|---|
| Client work | <X> | <%> |
| Internal work | <X> | <%> |
| Meetings | <X> | <%> |
| Admin | <X> | <%> |
| Training / dev | <X> | <%> |
| **Total** | **<X>** | **100%** |

## By project

| Project code | Project name | Hours |
|---|---|---|
| <CODE> | <…> | <X> |
| <…> | <…> | <…> |

## By day

### Monday <YYYY-MM-DD>
- 09:00-10:30 — Client kickoff (Project <CODE>) — 1.5h
- 10:30-11:00 — Standup (Internal) — 0.5h
- 11:00-12:30 — Spec writing (Project <CODE>) — 1.5h
- <…>
- **Day total: <X>h**

### Tuesday <YYYY-MM-DD>
<…>

## Gaps (please confirm)
- Wednesday 14:00-15:30 — no calendar entry, no commits, no jobs.
  Likely: <…>?
- <…>

## Anomalies
- Thursday total = 11h — long day, confirm before submitting.
- Friday total = 2h — was this a half-day?

## Source attributions
- Calendar events: <N>
- Jobs (agent activity): <N>
- Commits parsed: <N>
- Manual gaps: <N>
```

## Rules

- **Don't fabricate gaps.** If 90 minutes can't be sourced, flag it —
  let the operator fill.
- **Cite the source per block.** "Calendar event #X" or "Job #Y" so
  audit is possible.
- **Round honestly.** 1h 17min → 1.25h is fine. 1h 17min → 2h is not.
- **Surface anomalies.** Long days, short days, weekend work — call
  them out so the operator can recall context.

## Pitfalls

- Counting commute time as worked time. Don't.
- Counting personal calendar events. Default-skip anything tagged as
  personal / OOO.
- Filling gaps with "general work" — that's just lying about the data.
- Forgetting to subtract OOO / holidays from expected hours.
