---
name: support-themes
description: Cluster a batch of support tickets by underlying theme — frequency, urgency, suggested fix per cluster.
applies_to: [summarize, analyze]
---

# Skill: Support ticket clustering

## Goal

Support lead reads ONE page, sees the top 5-7 issue clusters by volume × severity, knows which is the next product or doc fix to ship.

## Process

1. **Group by underlying CAUSE, not symptom.** "Login broken on Safari", "Can't log in from iPad", "Auth fails after password reset" likely = one cluster (auth flow brittle on WebKit). Don't double-count.
2. **For each cluster: count, severity, and the smallest representative example.** A single representative ticket beats summarising five.
3. **Score frequency × severity.** High-volume-low-severity gets attention through accumulation; low-volume-high-severity (data loss, billing error) jumps the queue.
4. **Propose ONE fix per cluster** — product change, doc update, macro reply, or training. Not a fix-plan; a single next action.
5. **Surface the "no-pattern" tickets separately.** Singletons that don't cluster aren't part of the trend — listing them as a cluster is misleading.

## Output shape

```
## Support ticket themes — <Date range> · <N tickets total>

**Verdict:** <Top fix to ship this sprint>

## Clusters (ranked by frequency × severity)

### 1. <Cluster name> — <N tickets>, severity <P0/P1/P2>
- **What's happening:** <One sentence describing the underlying cause, not the symptom>
- **Example ticket:** "<Verbatim or trimmed>" (#<ticket id>)
- **Affected users:** <Segment if identifiable — e.g. "free tier, mobile">
- **Suggested fix:** <Single action — "Add empty-state copy to /onboarding", "Update Help Center article X", "Ship retry-with-backoff on auth refresh">
- **Owner:** <Team — Eng / Docs / Product / Support>

### 2. <Cluster name> — <N>, <severity>
<...>

## Unclustered (singletons — not a trend yet)
- #<id> — <one line>
- #<id> — <one line>

## Recommendations
1. <Top fix — biggest user-pain reduction per engineering hour>
2. <Second>
3. <Third — usually a doc/macro fix that handles a long tail>

## What I couldn't classify
- <Tickets that lacked enough info to cluster — usually need the support rep to follow up>
- <Multi-cause tickets that span two clusters>
```

## Rules

- **Cluster by CAUSE, not symptom.** Re-grouping after first pass is normal; first pass usually over-clusters.
- **Count once.** If a ticket spans two themes, attribute it to the dominant one and note the secondary.
- **One fix per cluster.** A "fix plan" with 5 steps loses the reader; pick the single action that unblocks 80%.
- **Severity is the user's lens, not yours.** Loss of data > can't complete task > inconvenience > cosmetic.
- **Singletons aren't a cluster.** If you can only find one ticket like this, it's noise — note it but don't recommend a fix.

## Pitfalls

- Promoting your favorite fix because it's interesting — go where the volume × severity is.
- Burying urgency under volume — one P0 outage report beats fifty P3 cosmetic complaints.
- Ignoring repeat customers — one user filing 6 tickets is one signal, not six.
- Generic cluster names ("login issues" — too broad). "Safari OAuth callback drops session after redirect" is what the engineer needs.
- Skipping the "couldn't classify" section — those tickets need follow-up, not silence.
