---
name: decision-doc
description: Architecture Decision Record / Request-For-Decision format — captures a choice, the alternatives considered, and the reasoning so future readers can re-evaluate.
applies_to: [plan, draft-other]
---

# Skill: Decision doc (ADR / RFD)

## Goal

A short, durable record of WHY a decision was made — written at the time of decision so the org can re-evaluate it later without re-litigating context. Future engineers should be able to read this and either keep the decision or replace it with a successor doc.

## Format

```
# ADR-<NNN>: <Decision title — verb + object, e.g. "Adopt SQLite for local persistence">

**Status:** Proposed | Accepted | Superseded by ADR-XXX | Deprecated
**Date:** <YYYY-MM-DD>
**Deciders:** <names>
**Context window:** <e.g. "Q4 2025, pre-launch architecture review">

## Context

<3-6 sentences. The forces in play. Why a decision is needed NOW. What constraints are non-negotiable. Avoid history — only the context that bears on this decision.>

## Decision

<One paragraph. The decision itself, in declarative form. "We will use SQLite for local persistence, single-writer, with a daily backup to S3."

Be specific. Vague decisions ("we'll use a database") rot — they get reinterpreted differently by different teams.>

## Alternatives considered

### <Alternative A> — rejected because <reason>
<2-3 sentences on what it was and why it didn't win. Be fair to it; future readers may revisit.>

### <Alternative B> — rejected because <reason>
<...>

### Do nothing — rejected because <reason>
<Always include "do nothing" as an option. If it would have been fine, that's important to record.>

## Consequences

**Positive:**
- <Specific outcome we expect>

**Negative:**
- <Cost we accepted>

**Risks:**
- <Thing that could invalidate this decision — name the early-warning signal>

## Re-evaluate when

- <Trigger 1 — e.g. "we exceed 100k rows or 1GB"; "we hit multi-writer requirements"; "we need replication">
- <Trigger 2>
```

## Rules

- **Status is load-bearing.** A "Proposed" ADR isn't policy. An "Accepted" ADR is. A "Superseded" ADR is history — keep it, don't delete it.
- **Date and deciders are mandatory.** Without them, the doc rots silently — readers can't tell if it's still active.
- **Name the alternatives.** "We considered other options" doesn't count. The whole value is showing the *path not taken* so future readers can re-walk it.
- **Re-evaluate triggers are mandatory.** A decision without an invalidation signal calcifies. List the conditions that should reopen the discussion.
- **One decision per doc.** Bundling 3 decisions into one ADR makes it impossible to supersede them independently.

## Length

200-600 words. If you're writing more than 1000, you're writing a design doc — link to it from a short ADR that names the decision.

## Pitfalls

- Vague decisions ("adopt a modern stack") that bind nobody to anything.
- Marketing alternatives instead of evaluating them honestly.
- Skipping the "do nothing" option — sometimes it's the right answer and you'll wish you'd written it down.
- Treating the ADR as a one-time artifact — the *re-evaluate* triggers are the whole point of writing it down.
