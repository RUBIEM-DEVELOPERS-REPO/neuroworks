---
name: follow-up-cadence
description: Decide WHEN and HOW to nudge someone who hasn't replied — and draft the actual nudge. Avoids the dead-air-after-a-cold-send failure mode.
applies_to: [draft-other, draft-memo]
---

# Skill: Follow-up cadence

## Goal

The operator has sent something (proposal, intro, question, ask) and the
other side has gone quiet. This skill decides: (a) is now the right time
to follow up, (b) which channel, (c) what to say. Output is the actual
message, ready to send.

## Cadence table (default — adjust to context)

| Relationship | First follow-up | Second | Third | Then |
|---|---|---|---|---|
| Cold prospect | 3 business days | 1 week later | 2 weeks later | move on, log "no fit" |
| Warm intro | 5 business days | 2 weeks later | (only if you have something new) | move on |
| Existing customer | 2 business days | next day | escalate to manager | call them |
| Internal teammate | 1 business day | same day end-of-day | post in their channel | tag manager |
| Vendor | 2 business days | 1 week | 2 weeks | replace the vendor |

## Process

1. **Establish the relationship type** — cold, warm, customer, teammate,
   vendor. This sets the cadence floor.
2. **Establish the elapsed time** since last contact. If shorter than the
   cadence floor, suggest WAITING and set a reminder instead.
3. **Establish the ASK.** Is the operator nudging because (a) they need
   info, (b) they need a decision, (c) they want to keep the deal alive?
   Each gets a different message shape.
4. **Choose channel.** Email if formal/traceable. Slack/Teams if
   internal-quick. SMS only if the recipient asked for it OR it's an
   urgent existing-customer issue. Never DM a cold prospect on LinkedIn
   if the original was email — channel-bouncing reads desperate.
5. **Write the nudge.** Three tight components: acknowledge the gap
   (one line), give a reason to reply NOW (deadline, new info, decision
   needed), make it cheap to respond (yes/no, pick a slot, one number).

## Output shape

```
**Recommendation:** <Send now / Wait until <date>>

**Channel:** <email / Slack / SMS>

**Draft:**

Subject: <subject — if email>

Hi <Name>,

<acknowledge gap in one line — no apology theatre>

<reason to reply NOW — concrete, dated>

<the cheap-to-answer ask — yes/no, pick X or Y>

<one-line close — no fluff>

— <Operator>
```

## Rules

- **Don't apologise for following up.** "Sorry to bother you, just
  circling back…" reads weak. State the gap, give the reason.
- **Reference the prior message, don't quote it.** "Following on the
  pricing question from Tuesday…" is enough.
- **Cheap response = high response rate.** Yes/no beats open-ended.
  Picking a calendar slot beats "let me know when works".
- **Move on after three.** Logging "no reply after 3" is a signal — they
  said no by not saying anything. Keep your time for prospects who answer.

## Pitfalls

- Cadence so tight you look desperate — 3 emails in 5 days to a cold
  prospect kills the deal.
- Re-pitching the same content. The nudge adds something new (deadline,
  social proof, peer story) or makes the response cheaper.
- Going up the org chart before the original contact has had a fair
  chance. Escalation too early loses the champion.
