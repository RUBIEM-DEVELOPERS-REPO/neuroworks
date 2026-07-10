---
name: sop-writing
description: Turn a process description into a Standard Operating Procedure — numbered steps, owners, checkpoints, escalation paths.
applies_to: [plan, draft-other]
---

# Skill: SOP writing

## Goal

A new hire can pick up this SOP on day one, execute the process correctly without asking a single question, and know exactly when to escalate.

## Process

1. **Identify the trigger.** What event starts this SOP? Inbound ticket / monthly close / new hire signed / customer complaint received. Without a clear trigger the SOP has no entry point.
2. **Define the outcome.** What "done" looks like. If two people can disagree on whether the SOP completed, you need a clearer definition.
3. **Decompose into atomic steps.** Each step is ONE action, ONE owner, with explicit inputs and outputs. Multi-action steps split.
4. **Add CHECKPOINTS** at branch points. "If X is true, go to step 7; if not, go to step 8". No silent loops.
5. **Escalation path explicit.** Every step has a "what if this fails / who to call" entry.
6. **Include the artifacts.** Templates, scripts, links — embedded or linked at the step they're used at.

## Output shape

```
# SOP: <Process name>

**Owner:** <Role responsible for the SOP itself, not the steps>
**Version:** <X.Y> · **Last reviewed:** <YYYY-MM-DD>
**Audience:** <Who runs this — role / team>
**Estimated time:** <Total wall-clock for a typical run>

## Trigger

<What event starts this SOP. Be specific — "a customer files a refund ticket flagged P1" not "a refund happens".>

## Outcome (what done looks like)

<One sentence describing the verified end state. Include observable signals — "ticket closed with status=Refunded, audit row written, customer email sent".>

## Prerequisites

- [ ] <Access / permission required — e.g. "Stripe dashboard refund-issue role">
- [ ] <Inputs needed — e.g. "Customer email, last 4 digits of card, refund amount">
- [ ] <Tools / templates — e.g. "Refund-confirmation email template (linked below)">

## Steps

### Step 1 — <Action>
- **Owner:** <Role>
- **Input:** <What you start with>
- **Action:** <One sentence — what to do>
- **Output:** <What you produce — file, record, message>
- **Checkpoint:** <How to verify it worked>
- **If this fails:** <Specific escalation — who, how>

### Step 2 — <Action>
<...>

### Step 3 — <Branching action>
- **Action:** <...>
- **If condition A:** Continue to step 4
- **If condition B:** Jump to step 7 (skip 4-6)
- **If neither / unclear:** Escalate to <role>

### Step N — <Verify and close>
- **Action:** <...>
- **Acceptance criteria:** <Explicit list of what must be true for "done">
- **Notify:** <Stakeholders who need to know>

## Escalation paths

| Situation | Who to escalate to | How |
|---|---|---|
| Refund > $5,000 | Manager + Finance lead | Slack #finance + tag in ticket |
| Customer threatens chargeback / litigation | Legal + manager | Slack #legal + tag manager |
| System unavailable (Stripe down, etc.) | On-call engineer | PagerDuty + status page |

## Linked artifacts

- [Template: <name>](#)
- [Script: <name>](#)
- [Form: <name>](#)
- [Related SOP: <name>](#)

## Change log

- <YYYY-MM-DD>: <What changed and why> — <Author>
- <YYYY-MM-DD>: <...>

## Review cadence

This SOP is reviewed <quarterly / semi-annually / annually>. Next review: <YYYY-MM-DD>.
```

## Rules

- **Atomic steps only.** Multi-action steps hide failure points.
- **Owner is a role, not a person.** People leave; roles persist.
- **Checkpoints are observable.** "Verified" without an observable check is invisible work.
- **Branches are exhaustive.** Every condition has a path, including "unclear / unknown".
- **Escalation paths are named.** "Talk to a manager" is not actionable; "Slack #finance and tag <role>" is.

## Pitfalls

- Writing the SOP from MEMORY of how you do it — observe a real run to catch the implicit steps.
- Treating "common sense" as a step (it isn't to a new hire).
- Skipping the prerequisites section — the new hire gets to step 3 and discovers they don't have access.
- Linking out to artifacts that drift / go stale — keep critical artifacts embedded if they're short, with last-modified dates if linked.
- Forgetting the change log — SOPs drift silently without it.
