---
name: research-deep
description: How to do solid research that grounds claims in real evidence — vault first, web second, no hand-waving.
applies_to: [research, summarize, explain, analyze]
---

# Skill: Deep research

## Goal

Produce a short answer that the user can trust, with every substantive claim traceable to a source.

## Process

1. **Vault first.** Search the user's notes (`vault.search`) before going to the web. The user's own notes are higher-trust than any web source for topics they've thought about. Read the top 1-3 matches with `vault.read`.
2. **Web only when needed.** If the vault has no coverage OR the topic is time-sensitive ("latest", "2026", "recent"), run `web.search` then fetch the top 2-3 results in parallel via `smartFetch`. Three sources is enough; more usually means noise.
3. **Cite everything.** Every substantive sentence ends with `[N]` (web source number) or `[vault:path/to/note.md]`. Unsourced claims = hallucination risk.
4. **Resolve contradictions.** When two sources disagree, NAME the disagreement and say which way the evidence leans. Don't paper over.
5. **Capture.** Write a 0-Inbox note via `vault.write` so the next research run finds it.

## Output shape

```
**TL;DR:** <one sentence with the answer>

## What we know
- Claim 1 [1]
- Claim 2 [2][vault:2-Permanent/note.md]

## Open questions
- Thing we couldn't pin down

## Sources
1. [Title](url)
2. [Title](url)
```

## Pitfalls

- Quoting a search snippet without reading the actual page → wrong claims.
- One source = one perspective. Aim for 3 minimum on contested topics.
- Going straight to web when the vault has the answer.
