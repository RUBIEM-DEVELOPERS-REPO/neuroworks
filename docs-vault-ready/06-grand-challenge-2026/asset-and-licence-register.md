---
title: Asset and licence register
audience: AI Grand Challenge 2026 adjudicators
track: Track 3 — Development
maps_to: Section 11 (Asset and Licence Register)
version: 1.0.0
date: 2026-07-11
---

# NeuroWorks — Asset and licence register

## 1. Original code

All original source code (`server/`, `web/`, `sdk/`, `tools/`) is authored
by the NeuroWorks team. Licensing position: proprietary, all rights
reserved, with an explicit evaluation/demonstration/pilot licence granted
to POTRAZ for the Grand Challenge — full text in
[`LICENSE`](../../LICENSE) at the repository root. Ownership is disclosed
there rather than assumed.

## 2. Third-party libraries

A production-dependency licence audit was run 2026-07-11 with
`license-checker-rseidelsohn` across both workspaces. Reproducible with:

```bash
npx license-checker-rseidelsohn --production --summary   # from repo root
npx license-checker-rseidelsohn --production --summary   # from server/
npx license-checker-rseidelsohn --production --summary   # from web/
```

**Server workspace — 254 production packages:**

| Licence | Count |
|---|---|
| MIT | 204 |
| BSD-3-Clause | 11 |
| ISC | 10 |
| BSD-2-Clause | 10 |
| Apache-2.0 | 9 |
| MIT-0 | 3 |
| (MIT OR EUPL-1.1+) | 2 |
| MIT OR GPL-3.0-or-later | 1 |
| (MIT AND Zlib) | 1 |
| BSD* | 1 |
| BlueOak-1.0.0 | 1 |
| 0BSD | 1 |
| UNLICENSED | 1 *(this package itself — resolved by the LICENSE file added 2026-07-11)* |

**Web workspace — 43 production packages:** 41 MIT, 1 ISC, 1 0BSD, 1
UNLICENSED (this package itself, same resolution).

**No copyleft-only (GPL/AGPL/LGPL without a permissive alternative)
dependency was found in either workspace.** The one dual-licensed entry
(`MIT OR GPL-3.0-or-later`) is consumed under its MIT option. This is a
genuinely clean tree, not an unchecked one — the audit above is a real
command an adjudicator can re-run against the committed lockfiles.

**Named exceptions worth calling out specifically:**
- `xlsx` (SheetJS) — Apache-2.0, sourced directly from the maintainer's own
  CDN per their current distribution recommendation (`server/package.json`)
  rather than the deprecated npm registry listing.
- `pg` (node-postgres) — MIT, added 2026-07-11 to support the first live
  operator database connection.

## 3. AI models and services

| Model / service | Access | Terms |
|---|---|---|
| Ollama (qwen2.5 and other open-weight local models) | Self-hosted, local inference | Model-specific open-weight licence (varies by model pulled; Ollama itself is MIT) |
| Anthropic Claude (Fable 5, Haiku 4.5, Sonnet, Opus) | Hosted API, BYO key | Anthropic's API Terms of Service |
| OpenRouter (multi-provider routing, incl. free-tier models) | Hosted API, BYO key | OpenRouter's Terms of Service |
| MiniMax (optional, env-gated) | Hosted API, BYO key | MiniMax's Terms of Service |

No model is fine-tuned or custom-trained by NeuroWorks — all are used as
provided by their publisher, under that publisher's own terms.

## 4. Datasets

See the [Dataset Statement](dataset-statement.md) for full detail. Summary:
the Awesome dataset is CC0-1.0 (public domain, verified against the source
repository's licence metadata); the reflection-series datasets are
NeuroWorks' own operational output; the connected operator database is the
connecting operator's own data, used under their own authority as data
controller.

## 5. External APIs

| API | Purpose | Terms position |
|---|---|---|
| GitHub REST API | Repo digest, issue/PR actions, vault sync | GitHub's API Terms of Service; access via a scoped fine-grained PAT |
| Mailjet | Outbound email — the only sanctioned send path | Mailjet's Terms of Service |
| Stripe | Payment collection | Stripe's Terms of Service |
| Paynow | Zimbabwe-market payment collection | Paynow's Terms of Service, merchant integration |
| Connectors framework (generic) | Any operator-configured external API | Per-connector, set by the operator at registration time; SSRF-guarded, credentials encrypted at rest |

## 6. Design assets

No custom fonts, icons, or template assets are used — the web UI is built
with `lucide-react` (ISC-licensed icon set) and Tailwind CSS (MIT) utility
classes; no proprietary or unlicensed design asset is incorporated.

## 7. Background vs. foreground IP

**Background IP** (pre-existing, brought into this submission): the
open-source dependencies listed above, used under their own licences; no
other pre-existing proprietary IP is incorporated.

**Foreground IP** (created for/during the Grand Challenge): the agent
planning/execution engine, the governance policy-enforcement gate, the
ADRS/Intellinexus data pipeline, the sector-pack knowledge, the
cost-tracking and reflection-action systems, and all product documentation
in this repository. Proposed ownership and licensing position: as stated
in [`LICENSE`](../../LICENSE) — proprietary to the NeuroWorks authors, with
the Grand Challenge evaluation carve-out.
