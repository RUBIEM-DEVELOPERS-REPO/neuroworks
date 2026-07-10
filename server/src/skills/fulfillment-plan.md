---
name: fulfillment-plan
description: Plan a shipment / order fulfillment — route, carrier, packing, documentation, timeline, cost, and contingency for an order or consignment.
applies_to: [draft-other, plan, fulfillment]
---

# Skill: Shipment / fulfillment plan

## Goal

An order gets from origin to destination on time, intact, compliant, and at a known cost — with the documents ready and a fallback if the primary route fails.

## Structure

```
# Fulfillment plan — <Order / consignment ref>
Origin: <___> → Destination: <___> · Required delivery: <date> · Incoterm: <e.g. DAP>

## Goods
| Item | Qty | Weight/vol | Handling (fragile / cold / hazmat) |
|---|---|---|---|

## Route & carrier
- Mode: <road / air / sea / courier> · Carrier: <___> · Transit est: <N days>
- Why this option: <cost vs speed vs reliability trade-off>

## Packing
- <packaging spec, palletisation, labelling, fragile/temp handling>

## Documentation (must travel with / precede the goods)
- [ ] Packing list  [ ] Invoice  [ ] Waybill/BoL  [ ] Customs docs (if cross-border)  [ ] Certificates (origin/quality/hazmat)

## Timeline
| Step | Owner | By |
|---|---|---|
| Pick & pack | warehouse | |
| Carrier pickup | logistics | |
| In transit | carrier | |
| Delivery + POD | carrier/recipient | |

## Cost
| Line | Amount |
|---|---|
| Freight | |
| Packing/handling | |
| Duties/taxes (if applic.) | |
| Insurance | |
| **Total** | |

## Contingency
- Carrier delay → <alt carrier/route> · Damage → <insurance + claim process> · Customs hold → <broker contact> · Stockout → <partial ship / backorder>
```

## Rules

- **Match mode to the real constraint** (deadline vs cost vs fragility) and say why — don't default to cheapest or fastest blindly.
- **Documents ready before pickup**, especially cross-border — missing paperwork is the #1 cause of customs holds.
- **State the Incoterm** — it decides who owns cost and risk at each leg.
- **Plan a proof-of-delivery** step; "shipped" isn't "delivered".
- **Insure value-appropriate consignments** and know the claims process before you need it.
- **Have a contingency for delay, damage, and customs** — the predictable failures.

## Pitfalls

- Cheapest carrier on a hard deadline — false economy when it slips.
- Cross-border without complete docs / HS codes — stuck at the border.
- No Incoterm — disputes over who pays duty and bears risk.
- No POD or tracking — "lost" shipments with no recourse.
