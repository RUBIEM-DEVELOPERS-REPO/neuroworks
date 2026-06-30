---
name: reconciliation
description: Reconcile two sources of truth (bank vs ledger, sub-ledger vs GL, statement vs invoices) — match, list differences with causes, and show the explained-to-zero bridge.
applies_to: [analysis, draft-other, reconciliation]
---

# Skill: Reconciliation

## Goal

Prove two records agree — or explain every penny of the gap. The output ends with a difference of zero (or a fully itemised, owned residual), not "roughly matches".

## Process

1. **Name the two sources + the period** (e.g. bank statement vs cash ledger, 1–31 May).
2. **Pin both opening balances.** A reconciliation that starts from an unagreed opening balance proves nothing.
3. **Match line by line.** By amount + date + reference. Mark each: matched / in-A-not-B / in-B-not-A / amount-differs.
4. **Classify each difference by CAUSE:** timing (in transit / uncleared), error (keying, duplicate, wrong account), omission (missing entry), fees/interest, FX, fraud-flag.
5. **Bridge to zero.** Opening diff + each reconciling item = closing diff = 0.
6. **Assign an action + owner** to every unresolved item.

## Direction matters — which side does each item adjust?

This is where reconciliations go wrong. Decide, per item, WHICH balance it corrects and in WHICH direction:

- **Uncleared cheque / deposit in transit** → a BANK-side TIMING item. The ledger is already right; the bank just hasn't caught up. Adjust the BANK figure (an unpresented cheque means the bank balance is temporarily HIGHER than the true balance → subtract it from bank). Do NOT touch the ledger.
- **Duplicate / erroneous payment in the ledger** → a LEDGER-side ERROR. Reverse it: a duplicate payment wrongly REDUCED the ledger, so reversing it ADDS the amount back to the ledger.
- **Bank fees / interest the ledger missed** → LEDGER-side omission: post them to the ledger.

### Worked example (must tie to zero)

Bank 50,000; Ledger 47,250. Items: 1,250 cheque not yet cleared; 1,500 duplicate payment in the ledger.

```
Bank per statement:                     50,000
  less unpresented cheque (timing):     -1,250
Adjusted bank:                          48,750

Ledger balance:                         47,250
  add back duplicate payment (reverse): +1,500
Adjusted ledger:                        48,750

Difference: 48,750 − 48,750 = 0  ✓ reconciled
```

If your two adjusted balances don't match, you applied an item to the wrong side or in the wrong direction — recheck before declaring a residual.

## Output shape

```
# Reconciliation — <A> vs <B> · <period>

**Balance per <A>:** <amount>
**Balance per <B>:** <amount>
**Unreconciled difference:** <amount>

## Reconciling items
| # | Description | Amount | In | Cause | Action / owner |
|---|---|---|---|---|---|
| 1 | Cheque #1042 not yet cleared | -1,250 | A only | timing | none — clears next period |
| 2 | Duplicate supplier payment | -3,400 | B only | error | reverse — A. Cole |

## Bridge
| | Amount |
|---|---|
| Difference at start | <x> |
| + timing items | <x> |
| + corrections | <x> |
| **Residual (should be 0)** | **0** |

## Follow-ups
- <item> — <owner> — <by when>
```

## Rules

- **Tie out to zero or explain the residual fully.** "Close enough" is not reconciled.
- **Every difference has a cause AND an action.** A difference with no cause is an open risk.
- **Timing vs error matters** — timing items self-clear; errors need a correcting entry.
- **Flag anything you can't explain** as a potential control failure / fraud item — don't bury it.
- **Never adjust a source to force a match** — record a correcting entry with a reason.

## Pitfalls

- Forcing the balance by plugging an unexplained "miscellaneous" line.
- Reconciling the close but not agreeing the opening balance.
- Matching on amount alone — two different items can share a value.
- No owner on residuals — they roll forward forever.
