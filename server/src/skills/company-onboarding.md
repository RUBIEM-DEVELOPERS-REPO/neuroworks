---
name: company-onboarding
description: Draft an internal onboarding brief for a new hire — pulls role from the JD, the team / org context from `_company/` and `_governance/`, and the first-week checklist tailored to the role.
applies_to: [draft-memo, draft-other]
---

# Skill: Company onboarding brief

## Goal

A first-day read that orients the new hire faster than three onboarding
meetings. Not HR paperwork — the specific shape of THIS company, the team
they're joining, and what their first 30 days look like.

## Process

1. **Pull the role context** from `_company/` via `vault.search`:
   - Job description (canonical version, not a recruiter copy)
   - Team mission / charter doc
   - The relevant playbook (sales handbook, eng onboarding, etc.)
2. **Pull org context** from `_governance/`:
   - Org chart (who they report to, who their peers are, who they'll need
     to escalate to). Use `org.lookup` if a name is mentioned.
   - Decision-rights doc — who owns what.
3. **Pull the toolset.** From `_company/` or `2-Permanent/` — what tools
   does this team use day-to-day, in what order do they appear in week 1.
4. **Compose the brief** with three time horizons: day 1, week 1, week 4.

## Output shape

```
# <Role> at <Company> — Onboarding brief for <Name>

## You're joining
- Team: <name> — <one-line mission>
- Manager: <Name, Role> — <comm preference if known>
- Peers: <Name, Name> (<their roles>)
- First skip-level: <Name>

## The role
- What you own: <2-3 bullets — outcomes, not activities>
- What you do NOT own (so you don't accidentally step on it):
  - <…>

## Day 1
- [ ] <Concrete first action — accounts, intros, first meeting to attend>
- [ ] <…>

## Week 1
- [ ] <Things to read, in order of priority>
- [ ] <People to meet 1:1 (with the question to bring to each)>
- [ ] <First small deliverable that proves you've got the basics>

## Week 4
- [ ] <First real deliverable that someone else would have done before you>
- [ ] <Decision you'll own end-to-end>

## How decisions happen here
- <Pulled from `_governance/decision-rights.md` or equivalent>

## Tools you'll use this week
- <Tool> — for <what>
- <…>

## Where to find things
- Company docs: `_company/`
- Past decisions: `2-Permanent/` (search vault)
- People + org: `_governance/people.md`
```

## Rules

- **Be specific about the company.** Generic onboarding ("set up your
  laptop") wastes the new hire's attention.
- **Name names.** "Talk to the platform team" is weaker than "Book 30 min
  with @Priya — bring the API question from week 1 bullet 3".
- **First deliverable matters.** Naming it concretely sets expectations
  both ways.
- **Cite paths.** New hires will go back and re-read; paths are how they
  find their way.

## Pitfalls

- Padding with HR boilerplate (write that section once, link to it).
- Skipping the "what you do NOT own" section — saves a turf battle later.
- Treating week 4 as far-future — at week 4 the operator-side judgement
  matters most. Be specific.
- Forgetting the manager's communication style — small detail, big effect
  on first week.
