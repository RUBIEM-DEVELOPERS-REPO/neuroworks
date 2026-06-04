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
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { marked } from "marked";
import { config } from "../config.js";
import { startInboundWebhook, stopInboundWebhook, getInboundWebhookStatus } from "./email-inbound.js";

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
  return { user, pass, from, allowedSenders, pollMs, imapHost, imapPort, smtpHost, smtpPort, mailjetApiKey, mailjetApiSecret, inboundMode };
}

// Mailjet HTTPS sender — POSTs to api.mailjet.com/v3.1/send. Used instead
// of nodemailer.sendMail when CLAWBOT_MAILJET_API_KEY + _SECRET are set.
// Auth is HTTP Basic with API_KEY:SECRET. The From: address must be on a
// domain verified in the Mailjet dashboard or the send is rejected with
// a "sender_unverified" / domain_not_authorized style error.
async function sendViaMailjet(env: EmailEnv, opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
}): Promise<void> {
  const headers: Record<string, string> = {};
  if (opts.inReplyTo) headers["In-Reply-To"] = opts.inReplyTo;
  if (opts.references?.length) headers["References"] = opts.references.join(" ");
  const message: any = {
    From: { Email: env.from },
    To: [{ Email: opts.to }],
    Subject: opts.subject,
    TextPart: opts.text,
  };
  if (opts.html) message.HTMLPart = opts.html;
  if (Object.keys(headers).length) message.Headers = headers;

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
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
}): Promise<void> {
  if (env.mailjetApiKey && env.mailjetApiSecret) {
    return sendViaMailjet(env, opts);
  }
  if (!transporter) throw new Error("email transport not initialised");
  await transporter.sendMail({
    from: env.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    ...(opts.html ? { html: opts.html } : {}),
    ...(opts.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
    ...(opts.references?.length ? { references: opts.references } : {}),
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

function routeFromSubject(subject: string): { route: Route; cleanSubject: string } {
  const s = subject ?? "";
  if (/\[team\]/i.test(s)) return { route: "team", cleanSubject: s.replace(/\[team\]/i, "").trim() };
  if (/\[chat\]/i.test(s)) return { route: "chat", cleanSubject: s.replace(/\[chat\]/i, "").trim() };
  return { route: "chat", cleanSubject: s.trim() };
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

async function renderHtml(md: string): Promise<string> {
  const inner = await Promise.resolve(marked.parse(md, { breaks: true }) as string | Promise<string>);
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a;max-width:640px">${inner}</div>`;
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
    to: opts.to,
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

  const subject = msg.subject ?? "";
  const { route, cleanSubject } = routeFromSubject(subject);
  const prompt = [cleanSubject, msg.body].filter(Boolean).join("\n\n").trim();
  if (!prompt) {
    await sendReply(env, { to: sender, subject, body: "I received an empty message — put a question or task in the subject or body and I'll get on it.\n\n— clawbot", inReplyTo: msg.messageId, references: msg.references });
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
        answer = (j?.result?.answer && String(j.result.answer).trim())
          || (j?.error ? `The task hit an error: ${j.error}` : "I wasn't able to produce an answer for that one.");
      }
    } else {
      // New chat session. Pin the generalist (clawbot) so an email on any topic
      // is handled rather than refused by whatever specialist persona happens to
      // be active in the UI (their lane gate would bounce off-topic requests).
      const r = await apiPost("/api/chat", { messages: [{ role: "user", content: prompt }], persona: "clawbot" });
      if (r?.kind === "message") {
        // Direct answer or a clarification question — reply with it as-is.
        answer = String(r.text ?? "").trim() || "I couldn't process that request.";
      } else if ((r?.kind === "task" || r?.kind === "approval") && r.jobId) {
        jobId = String(r.jobId);
        const j = await pollJob(jobId);
        answer = (j?.result?.answer && String(j.result.answer).trim())
          || (j?.error ? `The task hit an error: ${j.error}` : (r.text ? String(r.text) : "I wasn't able to produce an answer for that one."));
      } else {
        answer = String(r?.text ?? "").trim() || "I couldn't process that request.";
      }
    }

    await sendReply(env, {
      to: sender,
      subject: cleanSubject || subject,
      body: `${answer}\n\n— clawbot`,
      inReplyTo: msg.messageId,
      references: msg.references,
    });
    status.processed += 1;
    console.log(`[email] replied to ${sender} via ${route}${jobId ? ` (job ${jobId.slice(0, 8)})` : ""}`);
    return { status: "processed", jobId };
  } catch (e: any) {
    console.error(`[email] processInboundEmail failed for ${sender}: ${e?.stack ?? e}`);
    try {
      await sendReply(env, { to: sender, subject: cleanSubject || subject, body: `Sorry — I hit an error handling that: ${String(e?.message ?? e).slice(0, 200)}\n\n— clawbot`, inReplyTo: msg.messageId, references: msg.references });
    } catch { /* tolerate */ }
    return { status: "error", reason: String(e?.message ?? e) };
  } finally {
    status.inflight -= 1;
  }
}

// IMAP adapter — extract structured fields off a parsed message and hand to the
// shared core. Fired async from the poll loop (the message is already \Seen) so
// a multi-minute job doesn't block the inbox poll.
async function processMessage(_env: EmailEnv, parsed: ParsedMail): Promise<void> {
  await processInboundEmail({
    sender: parsed.from?.value?.[0]?.address ?? "",
    subject: parsed.subject ?? "",
    body: extractNewBody(parsed),
    messageId: parsed.messageId,
    references: refs(parsed),
  });
}

// Connect to IMAP, collect unseen messages, mark them \Seen, then fire each for
// async processing. IMPORTANT: \Seen is flagged AFTER the fetch generator
// finishes — issuing another IMAP command (messageFlagsAdd) WHILE the fetch is
// still streaming deadlocks the connection (imapflow serialises commands).
async function pollOnce(env: EmailEnv): Promise<void> {
  const client = new ImapFlow({
    host: env.imapHost,
    port: env.imapPort,
    secure: true,
    auth: { user: env.user, pass: env.pass },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const pending: ParsedMail[] = [];
      const seenUids: number[] = [];
      const uids = await client.search({ seen: false }, { uid: true });
      if (uids && uids.length) {
        for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
          if (!msg.source) continue;
          try {
            pending.push(await simpleParser(msg.source));
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
      for (const parsed of pending) {
        void processMessage(env, parsed).catch(e =>
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

/** Public outbound email primitive. Used by the `email.send` agent
 *  primitive AND by /api/email/test. Routes through whichever outbound
 *  transport is configured (Mailjet HTTPS > nodemailer SMTP). Returns a
 *  delivery confirmation that includes the transport name and any
 *  message id the provider returned so the calling agent can SHOW the
 *  user it actually sent — instead of synthesising a "looks sent" answer.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;              // markdown — auto-rendered to text + html
  inReplyTo?: string;
  references?: string[];
}): Promise<{ ok: true; transport: "mailjet" | "smtp"; from: string; to: string; subject: string; sentAt: string }> {
  const env = readEnv();
  if (!emailConfigured()) throw new Error("email not configured — set CLAWBOT_MAILJET_API_KEY + _SECRET, or CLAWBOT_EMAIL_USER + _APP_PASSWORD");
  if (!opts.to || !opts.to.includes("@")) throw new Error(`email.send: invalid 'to' address "${opts.to}"`);
  if (!opts.subject?.trim()) throw new Error("email.send: subject required");
  if (!opts.body?.trim()) throw new Error("email.send: body required");

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
  await sendOutbound(env, {
    to: opts.to,
    subject: opts.subject,
    text,
    html,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  });
  return {
    ok: true,
    transport: useMailjet ? "mailjet" : "smtp",
    from: env.from,
    to: opts.to,
    subject: opts.subject,
    sentAt: new Date().toISOString(),
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
  await sendOutbound(env, {
    to,
    subject: "clawbot email bridge — test",
    text: `This is a test message from your clawbot email bridge. Transport: ${useMailjet ? "Mailjet HTTPS API" : "SMTP"}.\n\nReply with a subject like '[chat] what's on my plate today?' or '[team] draft our Q3 launch plan' and clawbot will run it and reply.\n\n— clawbot`,
  });
}
