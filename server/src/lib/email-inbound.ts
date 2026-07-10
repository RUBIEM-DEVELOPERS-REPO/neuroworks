import express from "express";
import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { processInboundEmail, stripQuotedReply } from "./email.js";
import { evaluateAuthResultsHeader } from "./email-auth.js";

// Dedicated, minimal HTTP listener for Mailjet's inbound Parse API. Runs on its
// OWN port (NEUROWORKS_EMAIL_INBOUND_PORT, default 7475) exposing ONLY this webhook
// — never the main clawbot API. This is the surface we expose through the public
// tunnel, so /api/terminal, /api/chat, etc. are NOT reachable from the internet.
//
// Security, two gates:
//   1. A shared token (NEUROWORKS_EMAIL_INBOUND_TOKEN) must be present on every
//      request (?token= query or x-inbound-token header). We embed it in the URL
//      registered with Mailjet. Without a token configured the webhook refuses
//      to start — better off than wide open.
//   2. The sender allow-list inside processInboundEmail — a forged POST still
//      has to claim an allow-listed From before any task runs.

let server: Server | null = null;
const state = {
  running: false,
  port: 0,
  received: 0,
  accepted: 0,
  rejected: 0,
  lastAt: null as string | null,
};

export function getInboundWebhookStatus() {
  return { ...state, tokenSet: (process.env.NEUROWORKS_EMAIL_INBOUND_TOKEN ?? "").trim().length > 0 };
}

// Mailjet Parse payload keys vary by config (JSON, capitalised, dashed). Pull
// the first non-empty value across the plausible spellings.
function pick(obj: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
// Extract a bare address from "Name <a@b.com>" or a raw "a@b.com".
function addressOf(raw: string): string {
  const m = raw.match(/<([^>]+@[^>]+)>/) ?? raw.match(/([^\s<>]+@[^\s<>]+)/);
  return (m?.[1] ?? raw).trim().toLowerCase();
}

// Constant-time secret compare (avoids leaking the token via response timing).
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// SPF/DKIM evaluation lives in email-auth.ts (shared with the IMAP path).

export function startInboundWebhook(): void {
  if (server) return;
  const token = (process.env.NEUROWORKS_EMAIL_INBOUND_TOKEN ?? "").trim();
  if (!token) {
    console.warn("  ⚠ email inbound webhook NOT started — set NEUROWORKS_EMAIL_INBOUND_TOKEN to enable (it gates the public endpoint)");
    return;
  }
  const port = Number(process.env.NEUROWORKS_EMAIL_INBOUND_PORT ?? "7475") || 7475;
  const app = express();
  app.disable("x-powered-by"); // don't advertise the stack on a public endpoint
  // Mailjet Parse posts JSON; tolerate urlencoded too. 10mb covers a parsed
  // email incl. modest attachments without leaving a huge ingest surface.
  app.use(express.json({ limit: "10mb", type: ["application/json", "text/plain"] }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true, service: "clawbot-inbound", running: true }));

  app.post(["/inbound", "/api/email/inbound"], (req, res) => {
    state.received += 1;
    state.lastAt = new Date().toISOString();
    const given = (typeof req.query.token === "string" ? req.query.token : "") || req.header("x-inbound-token") || "";
    if (!safeEqual(given, token)) {
      state.rejected += 1;
      console.warn("[inbound-webhook] rejected request with bad/missing token");
      return res.status(401).json({ error: "unauthorized" });
    }

    const p = (req.body ?? {}) as Record<string, any>;
    const headers = (p.Headers ?? p.headers ?? {}) as Record<string, any>;
    // Prefer the From header for the authorised identity (matches the IMAP path
    // and the allow-list), falling back to the envelope Sender.
    const sender = addressOf(pick(p, "From", "Sender", "from", "sender"));
    const subject = pick(p, "Subject", "subject");
    const text = pick(p, "Text-part", "TextPart", "Text", "text", "Html-part", "HtmlPart", "html");
    const messageId = pick(headers, "Message-ID", "Message-Id", "MessageID") || pick(p, "MessageID", "messageId") || undefined;
    const refHeader = pick(headers, "References", "references");
    const references = refHeader ? refHeader.split(/\s+/).filter(Boolean) : undefined;
    const inReplyTo = pick(headers, "In-Reply-To", "In-Reply-to", "in-reply-to") || undefined;

    if (!sender) {
      state.rejected += 1;
      return res.status(400).json({ error: "could not determine sender" });
    }

    // Anti-spoofing: the From is attacker-controlled, so verify SPF/DKIM before
    // it can satisfy the allow-list. Reject explicit auth failures (a spoof);
    // in strict mode also reject when we can't verify at all.
    const auth = evaluateAuthResultsHeader(headers, sender);
    const strict = (process.env.NEUROWORKS_EMAIL_REQUIRE_AUTH ?? "").trim().toLowerCase() === "strict";
    if (auth === "fail" || (auth === "unknown" && strict)) {
      state.rejected += 1;
      console.warn(`[inbound-webhook] rejected ${sender}: email auth ${auth} (SPF/DKIM) — possible spoof`);
      return res.status(403).json({ error: "sender failed email authentication" });
    }
    if (auth === "unknown") console.warn(`[inbound-webhook] ${sender}: email auth UNVERIFIED (no Authentication-Results) — relying on allow-list`);

    // ACK immediately — the task can take minutes; Mailjet must not wait on it
    // (it would time out and retry, double-running the job). Process async.
    res.json({ ok: true });
    state.accepted += 1;
    void processInboundEmail({ sender, subject, body: stripQuotedReply(text), messageId, references, inReplyTo })
      .then(r => console.log(`[inbound-webhook] ${sender}: ${r.status}${r.jobId ? ` (job ${r.jobId.slice(0, 8)})` : ""}${r.reason ? ` — ${r.reason}` : ""}`))
      .catch(e => console.error(`[inbound-webhook] processing failed: ${e?.stack ?? e}`));
  });

  // Bind to localhost only — cloudflared runs on this machine and proxies to
  // 127.0.0.1, so we never need to listen on the LAN/all-interfaces.
  server = app.listen(port, "127.0.0.1", () => {
    state.running = true;
    state.port = port;
    console.log(`  ✓ email inbound webhook on http://127.0.0.1:${port}/inbound — tunnel THIS port to Mailjet`);
  });
  server.on("error", (e: any) => console.error(`[inbound-webhook] listen error: ${e?.message ?? e}`));
}

export function stopInboundWebhook(): void {
  if (server) { try { server.close(); } catch { /* tolerate */ } server = null; }
  state.running = false;
}
