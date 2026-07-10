// Email bridge — lets a user talk to clawbot over email.
//
// Inbound:  poll a Gmail mailbox over IMAP for unseen messages, route each by
//           a subject keyword ([team] vs [chat], default chat), and hand it to
//           the SAME endpoints the web UI uses — /api/chat (a new chat session)
//           or /api/team (a team brief). Then reply to the sender with the
//           synthesized answer. Because we go through those endpoints, every
//           email request shows up as a real session/brief and its result lands
//           in Reports + the second-brain vault exactly like a UI request.
// Outbound: SMTP via the same Gmail account.
//
// SECURITY — inbound is an external trust boundary. We ONLY act on mail from
// addresses on CLAWBOT_EMAIL_ALLOWED_SENDERS. If that list is empty, inbound
// processing is DISABLED (outbound send still works). Fail-safe: an open
// inbound bridge would let anyone email-trigger jobs against the user's machine
// and vault. The allow-list gates WHO may drive clawbot.
//
// Config (all via env — see clawbot/.env.example):
//   CLAWBOT_EMAIL_USER             clawbot's gmail address (IMAP+SMTP login)
//   CLAWBOT_EMAIL_APP_PASSWORD     gmail APP password (not the account password)
//   CLAWBOT_EMAIL_FROM             From: header (defaults to USER)
//   CLAWBOT_EMAIL_ALLOWED_SENDERS  comma list of addresses allowed to drive clawbot
//   CLAWBOT_EMAIL_POLL_MS          inbox poll interval (default 30000, min 10000)
//   CLAWBOT_EMAIL_IMAP_HOST/PORT   default imap.gmail.com:993
//   CLAWBOT_EMAIL_SMTP_HOST/PORT   default smtp.gmail.com:465
//   CLAWBOT_EMAIL=0                hard-disable the bridge even if creds present

import nodemailer, { type Transporter } from "nodemailer";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { marked } from "marked";
import { config } from "../config.js";
import { startInboundWebhook, stopInboundWebhook, getInboundWebhookStatus } from "./email-inbound.js";
import { verifyInboundDkim, type AuthVerdict } from "./email-auth.js";
import { lookup as dnsLookup } from "node:dns/promises";

// How inbound email requests reach clawbot:
//   "webhook" — Mailjet Parse API POSTs to our token-gated webhook (no Gmail).
//   "imap"    — legacy: poll a Gmail mailbox over IMAP.
//   "off"     — outbound only.
// Defaults to "imap" for back-compat unless CLAWBOT_EMAIL_INBOUND_MODE is set.
type InboundMode = "webhook" | "imap" | "off";

type EmailEnv = {
  user: string;
  pass: string;
  from: string;
  allowedSenders: string[];
  pollMs: number;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  // Mailjet HTTPS API credentials — when both are present, outbound goes
  // through api.mailjet.com/v3.1/send instead of the nodemailer SMTP
  // transport. Inbound (IMAP) is unaffected; Mailjet is send-only.
  mailjetApiKey: string;
  mailjetApiSecret: string;
  inboundMode: InboundMode;
  // Reply-To address. Set to the Mailjet Parse inbound address
  // (…@parse-in1.mailjet.com) so when a recipient hits "Reply", the message
  // routes into the inbound webhook pipeline — even though From shows the
  // friendly arthur@rubiem.com. Without this, replies go to the From mailbox
  // and never reach Mailjet Parse, so they can't trigger a task.
  replyTo: string;
};

function readEnv(): EmailEnv {
  const user = (process.env.CLAWBOT_EMAIL_USER ?? "").trim();
  const pass = (process.env.CLAWBOT_EMAIL_APP_PASSWORD ?? "").trim();
  const from = (process.env.CLAWBOT_EMAIL_FROM ?? "").trim() || user;
  const allowedSenders = (process.env.CLAWBOT_EMAIL_ALLOWED_SENDERS ?? "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const pollMs = Math.max(10_000, Number(process.env.CLAWBOT_EMAIL_POLL_MS ?? "30000") || 30_000);
  const imapHost = (process.env.CLAWBOT_EMAIL_IMAP_HOST ?? "imap.gmail.com").trim();
  const imapPort = Number(process.env.CLAWBOT_EMAIL_IMAP_PORT ?? "993") || 993;
  const smtpHost = (process.env.CLAWBOT_EMAIL_SMTP_HOST ?? "smtp.gmail.com").trim();
  const smtpPort = Number(process.env.CLAWBOT_EMAIL_SMTP_PORT ?? "465") || 465;
  const mailjetApiKey = (process.env.CLAWBOT_MAILJET_API_KEY ?? "").trim();
  const mailjetApiSecret = (process.env.CLAWBOT_MAILJET_API_SECRET ?? "").trim();
  const rawMode = (process.env.CLAWBOT_EMAIL_INBOUND_MODE ?? "").trim().toLowerCase();
  const inboundMode: InboundMode = rawMode === "webhook" || rawMode === "off" ? rawMode : "imap";
  const replyTo = (process.env.CLAWBOT_EMAIL_REPLY_TO ?? "").trim();
  return { user, pass, from, allowedSenders, pollMs, imapHost, imapPort, smtpHost, smtpPort, mailjetApiKey, mailjetApiSecret, inboundMode, replyTo };
}

// ── Attachments ──────────────────────────────────────────────────────
// A loaded, ready-to-send file. Built by loadAttachments() from disk paths;
// carried through sendOutbound to both transports (Mailjet Base64Content,
// nodemailer Buffer).
export type EmailAttachment = { filename: string; contentType: string; base64: string; bytes: number };

const ATTACHMENT_CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".zip": "application/zip",
  ".html": "text/html",
  ".ics": "text/calendar",
};

// Mailjet rejects messages over 15MB total; base64 inflates by ~37%, so cap
// the RAW total at 10MB — comfortably under the wire limit with headroom for
// the body + envelope.
const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;

/** Load files from disk into sendable attachments. Throws with a clear,
 *  actionable message on a missing file or an over-size total — a silent
 *  drop would produce a "please find attached" email with nothing attached. */
