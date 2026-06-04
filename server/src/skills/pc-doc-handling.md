---
name: pc-doc-handling
description: Read, summarise, and file documents from the user's PC into their NeuroWorks vault — find the file, extract its text, decide whether to capture, and surface what's notable.
applies_to: [summarize, read-doc, draft-other]
---

# Skill: PC document handling

## Goal

The customer has a document on their PC (Downloads, Desktop, Documents) and wants the agent to do something with it — read it, summarise it, file it into the second brain so they can search and reference it later. This skill covers the full flow: find → read → decide → file.

## When to use this skill

The user's request mentions a doc by name AND either:
- asks what's in it ("what's in this doc X", "summarise the PDF Y")
- asks to save it to the vault ("move/copy/save X to my vault / knowledge / neuroworks / second brain")
- both ("read X and save it to my brain")

If the user just wants to read a file without filing it, use [[local-doc-summary]] instead.

## Tool chain

```
fs.find_in (folder=all, name=<partial>) → resolves filename across Downloads + Desktop + Documents + Inbox
   ↓ $step_0.matches.0.path
fs.read_external          → returns extracted text (PDF/DOCX get OCR-extracted to plain text)
   ↓ optional, if user wants it filed
fs.import_to_vault        → copies binary into vault + writes a markdown sidecar with frontmatter, excerpt, link
```

The third step is COPY semantics by default — the original stays on the PC. Only pass `removeOriginal: true` when the user literally says "move and delete" or "remove from my downloads".

## Process

1. **Find the file.** Use `fs.find_in` with `folder: "all"` unless the customer named a specific folder. Newest-first ranking handles "the X I just downloaded" naturally. If 0 matches: tell the customer plainly — don't fabricate a path or pivot to web search.
2. **Read the WHOLE doc, not just the first page.** PDFs front-load preamble; the substance often lives in the middle or end. Skim end-to-end before deciding what's salient.
3. **Identify the doc type.** Reference letter, contract, slide deck, research paper, invoice, resume, memo — each has a different "what matters" shape (see [[local-doc-summary]] for the table). Lead the summary with the doc-type-relevant detail.
4. **Decide whether to file.** Default: if the user said anything that implied filing ("save", "move", "copy", "import", "add to my vault"), file it. Otherwise just summarise and ask the user whether they want it filed.
5. **File with `fs.import_to_vault`.** Default destination is `0-Inbox/` — that's the Obsidian convention for fleeting captures. Use `1-Literature/` only for clearly-reference material (textbook chapters, research papers, articles you want to come back to). Leave `2-Permanent/` to the human — promotion is a deliberate act.

## Output shape

When you read-only:

```
**Document:** <filename> · <pages or word count if known>

**Bottom line:** <2-3 sentences on what the doc is and what it says>

**Key points:**
- <Point 1 — with a quote or specific number if available>
- <Point 2>
- <Point 3-5>

**What you'd want to act on:**
- <Anything that looks like an ask, a deadline, or a decision the reader needs to make>

**Where this lives:**
- On your PC: `<absolute path>`
- _(say so if it's NOT in your vault yet)_
```

When you read AND file:

```
**Document:** <filename> · <pages or word count> · **Filed to:** [[0-Inbox/<filename>]]

**Bottom line:** <…>

**Key points:**
- <…>

**What you'd want to act on:**
- <…>

**Where this lives now:**
- 📁 Filed to your second brain at `0-Inbox/<filename>` — searchable via NeuroWorks Knowledge.
- 📄 Sidecar note: `0-Inbox/<date>-<slug>.md` with the excerpt + frontmatter tags `[imported, neuroworks]`.
- 💻 Original preserved on your PC at `<absolute path>` _(or "removed" if the user asked for that)_.
```

## Rules

- **Quote sparingly but accurately.** Use the actual wording for any claim that could be misremembered (dates, money, names). Wrap quotes in `"…"` with no paraphrasing.
- **Don't fabricate.** If the extractor returned thin or garbled text (scanned image PDF), say so plainly: "I could only extract the first page — the rest looks like images. The full PDF is now in your vault — open it directly to read."
- **Don't go to the web.** This skill is for local content. If the customer also wants context ("what's the legal standard this contract references?") — finish the summary + filing first, then offer to research.
- **Surface what's NOT there.** "The letter doesn't say what role he held" is often as useful as what it does say.
- **Preserve the PC original by default.** Copy semantics, not move. Only delete when the user explicitly said so.
- **Use the right vault folder.**
  - `0-Inbox/` (default) — fleeting captures, things you'll triage later
  - `1-Literature/` — reference material you'll come back to (papers, articles, textbook chapters)
  - `1-projects/` — project-scoped artifacts (contracts for a specific deal, spec for a specific feature)
  - Leave `2-Permanent/` for the human — promotion is a deliberate decision, not an import default.
- **Tell the user where the file landed.** The whole point of filing is so they can find it again — be explicit about the vault path AND the sidecar path.

## Examples of triggering phrases

These all route here:

- "what's in this doc Q3 forecast" — read-only
- "summarise the AIIA Reference Letter" — read-only
- "read resume.pdf" — read-only
- "save this PDF to my vault" — file (with default folder)
- "move the offer letter into neuroworks" — file (move with delete? — depends on follow-up phrasing)
- "copy the contract to my second brain" — file
- "add this doc to my knowledge base" — file
- "file Q3-forecast.pdf to 1-Literature" — file (with explicit folder)
- "save resume.pdf to my vault and delete the original from downloads" — file + remove

## Pitfalls

- Summarising the metadata (date, page count, format) instead of the content.
- Treating the abstract / opening paragraph as the whole doc.
- Generic summary that could apply to any reference letter / any contract — say what's specific.
- Suggesting "you should read the original for more detail" — that's the customer's whole point in asking; just give the detail. (After filing it, link to it.)
- Filing without telling the user where it landed — they need the vault path to find it again.
- Auto-deleting the PC original because the user said "move" — "move" without an explicit "and delete" means copy. Get explicit consent before removing.
- Reading binary as text — `fs.read_external` handles PDF/DOCX/XLSX extraction automatically; don't try to open them with anything else.
- Routing to web research when the doc is local — if the request names a file the user has, never default to web. The [[local-doc-summary]] skill goes further on this.

## How the NeuroWorks knowledge view picks this up

Once `fs.import_to_vault` runs:
1. The binary lands at `<vault>/0-Inbox/<filename>`
2. A markdown sidecar lands at `<vault>/0-Inbox/<date>-<slug>.md` with frontmatter + excerpt + wikilink to the binary
3. The vault commit queue auto-commits + pushes to the `main-brain` repo
4. The NeuroWorks Knowledge page reads from `/api/brain/tree` and `/api/brain/file` — both the binary AND the sidecar appear in the tree on the next load
5. The sidecar's `[[wikilink]]` to the binary is clickable from the Knowledge view

The user doesn't need to refresh manually; the next time they open NeuroWorks Knowledge, the imported file is there.
