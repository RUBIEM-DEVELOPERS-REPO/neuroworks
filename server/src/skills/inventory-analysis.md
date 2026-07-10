---
name: inventory-analysis
description: Analyse inventory and recommend reorders — usage rate, lead time, reorder point, safety stock, EOQ, and flag overstock / stockout / dead stock.
applies_to: [analysis, inventory]
---

# Skill: Inventory / reorder analysis

## Goal

A clear "order this, this much, by this date" recommendation per SKU — so the business avoids both stockouts (lost sales) and overstock (tied-up cash), backed by the numbers.

## The calculations

- **Average daily usage** = units sold / days in period.
- **Reorder point (ROP)** = (avg daily usage × lead-time days) + safety stock.
- **Safety stock** ≈ usage variability × lead time (buffer for demand/lead-time swings).
- **Economic order qty (EOQ)** balances order cost vs holding cost — order this much at a time.
- **Days of cover** = on-hand / avg daily usage. **Turn** = COGS / avg inventory.

## Output shape

```
# Inventory analysis — <category / warehouse> · <period>

## Action list (reorder now)
| SKU | On hand | Daily usage | Lead time | ROP | Days cover | ORDER | By |
|---|---|---|---|---|---|---|---|
| A123 | 40 | 6 | 10d | 80 | 6.7d | 120 | today |

## Watch
| SKU | Why | When to act |
|---|---|---|
| B456 | trending up, 12 days cover | reorder in ~5d |

## Overstock / dead stock (free up cash)
| SKU | On hand | Days cover | Action |
|---|---|---|---|
| C789 | 900 | 410d | discount / stop reorder / return |

## Summary
- Stockout risk: <N SKUs> · Overstock: <$ tied up> · Recommended spend this cycle: <$>
```

## Rules

- **Reorder on the reorder point, not on "looks low"** — ROP accounts for lead time, so you order before you run out.
- **Size safety stock to variability + lead time**, not a flat percentage — erratic, long-lead items need more buffer.
- **Flag dead/overstock explicitly** — idle inventory is cash on a shelf; recommend discount/return/stop-reorder.
- **Show days-of-cover**, the most intuitive signal for non-analysts.
- **Quantify both risks** — lost-sales risk (stockout) and carrying cost (overstock).
- **State assumptions** (lead times, usage period) — they drive every number.

## Pitfalls

- Ordering on gut ("we're low") and either stocking out mid-lead-time or over-ordering.
- Ignoring lead-time variability — the ROP that assumes a perfect supplier fails on the late delivery.
- No dead-stock view — cash quietly trapped.
- Treating all SKUs the same — segment by value/velocity (ABC) and focus effort on the A items.