export function loadAttachments(paths: string[]): EmailAttachment[] {
  const out: EmailAttachment[] = [];
  let total = 0;
  for (const raw of paths) {
    const p = String(raw ?? "").trim();
    if (!p) continue;
    if (!existsSync(p)) throw new Error(`attachment not found: ${p} — pass the absolute path from fs.find_in ($step_N.matches.0.path)`);
    const st = statSync(p);
    if (st.isDirectory()) throw new Error(`attachment is a directory, not a file: ${p}`);
    total += st.size;
    if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error(`attachments exceed the ${Math.round(MAX_ATTACHMENT_TOTAL_BYTES / 1024 / 1024)}MB email limit (${basename(p)} pushed the total to ${(total / 1024 / 1024).toFixed(1)}MB) — send fewer/smaller files or share a link instead`);
    }
    const ext = extname(p).toLowerCase();
    out.push({
      filename: basename(p),
      contentType: ATTACHMENT_CONTENT_TYPES[ext] ?? "application/octet-stream",
      base64: readFileSync(p).toString("base64"),
      bytes: st.size,
    });
  }
  return out;
}

// Mailjet HTTPS sender — POSTs to api.mailjet.com/v3.1/send. Used instead
// of nodemailer.sendMail when CLAWBOT_MAILJET_API_KEY + _SECRET are set.
// Auth is HTTP Basic with API_KEY:SECRET. The From: address must be on a
// domain verified in the Mailjet dashboard or the send is rejected with
// a "sender_unverified" / domain_not_authorized style error.
async function sendViaMailjet(env: EmailEnv, opts: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: EmailAttachment[];
}): Promise<void> {
  const headers: Record<string, string> = {};
  if (opts.inReplyTo) headers["In-Reply-To"] = opts.inReplyTo;
  if (opts.references?.length) headers["References"] = opts.references.join(" ");
  const message: any = {
    From: { Email: env.from },
    To: opts.to.map(e => ({ Email: e })),
    Subject: opts.subject,
    TextPart: opts.text,
  };
  if (env.replyTo) message.ReplyTo = { Email: env.replyTo };
  if (opts.html) message.HTMLPart = opts.html;
  if (Object.keys(headers).length) message.Headers = headers;
  if (opts.attachments?.length) {
    message.Attachments = opts.attachments.map(a => ({
      ContentType: a.contentType,
      Filename: a.filename,
      Base64Content: a.base64,
    }));
  }

  const authHeader = "Basic " + Buffer.from(`${env.mailjetApiKey}:${env.mailjetApiSecret}`).toString("base64");
  const res = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({ Messages: [message] }),
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new Error(`mailjet auth failed (${res.status}) — check CLAWBOT_MAILJET_API_KEY + CLAWBOT_MAILJET_API_SECRET`);
  }
  if (!res.ok) {
    // Mailjet returns 4xx for validation errors with a useful body.
    throw new Error(`mailjet ${res.status}: ${text.slice(0, 400)}`);
  }
  // Even on 200, Mailjet's v3.1 response carries per-message status. Parse
  // and surface "error" results so domain-unverified-style rejections
  // don't appear as silent successes.
  try {
    const j = JSON.parse(text);
    const msg = j?.Messages?.[0];
    if (!msg) throw new Error(`mailjet returned unexpected body: ${text.slice(0, 300)}`);
    if (msg.Status === "error") {
      const errs = (msg.Errors ?? []).map((e: any) => e.ErrorMessage ?? e.ErrorCode ?? "unknown").join("; ");
      throw new Error(`mailjet send failed: ${errs || text.slice(0, 300)}`);
    }
    // Status === "success" → we're done.
  } catch (e: any) {
    if (e?.message?.startsWith("mailjet")) throw e;
    console.warn(`[email] mailjet returned unparseable 200 body: ${text.slice(0, 200)}`);
  }
}

// Unified outbound — picks Mailjet HTTPS API when both API_KEY + SECRET are
// set, otherwise falls back to the existing nodemailer SMTP transport. Both
// call sites (reply and test) route through here so the transport choice
// lives in one place.
async function sendOutbound(env: EmailEnv, opts: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: EmailAttachment[];
}): Promise<void> {
  if (env.mailjetApiKey && env.mailjetApiSecret) {
    return sendViaMailjet(env, opts);
  }
  if (!transporter) throw new Error("email transport not initialised");
  await transporter.sendMail({
    from: env.from,
    to: opts.to.join(", "),  // nodemailer accepts a comma-separated address list natively
    subject: opts.subject,
    text: opts.text,
    ...(env.replyTo ? { replyTo: env.replyTo } : {}),
    ...(opts.html ? { html: opts.html } : {}),
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
    ...(opts.references?.length ? { references: opts.references } : {}),
    ...(opts.attachments?.length ? {
      attachments: opts.attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.base64, "base64"), contentType: a.contentType })),
    } : {}),
  });
}

/** True when EITHER (a) SMTP/IMAP creds are present, OR (b) the SMTP2GO HTTPS
 *  key alone is configured (outbound-only). The bridge can't poll inbound
 *  without the IMAP creds, but sendTestEmail / sendReply work either way. */
export function emailConfigured(): boolean {
  if (process.env.CLAWBOT_EMAIL === "0") return false;
  const { user, pass, mailjetApiKey, mailjetApiSecret } = readEnv();
  // Outbound-only via Mailjet HTTPS: both halves of Mailjet auth + a From: user.
  if (mailjetApiKey.length > 0 && mailjetApiSecret.length > 0 && user.length > 0) return true;
  // Otherwise the legacy SMTP path needs full IMAP/SMTP creds.
  return user.length > 0 && pass.length > 0;
}

// ─── Runtime state ───
let transporter: Transporter | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let polling = false;          // guards overlapping poll ticks
let started = false;
const status = {
  lastPollAt: null as string | null,
  lastError: null as string | null,
  processed: 0,
  skippedUnauthorized: 0,
  inflight: 0,
};

