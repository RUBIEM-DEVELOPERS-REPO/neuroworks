// Inbound agent dispatch — the orchestration-layer entrypoint other systems
// call to run a task inside NeuroWorks.
//
// A dispatch wraps the same agent pipeline the local UI uses (generalTaskRunner
// → plan → execute → synthesise), as an async job. The caller gets a jobId
// immediately and learns the outcome by polling GET /api/v1/dispatch/:jobId or
// by a signed webhook callback when the job finishes.
//
// Tenancy: every job remembers the API key that dispatched it, and a key may
// only read its own jobs. Idempotency: a repeated Idempotency-Key from the same
// key returns the original jobId instead of starting a second run.

import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { newJob, runJob, getJob } from "./jobs.js";

const WEBHOOK_SECRET = process.env.NW_WEBHOOK_SIGNING_SECRET ?? "";
const ALLOW_PRIVATE_WEBHOOK = process.env.NW_WEBHOOK_ALLOW_PRIVATE === "1";

// jobId → apiKeyId. In-memory: a job that outlives a restart is already 404
// from the jobs store, so durable ownership buys nothing.
const jobOwner = new Map<string, string>();
// `${keyId}:${idempotencyKey}` → jobId.
const idemIndex = new Map<string, string>();

export type DispatchInput = {
  task: string;
  callbackUrl?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

export function ownerOfJob(jobId: string): string | undefined {
  return jobOwner.get(jobId);
}

export function findIdempotentJob(keyId: string, idempotencyKey?: string): string | undefined {
  if (!idempotencyKey) return undefined;
  return idemIndex.get(`${keyId}:${idempotencyKey}`);
}

export function dispatchTask(keyId: string, input: DispatchInput): { jobId: string } {
  const existing = findIdempotentJob(keyId, input.idempotencyKey);
  if (existing && getJob(existing)) return { jobId: existing };

  const job = newJob("dispatch");
  job.title = input.task.slice(0, 100);
  job.inputs = { task: input.task, via: "dispatch", metadata: input.metadata };
  jobOwner.set(job.id, keyId);
  if (input.idempotencyKey) idemIndex.set(`${keyId}:${input.idempotencyKey}`, job.id);

  // Fire-and-forget — runJob stores the result/status on the job; we read it
  // back to build the webhook payload once it settles.
  void runJob(job, async (push, progress) => {
    const { generalTaskRunner } = await import("../routes/templates.js");
    return generalTaskRunner({ task: input.task, save_as_template: false }, push, progress);
  }).then(() => fireWebhook(job.id, input)).catch(() => { /* runJob already recorded the failure */ });

  return { jobId: job.id };
}

// Trim a job's internal result to the stable public shape returned to callers.
export function publicJobView(jobId: string): {
  jobId: string; status: string; answer: string | null; error?: string;
  startedAt?: string; finishedAt?: string;
} | null {
  const j = getJob(jobId);
  if (!j) return null;
  const r: any = j.result ?? {};
  return {
    jobId: j.id,
    status: j.status,
    answer: typeof r.answer === "string" ? r.answer : null,
    error: j.error,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
  };
}

// ── Webhook delivery ────────────────────────────────────────────────────────

async function fireWebhook(jobId: string, input: DispatchInput): Promise<void> {
  if (!input.callbackUrl) return;
  const view = publicJobView(jobId);
  if (!view) return;
  const payload = {
    jobId: view.jobId,
    status: view.status,
    answer: view.answer,
    error: view.error,
    finishedAt: view.finishedAt,
    metadata: input.metadata ?? null,
  };
  const body = JSON.stringify(payload);

  if (!(await isAllowedWebhookUrl(input.callbackUrl))) {
    console.warn(`[dispatch] webhook to ${input.callbackUrl} blocked (private/invalid target; set NW_WEBHOOK_ALLOW_PRIVATE=1 to allow)`);
    return;
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "NeuroWorks-Dispatch/1",
  };
  if (WEBHOOK_SECRET) {
    headers["X-NeuroWorks-Signature"] = "sha256=" + createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    // redirect: "manual" — do NOT follow 3xx. A caller-supplied URL that 302s
    // to an internal host would otherwise slip past the SSRF check (which only
    // vetted the ORIGINAL host). A redirected webhook is treated as delivered.
    await fetch(input.callbackUrl, { method: "POST", headers, body, redirect: "manual", signal: ctrl.signal });
    clearTimeout(t);
  } catch (e: any) {
    console.warn(`[dispatch] webhook delivery to ${input.callbackUrl} failed: ${e?.message ?? e}`);
  }
}

// SSRF guard for caller-supplied webhook URLs. Blocks loopback, private, and
// link-local (incl. cloud metadata 169.254.169.254) targets by resolving the
// host and checking the address — defeats DNS-rebinding to an internal IP.
async function isAllowedWebhookUrl(raw: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (ALLOW_PRIVATE_WEBHOOK) return true;
  const host = u.hostname;
  // Collect EVERY address the host resolves to and reject if ANY is private —
  // a multi-record DNS answer where only one entry is public would otherwise
  // let a rebinding attacker reach an internal service on the second record.
  let addrs: string[] = [];
  try {
    if (isIP(host)) addrs = [host];
    else addrs = (await dnsLookup(host, { all: true })).map(r => r.address);
  } catch { return false; }
  if (addrs.length === 0) return false;
  return addrs.every(a => !isPrivateAddress(a));
}

function isPrivateAddress(ip: string): boolean {
  const lc = ip.toLowerCase();
  // IPv6 loopback/link-local/unique-local/unspecified.
  if (lc === "::1" || lc === "::" || lc.startsWith("fe80") || lc.startsWith("fc") || lc.startsWith("fd")) return true;
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — unwrap and check the v4 part.
  const mapped = lc.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped ? mapped[1] : ip;
  const m = v4.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 169 && b === 254) return true;        // link-local + cloud metadata (169.254.169.254)
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64.0.0/10)
  return false;
}

// ── Per-key request cap ──────────────────────────────────────────────────────
// A lightweight in-memory sliding window so one key can't flood the dispatch
// pipeline. Cap is NW_DISPATCH_RATE_PER_MIN (default 120/min). Best-effort:
// resets on restart, which is fine — it's a throttle, not an accounting ledger.
const RATE_PER_MIN = Math.max(1, Number(process.env.NW_DISPATCH_RATE_PER_MIN ?? "120") || 120);
const rateWindows = new Map<string, number[]>();

export function checkDispatchRate(keyId: string): { ok: boolean; retryAfter: number; limit: number } {
  const now = Date.now();
  const cutoff = now - 60_000;
  const hits = (rateWindows.get(keyId) ?? []).filter(t => t > cutoff);
  if (hits.length >= RATE_PER_MIN) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + 60_000 - now) / 1000));
    rateWindows.set(keyId, hits);
    return { ok: false, retryAfter, limit: RATE_PER_MIN };
  }
  hits.push(now);
  rateWindows.set(keyId, hits);
  return { ok: true, retryAfter: 0, limit: RATE_PER_MIN };
}
