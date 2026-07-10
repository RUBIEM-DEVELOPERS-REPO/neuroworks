---
name: table-making
description: How to design comparison and reference tables — clear axes, scannable rows, no padding columns.
applies_to: [table]
---

# Skill: Table making

## Goal

A table the reader can compare across rows in seconds. Rows = the things being compared. Columns = the dimensions they're compared on. If the reader has to read prose to interpret it, the table isn't doing its job.

## Design rules

1. **Lead column anchors the row.** First column should be the unique identifier (name, option, date, term). Sort by it or by the column the reader cares about most.
2. **Cells are short.** 1-8 words per cell. Anything longer becomes prose with a small table or a list of mini-tables.
3. **Same units per column.** A "Cost" column is all dollars OR all relative ratings — not "$200" / "moderate" / "n/a" mixed.
4. **Symbols beat sentences for status.** ✓ / ✗ / — / 🔶 for yes/no/n-a/partial. Reserve prose for nuanced cases and add a footnote.
5. **3-7 columns, 3-15 rows.** Bigger tables want pagination, grouping, or a different format.
6. **Headers say what's compared, not what it is.** "Latency (p95, ms)" beats "Latency".

## Output shape

```markdown
| <Lead column> | <Dimension 1> | <Dimension 2> | <Dimension 3> |
|---|---|---|---|
| Option A | 12 | $200 | ✓ |
| Option B | 4  | $850 | ✓ |
| Option C | 1  | $2k  | ✗ |

**Bottom line:** <one sentence reading the table for the customer>
```

Always end a comparison table with a one-line read — the table is the evidence, the sentence is the takeaway.

## When NOT to use a table

- Only 2 items being compared → a 2-column "X vs Y" table is overkill; write a paragraph.
- Items don't share the same dimensions → use sections, not rows.
- The "comparison" is just descriptions of each item — that's a list of profiles, not a table.

## Pitfalls

- "Notes" or "Other" column → unstructured cells defeat the format. Inline a footnote instead.
- Markdown alignment cells (`---:`, `:---:`) overused → keep it default-left unless numbers are right-aligned for column comparison.
- Empty cells → use `—` so the reader knows it's intentionally blank, not a gap.
- Burying the recommendation below the table without bolding it → readers stop after the table.
