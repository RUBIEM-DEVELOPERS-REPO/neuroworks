---
name: discovery-call-prep
description: Prep a sales discovery call — pull customer context from CRM + vault, set the questions to ask, name the qualification framework. The 15-minute read before the call.
applies_to: [draft-memo, summarize]
---

# Skill: Discovery call prep

## Goal

The operator joins the call already knowing who they're talking to, what
the company looks like, what's likely going on inside, and the 6-10
specific questions that'll move the deal forward.

## Process

1. **Pull the account.** Use `db.query` on CRM if connected; otherwise
   vault.search for prior notes on the account.
2. **Pull the contact.** Role, tenure if available, prior interactions.
3. **External research** (use sparingly — research.deep) for the company
   if it's a new account: recent funding, headcount changes, leadership
   moves, public earnings color if listed.
4. **Decide the framework.** First call usually MEDDIC or BANT. Pick one
   — running both leaves both incomplete.
5. **Draft the 6-10 questions.** Each question maps to a framework slot.
   Lead with a context question (their world), then to pain, then to
   process. Never lead with budget.
6. **Identify the disqualifiers.** What would make this a "no fit"?
   Surface so the operator knows when to walk.

## Output shape

```
# Discovery call prep — <Account> · <YYYY-MM-DD>

## Account snapshot
- Industry / size: <…>
- Recent signals: <funding, leadership move, layoffs, M&A>
- Buying motion typically: <enterprise / SMB / self-serve>

## Contact
- **<Name>** — <Role>, <tenure if known>
- Likely owns: <budget / decision / influence / champion>
- Prior interactions: <CRM record or vault path>

## What we believe is true (going in)
- <Hypothesis 1 about their pain>
- <Hypothesis 2 about their buying process>

## Questions to ask (in order)

1. **Context** — "Walk me through how you currently <do X>."
2. **Pain** — "Where does that process break down today?"
3. **Cost of pain** — "What's that cost you — time, dollars, people?"
4. **Trigger** — "Why are you looking now and not 6 months ago?"
5. **Decision process** — "How does a decision like this get made here?"
6. **Other options** — "What other approaches are you considering?"
7. **Success criteria** — "If we did this and it worked, how would you
   know in 90 days?"
8. **Timeline** — "When would you want to have this in place?"
9. **Budget** — only if 1-8 have built trust. "What's the budget shape
   here — is this funded?"

## Qualification framework — MEDDIC slots to fill
- **M**etric: <leave blank — capture on the call>
- **E**conomic buyer: <leave blank>
- **D**ecision criteria: <leave blank>
- **D**ecision process: <leave blank>
- **I**dentify pain: <leave blank>
- **C**hampion: <leave blank>

## Disqualifiers — when to walk
- <Specific signals that mean this is not a fit, e.g. "no budget cycle
  in next 12 months", "competitor already POC'ing">

## Pre-call checklist
- [ ] CRM record open
- [ ] One-pager / case study relevant to their industry ready
- [ ] Calendar slot booked for follow-up
```

## Rules

- **Open-ended questions only.** Yes/no questions waste discovery slots.
- **No more than 10 questions.** Discovery is a conversation, not an
  interrogation.
- **Budget last.** Asking about budget before establishing pain reads
  transactional.
- **Cite the source.** Every hypothesis on the page links to a CRM
  record OR a public source. Otherwise you'll forget where it came from.

## Pitfalls

- Demoing in discovery. The rep who demos in discovery hasn't qualified.
- Asking yes/no questions ("Are you happy with X?"). Always reframe to
  open-ended.
- Skipping the "why now" question. Without it, even "yes" goes nowhere.
- Letting the call run past 30 minutes on first contact. End on time
  and book the next call.
