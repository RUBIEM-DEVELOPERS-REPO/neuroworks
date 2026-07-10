---
title: User guide — Natural-language task intake
audience: end-users
version: 0.2.0
tags: [user-guide, chat, intake, natural-language]
---

# User guide — Natural-language task intake

> Type what you want done. We'll figure out who should do it, what tools to
> use, and surface the result. No prompts to learn.

## What it is

Every typed message in the Chat page is interpreted through five layers, in
order of cost. The first layer that confidently matches handles your
request; everything else stays out of the way.

| Layer | When it fires | Latency |
|---|---|---|
| Arithmetic short-circuit | Pure number expressions: `12 * (7-3)`, `what's 2+2` | < 50 ms |
| Date/time short-circuit | "What's the date today?", "What time is it?" | < 50 ms |
| Regex action routing | "Add a note: …", "Sync my downloads", "Run digest", "Search my vault for …" | 1–3 s |
| Template intent inference | The customer's wording matches a saved template's intent | 2–5 s |
| Full agent (plan + execute + synth) | Everything else | 20–120 s |

You never pick the layer — it picks itself. You just type.

## What you can type

### Capture & retrieval
- `Add a note: Pricing decision — keep the $29/mo tier as the headline`
- `Search my notes for everything about the AURORA-7 launch`
- `What do I know about the latest Q4 forecast?`
- `Browse my vault`

### Project / repo work
- `Summarise the RUBIEM-DEVELOPERS-REPO/clawbot repo`
- `Run digest for the last 14 days`
- `Publish the folder C:\Users\Arthur Magaya\Desktop\demo-bundle`

### Knowledge work
- `Draft a launch announcement for the v0.2.0 release`
- `Write a JD for a senior backend engineer focused on payments`
- `Review the attached contract and flag the high-risk clauses`
- `Plan our migration off the legacy auth middleware`

### Follow-ups
- `Make it shorter`
- `Rewrite the second paragraph as bullets`
- `Give me three key bullets`
- `What about Q4?`

All four of the follow-up shapes above resolve against the previous answer
without sending you a "be more specific" follow-up.

## Tips

- **Open with the verb you mean.** "Draft", "summarise", "search",
  "review", "plan", "fix" — the intent extractor matches on these.
- **Name the deliverable shape if you care about it.** "as a numbered
  list", "as a 1-pager", "as bullets", "as an email to Sarah".
- **Attach a doc** for tasks that should be grounded in something
  specific — see the [Document uploads](#document-uploads) section below.
- **Switch topics explicitly.** Start with "new task:", "switching gears",
  or just say `hi` to reset the thread.

## Document uploads

Click the 📎 paperclip in the Chat input row to attach a document. The
toggle next to it (`context` / `vault`) controls where the doc goes:

- **context** — staged for THIS thread only, expires in 1 hour. The
  extracted text is folded into the next message you send. Pick this for
  one-off questions about a PDF / DOCX / spreadsheet.
- **vault** — permanent import into your knowledge base under `0-Inbox/`.
  Pick this when the doc is reference material you'll want to find later.

After a successful context upload a chip appears above the input ("📎
filename · 4,213 chars"). You can attach multiple chips, remove any of
them with ✕, and either type an accompanying message or send empty (the
system will produce a structured summary automatically).

**Cap:** 20 MB decoded. Larger docs should be vault-imported and queried
via `search my vault for …`.

## Past sessions

Your last three chat threads appear as chips under the header. Click one to
swap that thread back into view. Snapshots happen automatically after every
exchange — you don't have to click "save session".

To start fresh: click "New session" in the top-right; the prior thread
remains in the recent chips for one-click resume.

## When a persona is active

If you've activated a persona on the Personas page, the chat header shows
"Hi, I'm Maya" (or whichever persona). Tasks you type are interpreted
through that persona's lane — they'll refuse ("hand-off") cleanly when the
task is outside their job.

If no persona is active, the chat auto-routes the task to the right
specialist when the wording is distinctive enough (e.g. "MEDDIC discovery
questions" → account-executive, "SOP for vendor onboarding" →
operations-coordinator). Ambiguous tasks stay on the generalist.

## Frequently asked

**Q: How do I cancel a task that's running too long?**
A: Open Tasks → click the running job → there's a Cancel button if the
job is still in `running`. Completed jobs can be deleted from the same
page.

**Q: Why did my answer come back from a different model?**
A: When `quality.check` fails on a draft, the agent automatically retries
with the large OpenRouter tier. The header on the answer shows which model
produced the final version.

**Q: I uploaded a PDF but the answer doesn't mention anything from it.**
A: Check the job log on the Tasks page — look for the line "folded N
attachment(s) into task". If the line is there but the answer is generic,
re-send with a more specific instruction ("name the codename, owner,
budget, and dates from the attached brief").
