---
title: Dataset statement
audience: AI Grand Challenge 2026 adjudicators
track: Track 3 — Development
maps_to: Section 6 (Dataset Statement), Section 3 rubric (Dataset Provenance and Synthetic Validation)
version: 1.0.0
date: 2026-07-11
---

# NeuroWorks — Dataset statement

NeuroWorks does not ship with a pre-collected dataset. It ships with a
**data-readiness pipeline** (internally: ADRS / Intellinexus) that takes
whatever data an operator already has — their own notes, their own
databases, or openly-licensed material they choose to pull in — and turns
it into a versioned, provenance-tracked, machine-ready artifact the AI
workforce can retrieve from. This document describes that pipeline, states
where every piece of data in the current running instance actually came
from, and is honest about what isn't done yet.

## 1. The pipeline itself

Every dataset published through NeuroWorks passes through the same seven
stages, implemented in `server/src/lib/adrs.ts`:

1. **Normalization** — keys canonicalised, values trimmed and type-coerced
   (numeric-looking strings become numbers, `"n/a"`/`"none"`/`""` become
   null) so downstream fields are consistent regardless of source shape.
2. **Cryptographic hashing** — every record gets a SHA-256 hash; the whole
   batch gets a Merkle-style root hash. This is the tamper-evident anchor —
   if a published dataset is later challenged, the root hash proves whether
   the artifact matches what was originally published.
3. **Confidence scoring** — each record is scored 0–1 on field completeness
   against the dataset's own field universe.
4. **HITL (human-in-the-loop) gate** — records below a confidence threshold
   (default 0.6) are flagged into a review queue instead of silently
   publishing low-quality rows.
5. **Entity resolution** — records are deduplicated and merged into a single
   "golden record" per entity, either by an explicit key field or by
   content hash when no key is given.
6. **Publishing** — four machine-ready artifacts land in the vault under
   `_datasets/<id>/`: an ML-ready CSV, a knowledge-graph JSONL (one node per
   entity, one edge per non-null field), a RAG-chunked markdown file (one
   section per record), and a human-readable pack card documenting
   provenance, field list, and pipeline stage report.
7. **Retrieval** — because the artifacts live in the vault, they're indexed
   automatically. Every published dataset surfaces on the Knowledge Packs
   page and gets retrieved by the agent like any other vault content — this
   is the actual mechanism by which "agents learn from the data," not a
   separate training step.

The acquisition front-end (`server/src/lib/omnisignal.ts`) feeds this
pipeline from five source kinds: web search results, fetched web pages,
read-only queries against an operator-connected database, local documents,
or the vault's own content — each record is tagged with its source,
category, and acquisition timestamp before it enters the pipeline above.

## 2. What data actually exists in the running instance right now

Two real, currently-published datasets, queryable via `GET /api/datasets`
or the `data.list_datasets` primitive:

| Dataset | Source | Records | Avg. confidence | HITL review queue | Root hash (truncated) |
|---|---|---|---|---|---|
| Awesome — Curated Software & Resource Lists | `github.com/sindresorhus/awesome` | 682 | 93.8% | 0 | `eb1b0fe4a363a372…` |
| Daily reflection series (10 batches, 2026-07-03 → 2026-07-10) | NeuroWorks' own nightly self-audit | 2–6 per batch | 87.5–91.7% | 0 | (per-batch, see `_datasets/`) |

**The Awesome dataset** is a worked, end-to-end proof of the pipeline
against real third-party data: the source repository's `readme.md` was
parsed into 682 structured records (category, name, url, description),
deduplicated on `url`, and published with a full stage report. **Licence:
CC0-1.0** (public domain dedication), verified directly against the GitHub
repository's licence metadata before ingestion — not assumed.

**The reflection series** is NeuroWorks publishing its own operational
self-audit (task volumes, failure patterns, tool success rates) through the
same pipeline it offers operators — a second, self-referential proof that
the pipeline handles more than one shape of input.

## 3. Operator-connected data

As of 2026-07-11, one external operator database is connected: a
production PostgreSQL instance backing an operator's website, registered
**read-only**. It exposes 24 tables (users, admins, program applications,
event registrations, payments/transactions, contacts, page-visit logs) via
`db.list_sources` / `db.describe_table` / `db.query` — the agent can query
it live, but every source is registered read-only by default (a write
requires the operator to explicitly flip `readonly: false` on that
specific source when they register it; no source has that flag set today).

**Lawful basis:** this is the connecting operator's own data, registered by
the operator, at the operator's own instance. NeuroWorks does not collect,
store a copy of, or transmit this data anywhere beyond what a query
explicitly returns to the agent run that requested it. The connection
string is encrypted at rest (AES-256-GCM, `server/src/lib/secret-box.ts`)
and lives in `.neuroworks/data-sources.json`, which is excluded from
version control.

**PII disclosure:** the connected database's `users`/`admins`/`payments`
tables contain what any operational website's user table contains —
personal and financial identifiers belonging to the operator's own users.
NeuroWorks does not inspect, export, or publish this data through the ADRS
pipeline; it is queried live, per-request, and the result is scoped to
whatever the requesting task actually asked for. **Handling this data
lawfully (consent basis, retention, subject access) is the connecting
operator's responsibility as data controller** — NeuroWorks is a processor
acting on read-only instructions, the same posture as any BI/analytics tool
pointed at the same database.

## 4. Synthetic data

None is used anywhere in the current instance. If synthetic data is ever
generated for testing NeuroWorks itself (e.g. seed fixtures for the test
suite), it will be disclosed as synthetic in the same file it's generated
in — none of the 118 current tests fabricate data that gets published as a
real ADRS dataset; test fixtures and published datasets are structurally
separate (test fixtures never touch `_datasets/`).

## 5. Known limitations, stated honestly

- **Confidence scoring is completeness-based, not accuracy-based.** A
  record with every field filled scores 1.0 even if a field's *value* is
  wrong — the pipeline catches missing data, not incorrect data. Accuracy
  validation is a known gap, not a claimed feature.
- **Entity resolution is hash- or key-based, not fuzzy.** Two records that
  refer to the same real-world entity but are keyed or hashed differently
  (typo'd name, reformatted date) will publish as two golden records, not
  one merged one.
- **The Awesome dataset's descriptions are the source maintainer's own
  text**, not independently fact-checked — provenance (where it came from)
  is verified; the *content* of third-party descriptions is not.
- **Only one operator database is connected today.** The multi-source
  acquisition front-end (web/db/file/vault) is built and tested, but the
  breadth of "real data connected" is currently one production database and
  one open dataset, not a large corpus — stated plainly rather than implied
  otherwise.

## 6. Provenance is verifiable, not just claimed

Every published dataset's root hash, stage report, and record count are
readable directly from `_datasets/<id>/00-<name>.md` in the vault, and from
`GET /api/datasets/:id`. An adjudicator can request the root hash for any
dataset cited above and recompute it against the published CSV/JSONL to
verify nothing was altered after publication — the hash exists specifically
so that claim is checkable, not just asserted.
