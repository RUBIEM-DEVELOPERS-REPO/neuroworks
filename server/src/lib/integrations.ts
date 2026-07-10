// Integrations registry — the user connects external services (social,
// productivity, messaging, dev tools) so agents can act on them. Connections
// live at .neuroworks/integrations.json (per-machine, gitignored).
//
// Secrets (tokens, webhook URLs) are ENCRYPTED AT REST with AES-256-GCM. The
// key comes from NEUROWORKS_SECRET_KEY (hex/base64/passphrase) or, if unset, a
// generated key persisted at .neuroworks/.secret-key (also gitignored). So a
// leaked integrations.json is useless without the separate key.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { encryptSecret as encrypt, decryptSecret as decrypt } from "./secret-box.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const CONFIG_PATH = resolve(CONFIG_DIR, "integrations.json");

// ─── Provider catalog ───
// Each provider declares the fields needed to connect. `secret: true` fields are
// encrypted at rest and never returned to the UI. `auth: "oauth"` providers
// don't have a redirect flow yet — connect by pasting an access token for now.
export type ProviderField = { name: string; label: string; type: "text" | "password" | "url"; placeholder?: string; secret?: boolean; required?: boolean };
export type ProviderCategory = "messaging" | "social" | "productivity" | "dev";
export type Provider = {
  id: string;
  name: string;
  category: ProviderCategory;
  auth: "token" | "webhook" | "oauth";
  fields: ProviderField[];
  docsUrl?: string;
  note?: string;
  testable: boolean;
};

