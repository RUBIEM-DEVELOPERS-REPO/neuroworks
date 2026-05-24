---
name: kb-article
description: Turn a solved support ticket into a help-center article — reproducible steps, named symptoms, ready-to-publish.
applies_to: [draft-other, summarize]
---

# Skill: KB article from solved ticket

## Goal

A user with the SAME symptom finds the article via search, follows the steps, and resolves it without filing a ticket. Single-page, scannable, searchable.

## Process

1. **Pull the SYMPTOM the user typed** — exact phrasing. That's what future users will search for.
2. **Extract the diagnostic question the rep asked** — version, browser, account tier, recent change.
3. **Capture the resolution steps** verbatim from the ticket close, then rewrite as imperative ("Click Settings → Account, not "I had them click...").
4. **Generalise from the one user to the population.** If the bug was "this user's auth token expired", the article is "If you can't log in after X days...", not "This one customer's token expired".
5. **Add a "Still stuck?" footer** linking back to support.

## Output shape

```
---
title: <Symptom phrased as a question or imperative — e.g. "Can't log in after password reset (Safari)">
slug: <kebab-case-symptom>
last-updated: <YYYY-MM-DD>
audience: <Free / Pro / All>
tags: [<symptom-tag>, <feature-area>]
---

# <Title (same as frontmatter)>

## What you'll see

<Plain-English description of the symptom — the user reads this and goes "yes that's me".>

Common errors / messages:
- "<Quoted error text 1>"
- "<Quoted error text 2>"

## Why this happens

<2-3 sentences in plain language. No internal jargon. If the cause is "your auth token expired", explain what that means without the word "token".>

## Fix it in 3 steps

1. **<First action — what to click / where to go>**
2. **<Second action>**
3. **<Verify it worked — what should they see>**

> **Tip:** <Optional gotcha that catches users mid-fix — e.g. "If you're using a corporate VPN, you may need to disable it first.">

## Still stuck?

If those steps didn't fix it, your situation might be different. <Link: Contact support> and share:
- <Specific info we'll need — browser, version, account email>
- A screenshot of the error message

## Related articles
- [<Related article 1>](#)
- [<Related article 2>](#)
```

## Rules

- **Title is the search query.** Users type "can't log in", not "OAuth token refresh failure". Title matches user vocabulary.
- **Steps are imperative + atomic.** "Click X" not "you'll want to click X". One action per step; multi-action steps split.
- **Cause explanation is human-readable.** Not "your JWT expired" — "your sign-in expired (we ask you to sign in again every 30 days for security)".
- **One symptom, one article.** Multi-symptom articles don't get found via search and lose the reader.
- **Always include the still-stuck section** with the exact info support will need — saves the next round-trip.

## Pitfalls

- Copying the ticket verbatim — leaves internal jargon, references that don't generalise.
- Starting with the fix before the symptom — readers bounce when they're not sure it's their issue.
- Adding 10 steps when 3 would do — every extra step is a place users get lost.
- Writing for the "savvy" user — KB readers are stuck, low-context, often frustrated. Plain language wins.
- Forgetting to date the article — KB content rots; a date tells future users (and search) whether to trust it.
