---
name: local-doc-summary
description: How to read and summarize a local file the user pointed to (PDF, DOCX, Markdown, etc.) — use the extracted content, don't research the web.
applies_to: [summarize, read-doc, explain]
---

# Skill: Local document summary

## Goal

The customer has a file. They want to know what's inside without reading it themselves. Open it, surface the substance, and tell them what's notable.

## Process

1. **Find the file first.** Use `fs.find_in` with `folder: "all"` (sweeps Downloads + Desktop + Documents + Inbox) when the customer hasn't named a folder. If they did name one (`my downloads`), use that — fewer paths to walk.
2. **Read with `fs.read_external`.** Handles PDF, DOCX, XLSX, plain text, and Markdown via the extractor. Returns plain text the synth can reason over.
3. **Read the WHOLE thing, not the first paragraph.** PDFs especially front-load preamble and back-load conclusions. Skim end-to-end before deciding what's salient.
4. **Identify the doc type.** Reference letter, contract, memo, slide deck, research paper, invoice — each has a different "what matters" shape (see below).
5. **Summarize for the customer's use, not in abstract.** "What's in this doc?" → the customer wants to act on it; lead with the actionable bits.

## Output shape by doc type

| Doc type | Lead with |
|---|---|
| Reference / recommendation letter | Who wrote it, who it's about, the strength of the endorsement, any specific evidence cited |
| Contract / agreement | Parties, term, money, key obligations, exit clauses, surprises |
| Slide deck | Top-level argument, key chart/number, recommended action |
| Research paper | Claim, method, sample size, finding, limitations |
| Memo / report | Bottom line, decision/recommendation, owners + dates |
| Invoice / receipt | Vendor, amount, period, line items, due date |
| Resume / CV | Most recent role, 2-3 standout achievements, total years |

Default template when type is unclear:

```
**Document:** <filename> · <pages or word count if known>

**TL;DR:** <2-3 sentences on what the doc is and what it says>

**Key points:**
- <Point 1 — with a quote or specific number if available>
- <Point 2>
- <Point 3-5>

**What you'd want to act on:**
- <Anything that looks like an ask, a deadline, or a decision the reader needs to make>

**Open questions / gaps:**
- <Things the doc doesn't say but a reader might wonder about>
```

## Rules

- **Quote sparingly but accurately.** Use the actual wording for any claim that could be misremembered (dates, money, names). Wrap quotes in `"…"` with no paraphrasing.
- **Don't fabricate.** If the extractor returned thin or garbled text (binary PDF, scanned image), say so plainly: "I could only extract the first page — the rest looks like images. Want me to try OCR?"
- **Don't go to the web.** This skill is for local content. If the customer also wants context ("what's the legal standard this contract is referring to?") — finish the summary first, then offer to research.
- **Surface what's NOT there.** "The letter doesn't say what role he held" is often as useful as what it does say.

## Pitfalls

- Summarizing the metadata (date, page count, format) instead of the content.
- Treating the abstract / opening paragraph as the whole doc.
- Generic summary that could apply to any reference letter / any contract — say what's specific.
- Suggesting "you should read the original for more detail" — that's the customer's whole point in asking; just give the detail.