export const PROVIDERS: Provider[] = [
  // Messaging — agents reach you on your channels (token/webhook, no OAuth).
  { id: "slack", name: "Slack", category: "messaging", auth: "token", testable: true,
    fields: [
      { name: "botToken", label: "Bot Token (xoxb-…)", type: "password", secret: true, required: false, placeholder: "xoxb-..." },
      { name: "defaultChannel", label: "Default channel (for bot token)", type: "text", secret: false, required: false, placeholder: "#general or C0123ABCD" },
      { name: "webhookUrl", label: "Incoming Webhook URL (alternative to bot token)", type: "url", secret: true, required: false, placeholder: "https://hooks.slack.com/services/..." },
    ],
    docsUrl: "https://api.slack.com/web" },
  { id: "telegram", name: "Telegram", category: "messaging", auth: "token", testable: true,
    fields: [
      { name: "botToken", label: "Bot Token", type: "password", secret: true, required: true, placeholder: "123456:ABC-DEF..." },
      { name: "chatId", label: "Default Chat ID", type: "text", required: true, placeholder: "123456789" },
    ], docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot" },
  { id: "discord", name: "Discord", category: "messaging", auth: "webhook", testable: true,
    fields: [{ name: "webhookUrl", label: "Webhook URL", type: "url", secret: true, required: true, placeholder: "https://discord.com/api/webhooks/..." }],
    docsUrl: "https://support.discord.com/hc/en-us/articles/228383668" },
  { id: "msteams", name: "Microsoft Teams", category: "messaging", auth: "webhook", testable: true,
    fields: [{ name: "webhookUrl", label: "Incoming Webhook URL", type: "url", secret: true, required: true, placeholder: "https://outlook.office.com/webhook/..." }],
    note: "Add an 'Incoming Webhook' connector to a Teams channel and paste its URL.",
    docsUrl: "https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook" },
  { id: "googlechat", name: "Google Chat", category: "messaging", auth: "webhook", testable: true,
    fields: [{ name: "webhookUrl", label: "Space Webhook URL", type: "url", secret: true, required: true, placeholder: "https://chat.googleapis.com/v1/spaces/.../messages?key=..." }],
    docsUrl: "https://developers.google.com/chat/how-tos/webhooks" },

  // Dev / data tools.
  { id: "github", name: "GitHub", category: "dev", auth: "token", testable: true,
    fields: [{ name: "token", label: "Personal Access Token", type: "password", secret: true, required: true, placeholder: "ghp_..." }],
    docsUrl: "https://github.com/settings/tokens" },
  { id: "notion", name: "Notion", category: "dev", auth: "token", testable: true,
    fields: [{ name: "token", label: "Internal Integration Token", type: "password", secret: true, required: true, placeholder: "secret_... / ntn_..." }],
    docsUrl: "https://www.notion.so/my-integrations" },
  { id: "linear", name: "Linear", category: "dev", auth: "token", testable: true,
    fields: [{ name: "apiKey", label: "API Key", type: "password", secret: true, required: true, placeholder: "lin_api_..." }],
    docsUrl: "https://linear.app/settings/api" },
  { id: "jira", name: "Jira", category: "dev", auth: "token", testable: true,
    fields: [
      { name: "site", label: "Site (host)", type: "text", required: true, placeholder: "yourcompany.atlassian.net" },
      { name: "email", label: "Account Email", type: "text", required: true, placeholder: "you@company.com" },
      { name: "apiToken", label: "API Token", type: "password", secret: true, required: true },
    ], docsUrl: "https://id.atlassian.com/manage-profile/security/api-tokens" },
  { id: "webhook", name: "Webhook (custom)", category: "dev", auth: "webhook", testable: true,
    fields: [{ name: "webhookUrl", label: "Endpoint URL", type: "url", secret: true, required: true, placeholder: "https://example.com/hooks/neuro" }],
    note: "Any HTTPS endpoint. Neuro POSTs JSON ({ text, source }) to it — wire it into Zapier, Make, n8n, or your own service.",
    docsUrl: "https://zapier.com/apps/webhook/integrations" },

  // Social.
  { id: "twitter", name: "X / Twitter", category: "social", auth: "token", testable: false,
    fields: [{ name: "bearerToken", label: "Bearer Token", type: "password", secret: true, required: true }],
    docsUrl: "https://developer.x.com/en/portal/dashboard" },
  { id: "linkedin", name: "LinkedIn", category: "social", auth: "token", testable: true,
    fields: [{ name: "accessToken", label: "Access Token", type: "password", secret: true, required: true }],
    docsUrl: "https://www.linkedin.com/developers/apps" },

  // Productivity / CRM / ops — token-auth SaaS the agent can read & act on.
  { id: "hubspot", name: "HubSpot", category: "productivity", auth: "token", testable: true,
    fields: [{ name: "token", label: "Private App Access Token", type: "password", secret: true, required: true, placeholder: "pat-..." }],
    docsUrl: "https://developers.hubspot.com/docs/api/private-apps" },
  { id: "airtable", name: "Airtable", category: "productivity", auth: "token", testable: true,
    fields: [
      { name: "apiKey", label: "Personal Access Token", type: "password", secret: true, required: true, placeholder: "pat..." },
      { name: "baseId", label: "Default Base ID", type: "text", required: false, placeholder: "app..." },
    ], docsUrl: "https://airtable.com/create/tokens" },
  { id: "trello", name: "Trello", category: "productivity", auth: "token", testable: true,
    fields: [
      { name: "apiKey", label: "API Key", type: "password", secret: true, required: true },
      { name: "token", label: "Token", type: "password", secret: true, required: true },
    ], docsUrl: "https://trello.com/power-ups/admin" },
  { id: "asana", name: "Asana", category: "productivity", auth: "token", testable: true,
    fields: [{ name: "accessToken", label: "Personal Access Token", type: "password", secret: true, required: true }],
    docsUrl: "https://app.asana.com/0/my-apps" },
  { id: "mailchimp", name: "Mailchimp", category: "productivity", auth: "token", testable: true,
    fields: [{ name: "apiKey", label: "API Key", type: "password", secret: true, required: true, placeholder: "xxxx-us21" }],
    note: "The datacenter suffix (e.g. us21) is taken from the key automatically.",
    docsUrl: "https://mailchimp.com/help/about-api-keys/" },

  // Productivity — OAuth providers; paste an access token for now (full OAuth flow is future).
  { id: "google", name: "Google (Gmail/Calendar/Drive)", category: "productivity", auth: "oauth", testable: true,
    fields: [{ name: "accessToken", label: "OAuth Access Token", type: "password", secret: true, required: true }],
    note: "OAuth redirect flow coming soon — paste an access token to use now.",
    docsUrl: "https://developers.google.com/oauthplayground" },
  { id: "microsoft365", name: "Microsoft 365", category: "productivity", auth: "oauth", testable: true,
    fields: [{ name: "accessToken", label: "OAuth Access Token", type: "password", secret: true, required: true }],
    note: "OAuth redirect flow coming soon — paste an access token to use now.",
    docsUrl: "https://learn.microsoft.com/en-us/graph/auth/" },
];

export function getProvider(id: string): Provider | undefined {
  return PROVIDERS.find(p => p.id === id);
}

// Secrets are encrypted at rest via the shared AES-256-GCM box (see secret-box.ts).

// ─── Registry ───
// Persisted health signal — the result of the most recent test run for a
// connection. Lets the UI show a green/red dot ("connected AND working") at a
// glance instead of only "connected", and survives restarts.
export type ConnectionTest = { ok: boolean; detail: string; at: string };

type StoredConnection = {
  id: string;
  providerId: string;
  label: string;
  // secret field values are stored as encrypted blobs; non-secret as plaintext.
  secrets: Record<string, string>;   // encrypted
  config: Record<string, string>;    // non-secret fields
  createdAt: string;
  lastTest?: ConnectionTest;
};

export type ConnectionPublic = {
  id: string;
  providerId: string;
  providerName: string;
  category: ProviderCategory;
  label: string;
  config: Record<string, string>;
  secretFields: string[];   // names of the secrets we hold (values never sent)
  createdAt: string;
  lastTest?: ConnectionTest;   // health signal from the most recent test
};

function load(): StoredConnection[] {
  try {
    if (!existsSync(CONFIG_PATH)) return [];
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed as StoredConnection[] : [];
  } catch { return []; }
}
function save(list: StoredConnection[]): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(list, null, 2), "utf8");
}

