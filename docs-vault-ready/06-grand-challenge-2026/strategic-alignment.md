---
title: Strategic alignment — Zimbabwe and national priorities
audience: AI Grand Challenge 2026 adjudicators
track: Track 3 — Development
maps_to: Section 2 (Strategic Alignment)
version: 1.0.0
date: 2026-07-11
---

# NeuroWorks — Strategic alignment, Zimbabwe and national priorities

This is written to name specific initiatives and pillars, not assert
general national-development sentiment — the checklist itself warns that
"this product supports Zimbabwe's development" is not sufficient alignment.
Where a claim below is a stretch, it's marked as such rather than forced.

## 1. Target user and beneficiary

Zimbabwean and SADC-region organisations and their operating teams: a
fintech's reconciliation desk, an agricultural NGO's field-reporting team,
a school's admin office, a public-sector procurement unit, a tourism
operator's booking desk. Not a consumer product — an operational tool for
the people who currently do this work by hand.

## 2. Sector coverage — named, not generic

NeuroWorks ships 12 built-in sector context packs
(`server/src/lib/sector-packs.ts`), each carrying real institutional detail
rather than placeholder text. Of the Grand Challenge's own listed priority
sectors — *fisheries, future skills, finance, tourism, agriculture, health,
energy, public services, education, informal economy* — NeuroWorks covers
**7 directly**:

| Priority sector | NeuroWorks pack | Named institutions / programs |
|---|---|---|
| Finance | Fintech | RBZ (Reserve Bank of Zimbabwe), EcoCash, OneMoney — mobile money reconciliation, agent network management |
| Agriculture | Agriculture | Pfumvudza/Intwasa (government smallholder program), GMB, input financing |
| Health | Health | MOHCC (Ministry of Health), DHIS2 — stock-out prediction, community health worker coordination |
| Education | Education | ZIMSEC (exam board), the 2-7-4-2-4 curriculum structure, teacher-shortage and rural-infrastructure gaps |
| Tourism | Tourism | ZTA (Zimbabwe Tourism Authority), the UNIVISA/KAZA cross-border scheme, Victoria Falls / Hwange / Great Zimbabwe |
| Public services | Public sector | PRAZ (procurement compliance), devolution agenda, ZIMRA, records management across paper and digital systems |
| Informal economy | Retail | Informal markets by name (Mbare Musika, kopje trading), USD/ZWL dual pricing, delivery logistics in high-density suburbs |

Two more packs (mining — ZIMRA royalty compliance, artisanal mining
regulation; development/NGO — WFP/WHO/UNICEF/UNDP reporting cadences) sit
outside the checklist's named list but extend the same real-institution
approach. *Fisheries, future skills, and energy are not covered by a
dedicated pack today* — stated plainly rather than stretched to fit.

## 3. National AI Strategy alignment

Of the five stated priorities, three have a direct, evidenced fit; one has
a real but partial fit; one is not claimed.

- **Sovereign AI infrastructure — direct fit.** The default install runs
  entirely on a local, open-weight model (Ollama) with zero API keys and
  zero mandatory dependency on a foreign cloud provider. Cloud models are
  an *optional* escalation path the planner reaches for only when task
  complexity demands it, not a requirement to function at all. An
  institution can run NeuroWorks with its data never leaving its own
  machine — the architecture makes this the default, not a special
  "offline mode."
- **MSME and informal economy inclusion — direct fit.** The retail sector
  pack targets informal-market operators specifically (see §2). Native
  Paynow integration (a Zimbabwe-market payment gateway) lowers the barrier
  for a small operator to collect digital payments without building
  payment infrastructure themselves.
- **Public sector efficiency — direct fit.** The public-sector pack names
  PRAZ procurement compliance and citizen-facing turnaround times
  specifically; the governance engine (accepted-policy enforcement, a full
  audit trail on every gate decision — see the [Risk
  Note](risk-note.md)) is exactly the kind of accountability layer a public
  institution would require before adopting an AI tool for real decisions.
- **National data assets — partial fit, stated honestly.** The ADRS
  provenance pipeline (see the [Dataset Statement](dataset-statement.md))
  is architecturally capable of building governed, hash-verified datasets
  at institutional scale. Today it operates at single-operator scale, not
  literally as national infrastructure — this is a real capability, not yet
  a deployed national asset.
- **AI skills development — not claimed.** NeuroWorks is a tool operators
  use, not a training or upskilling product. No attempt is made to stretch
  this fit.

## 4. NDS2 pillar alignment

- **Pillar 3 — Governance and Institutions: direct fit.** The governance
  engine lets an institution upload its own policy documents, have rules
  extracted and reviewed, and have those accepted rules actually enforced
  — blocking a non-compliant action before it executes, not just logging it
  afterward (full mechanism in the [Risk Note](risk-note.md)). Paired with
  the public-sector pack's named PRAZ/devolution focus, this is the
  strongest institutional-alignment claim in the whole product.
- **Pillar 1 — Economic Growth and Stability: direct fit.** Productivity
  gains in the fintech, agriculture, tourism, and mining sectors this
  product targets are the mechanism, not the sentiment — real
  reconciliation, reporting, and correspondence work done faster.
- **Pillar 2 — Social Development: partial fit.** The health pack's
  community-health-worker coordination and the education pack's admin
  support touch social-development outcomes indirectly, through operator
  efficiency rather than a direct citizen-facing service.
- **Pillars 4 (Infrastructure and Utilities) and 5 (Environment and
  Climate) — not claimed.** No feature of NeuroWorks addresses either
  directly; forcing a connection here would be exactly the generic-claim
  pattern the checklist warns against.

## 5. Vision 2030 / Heritage-Based Education 5.0

A modest, honest connection only: Education 5.0's innovation-and-technology
emphasis is broadly consistent with an AI tool built for a Zimbabwean
education admin office (see the education sector pack, §2), but no formal
Education 5.0 program integration exists today. Not stretched further than
that.
