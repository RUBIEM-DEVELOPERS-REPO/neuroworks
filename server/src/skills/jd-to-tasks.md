---
name: jd-to-tasks
description: Convert a job description into a role-based workflow — the canonical tasks this person actually owns, sequenced and grouped.
applies_to: [plan, draft-other]
---

# Skill: JD → role workflow

## Goal

Given a JD, output the workflow this role runs week-in week-out — the *actual* recurring tasks, not a paraphrase of the responsibilities section.

## Process

1. **Identify the role's primary deliverables** (what does success look like for this person?). Pull from the JD's "responsibilities" and "what success looks like" sections.
2. **For each deliverable, list the recurring tasks that produce it.** "Quarterly board deck" deliverable → tasks like "pull KPI data Monday week-of", "draft narrative Tuesday", "circulate for review Wednesday", etc.
3. **Group tasks by cadence** — daily / weekly / monthly / quarterly / event-driven.
4. **Mark which tasks can be AI-assisted vs human-only.** AI-assisted = the persona/skill stack can produce a credible first draft; human-only = judgment, relationship, in-person required.

## Output shape

```
## Role workflow — <Job title>

**Primary deliverables:**
1. <Deliverable 1>
2. <Deliverable 2>
3. <Deliverable 3>

## Tasks by cadence

### Daily
| Task | AI-assist? | Skill / persona to use |
|---|---|---|
| Triage inbound requests | ✓ | support-themes (clusters → urgency) |
| Standup update | ✓ | status-update skill |

### Weekly
| Task | AI-assist? | Skill / persona to use |
|---|---|---|
| Weekly progress report | ✓ | report-writing + status-update |
| 1:1s with reports | — | judgment + relationship — human-only |

### Monthly
| Task | AI-assist? | Skill / persona to use |
|---|---|---|
| Pipeline review | ✓ | crm-update + meddic-qualification |
| Performance check-ins | ✓ | performance-review (notes prep) |

### Quarterly / Event-driven
| Task | AI-assist? | Skill / persona to use |
|---|---|---|
| Quarterly board deck | ✓ | report-writing + slide-outline |
| Hiring loop for backfills | ✓ | jd-writing + cv-screening + interview-questions |

## Recommended AI-assist setup
- Wire <Skill A> for <task category>
- Wire <Skill B> for <task category>
- Reserve human-only time for <list>
```

## Rules

- **Cadence matters more than seniority.** A Staff Eng's "weekly" is different from a Director's "weekly". Capture both.
- **AI-assist isn't all-or-nothing.** Mark which STEP of the task is AI-assisted vs which needs judgment.
- **Name the skill / persona for each AI-assisted row.** Pointless to mark a task AI-assist if the reader doesn't know what to invoke.
- **Don't pad with generic tasks.** "Attend meetings" isn't a workflow task; the OUTPUT of a meeting (decisions, action items) is.

## Pitfalls

- Echoing JD bullets verbatim — they're aspirational, not operational.
- Missing the implicit tasks (e.g. JD says "drive growth" — that's not a task, the recurring tasks are "weekly pipeline review", "monthly experiment readout", etc.).
- Marking high-judgment tasks (1:1s, executive comms) as AI-assist — readers lose trust.
- Forgetting event-driven tasks (annual planning, hiring loops, incident response).
