import { Router } from "express";
import {
  gatewayStatus, createPaymentLink, listPrices, createCheckoutSession,
  createBillingPortalSession, listPayments, verifyStripeSignature,
} from "../lib/payments.js";
import { newJob } from "../lib/jobs.js";
import { persistJobRecord } from "../lib/job-store.js";

// Payments API — Stripe gateway. Two surfaces:
//   • Outbound billing: POST /links creates a payment link to bill a client.
//   • Subscriptions: GET /prices, POST /checkout, POST /portal.
// Plus GET /status, GET /payments (reporting), and POST /webhook (Stripe events).
//
// NOTE: /webhook is mounted with a RAW body parser in index.ts (before the JSON
// parser) and exempted from the origin guard — Stripe posts from its own
// servers and authenticity is proven by the signature, not the request origin.

export const paymentsRouter = Router();

paymentsRouter.get("/status", async (_req, res) => {
  try { res.json(await gatewayStatus()); }
  catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
});

// Outbound billing — create a payment link. body: { amount, description, currency?, productName? }
paymentsRouter.post("/links", async (req, res) => {
  try {
    const b = req.body ?? {};
    res.json({ link: await createPaymentLink({ amount: Number(b.amount), description: String(b.description ?? ""), currency: b.currency, productName: b.productName }) });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

paymentsRouter.get("/prices", async (_req, res) => {
  try { res.json({ prices: await listPrices() }); }
  catch (e: any) { res.status(500).json({ error: String(e?.message ?? e) }); }
});

// Subscription (or one-off) checkout session. body: { priceId, mode?, customerEmail?, quantity? }
paymentsRouter.post("/checkout", async (req, res) => {
  try {
    const b = req.body ?? {};
    res.json({ session: await createCheckoutSession({ priceId: String(b.priceId ?? ""), mode: b.mode, customerEmail: b.customerEmail, quantity: b.quantity }) });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

paymentsRouter.post("/portal", async (req, res) => {
  try {
    const b = req.body ?? {};
    res.json({ session: await createBillingPortalSession({ customerId: String(b.customerId ?? ""), returnUrl: b.returnUrl }) });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

paymentsRouter.get("/payments", async (req, res) => {
  try {
    const limit = Number(req.query.limit ?? 20);
    res.json({ payments: await listPayments(limit) });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

// Stripe webhook. req.body is a Buffer here (raw parser mounted in index.ts).
paymentsRouter.post("/webhook", (req, res) => {
  const sig = String(req.headers["stripe-signature"] ?? "");
  const raw: Buffer | string = Buffer.isBuffer(req.body) ? req.body : String(req.body ?? "");
  const v = verifyStripeSignature(raw, sig);
  if (!v.valid) {
    console.warn(`[payments] rejected webhook: ${v.reason}`);
    return res.status(400).json({ error: `webhook signature verification failed: ${v.reason}` });
  }
  const event = v.event;
  // Record notable money events into the job journal so they surface on the
  // Activity/Reports pages and the nightly reflection alongside agent work.
  try {
    const interesting = new Set(["checkout.session.completed", "payment_intent.succeeded", "invoice.paid", "invoice.payment_failed", "customer.subscription.created", "customer.subscription.deleted"]);
    if (interesting.has(event?.type)) {
      const obj = event?.data?.object ?? {};
      const amount = typeof obj.amount_total === "number" ? obj.amount_total / 100
        : typeof obj.amount === "number" ? obj.amount / 100
        : typeof obj.amount_paid === "number" ? obj.amount_paid / 100 : undefined;
      const j = newJob(`payments:${event.type}`);
      j.template = "payments-webhook";
      j.title = `Stripe — ${event.type}`;
      j.personaName = "Payments";
      j.status = event.type === "invoice.payment_failed" ? "failed" : "succeeded";
      j.startedAt = new Date().toISOString();
      j.finishedAt = j.startedAt;
      j.log.push(`[${j.finishedAt}] ${event.type}${amount !== undefined ? ` — ${obj.currency ?? ""} ${amount}` : ""}`);
      j.result = { event: event.type, amount, currency: obj.currency, id: obj.id, customer: obj.customer ?? obj.customer_email };
      try { persistJobRecord(j); } catch { /* tolerate */ }
    }
  } catch (e: any) {
    console.warn(`[payments] webhook post-processing failed: ${e?.message ?? e}`);
  }
  // Always 200 a verified event so Stripe stops retrying.
  res.json({ received: true });
});
