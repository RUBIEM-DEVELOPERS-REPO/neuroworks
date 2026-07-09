---
name: payment-collection
description: Create a real payment link (Paynow for Zimbabwe, Stripe elsewhere) for a customer to pay, or check/poll the status of one already sent. All money movement requires human approval before it goes out.
applies_to: [draft-other, direct-answer, payment-collection]
---

# Skill: Payment collection

## When to use this

The user asks to "collect payment from X", "send a payment link", "invoice
Y for Z", "charge the customer", or asks "has X paid yet" / "check the
payment status". This is real money — treat every step as consequential and
never claim a payment happened without reading it off a primitive's result.

## Creating a payment

1. **Pick the gateway.** Paynow for Zimbabwe-market payments (ZWG/USD via
   EcoCash, OneMoney, bank, card); Stripe (`payment.link`) for everything
   else. If the user doesn't say and the context is ambiguous, ask rather
   than guessing a gateway that won't work for the payer.
2. **Resolve the amount and reference precisely** — never round or estimate
   an amount stated by the user. Build a clear `description` (what it's
   for — the customer will see this).
3. **Call `payment.paynow_link`** (or `payment.link` for Stripe):
   ```
   payment.paynow_link({
     amount: 150,
     reference: "Tendai — July invoice",
     description: "July consulting invoice",
     email: "<payer's real email, if known>"
   })
   ```
4. **This does NOT move money.** It queues an approval request — the result
   is `{ pendingApproval: true, approvalJobId }`, not a completed charge. A
   human must approve it on the Approvals page before Paynow is actually
   contacted. Tell the user exactly this: the link is queued for approval,
   not sent yet.
5. **Once approved**, the real `browserUrl` (send this to the payer) and
   `pollUrl` (to check status later) come back — surface `browserUrl` to
   the user/customer, and keep `pollUrl` for step 2 below.

## Checking payment status

1. Use `payment.paynow_poll` with the stored `pollUrl`, or `payment.status`
   / `payment.list` to look up by reference.
2. **Read `paid` / `status` off the result — never infer payment from the
   fact that time has passed.** Paynow statuses: Created, Sent, Cancelled,
   Failed, Paid, Awaiting Delivery, Delivered, Refunded. Only "Paid" and
   later count as paid.
3. Report the actual status verbatim, including "not yet paid" — a false
   "they paid" is far worse than an honest "still pending".

## Rules

- **Never claim a payment succeeded from a `pendingApproval` result** — that
  response means nothing has been charged yet.
- **Never invent an amount, reference, or payer email.** If the user didn't
  give one and it's not resolvable via `users.lookup`, ask.
- **Approval is mandatory, not optional** — this is by design so a human
  always signs off before money moves; don't try to work around it or tell
  the user it's "basically done" before approval.

## Pitfalls

- Treating `{ pendingApproval: true }` as "payment sent" in the summary to
  the user — it is explicitly NOT sent yet.
- Polling immediately after creating the link and reporting "not paid" as if
  that's a final answer — the payer hasn't had a chance to pay yet; state
  the link was just created/queued.
- Using Stripe's `payment.link` for a Zimbabwe-market ask, or Paynow for an
  international one — pick the gateway that matches the payer's market.