export function getEmailStatus() {
  const env = emailConfigured() ? readEnv() : null;
  return {
    configured: emailConfigured(),
    running: started,
    // Outbound transport in use. SMTP2GO HTTPS API takes precedence when
    // its key is set; SMTP is the fallback. Helps the operator see which
    // path actually delivered a given send when debugging deliverability.
    outboundTransport: (env?.mailjetApiKey && env?.mailjetApiSecret) ? "mailjet" as const : "smtp" as const,
    // Inbound depends on the configured transport. webhook: live when the
    // listener is running. imap: needs IMAP creds + an allow-list.
    inboundMode: env?.inboundMode ?? null,
    inboundEnabled: !!env && env.allowedSenders.length > 0 && (
      env.inboundMode === "webhook" ? getInboundWebhookStatus().running
      : env.inboundMode === "imap" ? env.user.length > 0 && env.pass.length > 0
      : false
    ),
    webhook: env?.inboundMode === "webhook" ? getInboundWebhookStatus() : null,
    user: env?.user ?? null,
    from: env?.from ?? null,
    replyTo: env?.replyTo || null,
    allowedSenders: env?.allowedSenders ?? [],
    pollMs: env?.pollMs ?? null,
    ...status,
  };
}

const BASE = `http://127.0.0.1:${config.port}`;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function apiPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

