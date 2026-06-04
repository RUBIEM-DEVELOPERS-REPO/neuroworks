---
name: expense-report
description: Turn uploaded receipts (photos, PDFs) into expense lines — vendor, date, amount, category, tax. Uses OCR for image receipts and pdf-parse for digital ones.
applies_to: [summarize, draft-other]
---

# Skill: Expense report

## Goal

The operator drops a folder / inbox attachment of receipts and gets back
a structured expense report with each line ready to paste into the
company's expense tool (or finance system via db.query if connected).

## Process

1. **Identify the receipts.** From an attachments list OR `fs.find_in`
   on Downloads / Desktop. Filter to images (.png, .jpg, .heic) + PDFs
   that look like receipts.
2. **Extract content per receipt:**
   - For text-extractable PDFs: `fs.read_external` returns the text.
   - For image-only PDFs / photos: `doc.ocr` returns the OCR text.
3. **Parse the receipt structure** — vendor, date, total, tax, items
   (if itemised), payment method (if shown).
4. **Categorise** using the operator's chart of accounts (if known) or
   the standard buckets: travel, meals, accommodation, software,
   office supplies, client entertainment, conference, other.
5. **Flag anything unusual** — missing date, illegible total, foreign
   currency, suspected duplicate, exceeding company policy.

## Output shape

```
# Expense report — <Operator> · <period>

## Summary

| Category | Lines | Total |
|---|---|---|
| Travel | <N> | $<X> |
| Meals | <N> | $<X> |
| Software | <N> | $<X> |
| Other | <N> | $<X> |
| **Total** | <N> | $<X> |

## Lines

| # | Date | Vendor | Description | Amount | Tax | Category | Receipt |
|---|---|---|---|---|---|---|---|
| 1 | 2026-06-02 | Uber | Airport → Office | $42.15 | $3.50 | Travel | `receipts/uber-0602.pdf` |
| 2 | 2026-06-02 | Starbucks | Client meeting | $18.40 | $1.40 | Meals (client) | `receipts/starbucks-0602.jpg` |
| <…> | <…> | <…> | <…> | <…> | <…> | <…> | <…> |

## Flags (need operator review)
- **Line <N>:** <issue> — e.g., "OCR returned $1240 but receipt clearly
  shows $124.0 — confirm before submitting"
- **Line <N>:** Missing date — fall back to file mtime?
- **Line <N>:** Possible duplicate of Line <M>

## Foreign currency conversions
- <Vendor> charged €34.50; converted at <rate> to $<X> as of <date>

## Policy check
- <Any line that exceeds policy limits — meal cap, client entertainment
  cap, etc., assuming policy is in `_company/expense-policy.md`>
```

## Rules

- **Every line cites a receipt file.** Without provenance, finance
  rejects.
- **Flag ambiguity rather than guess.** "Could be $124 or $1240" beats
  an incorrect submission.
- **Round-trip the totals.** Sum the lines and the category totals
  match.
- **Don't categorise where unclear.** "Other" is honest; a wrong
  category creates an audit issue.

## Pitfalls

- Trusting OCR blindly. Photos of glossy receipts often misread
  decimals.
- Forgetting tax lines. Some receipts list tax separately; some bundle
  it.
- Skipping the policy check. If the operator's company has a meal cap
  and a line exceeds it, surfacing it saves a follow-up.
- Treating a tip-included total as the base. Confirm whether the total
  includes tip before recording.
