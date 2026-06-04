// Integrations registry — the user connects external services (social,
// productivity, messaging, dev tools) so agents can act on them. Connections
// live at .neuroworks/integrations.json (per-machine, gitignored).
//
// Secrets (tokens, webhook URLs) are ENCRYPTED AT REST with AES-256-GCM. The
// key comes from CLAWBOT_SECRET_KEY (hex/base64/passphrase) or, if unset, a
// generated key persisted at .neuroworks/.secret-key (also gitignored). So a
// leaked integrations.json is useless without the separate key.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const CONFIG_PATH = resolve(CONFIG_DIR, "integrations.json");
const KEY_PATH = resolve(CONFIG_DIR, ".secret-key");

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
  { id: "slack", name: "Slack", category: "messaging", auth: "webhook", testable: true,
    fields: [{ name: "webhookUrl", label: "Incoming Webhook URL", type: "url", secret: true, required: true, placeholder: "https://hooks.slack.com/services/..." }],
    docsUrl: "https://api.slack.com/messaging/webhooks" },
  { id: "telegram", name: "Telegram", category: "messaging", auth: "token", testable: true,
    fields: [
      { name: "botToken", label: "Bot Token", type: "password", secret: true, required: true, placeholder: "123456:ABC-DEF..." },
      { name: "chatId", label: "Default Chat ID", type: "text", required: true, placeholder: "123456789" },
    ], docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot" },
  { id: "discord", name: "Discord", category: "messaging", auth: "webhook", testable: true,
    fields: [{ name: "webhookUrl", label: "Webhook URL", type: "url", secret: true, required: true, placeholder: "https://discord.com/api/webhooks/..." }],
    docsUrl: "https://support.discord.com/hc/en-us/articles/228383668" },

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

  // Social.
  { id: "twitter", name: "X / Twitter", category: "social", auth: "token", testable: false,
    fields: [{ name: "bearerToken", label: "Bearer Token", type: "password", secret: true, required: true }],
    docsUrl: "https://developer.x.com/en/portal/dashboard" },
  { id: "linkedin", name: "LinkedIn", category: "social", auth: "token", testable: true,
    fields: [{ name: "accessToken", label: "Access Token", type: "password", secret: true, required: true }],
    docsUrl: "https://www.linkedin.com/developers/apps" },

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

// ─── Encryption ───
let cachedKey: Buffer | null = null;
function secretKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = (process.env.CLAWBOT_SECRET_KEY ?? "").trim();
  if (fromEnv) {
    // Accept hex (64 chars), base64, or any passphrase → SHA-256 to 32 bytes.
    cachedKey = createHash("sha256").update(fromEnv).digest();
    return cachedKey;
  }
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (existsSync(KEY_PATH)) {
    cachedKey = Buffer.from(readFileSync(KEY_PATH, "utf8").trim(), "hex");
  } else {
    const k = randomBytes(32);
    writeFileSync(KEY_PATH, k.toString("hex"), { encoding: "utf8", mode: 0o600 });
    cachedKey = k;
  }
  return cachedKey;
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Stored as "v1:<iv>:<tag>:<ciphertext>" (all base64).
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function decrypt(blob: string): string {
  const parts = blob.split(":");
  if (parts[0] !== "v1" || parts.length !== 4) throw new Error("bad ciphertext");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ─── Registry ───
type StoredConnection = {
  id: string;
  providerId: string;
  label: string;
  // secret field values are stored as encrypted blobs; non-secret as plaintext.
  secrets: Record<string, string>;   // encrypted
  config: Record<string, string>;    // non-secret fields
  createdAt: string;
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
  };
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
export async function testConnection(id: string): Promise<{ ok: boolean; detail: string }> {
  const full = getConnectionSecrets(id);
  if (!full) return { ok: false, detail: "connection not found" };
  const { provider, secrets } = full;
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
        const r = await fetch(secrets.webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "✅ clawbot connected to this channel." }) });
        return r.ok ? { ok: true, detail: "test message sent" } : { ok: false, detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 120)}` };
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
