// Machine identity for external systems that dispatch agents into NeuroWorks.
//
// Human users authenticate with sessions (auth.ts). Integrating SYSTEMS
// authenticate with API keys: a long random bearer token, stored only as a
// SHA-256 hash so a leaked keys file can't be replayed. Each key carries
// scopes (what it may do) and is the tenancy boundary — a key may only read
// the jobs it dispatched (see dispatch.ts).
//
// Token format: `nw_<43-char base64url>`. Shown ONCE at creation; after that
// only the prefix is recoverable for display.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const KEYS_PATH = resolve(STATE_DIR, "api-keys.json");

export type ApiKeyScope = "dispatch:write" | "dispatch:read" | "machine:full";
export const ALL_SCOPES: ApiKeyScope[] = ["dispatch:write", "dispatch:read", "machine:full"];
// Default scopes for a key minted with no explicit scopes array. Deliberately
// excludes "machine:full" (full API access, used to authenticate as a trusted
// machine caller under enterprise mode) — that's meaningfully more powerful
// than dispatch access and must be requested explicitly, not granted by omission.
const DEFAULT_SCOPES: ApiKeyScope[] = ["dispatch:write", "dispatch:read"];

export type ApiKeyRecord = {
  id: string;
  label: string;
  hash: string;        // sha256(token) — the only persisted form of the secret
  prefix: string;      // first 12 chars, for display ("nw_abc123…")
  scopes: ApiKeyScope[];
  createdAt: string;
  lastUsedAt?: string;
  revoked?: boolean;
};

// Public shape — never leaks the hash.
export type ApiKeyPublic = Omit<ApiKeyRecord, "hash">;

function load(): ApiKeyRecord[] {
  try {
    if (!existsSync(KEYS_PATH)) return [];
    const parsed = JSON.parse(readFileSync(KEYS_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function save(list: ApiKeyRecord[]): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(KEYS_PATH, JSON.stringify(list, null, 2), { encoding: "utf8", mode: 0o600 });
}

function sha(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function redact(r: ApiKeyRecord): ApiKeyPublic {
  const { hash, ...pub } = r;
  return pub;
}

export function createApiKey(label: string, scopes: ApiKeyScope[] = DEFAULT_SCOPES): { key: ApiKeyPublic; token: string } {
  const token = "nw_" + randomBytes(32).toString("base64url");
  const record: ApiKeyRecord = {
    id: randomUUID(),
    label: label.trim() || "unnamed",
    hash: sha(token),
    prefix: token.slice(0, 12),
    scopes: scopes.length ? scopes : DEFAULT_SCOPES,
    createdAt: new Date().toISOString(),
  };
  const list = load();
  list.push(record);
  save(list);
  // The raw token is returned ONCE — the caller must store it. We never can again.
  return { key: redact(record), token };
}

export function listApiKeys(): ApiKeyPublic[] {
  return load().map(redact).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function revokeApiKey(id: string): boolean {
  const list = load();
  const r = list.find(k => k.id === id);
  if (!r) return false;
  r.revoked = true;
  save(list);
  return true;
}

// Verify a presented bearer token. Constant-time compares the hash to defeat
// timing oracles, rejects revoked keys, and stamps lastUsedAt (throttled so we
// don't rewrite the file on every request).
let lastUsedFlush = 0;
export function verifyApiKey(token: string): ApiKeyRecord | null {
  if (!token || !token.startsWith("nw_")) return null;
  const presented = sha(token);
  const presentedBuf = Buffer.from(presented, "hex");
  const list = load();
  for (const r of list) {
    if (r.revoked) continue;
    let match = false;
    try {
      const stored = Buffer.from(r.hash, "hex");
      match = stored.length === presentedBuf.length && timingSafeEqual(stored, presentedBuf);
    } catch { match = false; }
    if (match) {
      const now = Date.now();
      if (now - lastUsedFlush > 60_000) {
        r.lastUsedAt = new Date(now).toISOString();
        try { save(list); } catch { /* best-effort */ }
        lastUsedFlush = now;
      }
      return r;
    }
  }
  return null;
}

export function keyHasScope(rec: ApiKeyRecord, scope: ApiKeyScope): boolean {
  return rec.scopes.includes(scope);
}
