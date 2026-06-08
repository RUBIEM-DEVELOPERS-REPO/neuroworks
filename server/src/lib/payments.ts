// Payment gateway — a provider-agnostic core with a Stripe adapter implemented
// over the REST API via fetch (no SDK dependency, mirroring openrouter.ts /
// minimax.ts). Two jobs the platform needs:
//
//   • OUTBOUND BILLING — agents create payment links to bill the operator's
//     clients (e.g. "send the client a payment link for R5,000"). The money
//     flows to the operator's Stripe account.
//   • PLATFORM SUBSCRIPTIONS — checkout sessions for plans + a billing portal,
//     so NeuroWorks itself can be monetized.
//
// Gated on STRIPE_SECRET_KEY (config.paymentsEnabled). Absent = the capability
// simply isn't offered — no behaviour change. Webhook authenticity is proven by
// Stripe's signature (verifyStripeSignature), not by request origin.

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const STRIPE_API = "https://api.stripe.com";
const STRIPE_VERSION = "2024-06-20";

export type GatewayStatus = {
  enabled: boolean;
  provider: "stripe";
  currency: string;
  publishableKey?: string;
  livemode?: boolean;
  account?: string;
  detail?: string;
};

export type PaymentLink = { id: string; url: string; amount: number; currency: string; description: string };
export type CheckoutSession = { id: string; url: string };
export type Price = { id: string; nickname?: string; productName?: string; unitAmount: number | null; currency: string; interval?: string };
export type PaymentRecord = { id: string; amount: number; currency: string; status: string; description?: string; created: number; receiptEmail?: string };

function ensureEnabled(): string {
  if (!config.paymentsEnabled) {
    throw new Error("payments are not configured — set STRIPE_SECRET_KEY in .env (Settings → Payments)");
  }
  return config.stripeSecretKey;
}

// Flatten a nested object/array into Stripe's bracket form-encoding, e.g.
// { line_items: [{ price: "x", quantity: 1 }] } → line_items[0][price]=x&line_items[0][quantity]=1
function toForm(obj: Record<string, any>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") toForm(item, `${key}[${i}]`, out);
        else out.append(`${key}[${i}]`, String(item));
      });
    } else if (v !== null && typeof v === "object") {
      toForm(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

async function stripe<T = any>(method: "GET" | "POST", path: string, params?: Record<string, any>): Promise<T> {
  const key = ensureEnabled();
  const isGet = method === "GET";
  const body = !isGet && params ? toForm(params).toString() : undefined;
  let url = `${STRIPE_API}${path}`;
  if (isGet && params) {
    const qs = toForm(params).toString();
    if (qs) url += `?${qs}`;
  }
  const r = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_VERSION,
    },
    body,
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message ?? `Stripe HTTP ${r.status}`;
    throw new Error(msg);
  }
  return j as T;
}

export async function gatewayStatus(): Promise<GatewayStatus> {
  const base: GatewayStatus = { enabled: config.paymentsEnabled, provider: "stripe", currency: config.paymentsCurrency };
  if (config.stripePublishableKey) base.publishableKey = config.stripePublishableKey;
  if (!config.paymentsEnabled) return { ...base, detail: "STRIPE_SECRET_KEY not set" };
  try {
    // /v1/account is the cheapest authenticated call that confirms the key works.
    const acct: any = await stripe("GET", "/v1/account");
    return { ...base, account: acct?.id, livemode: !config.stripeSecretKey.startsWith("sk_test_") };
  } catch (e: any) {
    return { ...base, detail: String(e?.message ?? e) };
  }
}

// ─── Outbound billing — ad-hoc payment link for an arbitrary amount ───
// Stripe payment links require a Price, so we create an inline Price (with an
// inline product) first, then a reusable Payment Link pointing at it.
// `amount` is in major units (e.g. 49.99) — converted to the smallest unit.
export async function createPaymentLink(input: { amount: number; description: string; currency?: string; productName?: string }): Promise<PaymentLink> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number");
  const currency = (input.currency ?? config.paymentsCurrency).toLowerCase();
  const description = String(input.description ?? "").trim() || "Payment";
  const productName = String(input.productName ?? description).slice(0, 250);
  const unitAmount = Math.round(amount * 100); // zero-decimal currencies are rare for us; cents is correct for ZAR/USD/EUR

  const price: any = await stripe("POST", "/v1/prices", {
    currency,
    unit_amount: unitAmount,
    product_data: { name: productName },
  });
  const link: any = await stripe("POST", "/v1/payment_links", {
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { source: "neuroworks", description },
  });
  return { id: link.id, url: link.url, amount, currency, description };
}