function toPublic(c: StoredConnection): ConnectionPublic {
  const p = getProvider(c.providerId);
  return {
    id: c.id,
    providerId: c.providerId,
    providerName: p?.name ?? c.providerId,
    category: p?.category ?? "dev",
    label: c.label,
    config: c.config,
    secretFields: Object.keys(c.secrets),
    createdAt: c.createdAt,
    lastTest: c.lastTest,
  };
}

// Persist the most recent test verdict on a connection so the UI can show a
// durable health signal. Best-effort — a write failure doesn't fail the test.
export function recordTestResult(id: string, result: { ok: boolean; detail: string }): void {
  recordTestResults([{ id, ...result }]);
}

// Batched persist — one load + one save for many results. Used by test-all so
// concurrent per-connection writes can't race and drop each other's updates.
function recordTestResults(results: { id: string; ok: boolean; detail: string }[]): void {
  if (results.length === 0) return;
  const list = load();
  const at = new Date().toISOString();
  let changed = false;
  for (const r of results) {
    const c = list.find(x => x.id === r.id);
    if (!c) continue;
    c.lastTest = { ok: r.ok, detail: r.detail, at };
    changed = true;
  }
  if (changed) save(list);
}

export function listConnections(): ConnectionPublic[] {
  return load().map(toPublic);
}

export function addConnection(providerId: string, label: string, values: Record<string, string>): ConnectionPublic {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`unknown provider "${providerId}"`);
  const secrets: Record<string, string> = {};
  const config: Record<string, string> = {};
  for (const f of provider.fields) {
    const v = (values[f.name] ?? "").trim();
    if (f.required && !v) throw new Error(`missing required field "${f.label}"`);
    if (!v) continue;
    if (f.secret) secrets[f.name] = encrypt(v);
    else config[f.name] = v;
  }
  const conn: StoredConnection = {
    id: randomUUID(), providerId, label: label.trim() || provider.name,
    secrets, config, createdAt: new Date().toISOString(),
  };
  const list = load();
  list.push(conn);
  save(list);
  return toPublic(conn);
}

export function removeConnection(id: string): boolean {
  const list = load();
  const next = list.filter(c => c.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}

// Decrypted access for primitives/test only — never exposed via the API as-is.
export function getConnectionSecrets(id: string): { provider: Provider; config: Record<string, string>; secrets: Record<string, string> } | null {
  const c = load().find(x => x.id === id);
  if (!c) return null;
  const provider = getProvider(c.providerId);
  if (!provider) return null;
  const secrets: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.secrets)) {
    try { secrets[k] = decrypt(v); } catch { /* skip unreadable (wrong key) */ }
  }
  return { provider, config: c.config, secrets };
}

