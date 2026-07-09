---
name: human-handoff
description: Pause a task and hand a specific question, approval, or missing piece of information to a human teammate, then resume with their answer woven in.
applies_to: [plan, draft-other]
---

# Skill: Human hand-off (hybrid workforce)

## When to use this

Partway through a task you hit something ONLY a human can supply or decide:
a number that isn't in any system (this quarter's still-unpublished
figures), a judgment call above your authority (approve this spend, pick
between two vendors), a document only the human has, or a work-mode "human"
/ "hybrid" persona/role that the task should route to a person for. This is
the shipped hybrid-workforce pattern — NeuroWorks agents and humans share
the same org chart, and `human.request` is the bridge between them.

This is NOT for things you can find yourself. Exhaust `vault.search`,
`fs.find_in`, `users.lookup`, `connector.call`, `db.query`, etc. first — only
hand off when the answer genuinely doesn't exist anywhere you can reach.

## Process

1. **Identify exactly what's missing** — one specific question, not a vague
   "need more info". "What was Q3 net revenue?" not "tell me about Q3".
2. **Call `human.request`** with the question(s):
   ```
   human.request({
     items: [
       { type: "answer", question: "What was Q3 2026 net revenue (ZAR)?" }
     ],
     note: "Drafting the investor update — everything else is ready; this figure blocks the finance section."
   })
   ```
   `type` can be `answer` (free text), `upload` (a file), or `approval`
   (yes/no on something you're proposing) — pick the one that matches what
   you actually need back.
3. **Stop there for this run.** The task automatically parks as
   "waiting on human" — do not fabricate a placeholder answer and keep
   going. A guessed number in an investor update is worse than a delayed one.
4. **When the human answers**, the task resumes automatically with their
   answer available to you — weave it into the final deliverable exactly as
   given, don't paraphrase a number.

## What good hand-offs look like

- **Specific, answerable in one line.** "What's the renewal date for the
  Acme contract?" not "what do you know about Acme?"
- **Explain why you're asking** in `note` — the human sees this on the
  Tasks page waiting-card; context saves them a round trip.
- **Batch related asks into one `human.request`** rather than pausing
  multiple times for things you could ask together.

## Rules

- **Never fabricate what a human.request would have supplied.** If a figure,
  approval, or file is genuinely missing and you can't find it, ask — don't
  estimate and present it as fact.
- **This costs the human real time** (tracked on the Cost page's time-waste
  analytics) — only hand off when you've actually exhausted the tools
  available to you.
- **One hand-off per genuinely blocking gap.** Don't chain trivial questions
  the org directory or vault could answer.

## Pitfalls

- Asking a question `users.lookup` or `vault.search` could have answered —
  check first, ask second.
- A vague ask ("need clarification on the report") that forces the human to
  guess what you actually need — always ask the precise question.
- Continuing the plan with a placeholder/estimate instead of actually
  pausing — defeats the entire point of the hand-off.
