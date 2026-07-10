---
name: vault-organization
description: How to write and place notes in the user's Obsidian-style vault so they integrate with the existing structure.
applies_to: [research, summarize, draft-other]
---

# Skill: Vault organization

## Folder map

```
0-Inbox/        — Fleeting / raw / unprocessed. Default landing for new captures.
1-Active/       — Notes related to currently active projects.
2-Permanent/    — Atomic, evergreen insights. Promote from 0-Inbox once matured.
3-Reference/    — External material: papers, articles, snippets, source extracts.
_neuroworks/    — System-generated content (reflections, screenshots). Don't promote.
```

## Where new content goes

| Source | Destination |
|---|---|
| Research run output | `0-Inbox/<YYYYMMDDHHMM>-research-<slug>.md` |
| Multi-perspective report | `0-Inbox/<YYYYMMDDHHMM>-multiperspective-<slug>.md` |
| Email / draft snapshot | `0-Inbox/<YYYYMMDDHHMM>-draft-<slug>.md` |
| Meeting notes | `0-Inbox/<YYYYMMDDHHMM>-meeting-<slug>.md` |
| Reflection (nightly) | `_neuroworks/reflections/<YYYY-MM-DD>.md` |
| Screenshot | `_neuroworks/screenshots/<YYYYMMDDHHMM>-<slug>.png` |

## Frontmatter

Every captured note starts with:

```yaml
---
title: "<descriptive title — searchable>"
created: <YYYY-MM-DD>
source: clawbot-<tool>   # e.g. clawbot-research, clawbot-multiperspective
tags: [<topic>, <persona-if-relevant>]
---
```

## Linking conventions

- **Wikilinks** for vault-to-vault references: `[[2-Permanent/202604271220-neuroworks]]`
- **Markdown links** for external: `[Title](https://url)`
- **Inline citations** in synth output: `[N]` (numbered web source) or `[vault:path/to/note.md]`

## Atomic-note rules (for 2-Permanent/)

- One idea per file. If the note has 3 sections, it's 3 notes that link to each other.
- Title states the idea, not the topic. "Caching invalidates correctness" — not "Caching".
- Open with a 1-sentence claim. The rest of the note justifies that claim.
- Every atomic note links to at least one other atomic note (the network is the value).

## What NOT to write to the vault

- Conversational chat replies (direct-answer outputs). Capture only when there's evidence + a useful summary.
- Drafts the user didn't approve (gate via `NEUROWORKS_VAULT_EDIT=1`).
- Anything that fails the security scan — refuses automatically.
- Re-summaries of existing notes (cluttered the vault). Update the existing note in place instead.
