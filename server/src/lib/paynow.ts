// Paynow (Zimbabwe) payment gateway — the local-market counterpart to the
// Stripe gateway in payments.ts. Implemented over Paynow's HTTP interface via
// fetch (no SDK): form-urlencoded requests, URL-encoded responses, SHA-512
// hash authentication on both directions.
//
// Flow:
//   1. createPaynowPayment() → POST /interface/initiatetransaction
//      → { browserUrl (send the payer here), pollUrl (our status handle) }
//   2. Payer completes on Paynow (card, EcoCash, OneMoney, bank).
//   3. pollPaynowStatus(pollUrl) any time → { status: "Paid" | ... }
//      and Paynow also POSTs the same fields to our resulturl webhook.
//
// Gated on PAYNOW_INTEGRATION_ID + PAYNOW_INTEGRATION_KEY (config.paynowEnabled).
// Hash rule (per Paynow docs): concatenate the VALUES of every field in the
// order they appear (excluding "hash" itself), append the integration key,
// SHA-512, uppercase hex.

import { createHash } from "node:crypto";
import { config } from "../config.js";

const PAYNOW_INITIATE = "https://www.paynow.co.zw/interface/initiatetransaction";

export type PaynowPayment = {
  reference: string;
  amount: number;
  browserUrl: string;   // where the payer completes the payment
  pollUrl: string;      // status handle — poll or store for later
  status: string;       // "Ok" on success
};

export type PaynowStatus = {
  reference?: string;
  paynowReference?: string;
  amount?: number;
  status: string;       // Created | Sent | Cancelled | Failed | Paid | Awaiting Delivery | Delivered | Refunded
  paid: boolean;
  pollUrl?: string;
  hashValid: boolean;
};

function requireConfigured(): void {
  if (!config.paynowEnabled) {
    throw new Error("Paynow is not configured — set PAYNOW_INTEGRATION_ID and PAYNOW_INTEGRATION_KEY in .env");
  }
}

// SHA-512 hash over the ordered field values + integration key, uppercase hex.
function paynowHash(values: Record<string, string>): string {
  const concat = Object.entries(values)
    .filter(([k]) => k.toLowerCase() !== "hash")
    .map(([, v]) => v)
    .join("") + config.paynowIntegrationKey;
  return createHash("sha512").update(concat, "utf8").digest("hex").toUpperCase();
}

// Verify an inbound message (poll response / result webhook) against its hash.
// Field ORDER matters — we hash in the order the fields arrived.
export function verifyPaynowHash(fields: Record<string, string>): boolean {
  const theirs = fields.hash ?? fields.Hash;
  if (!theirs) return false;
  return paynowHash(fields) === theirs.toUpperCase();
}

function parseUrlEncoded(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}

// Create a payment the customer completes on Paynow's hosted page.
// amount is in the merchant account's currency (USD or ZWG per the Paynow
// account setup); reference must be unique per payment on our side.
export async function createPaynowPayment(input: {
  amount: number;
  reference?: string;
  description: string;
  email?: string;        // authemail — required by Paynow for "3rd Party" integrations
  returnUrl?: string;
  resultUrl?: string;
}): Promise<PaynowPayment> {
  requireConfigured();
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount must be a positive number");
  const reference = (input.reference?.trim() || `NW-${Date.now()}`).slice(0, 50);

  // Insertion order defines hash order — keep this object literal in the
  // exact order the fields are posted.
  const fields: Record<string, string> = {
    id: config.paynowIntegrationId,
    reference,
    amount: amount.toFixed(2),
    additionalinfo: String(input.description ?? "").slice(0, 250),
    returnurl: input.returnUrl || config.paynowReturnUrl,
    resulturl: input.resultUrl || config.paynowResultUrl,
    authemail: input.email?.trim() || config.paynowMerchantEmail,
    status: "Message",
  };
  fields.hash = paynowHash(fields);

  const res = await fetch(PAYNOW_INITIATE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
    // A hung gateway must not hang the agent step/UI request with it.
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Paynow initiate failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
  const parsed = parseUrlEncoded(text);
  const status = parsed.status ?? parsed.Status ?? "";
  if (status.toLowerCase() !== "ok") {
    throw new Error(`Paynow rejected the payment: ${parsed.error ?? parsed.Error ?? text.slice(0, 200)}`);
  }
  return {
    reference,
    amount,
    browserUrl: parsed.browserurl ?? parsed.BrowserUrl ?? "",
    pollUrl: parsed.pollurl ?? parsed.PollUrl ?? "",
    status,
  };
}

// Poll a payment's current state from its pollUrl. Safe to call repeatedly.
export async function pollPaynowStatus(pollUrl: string): Promise<PaynowStatus> {
  requireConfigured();
  const u = String(pollUrl ?? "").trim();
  if (!/^https:\/\/www\.paynow\.co\.zw\//i.test(u)) throw new Error("pollUrl must be a https://www.paynow.co.zw/ URL");
  const res = await fetch(u, { method: "POST", signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Paynow poll failed: HTTP ${res.status}`);
  return parsePaynowStatusFields(parseUrlEncoded(text));
}

// Shared by the poller and the result webhook (same field shape both ways).
export function parsePaynowStatusFields(fields: Record<string, string>): PaynowStatus {
  const status = fields.status ?? fields.Status ?? "Unknown";
  return {
    reference: fields.reference ?? fields.Reference,
    paynowReference: fields.paynowreference ?? fields.PaynowReference,
    amount: fields.amount !== undefined ? Number(fields.amount) : undefined,
    status,
    paid: /^(paid|awaiting delivery|delivered)$/i.test(status),
    pollUrl: fields.pollurl ?? fields.PollUrl,
    hashValid: verifyPaynowHash(fields),
  };
}

export function paynowGatewayStatus(): { enabled: boolean; provider: "paynow"; integrationId?: string; detail?: string } {
  if (!config.paynowEnabled) return { enabled: false, provider: "paynow", detail: "PAYNOW_INTEGRATION_ID / PAYNOW_INTEGRATION_KEY not set" };
  return { enabled: true, provider: "paynow", integrationId: config.paynowIntegrationId };
}