// ─── Platform subscriptions ───
export async function listPrices(): Promise<Price[]> {
  const r: any = await stripe("GET", "/v1/prices", { active: true, limit: 100, "expand[0]": "data.product" });
  const data: any[] = Array.isArray(r?.data) ? r.data : [];
  return data.map(p => ({
    id: p.id,
    nickname: p.nickname ?? undefined,
    productName: typeof p.product === "object" ? p.product?.name : undefined,
    unitAmount: typeof p.unit_amount === "number" ? p.unit_amount / 100 : null,
    currency: p.currency,
    interval: p.recurring?.interval,
  }));
}

export async function createCheckoutSession(input: { priceId: string; mode?: "subscription" | "payment"; customerEmail?: string; quantity?: number }): Promise<CheckoutSession> {
  const priceId = String(input.priceId ?? "").trim();
  if (!priceId) throw new Error("priceId is required");
  const mode = input.mode === "payment" ? "payment" : "subscription";
  const params: Record<string, any> = {
    mode,
    line_items: [{ price: priceId, quantity: Math.max(1, Number(input.quantity) || 1) }],
    success_url: config.paymentsSuccessUrl,
    cancel_url: config.paymentsCancelUrl,
  };
  if (input.customerEmail) params.customer_email = input.customerEmail;
  const s: any = await stripe("POST", "/v1/checkout/sessions", params);
  return { id: s.id, url: s.url };
}

export async function createBillingPortalSession(input: { customerId: string; returnUrl?: string }): Promise<CheckoutSession> {
  const customerId = String(input.customerId ?? "").trim();
  if (!customerId) throw new Error("customerId is required");
  const s: any = await stripe("POST", "/v1/billing_portal/sessions", {
    customer: customerId,
    return_url: input.returnUrl ?? config.paymentsSuccessUrl,
  });
  return { id: s.id, url: s.url };
}

// ─── Reporting ───
export async function listPayments(limit = 20): Promise<PaymentRecord[]> {
  const r: any = await stripe("GET", "/v1/payment_intents", { limit: Math.max(1, Math.min(100, limit)) });
  const data: any[] = Array.isArray(r?.data) ? r.data : [];
  return data.map(p => ({
    id: p.id,
    amount: typeof p.amount === "number" ? p.amount / 100 : 0,
    currency: p.currency,
    status: p.status,
    description: p.description ?? undefined,
    created: p.created,
    receiptEmail: p.receipt_email ?? undefined,
  }));
}

// ─── Webhook signature verification ───
// Stripe signs each webhook: header `Stripe-Signature: t=<ts>,v1=<sig>`. The
// signed payload is `${t}.${rawBody}`; sig = HMAC-SHA256(payload, webhookSecret).
// We MUST verify against the RAW request body (not re-serialized JSON).
export function verifyStripeSignature(rawBody: Buffer | string, signatureHeader: string, toleranceSec = 300): { valid: boolean; event?: any; reason?: string } {
  const secret = config.stripeWebhookSecret;
  if (!secret) return { valid: false, reason: "STRIPE_WEBHOOK_SECRET not set" };
  if (!signatureHeader) return { valid: false, reason: "missing Stripe-Signature header" };

  const parts = Object.fromEntries(signatureHeader.split(",").map(kv => kv.split("=").map(s => s.trim())));
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return { valid: false, reason: "malformed signature header" };

  const raw = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(v1, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "signature mismatch" };

  const ts = Number(t);
  if (Number.isFinite(ts) && Math.abs(Date.now() / 1000 - ts) > toleranceSec) {
    return { valid: false, reason: "timestamp outside tolerance (possible replay)" };
  }
  try { return { valid: true, event: JSON.parse(raw) }; }
  catch { return { valid: false, reason: "body is not valid JSON" }; }
}
