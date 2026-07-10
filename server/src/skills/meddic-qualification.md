---
name: meddic-qualification
description: How to qualify a B2B sales deal with MEDDIC and turn it into discovery questions a rep can actually ask on the next call.
applies_to: [plan, draft-other, research]
---

# Skill: MEDDIC qualification

## Goal

A clear-eyed read of a deal — what we know, what we don't, what the next concrete action is. Outputs an honest list of unknowns, not a wishful summary.

## Framework (MEDDIC, with PIC variants)

- **M — Metric.** What measurable outcome does the customer expect? ("Cut onboarding time by 50%", "Save 4 FTE", "Cover SOC-2 audit in 30 days".) If we can't name a number, the deal has no business case.
- **E — Economic buyer.** The person who can sign the cheque. Not the champion, not the influencer. By name, by title, and by whether we've met them.
- **D — Decision criteria.** What's their internal rubric for picking us vs not us? Security review? Reference customers? Integration depth? Procurement preference?
- **D — Decision process.** The actual workflow: how do they evaluate (POC, RFP, side-by-side)? Who signs off (security, IT, finance, legal)? How long historically?
- **I — Identified pain.** The pain that justifies action NOW, not "someday". Pain without urgency = no deal.
- **C — Champion.** A person inside the account who is willing to sell us internally when we're not in the room. Not "the contact". Someone who has stake in our success.

## Output structure

```
## Deal qualification — <Account name>

| MEDDIC slot | What we know | Confidence | What we still need |
|---|---|---|---|
| Metric | <…> | high/med/low | <…> |
| Economic buyer | <…> | … | … |
| Decision criteria | … | … | … |
| Decision process | … | … | … |
| Identified pain | … | … | … |
| Champion | … | … | … |

## Risks
- <Specific risk, e.g. "no champion identified — single point of failure if our contact moves teams">
- <…>

## Discovery questions for the next call (6-8)
Each one is open-ended, anchored to a MEDDIC slot we're weak on. Examples:
- (M) "If this works, what changes for your team in 90 days?"
- (E) "Who else needs to see this before you'd commit budget?"
- (D-process) "Walk me through the last vendor you bought at this price point — how did it move?"
- (Champion) "Who else on your team would feel the difference if we shipped this?"

## Recommended next step
<One concrete action with a date — not "follow up next week".>
```

## Rules

- **Honesty over wishful thinking.** If you don't know who the economic buyer is, write "unknown" — don't invent one. Inventing rots the forecast.
- **Confidence ratings are required.** "We know X" with no confidence rating hides the weakness.
- **Risks are named, not implied.** "No compelling event" is a risk worth flagging — most reps bury it.
- **Discovery questions are open-ended.** No yes/no questions, no leading questions ("you'd agree that…").
- **The next step has a date.** "Follow up" without a day is theatre.

## Pitfalls

- **Treating influencer as champion.** Someone who likes you isn't a champion. A champion will SELL for you when you're not there.
- **Pain without urgency.** "They have a problem" doesn't move budget. "Their auditor flagged this and they have 60 days" does.
- **Listing features instead of metrics.** "They want our API gateway" isn't a metric — "they want to cut 30% off latency by Q3" is.
- **Champion = our contact.** If we've met one person and called them the champion, that's hopium.
- **Counting POC interest as buying signal.** POCs that don't have decision criteria locked in are POCs that die in stage 4.
