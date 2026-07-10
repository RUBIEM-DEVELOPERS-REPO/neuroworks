---
name: channel-notify
description: Push a message, result, or alert to one of the operator's connected channels — Slack, Microsoft Teams, Telegram, Discord, Google Chat, or a custom Webhook — using the right primitive.
applies_to: [draft-other, direct-answer]
---

# Skill: Channel notify

## When to use this

The user asks you to "notify", "ping", "post to", "send to the team", "drop a
message in", "alert", or "let X know on <channel>". Also use it proactively
when a long task finishes and the user asked to be told when it's done.

## Process

1. **Discover what's connected.** Call `integration.list` first. It returns the
   providers the operator has wired up (and never any secrets). Do NOT assume a
   channel exists — if the user says "post to Slack" but no Slack connection is
   listed, say so and point them at the Integrations page (`/integrations`).
2. **Pick the matching primitive** for the requested channel:
   | Channel | Primitive |
   |---|---|
   | Slack | `slack.post(text)` |
   | Microsoft Teams | `msteams.post(text)` |
   | Telegram | `telegram.send(text, chatId?)` |
   | Discord | `discord.post(text)` |
   | Google Chat | `googlechat.post(text)` |
   | Custom webhook / Zapier / Make / n8n | `webhook.post(text)` |
3. **If the user didn't name a channel**, prefer the one they use most or the
   only one connected. If several are connected and it's ambiguous, ask — don't
   fan out to all of them.
4. **Write the message for the channel, not for email.** Short, skimmable, one
   idea per line. Lead with the headline. Link out rather than pasting a wall of
   text. Slack/Teams render basic markdown; keep it light.
5. **Confirm delivery from the tool result.** Each primitive returns
   `{ ok: true, posted: true }` on success or `{ error }`. Report what actually
   happened — never claim "sent" off a failed/`error` result.

## Message shape

```
<headline in one line — what happened / what's needed>
<1–3 supporting lines: the number, the link, the next action>
```

## Rules

- **One channel unless told otherwise.** Cross-posting the same alert to four
  places is noise; the operator wired specific channels for specific audiences.
- **Never invent a webhook URL or token.** The primitives read the stored,
  encrypted connection — you only supply `text` (and optionally a Telegram
  `chatId`).
- **Respect length caps.** Discord truncates at 2000 chars; keep alerts terse.
- **Don't notify on every micro-step.** Notify on completion, on a blocker, or
  when the user explicitly asked — not for routine progress.

## Pitfalls

- Calling `slack.post` when only Telegram is connected → fails. Always
  `integration.list` first.
- Dumping a full report into a chat message. Summarize + link instead.
- Treating an `{ error: "no X connection" }` result as success — read the
  result and surface the real outcome (and the fix: connect it on Integrations).
