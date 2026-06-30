---
name: brd-writing
description: Write a Business Requirements Document (BRD/BRS) — purpose, scope, stakeholders, numbered business requirements, assumptions, and out-of-scope.
applies_to: [draft-doc, draft-other, business-requirements]
---

# Skill: Business Requirements Document (BRD)

## Goal

A sponsor, an engineer, and an auditor can each read the BRD and agree on WHAT the system must do and WHY — before anyone designs or builds. Requirements are numbered, testable, and free of solution detail.

## Structure

```
# Business Requirements Document — <System / Project>
Version: <x.y> · Prepared for: <Org> · Prepared by: <Name> · Date: <YYYY-MM-DD>
Reference: <law / standard / contract driving the work, if any>

## 1. Purpose
<2-4 sentences: what this document defines and why the work exists.>

## 2. Background / Problem statement
<The current pain, the risk of inaction, the trigger.>

## 3. Business objectives
1. <Outcome the business wants — measurable where possible.>
2. …

## 4. Scope
### 4.1 In scope
- <capability the system MUST cover>
### 4.2 Out of scope
- <explicitly excluded, so no one assumes it>

## 5. Stakeholders
| Stakeholder | Interest / role | Sign-off? |
|---|---|---|

## 6. Assumptions & constraints
- <what we assume true; what limits the solution (budget, law, timeline)>

## 7. Business requirements
| ID | Requirement | Priority | Acceptance / how we verify |
|---|---|---|---|
| BR1 | The system **must** <observable capability>. | Must | <testable condition> |
| BR2 | … | Should | … |

## 8. Dependencies & risks
- <external systems, data, approvals this depends on; top risks>

## 9. Open questions
- <decisions still needed, with owner>
```

## Rules

- **Requirements describe WHAT, never HOW.** "The system must record who approved each deletion" — not "add an `approved_by` column".
- **Each requirement is atomic, numbered, and testable.** One capability per BRn. If you can't write an acceptance condition, it's not a requirement yet.
- **MoSCoW priority** (Must/Should/Could/Won't) on every requirement.
- **Out-of-scope is explicit.** The most expensive misunderstandings live in the gap between "assumed in" and "assumed out".
- **Trace to an objective.** Every requirement should ladder up to a section-3 objective; orphans are scope creep.

## Pitfalls

- Smuggling a design (tech stack, schema, UI) into a requirement — locks the build prematurely.
- Vague verbs: "handle", "manage", "support" with no acceptance condition.
- No priorities — everything becomes Must, and the first cut is chaos.
- Skipping assumptions — then the build silently assumes the opposite.
