---
name: invoice-statement
description: Produce a correct invoice or account statement — parties, unique number, dated line items, tax, totals, payment terms and remittance details.
applies_to: [draft-other, invoice]
---

# Skill: Invoice / statement

## Goal

A document the customer can pay from and the books can post from with zero back-and-forth — every legally and operationally required field present, the maths provable.

## Invoice — required fields

```
INVOICE
Invoice #: <unique sequential> · Date: <YYYY-MM-DD> · Due: <date or "Net 30">

From: <Legal name, address, tax/VAT/registration no.>
Bill to: <Customer legal name, address, contact>
<PO number if the customer requires one>

| # | Description | Qty | Unit price | Line total |
|---|---|---|---|---|
| 1 | <service/goods — specific> | 2 | 1,500.00 | 3,000.00 |

Subtotal:           <x>
Discount (if any):  -<x>
Tax (<rate>%):      <x>
**Total due:**      **<currency> <x>**

Payment terms: <Net 30 from invoice date>
Pay to: <bank name, account name, number, branch/SWIFT/reference to quote>
Notes: <late-payment terms, thank-you>
```

## Statement (account activity) — shape

```
STATEMENT OF ACCOUNT — <Customer> · as at <date>
Opening balance: <x>
| Date | Ref | Description | Charges | Payments | Balance |
|---|---|---|---|---|---|
Closing balance due: <x>
Aged: Current <x> · 30d <x> · 60d <x> · 90d+ <x>
```

## Rules

- **Unique, sequential invoice number** — never reuse; gaps invite audit questions.
- **Tax shown as its own line** with the rate; never fold tax into unit prices silently.
- **Totals foot.** Subtotal − discount + tax = total; re-add the column before sending.
- **State the currency** explicitly (ZAR, USD…) — ambiguity delays payment.
- **Payment terms + remittance details** present, or the customer can't actually pay.
- **One service per line**, specific enough to match the PO/contract.

## Pitfalls

- Missing tax/VAT registration number where required by law.
- Reusing an invoice number or skipping the sequence.
- No due date / terms — invoice ages indefinitely.
- Statement that doesn't tie opening + activity = closing.
- Vague line items ("consulting — 3,000") that the customer's AP can't approve.
