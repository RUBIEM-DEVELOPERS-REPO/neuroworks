---
name: precedent-finder
description: "Have we done X before?" — searches the vault + jobs journal for prior work on a similar request. Saves the operator from reinventing wheels.
applies_to: [direct-answer, summarize]
---

# Skill: Precedent finder

## Goal

The operator is about to start a piece of work. Before they do, this
skill checks whether they (or the team) have already done something
similar. If yes — surface the prior work so it can be adapted. If no —
say so cleanly.

## Process

1. **Extract the canonical phrasing of the request.** "Write a security
   one-pager for finance customers" → search terms: "security one-pager",
   "finance customer", "compliance".
2. **Search the vault.** `vault.search` across `_company/`, `2-Permanent/`,
   and `0-Inbox/` (in that priority order — promoted notes first).
3. **Search the jobs journal.** Look for past jobs with similar titles
   or that used the same template. The reflection's job stats are also
   a source.
4. **Rank by quality + recency.** Recent + high quality > old + high
   quality > recent + draft. Surface the top 3.
5. **For each precedent, name:**
   - What it is + where it lives (path / job id)
   - When + by whom (if recorded)
   - How relevant (high / medium / low) and WHY
   - What's adaptable + what's NOT (audience, date, segment)
6. **If nothing found, say so.** "No vault or job precedent — this is
   greenfield." Better than a forced match.

## Output shape

```
# Precedent check — <one-line on the request> · <YYYY-MM-DD>

## Found ( <N> )

### 1. <Title or path> — **Relevance: High**
- **Where:** `<vault path>` or [job <id>](/results/<id>)
- **What it is:** <one-line>
- **When + who:** <date, person>
- **Reusable bits:** <2-3 bullets — sections, structure, language>
- **What to change:** <audience / date / specifics that won't transfer>

### 2. <…> — **Relevance: Medium**
<…>

### 3. <…> — **Relevance: Low** (only included because nothing better)
<…>

## Not found
- <If applicable: "no prior security one-pagers in `_company/`. This is
  the first.">

## Suggested next step
- **Adapt:** Start from precedent #1, change <X, Y> for this audience.
- **Or fresh:** No reuse-worthy precedent; draft from scratch.
```

## Rules

- **Relevance ratings are honest.** Don't pad medium into high just to
  look helpful.
- **Cite the path or job id every time.** Without it, the precedent
  can't be used.
- **Name what DOESN'T transfer.** Most precedents are adaptable but
  not copy-pastable — say what changes.
- **No precedent is a valid finding.** "First time we've done this"
  shapes how the operator approaches the task.

## Pitfalls

- Surfacing 10 precedents. Operator only has time for the top 3.
- Treating a Slack-export note as the same quality as a promoted
  2-Permanent note. Promote-status is a signal.
- Forgetting to say "this won't transfer because the audience is
  different." Saves time later.
- Pulling precedents from years ago without flagging the date. Old
  precedents may reflect old positions.
