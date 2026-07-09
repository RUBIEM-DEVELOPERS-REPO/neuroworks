---
name: dataset-publish
description: Publish cleaned rows as a dataset through the Intellinexus data pipeline (normalize → score → publish) so other agents can learn from it via RAG, or look up what's already published.
applies_to: [draft-other, dataset-publish]
---

# Skill: Publish to Intellinexus

## When to use this

The user asks to "publish this data", "turn this into a dataset", "make
this available to the other agents", or "add this to Intellinexus /
the knowledge base / the data pipeline" — this is for STRUCTURED rows
(a table, a list of records) becoming a reusable, queryable dataset, not for
filing a single document (`pc-doc-handling`) or writing a note
(`vault-organization`).

The distinction that matters: publishing here means the org's OTHER agents
can pull this data into future answers via RAG. A one-off memo doesn't
belong here; a cleaned table of numbers, contacts, or records that should
inform future work does.

## Process

1. **Check what's already published** first with `data.list_datasets` — if
   a dataset with the same subject already exists, consider whether this is
   an update to it rather than a duplicate.
2. **Shape the rows** into a consistent record shape — every row should have
   the same fields. Drop obviously broken/incomplete rows rather than
   publishing garbage; note what you dropped and why.
3. **Publish** with `data.publish`:
   ```
   data.publish({
     name: "reflections-2026-07-08",      // short, dated, descriptive slug
     rows: [ { ...record }, { ...record } ],
     sector: "operations",                 // the department/domain this belongs to
     keyField: "template"                  // the field that uniquely identifies a row
   })
   ```
4. **Confirm from the result** — it returns confirmation of what was
   published (row count, dataset id). Report that back, not an assumption.
5. **Tell the user where it surfaces**: published datasets appear on the
   Data Pipeline (Intellinexus) page and become knowledge other agents draw
   on in RAG — not an immediate visible change anywhere else.

## Rules

- **Never publish unvetted or fabricated rows.** Every row must trace back
  to a real source (a file you read, a query you ran, data the user gave
  you) — this feeds every other agent's future answers, so garbage in here
  propagates.
- **Pick a `keyField` that's actually unique** per row — a bad key makes the
  dataset unreliable for lookups later.
- **Sector matters** — it's how the dataset gets surfaced to the right
  department's agents. Guess conservatively; ask if genuinely unclear.

## Pitfalls

- Publishing raw, un-normalized data (inconsistent field names/types across
  rows) — normalize the shape first.
- Re-publishing the same data under a new name instead of checking
  `data.list_datasets` first — creates duplicate/conflicting knowledge.
- Treating this as a substitute for `vault.write`/`vault.create_zettel` when
  the user actually wanted a written note or document, not a structured
  dataset.
