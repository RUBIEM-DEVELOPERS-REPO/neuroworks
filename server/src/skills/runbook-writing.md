---
name: runbook-writing
description: How to write an operational runbook another operator can execute at 3am without asking you any questions.
applies_to: [plan, draft-other]
---

# Skill: Runbook writing

## Goal

A document a tired, unfamiliar operator can pick up at 3am and execute correctly. Steps are imperatives, not descriptions. No judgement calls, no "you might want to check".

## Structure

```
# Runbook: <Trigger>

## When to run
<One sentence — the alert / symptom / request shape that triggers this>

## Severity
<P0 / P1 / P2 / standard — what's the impact if NOT run promptly>

## Preconditions
- <What must be true before starting (access, tools, current state)>
- <…>

## First 5 minutes — immediate actions
1. <Concrete command or click. No "verify the cluster looks healthy" — name the command.>
2. <…>

## Diagnostic decision tree
- If <symptom A>: <action / next runbook>
- If <symptom B>: <action>
- Else: escalate per below

## Resolution / standard procedure
1. <Step with the exact command or path>
2. <…>

## Verification — done means
- <Specific observable: dashboard shows X, alert clears, log line appears>
- <…>

## Rollback
<How to undo if the procedure makes things worse. If not safely reversible, say so explicitly.>

## Escalation
- After <N minutes> if <symptom>: page <owner / role>
- Comms template: <one-line slack / status-page update>

## Owner
<Person/team responsible for keeping this runbook current. Date of last update.>
```

## Rules

- **Every step is executable.** Commands in code blocks. Click paths spelled out. Files named with absolute paths.
- **No "check that it looks normal".** Replace with a specific assertion ("p99 below 200ms on the API latency dashboard").
- **Time-box everything.** "If after 10 minutes the queue is still draining: ___". Operators panic without time signals.
- **Name the owner of each escalation hop.** "Page on-call" is useless if there are five on-calls.
- **State the assumption that would break the runbook.** ("Assumes the read replica is healthy — if it's not, see <other runbook>".)
- **Comms first when customer-visible.** Status-page update before deep diagnostics. Users need to know we know.

## Pitfalls

- **Prose instead of commands.** "You'll want to look at the logs" — replace with `kubectl logs -n prod -l app=api --tail=200 | grep ERROR`.
- **Skipped rollback section.** Procedures that can make things worse without a documented undo path are dangerous.
- **Decisions buried in paragraphs.** Decision points should be `if X: do Y` bullets, not "depending on what you find, you may need to…".
- **Stale owner field.** Runbook with no owner and no last-updated date gets distrusted.
- **Symptom recognition missing.** Operator opens the runbook and can't tell if it applies. Always lead with "When to run".