// Poll a job created by /api/chat or /api/team until it reaches a terminal
// state. Returns the job (with result.answer) or null on timeout.
async function pollJob(jobId: string, timeoutMs = 300_000): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/tasks/jobs/${jobId}`);
      if (res.ok) {
        const j = await res.json();
        if (j.status === "succeeded" || j.status === "failed" || j.status === "rejected") return j;
      }
    } catch { /* transient — keep polling */ }
    await sleep(3000);
  }
  return null;
}

/** Strip quoted reply history from a raw text body so the request sees only
 *  the new message. Shared by the IMAP path and the Mailjet inbound webhook. */
export function stripQuotedReply(rawInput: string): string {
  const raw = (rawInput ?? "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .+wrote:\s*$/.test(line)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*_{5,}\s*$/.test(line)) break;
    if (/^\s*From:\s.+@/.test(line) && out.length > 0) break;
    if (/^\s*>/.test(line)) continue; // drop quoted lines
    out.push(line);
  }
  return out.join("\n").trim() || raw.trim();
}

/** IMAP variant — pulls the text part off a parsed message, then strips quotes. */
function extractNewBody(parsed: ParsedMail): string {
  return stripQuotedReply(parsed.text ?? "");
}

type Route = "team" | "chat";

// Drop repeated Re:/Fwd:/Fw: (and common non-English AW:/WG:) reply markers so
// a reply to an email Neuro itself sent is seen as the actual topic — not
// "Re: Re: …" — and so the prompt we build isn't polluted with the prefix.
// Threading is preserved independently via the In-Reply-To / References headers.
function stripSubjectPrefixes(s: string): string {
  let out = s ?? "";
  let prev: string;
  do { prev = out; out = out.replace(/^\s*(?:re|fwd?|aw|wg)\s*:\s*/i, ""); } while (out !== prev);
  return out.trim();
}

function routeFromSubject(subject: string): { route: Route; cleanSubject: string } {
  const s = subject ?? "";
  if (/\[team\]/i.test(s)) return { route: "team", cleanSubject: stripSubjectPrefixes(s.replace(/\[team\]/i, "")) };
  if (/\[chat\]/i.test(s)) return { route: "chat", cleanSubject: stripSubjectPrefixes(s.replace(/\[chat\]/i, "")) };
  return { route: "chat", cleanSubject: stripSubjectPrefixes(s) };
}

function refs(parsed: ParsedMail): string[] {
  const existing = Array.isArray(parsed.references) ? parsed.references : (parsed.references ? [parsed.references] : []);
  return parsed.messageId ? [...existing, parsed.messageId] : existing;
}

// LLM answers are markdown. Email clients show the raw "**", "*", "-" as
// literal characters, which looks unprofessional — so we send BOTH a rendered
// HTML part (proper bold/headings/bullets) and a cleaned plain-text fallback
// (markdown markers stripped, bullets normalized).
function mdToPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*\n?/g, "").trim()) // code fences → bare
    .replace(/^#{1,6}\s+(.*)$/gm, (_m, h) => String(h).toUpperCase())       // headings → UPPERCASE
    .replace(/\*\*([^*]+)\*\*/g, "$1")                                       // bold
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")                            // italic
    .replace(/`([^`]+)`/g, "$1")                                             // inline code
    .replace(/^\s{0,3}[-*+]\s+/gm, "• ")                                     // bullets → •
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")                          // links → text (url)
    .replace(/^\s*>\s?/gm, "")                                               // blockquote markers
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Branded, email-client-safe HTML shell. Structural styles are INLINE (Gmail
// strips most <style> rules) and content-element styling rides in a <head>
// <style> block as progressive enhancement — clients that drop it still get a
// clean, readable layout from sane element defaults. Renders as: a soft grey
// canvas, a violet wordmark header, a white content card, and a muted footer
// that tells the recipient they can just reply to assign Neuro another task.
function buildEmailHtml(innerHtml: string): string {
  const accent = "#6d4aff";
  const ink = "#1a1a22";
  const muted = "#6b6b76";
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<style>
  .nw-body h1,.nw-body h2,.nw-body h3{color:${ink};font-weight:600;line-height:1.3;margin:1.2em 0 .5em}
  .nw-body h1{font-size:20px}.nw-body h2{font-size:17px}.nw-body h3{font-size:15px}
  .nw-body p{margin:0 0 .85em}
  .nw-body ul,.nw-body ol{margin:0 0 .85em;padding-left:1.4em}
  .nw-body li{margin:.2em 0}
  .nw-body a{color:${accent};text-decoration:underline}
  .nw-body code{font-family:'SF Mono',Consolas,Menlo,monospace;font-size:13px;background:#f1f0f6;border-radius:4px;padding:1px 5px}
  .nw-body pre{background:#f6f5fb;border:1px solid #e7e5f0;border-radius:8px;padding:12px 14px;overflow:auto;font-size:13px}
  .nw-body pre code{background:none;padding:0}
  .nw-body blockquote{margin:0 0 .85em;padding:.2em 0 .2em 14px;border-left:3px solid #e0ddee;color:${muted}}
  .nw-body table{border-collapse:collapse;width:100%;margin:0 0 1em;font-size:13px}
  .nw-body th,.nw-body td{border:1px solid #e7e5f0;padding:7px 10px;text-align:left}
  .nw-body th{background:#f6f5fb;font-weight:600}
  .nw-body hr{border:none;border-top:1px solid #ececf2;margin:1.4em 0}
</style>
</head>
<body style="margin:0;padding:0;background:#f4f3f8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f8;">
    <tr><td align="center" style="padding:28px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #ebeaf1;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:20px 28px;border-bottom:1px solid #f0eff5;">
          <span style="font-family:${font};font-size:18px;font-weight:700;color:${ink};letter-spacing:-.2px;">Neuro</span>
          <span style="font-family:${font};font-size:12px;color:${muted};margin-left:8px;">· NeuroWorks AI workforce</span>
        </td></tr>
        <tr><td class="nw-body" style="padding:24px 28px;font-family:${font};font-size:14px;line-height:1.6;color:${ink};">
          ${innerHtml}
        </td></tr>
        <tr><td style="padding:16px 28px 22px;border-top:1px solid #f0eff5;font-family:${font};font-size:12px;line-height:1.5;color:${muted};">
          Sent by <strong style="color:${ink};">Neuro</strong>, your AI workforce. Just reply to this email to assign another task — add <span style="font-family:monospace;">[team]</span> to the subject to route it to a specialist.
        </td></tr>
      </table>
      <div style="font-family:${font};font-size:11px;color:#a7a6b3;margin-top:14px;">NeuroWorks by RUBIEM Innovations · Aiia</div>
    </td></tr>
  </table>
</body>
</html>`;
}

async function renderHtml(md: string): Promise<string> {
  const inner = await Promise.resolve(marked.parse(md, { breaks: true }) as string | Promise<string>);
  return buildEmailHtml(inner);
}

async function sendReply(env: EmailEnv, opts: {
  to: string;
  subject: string;
  body: string;            // markdown
  inReplyTo?: string;
  references?: string[];
}): Promise<void> {
  // Mailjet HTTPS path doesn't need a nodemailer transport; only the
  // legacy SMTP path does. Guard accordingly so a Mailjet-only config
  // still sends replies.
  const useMailjet = !!(env.mailjetApiKey && env.mailjetApiSecret);
  if (!useMailjet && !transporter) return;
  const subject = /^re:/i.test(opts.subject) ? opts.subject : `Re: ${opts.subject || "your message"}`;
  const text = mdToPlainText(opts.body);
  let html: string | undefined;
  try { html = await renderHtml(opts.body); } catch { html = undefined; }
  await sendOutbound(env, {
    to: [opts.to],
    subject,
    text,
    html,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  });
}

export type InboundMessage = {
  sender: string;            // From address
  subject: string;
  body: string;              // new message body (quoted history already stripped)
  messageId?: string;
  references?: string[];
  inReplyTo?: string;        // In-Reply-To header — threads a reply to its parent
  // SPF/DKIM verdict for the sender (IMAP path computes it cryptographically via
  // mailauth; webhook path verifies upstream and leaves this undefined). "fail"
  // is rejected as a spoof; "unknown" is rejected only in strict mode.
  authVerdict?: AuthVerdict;
};

// Core inbound handler — SHARED by the IMAP poll and the Mailjet Parse webhook.
// Applies the allow-list (the security boundary), routes to /api/chat (new chat
// session) or /api/team (team brief), waits for the result, and replies via the
// configured outbound transport. Returns a status so the webhook can turn it
// into an HTTP response. The allow-list is the trust gate for BOTH transports:
// a forged webhook POST still has to claim an allow-listed From to do anything.
export async function processInboundEmail(msg: InboundMessage): Promise<{ status: "processed" | "ignored" | "empty" | "error"; reason?: string; jobId?: string }> {
  if (!emailConfigured()) return { status: "error", reason: "email not configured" };
  const env = readEnv();
  const sender = (msg.sender ?? "").toLowerCase().trim();
  if (!sender) return { status: "ignored", reason: "no sender" };
  // ── Allow-list gate (the security boundary) ──
  if (!env.allowedSenders.includes(sender)) {
    status.skippedUnauthorized += 1;
    console.warn(`[email] ignored message from non-allowlisted sender: ${sender}`);
    return { status: "ignored", reason: "sender not allow-listed" }; // silent — no backscatter to a possibly-spoofed From
  }

  // Anti-spoofing: an allow-listed From is attacker-controlled until verified.
  // The IMAP path supplies a cryptographic DKIM/DMARC verdict; reject explicit
  // failures (a spoof), and unverifiable mail too when REQUIRE_AUTH=strict.
  const strictAuth = (process.env.CLAWBOT_EMAIL_REQUIRE_AUTH ?? "").trim().toLowerCase() === "strict";
  if (msg.authVerdict === "fail" || (msg.authVerdict === "unknown" && strictAuth)) {
    status.skippedUnauthorized += 1;
    console.warn(`[email] rejected ${sender}: email auth ${msg.authVerdict} (DKIM/DMARC) — possible spoof`);
    return { status: "ignored", reason: `email auth ${msg.authVerdict}` }; // silent — don't backscatter a spoof
  }
  if (msg.authVerdict === "unknown") console.warn(`[email] ${sender}: DKIM/DMARC UNVERIFIED — relying on allow-list`);

  const subject = msg.subject ?? "";
  const { route, cleanSubject } = routeFromSubject(subject);
  const prompt = [cleanSubject, msg.body].filter(Boolean).join("\n\n").trim();
  // Thread key — groups this message with prior turns in the same mail thread so
  // an email back-and-forth keeps context (computed even when the body is empty
  // so the reply below still threads).
  const { threadKeyFor, getThreadHistory, appendThreadTurn } = await import("./email-threads.js");
  const threadKey = threadKeyFor({ references: msg.references, inReplyTo: msg.inReplyTo, messageId: msg.messageId, sender, subject });
  if (!prompt) {
    await sendReply(env, { to: sender, subject, body: "I received an empty message — put a question or task in the subject or body and I'll get on it.\n\n— Neuro", inReplyTo: msg.messageId, references: msg.references });
    return { status: "empty" };
  }

  status.inflight += 1;
  try {
    let answer = "";
    let jobId: string | undefined;
    if (route === "team") {
      // Team brief — auto-routes the task to the best specialist persona(s).
      const r = await apiPost("/api/team", { tasks: [{ content: prompt }] });
      jobId = r?.tasks?.[0]?.jobId;
      if (!jobId) {
        answer = `I couldn't dispatch that as a team brief (${r?.error ?? "no job created"}).`;
      } else {
        const j = await pollJob(jobId);
        answer = coerceEmailBody(j?.result?.answer).trim()
          || (j?.error ? `The task hit an error: ${j.error}` : "I wasn't able to produce an answer for that one.");
      }
    } else {
      // Chat session — thread-aware. Replay any prior turns in this mail thread
      // so a reply continues the conversation (the web chat does the same with
      // its message list). Pin the generalist (clawbot) so an email on any topic
      // is handled rather than refused by whatever specialist persona happens to
      // be active in the UI (their lane gate would bounce off-topic requests).
      const history = getThreadHistory(threadKey);
      const messages = [...history.map(h => ({ role: h.role, content: h.content })), { role: "user", content: prompt }];
      const r = await apiPost("/api/chat", { messages, persona: "clawbot" });
      if (r?.kind === "message") {
        // Direct answer or a clarification question — reply with it as-is.
        answer = String(r.text ?? "").trim() || "I couldn't process that request.";
      } else if ((r?.kind === "task" || r?.kind === "approval") && r.jobId) {
        jobId = String(r.jobId);
        const j = await pollJob(jobId);
        answer = coerceEmailBody(j?.result?.answer).trim()
          || (j?.error ? `The task hit an error: ${j.error}` : (r.text ? String(r.text) : "I wasn't able to produce an answer for that one."));
      } else {
        answer = String(r?.text ?? "").trim() || "I couldn't process that request.";
      }
    }

    // Persist this exchange to the thread so the next reply has context. Only
    // the chat route carries a conversational thread; team briefs are one-shot
    // dispatches, so we skip them.
    if (route === "chat" && answer) {
      try {
        appendThreadTurn(threadKey, "user", prompt);
        appendThreadTurn(threadKey, "assistant", answer);
      } catch (e: any) { console.warn(`[email] thread append failed: ${e?.message ?? e}`); }
    }

    await sendReply(env, {
      to: sender,
      subject: cleanSubject || subject,
      body: `${answer}\n\n— Neuro`,
      inReplyTo: msg.messageId,
      references: msg.references,
    });
    status.processed += 1;
    console.log(`[email] replied to ${sender} via ${route}${jobId ? ` (job ${jobId.slice(0, 8)})` : ""}`);
    return { status: "processed", jobId };
  } catch (e: any) {
    console.error(`[email] processInboundEmail failed for ${sender}: ${e?.stack ?? e}`);
    try {
      await sendReply(env, { to: sender, subject: cleanSubject || subject, body: `Sorry — I hit an error handling that: ${String(e?.message ?? e).slice(0, 200)}\n\n— Neuro`, inReplyTo: msg.messageId, references: msg.references });
    } catch { /* tolerate */ }
    return { status: "error", reason: String(e?.message ?? e) };
  } finally {
    status.inflight -= 1;
  }
}

// IMAP adapter — extract structured fields off a parsed message and hand to the
// shared core. Fired async from the poll loop (the message is already \Seen) so
// a multi-minute job doesn't block the inbox poll.
async function processMessage(_env: EmailEnv, parsed: ParsedMail, rawSource: Buffer): Promise<void> {
  const sender = parsed.from?.value?.[0]?.address ?? "";
  // Cryptographically verify DKIM/DMARC from the raw message before trusting the
  // From against the allow-list. mailauth fetches the signing key from DNS.
  let authVerdict: AuthVerdict = "unknown";
  try { authVerdict = await verifyInboundDkim(rawSource, sender); }
  catch { authVerdict = "unknown"; }
  await processInboundEmail({
    sender,
    subject: parsed.subject ?? "",
    body: extractNewBody(parsed),
    messageId: parsed.messageId,
    references: refs(parsed),
    inReplyTo: parsed.inReplyTo,
    authVerdict,
  });
}

// Connect to IMAP, collect unseen messages, mark them \Seen, then fire each for
// async processing. IMPORTANT: \Seen is flagged AFTER the fetch generator
// finishes — issuing another IMAP command (messageFlagsAdd) WHILE the fetch is
// still streaming deadlocks the connection (imapflow serialises commands).
// IMAP host IP cache. This box's resolver intermittently NXDOMAINs the mail
// host (it has several DNS servers across interfaces), which would stall inbound
// every time a poll's getaddrinfo fails. Resolve once and reconnect by IP — TLS
// SNI + cert validation still use the real hostname — falling back to the
// last-known-good IP when DNS hiccups. Re-resolve hourly so a real IP change
// still propagates.
let cachedImapHost: { name: string; ip: string; at: number } | null = null;
async function resolveImapHostIp(host: string): Promise<string | null> {
  if (cachedImapHost && cachedImapHost.name === host && Date.now() - cachedImapHost.at < 3_600_000) return cachedImapHost.ip;
  try {
    const r = await dnsLookup(host, { family: 4 });
    cachedImapHost = { name: host, ip: r.address, at: Date.now() };
    return r.address;
  } catch {
    if (cachedImapHost && cachedImapHost.name === host) return cachedImapHost.ip; // survive transient DNS failure
    return null;
  }
}

async function pollOnce(env: EmailEnv): Promise<void> {
  const ip = await resolveImapHostIp(env.imapHost);
  const client = new ImapFlow({
    host: ip ?? env.imapHost,    // connect by cached IP — immune to a transient resolver miss
    servername: env.imapHost,    // SNI + TLS cert hostname stay the real name
    port: env.imapPort,
    secure: true,
    auth: { user: env.user, pass: env.pass },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // Keep the raw source alongside the parsed message — DKIM verification
      // needs the exact bytes the sender signed, not the re-serialised parse.
      const pending: { parsed: ParsedMail; raw: Buffer }[] = [];
      const seenUids: number[] = [];
      const uids = await client.search({ seen: false }, { uid: true });
      if (uids && uids.length) {
        for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          try {
            pending.push({ parsed: await simpleParser(msg.source), raw: msg.source });
            seenUids.push(msg.uid);
          } catch (e: any) {
            console.warn(`[email] failed to parse message uid=${msg.uid}: ${e?.message ?? e}`);
          }
        }
        // Mark seen AFTER the fetch loop so the next poll won't reprocess these,
        // even if a job below crashes. Done outside the fetch stream to avoid
        // the imapflow command-while-streaming deadlock.
        if (seenUids.length) await client.messageFlagsAdd(seenUids, ["\\Seen"], { uid: true });
      }
      // Process outside the mailbox lock — jobs take minutes; don't hold IMAP.
      for (const { parsed, raw } of pending) {
        void processMessage(env, parsed, raw).catch(e =>
          console.error(`[email] processMessage rejected: ${e?.stack ?? e}`));
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => { /* tolerate */ });
  }
}

/** Start the email bridge. No-op (with a log) when not configured. */
export async function startEmailBridge(): Promise<void> {
  if (started) return;
  if (!emailConfigured()) {
    console.log("  ⓘ email bridge disabled (set CLAWBOT_EMAIL_USER + CLAWBOT_EMAIL_APP_PASSWORD to enable)");
    return;
  }
  const env = readEnv();
  // Mailjet HTTPS API is preferred when both halves of its auth are set
  // — skip the SMTP transport setup entirely so we don't try (and fail)
  // to verify Gmail creds the operator may not have provided. The legacy
  // SMTP path stays available as a fallback for installs without Mailjet.
  if (env.mailjetApiKey && env.mailjetApiSecret) {
    console.log(`  ✓ email outbound via Mailjet HTTPS API (${env.from})`);
  } else if (env.user && env.pass) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.user, pass: env.pass },
    });
    try {
      await transporter.verify();
      console.log(`  ✓ email SMTP ready (${env.from})`);
    } catch (e: any) {
      status.lastError = `SMTP verify failed: ${e?.message ?? e}`;
      console.warn(`  ⚠ email SMTP verify failed: ${e?.message ?? e}`);
    }
  }

  started = true;

  // An allow-list is the trust boundary for BOTH inbound transports.
  if (env.allowedSenders.length === 0) {
    console.warn("  ⚠ email INBOUND disabled — set CLAWBOT_EMAIL_ALLOWED_SENDERS to allow senders (outbound send still works)");
    return; // fail safe — never accept inbound without an allow-list
  }

  // ── Inbound transport: Mailjet Parse webhook ──
  if (env.inboundMode === "webhook") {
    startInboundWebhook(); // own port, token-gated; tunnel it to Mailjet
    console.log(`  ⓘ email inbound via Mailjet Parse webhook · ${env.allowedSenders.length} allowed sender(s)`);
    return; // webhook mode: no IMAP poll
  }
  if (env.inboundMode === "off") {
    console.log("  ⓘ email inbound OFF (CLAWBOT_EMAIL_INBOUND_MODE=off) — outbound only");
    return;
  }

  // ── Inbound transport: legacy Gmail IMAP poll ──
  // The poll loop needs IMAP creds (user + pass). SMTP2GO is send-only.
  if (!env.user || !env.pass) {
    console.log("  ⓘ email INBOUND skipped — no IMAP credentials (SMTP2GO is send-only). Outbound still works.");
    return;
  }

  console.log(`  ⓘ email inbound armed — polling ${env.user} every ${Math.round(env.pollMs / 1000)}s · ${env.allowedSenders.length} allowed sender(s)`);
  const tick = async () => {
    if (polling) return;
    polling = true;
    try {
      await pollOnce(env);
      status.lastPollAt = new Date().toISOString();
      status.lastError = null;
    } catch (e: any) {
      status.lastError = String(e?.message ?? e);
      console.warn(`[email] poll error: ${status.lastError}`);
    } finally {
      polling = false;
    }
  };
  pollTimer = setInterval(() => void tick(), env.pollMs);
  void tick(); // initial poll without waiting a full interval
}

export function stopEmailBridge(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (transporter) { try { transporter.close(); } catch { /* tolerate */ } transporter = null; }
  stopInboundWebhook();
  started = false;
}

/** Return a reason string if `addr` looks like a placeholder / example address
 *  the agent should never actually send to, or null if it's a plausible real
 *  address. Covers the RFC-reserved example/test domains, bracketed fill-ins
 *  ("[project lead email]"), and the common fake-recipient tokens models emit
 *  when they couldn't resolve a real contact. */
export function placeholderAddressReason(addr: string): string | null {
  const a = String(addr ?? "").trim();
  if (!a) return "empty";
  if (/[[\]<>]|\s/.test(a)) return "contains brackets/spaces — not a real address";
  const at = a.lastIndexOf("@");
  if (at < 1 || at === a.length - 1) return "not a valid address";
  const local = a.slice(0, at).toLowerCase();
  const domain = a.slice(at + 1).toLowerCase();
  // RFC 2606 / 6761 reserved domains that can never receive real mail.
  if (/(^|\.)(example|test|invalid|localhost)$/.test(domain)) return `${domain} is a reserved/example domain`;
  if (/(^|\.)(example)\.(com|org|net)$/.test(domain)) return `${domain} is an example domain`;
  if (domain === "email.com" && /^(email|your|name|user|recipient)$/.test(local)) return "looks like a fill-in stub";
  // Obvious fill-in local parts paired with a vague domain.
  if (/^(your[._-]?email|recipient|name|firstname|lastname|someone|user|client|customer|placeholder|tbd|xxx+)$/.test(local) && /^(email|company|domain|example|yourcompany|acme)\./.test(domain + ".")) {
    return "looks like a fill-in stub";
  }
  return null;
}

/** Strip NeuroWorks vault-note plumbing from an outbound email body.
 *
 *  When a user asks Neuro to "send me that report/document", the agent reads the
 *  vault note and emails it verbatim — but our notes carry metadata the recipient
 *  shouldn't see. Two note shapes leak:
 *
 *  • JOB-JOURNAL notes — YAML frontmatter (jobId/status/template/persona/…) + a
 *    Status/Template/Started/Finished/Title preamble + an Inputs JSON dump + a
 *    collapsible run Log. The deliverable is the `## Answer` section.
 *  • IMPORT-SIDECAR notes (fs.import_to_vault / bulk-import) — frontmatter
 *    (imported_from/imported_at/kind/size_kb/tags:[imported,…]) + a provenance
 *    preamble ("Imported from … on …", "The full file is filed in your vault at
 *    [[…]] — open it in Obsidian", "## Source provenance"). The deliverable is
 *    the `## Excerpt` section (the extracted document text).
 *
 *  Steps: (1) always drop a leading `--- … ---` frontmatter fence (never email
 *  raw YAML); (2) if it's an import sidecar, return the document excerpt minus
 *  the provenance boilerplate; (3) if it's a job journal, return the Answer (or
 *  strip the preamble/Inputs/Log); (4) otherwise return the (frontmatter-free)
 *  body. Telltale-gated so ordinary emails pass through untouched.
 */
export function stripVaultReportMetadata(input: string): string {
  const original = String(input ?? "");
  if (!original.trim()) return original;

  // 1) Capture + remove a leading YAML frontmatter fence. Keep the captured
  //    frontmatter text so we can read its keys for telltale detection.
  const fence = original.match(/^﻿?\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/);
  const frontmatter = fence ? fence[1] : "";
  let s = fence ? original.slice(fence[0].length) : original;

  // ── IMPORT-SIDECAR note ──
  const importTelltale =
    /(^|\n)\s*imported_(from|at)\s*:/i.test(frontmatter) ||
    /(^|\n)\s*tags\s*:\s*\[[^\]]*\bimported\b/i.test(frontmatter) ||
    /filed in your vault at \[\[/i.test(s) ||
    /(^|\n)#{1,6}[ \t]*Source provenance\b/i.test(s) ||
    /(^|\n)Imported from [`"]?.+ on \d{4}-\d{2}-\d{2}/i.test(s);
  if (importTelltale) {
    // Prefer the extracted document — the "## Excerpt …" section.
    const excerpt = s.match(/(?:^|\n)#{1,6}[ \t]*Excerpt[^\n]*\n([\s\S]*?)(?=\n#{1,6}[ \t]*Source provenance\b|\n#{1,6}[ \t]|$)/i);
    if (excerpt && excerpt[1].trim().length > 40) {
      return excerpt[1].replace(/_\(text truncated[^)]*\)_/gi, "").trim();
    }
    // No excerpt section — strip the provenance scaffolding and keep the rest.
    let body = s
      .replace(/^#{1,6}[ \t]*.+\n+/, "")                                              // leading "# title"
      .replace(/(?:^|\n)Imported from [`"]?.+? on \d{4}-\d{2}-\d{2}[^\n]*\n?/i, "\n") // "Imported from … on …"
      .replace(/(?:^|\n)The full file is filed in your vault at \[\[[^\n]*\n?/i, "\n")// "filed in your vault …"
      .replace(/(?:^|\n)#{1,6}[ \t]*Source provenance\b[\s\S]*$/i, "")               // provenance block → end
      .replace(/_\(text truncated[^)]*\)_/gi, "");
    return body.trim() || s.trim();
  }

  // ── JOB-JOURNAL note ──
  const hasJournalKey = /(^|\n)(?:[-*]\s*)?\*{0,2}(?:jobId|slug|startedAt|finishedAt|personaName)\*{0,2}\s*[:=]/i.test(original);
  const hasInputsAndAnswer = /(^|\n)#{1,6}\s*Inputs\b/i.test(s) && /(^|\n)#{1,6}\s*Answer\b/i.test(s);
  if (hasJournalKey || hasInputsAndAnswer) {
    const answer = s.match(/(?:^|\n)#{1,6}[ \t]*Answer[ \t]*\n([\s\S]*?)(?=\n#{1,6}[ \t]|\n<details>|$)/i);
    if (answer && answer[1].trim().length > 40) return answer[1].trim();
    const META = /^(?:[-*]\s*)?\*{0,2}(?:type|title|slug|created|jobId|job id|status|template|persona|personaName|persona name|startedAt|started|finishedAt|finished)\*{0,2}\s*[:=]\s/i;
    const lines = s.split("\n");
    let i = 0;
    while (i < lines.length && (lines[i].trim() === "" || META.test(lines[i].trim()))) i++;
    s = lines.slice(i).join("\n");
    s = s.replace(/(?:^|\n)#{1,6}[ \t]*Inputs[ \t]*\n+```[a-z]*\n[\s\S]*?\n```/i, "");
    s = s.replace(/\n*<details>\s*<summary>\s*Log\s*<\/summary>[\s\S]*?<\/details>\s*$/i, "");
    return s.trim() || original.trim();
  }

  // ── Ordinary content ──
  // If we stripped a frontmatter fence, return the frontmatter-free body (never
  // email raw YAML). Otherwise leave the body exactly as-is.
  return fence ? s.trim() : original;
}

/** Coerce whatever a caller hands us as an email body into markdown text.
 *  The planner sometimes wires a PRIOR STEP'S RESULT OBJECT into email.send's
 *  `body` (e.g. a synth step's `{ answer, sources, … }`) instead of its
 *  `.answer` string — naive `String(obj)` then renders as "[object Object]".
 *  We dig out the human-readable field; only fall back to JSON for genuinely
 *  structureless objects. Then strip any job-journal metadata so "send me that
 *  report" emails carry the deliverable, not the internal plumbing. Exported so
 *  the email.send primitive uses the same logic before it ever stringifies. */
export function coerceEmailBody(v: unknown): string {
  return stripVaultReportMetadata(coerceToBodyString(v));
}

function coerceToBodyString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(coerceToBodyString).filter(Boolean).join("\n\n");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const key of ["answer", "text", "body", "markdown", "content", "message"]) {
      if (typeof o[key] === "string" && (o[key] as string).trim()) return o[key] as string;
    }
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }
  return String(v);
}

/** Public outbound email primitive. Used by the `email.send` agent
 *  primitive AND by /api/email/test. Routes through whichever outbound
 *  transport is configured (Mailjet HTTPS > nodemailer SMTP). Returns a
 *  delivery confirmation that includes the transport name and any
 *  message id the provider returned so the calling agent can SHOW the
 *  user it actually sent — instead of synthesising a "looks sent" answer.
 */
// Recipient count cap — a broadcast that fans out to hundreds of addresses
// off a single planner call is more likely a mis-resolved wildcard (e.g. an
// unfiltered users.list) than an intentional send; fail loud so the agent
// narrows the recipient set instead of spamming the whole org directory.
const MAX_RECIPIENTS = 50;

// Accepts one address or many (comma-separated string / array — both the
// email.send primitive and POST /api/email/send normalise into this before
// calling sendEmail). Every address is validated + placeholder-checked
// individually so one bad address in a broadcast fails loud with which one,
// rather than silently dropping it or rejecting the whole batch opaquely.
export function normalizeRecipients(to: string | string[]): string[] {
  const raw = Array.isArray(to) ? to : String(to ?? "").split(",");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const addr = String(r ?? "").trim();
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  body: string;              // markdown — auto-rendered to text + html
  inReplyTo?: string;
  references?: string[];
  attachPaths?: string[];    // absolute file paths — loaded + base64'd here
}): Promise<{ ok: true; transport: "mailjet" | "smtp"; from: string; to: string; recipients: string[]; subject: string; sentAt: string; attachments?: { filename: string; bytes: number }[] }> {
  const env = readEnv();
  if (!emailConfigured()) throw new Error("email not configured — set CLAWBOT_MAILJET_API_KEY + _SECRET, or CLAWBOT_EMAIL_USER + _APP_PASSWORD");
  const recipients = normalizeRecipients(opts.to);
  if (recipients.length === 0) throw new Error(`email.send: invalid 'to' — no recipients resolved from "${opts.to}"`);
  if (recipients.length > MAX_RECIPIENTS) throw new Error(`email.send: ${recipients.length} recipients exceeds the ${MAX_RECIPIENTS}-address cap — this usually means a wildcard/list reference wasn't filtered. Narrow the recipient list.`);
  for (const addr of recipients) {
    if (!addr.includes("@")) throw new Error(`email.send: invalid 'to' address "${addr}"`);
    // Reject obvious placeholder / example addresses. A planner that couldn't
    // resolve a real recipient sometimes emits a fake one (name@example.com,
    // "[project lead email]"); sending there is worse than failing. Fail LOUD
    // with a corrective hint so the agent resolves the real address from the
    // org directory (users.lookup) and retries.
    const badTo = placeholderAddressReason(addr);
    if (badTo) throw new Error(`email.send: "${addr}" looks like a placeholder (${badTo}). Resolve the recipient's real address from the org directory with users.lookup / users.list before sending — don't use example/placeholder addresses.`);
  }
  if (!opts.subject?.trim()) throw new Error("email.send: subject required");
  // Safety net for EVERY caller (schedules, replies, the email.send primitive):
  // never let a non-string body render as "[object Object]".
  const body = coerceEmailBody(opts.body);
  if (!body.trim()) throw new Error("email.send: body required");
  opts = { ...opts, body };

  const useMailjet = !!(env.mailjetApiKey && env.mailjetApiSecret);
  if (!useMailjet && !transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost, port: env.smtpPort, secure: env.smtpPort === 465,
      auth: { user: env.user, pass: env.pass },
    });
  }
  const text = mdToPlainText(opts.body);
  let html: string | undefined;
  try { html = await renderHtml(opts.body); } catch { html = undefined; }
  // Load attachments BEFORE sending — a missing file must fail the send, not
  // produce a "please find attached" email with nothing on it.
  const attachments = opts.attachPaths?.length ? loadAttachments(opts.attachPaths) : undefined;
  await sendOutbound(env, {
    to: recipients,
    subject: opts.subject,
    text,
    html,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
    attachments,
  });
  return {
    ok: true,
    transport: useMailjet ? "mailjet" : "smtp",
    from: env.from,
    to: recipients.join(", "),
    recipients,
    subject: opts.subject,
    sentAt: new Date().toISOString(),
    ...(attachments?.length ? { attachments: attachments.map(a => ({ filename: a.filename, bytes: a.bytes })) } : {}),
  };
}

/** Send a one-off test email (used by the /api/email/test route). */
export async function sendTestEmail(to: string): Promise<void> {
  const env = readEnv();
  if (!emailConfigured()) throw new Error("email not configured");
  // Mailjet path doesn't need a nodemailer transport; only initialise the
  // SMTP transporter when we'd actually use it (Mailjet not configured).
  const useMailjet = !!(env.mailjetApiKey && env.mailjetApiSecret);
  if (!useMailjet && !transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost, port: env.smtpPort, secure: env.smtpPort === 465,
      auth: { user: env.user, pass: env.pass },
    });
  }
  const testMd = `Your Neuro email bridge is **live**. Transport: ${useMailjet ? "Mailjet HTTPS API" : "SMTP"}.\n\nReply to any message from Neuro to assign a task — for example:\n\n- **\\[chat\\] what's on my plate today?**\n- **\\[team\\] draft our Q3 launch plan**\n\nNeuro will run it and email you back the result.\n\n— Neuro`;
  let testHtml: string | undefined;
  try { testHtml = await renderHtml(testMd); } catch { testHtml = undefined; }
  await sendOutbound(env, {
    to: [to],
    subject: "Neuro email bridge — test",
    text: mdToPlainText(testMd),
    html: testHtml,
  });
}
