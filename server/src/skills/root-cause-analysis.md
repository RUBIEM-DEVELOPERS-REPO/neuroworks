---
name: root-cause-analysis
description: How to find the root cause of a problem (not the proximate cause) using 5-Whys and adjacent techniques. Useful for incidents, recurring bugs, organisational pattern failures.
applies_to: [review, analyze]
---

# Skill: Root cause analysis

## Goal

Identify the deepest mechanism that produced the observed problem so the fix prevents recurrence rather than papering over the symptom. The proximate cause is what happened just before the failure; the root cause is the system condition that made the failure likely.

## When to use

- After an incident (paired with the post-mortem)
- For bugs that have been "fixed" 3+ times and keep coming back
- For organisational patterns (deadlines repeatedly missed, the same kind of mistake from different people)
- For customer escalations that share a shape

## The 5-Whys method

Start with the observed problem. Ask "why?" five times — each answer becomes the next question's subject. The 5 is approximate — sometimes 3 whys is enough, sometimes 7. You're done when the answer is a structural / systemic cause, not a personal one.

### Example: A site outage

```
Problem: The site was down for 12 minutes on Tuesday.

Q1: Why was the site down?
A1: The web tier OOMed and CrashLooped.

Q2: Why did it OOM?
A2: A query in the new dashboard pulled 4M rows into memory.

Q3: Why did that query pull 4M rows?
A3: The pagination param wasn't applied — default was "all".

Q4: Why was "all" the default?
A4: The ORM helper's default was "all" but the new dashboard
    didn't override it.

Q5: Why didn't the code review catch this?
A5: We have no convention to flag unbounded queries in PRs, and
    no integration test exercises the dashboard against
    production-shaped data.

→ Root cause: lack of a queryability convention + missing
  integration test fixture. Fix the system, not just the query.
```

Without the 5 whys, the fix would be "add pagination to dashboard query" — and the same bug shape would reappear in the next dashboard.

## Cross-checks (don't stop at the first plausible chain)

After running 5 whys once, check:

1. **Multiple causal paths?** Sometimes 2-3 conditions had to be true simultaneously for the failure to occur. Run 5-Whys on each, not just one.
2. **Is the root cause a personality?** "Because X is careless" is not a root cause. Replace with the system condition that made the carelessness consequential.
3. **Is the answer political?** "Because Y team owns it and they're slow" — the system question is "why does ownership of Y produce slowness here?"
4. **Could a similar failure happen with a different proximate cause?** If yes, the root cause is shallower than you think.

## Output shape

```
# Root cause analysis: <problem>

**Date:** <YYYY-MM-DD> · **Author:** <name>
**Trigger event:** <one-sentence summary of what surfaced the problem>

## Observed problem
<What we saw — symptoms, customer impact, scale.>

## 5-Whys chain
1. **Why <observed problem>?** → <answer>
2. **Why <a1>?** → <answer>
3. **Why <a2>?** → <answer>
4. **Why <a3>?** → <answer>
5. **Why <a4>?** → <answer (the root cause)>

## Contributing factors (other causal paths)
- <Factor — would the failure happen without it?>
- <Factor>

## Root cause
<2-4 sentences. The structural condition. Phrased so the fix is obvious.>

## Recommended fixes

### Address the root cause
- <Specific action — owner — by when>

### Address the contributing factors
- <Specific action — owner — by when>

### Things we considered but rejected
- <"Just add a null check" — why this would only fix this one instance>

## How we'll know it worked
- <Signal that the system is healthier — e.g. "no instances of pattern X in PRs for the next 90 days">
- <Detection-side signal — even if the bug returns, we'd see it earlier>
```

## Other techniques worth knowing

- **Fishbone (Ishikawa) diagram** — visualise contributing factors across categories (people, process, tools, environment, data). Useful when there are clearly multiple causal paths.
- **Fault tree analysis** — top-down: start with the failure, build a tree of conditions that could produce it. Better when "X happened" might have several distinct causes.
- **Causal loop diagrams** — for organisational dynamics where the same problem recurs because of a feedback loop, not a single chain.

## Rules

- **Stop at systemic, not personal.** If your final "why" is a person's name, keep going.
- **Quote / cite specifics in each step.** Vague claims at any step poison the analysis.
- **Look for the missing safety net.** A real root cause usually involves a control that didn't catch the failure as much as the failure itself.
- **One RCA, one fix at the structural layer.** Tactical patches go in the post-mortem; the RCA's recommendation should be the systemic change.

## Pitfalls

- "Because of human error" — that's where to start, not finish.
- Five superficial whys that all live in the same layer of the system.
- One chain when two were operative — single-path RCAs leave latent bugs.
- Picking the "why" you can solve cheaply rather than the deepest true one.
- Skipping "how we'll know it worked" — the RCA goes in a drawer, nothing changes.