// Find the first connection for a provider (used by primitives like slack.post).
export function getConnectionByProvider(providerId: string): { id: string; config: Record<string, string>; secrets: Record<string, string> } | null {
  const c = load().find(x => x.providerId === providerId);
  if (!c) return null;
  const full = getConnectionSecrets(c.id);
  return full ? { id: c.id, config: full.config, secrets: full.secrets } : null;
}

// ─── Test a connection (non-destructive auth check where possible) ───
// Public entry: runs the test, then PERSISTS the verdict on the connection so
// the UI shows a durable "connected & working" (or failing) signal.
export async function testConnection(id: string): Promise<{ ok: boolean; detail: string }> {
  const result = await runConnectionTest(id);
  if (result.detail !== "connection not found") recordTestResult(id, result);
  return result;
}

// Test every connection in parallel, then persist all verdicts in ONE batched
// save (avoids the read-modify-write race of per-test saves running together).
export async function testAllConnections(): Promise<{ id: string; ok: boolean; detail: string }[]> {
  const ids = load().map(c => c.id);
  const results = await Promise.all(ids.map(async id => ({ id, ...(await runConnectionTest(id)) })));
  recordTestResults(results.filter(r => r.detail !== "connection not found"));
  return results;
}

async function runConnectionTest(id: string): Promise<{ ok: boolean; detail: string }> {
  const full = getConnectionSecrets(id);
  if (!full) return { ok: false, detail: "connection not found" };
  const { provider, config, secrets } = full;
  try {
    switch (provider.id) {
      case "telegram": {
        const r = await fetch(`https://api.telegram.org/bot${secrets.botToken}/getMe`);
        const j: any = await r.json();
        return j?.ok ? { ok: true, detail: `bot @${j.result?.username}` } : { ok: false, detail: j?.description ?? `HTTP ${r.status}` };
      }
      case "discord": {
        const r = await fetch(secrets.webhookUrl);
        if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
        const j: any = await r.json();
        return { ok: true, detail: `webhook "${j?.name ?? "ok"}"` };
      }
      case "slack": {
        // Prefer the Web API bot token (auth.test) — non-destructive and works
        // for chat.postMessage. Fall back to the Incoming Webhook if that's all
        // that's configured (a webhook can't be tested without posting).
        if (secrets.botToken) {
          const r = await fetch("https://slack.com/api/auth.test", { method: "POST", headers: { authorization: `Bearer ${secrets.botToken}` } });
          const j: any = await r.json().catch(() => ({}));
          return j?.ok ? { ok: true, detail: `bot @${j.user ?? "?"} in ${j.team ?? "workspace"}` } : { ok: false, detail: j?.error ?? `HTTP ${r.status}` };
        }
        if (secrets.webhookUrl) {
          const r = await fetch(secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "✅ Neuro connected to this channel." }) });
          return r.ok ? { ok: true, detail: "test message sent" } : { ok: false, detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}` };
        }
        return { ok: false, detail: "no bot token or webhook configured" };
      }
      case "msteams": {
        const r = await fetch(secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "✅ Neuro connected to this Teams channel." }) });
        return r.ok ? { ok: true, detail: "test message sent" } : { ok: false, detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}` };
      }
      case "googlechat": {
        const r = await fetch(secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "✅ Neuro connected to this space." }) });
        return r.ok ? { ok: true, detail: "test message sent" } : { ok: false, detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}` };
      }
      case "webhook": {
        const r = await fetch(secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "ping from Neuro", source: "neuroworks" }) });
        // Generic endpoint — any non-5xx means it's reachable and accepted the POST.
        return r.status < 500 ? { ok: true, detail: `endpoint reachable (HTTP ${r.status})` } : { ok: false, detail: `HTTP ${r.status}` };
      }
      case "github": {
        const r = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${secrets.token}`, "user-agent": "clawbot" } });
        const j: any = await r.json();
        return r.ok ? { ok: true, detail: `@${j?.login}` } : { ok: false, detail: j?.message ?? `HTTP ${r.status}` };
      }
      case "notion": {
        const r = await fetch("https://api.notion.com/v1/users/me", { headers: { authorization: `Bearer ${secrets.token}`, "Notion-Version": "2022-06-28" } });
        const j: any = await r.json();
        return r.ok ? { ok: true, detail: j?.name ?? j?.bot?.owner?.type ?? "ok" } : { ok: false, detail: j?.message ?? `HTTP ${r.status}` };
      }
      case "linear": {
        const r = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { authorization: secrets.apiKey, "content-type": "application/json" }, body: JSON.stringify({ query: "{ viewer { name email } }" }) });
        const j: any = await r.json();
        return j?.data?.viewer ? { ok: true, detail: j.data.viewer.name } : { ok: false, detail: j?.errors?.[0]?.message ?? `HTTP ${r.status}` };
      }
      case "linkedin": {
        const r = await fetch("https://api.linkedin.com/v2/me", { headers: { authorization: `Bearer ${secrets.accessToken}` } });
        return r.ok ? { ok: true, detail: "token valid" } : { ok: false, detail: `HTTP ${r.status}` };
      }
      case "jira": {
        const site = (config.site ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
        const auth = Buffer.from(`${config.email}:${secrets.apiToken}`).toString("base64");
        const r = await fetch(`https://${site}/rest/api/3/myself`, { headers: { authorization: `Basic ${auth}`, accept: "application/json" } });
        const j: any = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, detail: j?.displayName ?? j?.emailAddress ?? "token valid" } : { ok: false, detail: j?.errorMessages?.[0] ?? `HTTP ${r.status}` };
      }
      case "hubspot": {
        const r = await fetch("https://api.hubapi.com/account-info/v3/details", { headers: { authorization: `Bearer ${secrets.token}` } });
        const j: any = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, detail: `portal ${j?.portalId ?? "connected"}` } : { ok: false, detail: j?.message ?? `HTTP ${r.status}` };
      }
      case "airtable": {
        const r = await fetch("https://api.airtable.com/v0/meta/whoami", { headers: { authorization: `Bearer ${secrets.apiKey}` } });
        const j: any = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, detail: j?.id ? `user ${j.id}` : "token valid" } : { ok: false, detail: j?.error?.message ?? j?.error?.type ?? `HTTP ${r.status}` };
      }
      case "trello": {
        const r = await fetch(`https://api.trello.com/1/members/me?key=${encodeURIComponent(secrets.apiKey)}&token=${encodeURIComponent(secrets.token)}`);
        const j: any = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, detail: j?.fullName ?? j?.username ?? "token valid" } : { ok: false, detail: typeof j === "string" ? j : `HTTP ${r.status}` };
      }
      case "asana": {
        const r = await fetch("https://app.asana.com/api/1.0/users/me", { headers: { authorization: `Bearer ${secrets.accessToken}` } });
        const j: any = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, detail: j?.data?.name ?? j?.data?.email ?? "token valid" } : { ok: false, detail: j?.errors?.[0]?.message ?? `HTTP ${r.status}` };
      }
      case "mailchimp": {
        const dc = (secrets.apiKey.split("-")[1] ?? "").trim();
        if (!dc) return { ok: false, detail: "API key has no datacenter suffix (expected key-usXX)" };
        const auth = Buffer.from(`anystring:${secrets.apiKey}`).toString("base64");
        const r = await fetch(`https://${dc}.api.mailchimp.com/3.0/`, { headers: { authorization: `Basic ${auth}` } });
        const j: any = await r.json().catch(() => ({}));
        return r.ok ? { ok: true, detail: j?.account_name ?? "token valid" } : { ok: false, detail: j?.detail ?? `HTTP ${r.status}` };
      }
      case "google": {
        const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${secrets.accessToken}` } });
        const j: any = await r.json();
        return r.ok ? { ok: true, detail: j?.email ?? "token valid" } : { ok: false, detail: j?.error_description ?? `HTTP ${r.status}` };
      }
      case "microsoft365": {
        const r = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { authorization: `Bearer ${secrets.accessToken}` } });
        const j: any = await r.json();
        return r.ok ? { ok: true, detail: j?.userPrincipalName ?? "token valid" } : { ok: false, detail: j?.error?.message ?? `HTTP ${r.status}` };
      }
      default:
        return { ok: false, detail: "no test available for this provider" };
    }
  } catch (e: any) {
    return { ok: false, detail: String(e?.message ?? e) };
  }
}
