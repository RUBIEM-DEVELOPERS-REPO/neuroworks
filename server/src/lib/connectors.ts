// Company system connectors — a registry of external HTTP APIs the operator
// authorizes agents to call. Persisted at .neuroworks/connectors.json (outside
// the vault, since it carries credentials → encrypted at rest via secret-box).
//
// Each connector is a SELF-DESCRIBING handle to one company system:
//   • baseUrl + auth scheme (api key / bearer / basic / custom header / none)
//   • optional static headers
//   • an ENDPOINT MANIFEST — named, documented operations so an agent can
//     "read and understand" what the system offers (connector.describe) BEFORE
//     calling it (connector.call). The manifest is the contract other agents read.
//
// Safety model (mirrors data-sources.ts):
//   • Calls are READ-ONLY by default — only GET/HEAD allowed. The operator flips
//     `writeEnabled` per connector to authorize POST/PUT/PATCH/DELETE.
//   • SSRF guard — a call's resolved URL host MUST equal the configured baseUrl
//     host. A path that tries to jump to another origin is rejected.
//   • Secrets (tokens, keys, passwords) are encrypted at rest and never returned
//     to the API/UI — only a boolean "set" flag is surfaced.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret, isEncrypted } from "./secret-box.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const CONFIG_PATH = resolve(CONFIG_DIR, "connectors.json");

// ─── Types ───
export type ConnectorAuthType = "none" | "apiKey" | "bearer" | "basic" | "header";

// Auth carries both structural (non-secret) fields and secret fields. On disk
// the secret fields (value/token/password) are encrypted; everything else is
// plaintext so the redacted public view can describe the scheme.
export type ConnectorAuth = {
  type: ConnectorAuthType;
  // apiKey: where the key goes + its parameter name (e.g. header "X-API-Key" or query "api_key")
  in?: "header" | "query";
  name?: string;
  // basic: username is non-secret; password is secret
  username?: string;
  // secret material (one of, depending on type)
  value?: string;    // apiKey / header value
  token?: string;    // bearer token
  password?: string; // basic password
};

const SECRET_AUTH_FIELDS = ["value", "token", "password"] as const;

export type ConnectorEndpoint = {
  name: string;            // short id agents reference, e.g. "list_invoices"
  method: string;          // GET / POST / ...
  path: string;            // relative to baseUrl, e.g. "/v1/invoices" or "/customers/{id}"
  description?: string;    // what it does — the agent reads this to understand the system
  query?: string[];        // documented query params
  body?: string;           // freeform body shape hint (e.g. a JSON example)
};

export type Connector = {
  id: string;
  label: string;
  baseUrl: string;
  description?: string;
  auth: ConnectorAuth;
  headers?: Record<string, string>;   // static non-secret headers sent on every call
  endpoints?: ConnectorEndpoint[];
  writeEnabled: boolean;              // allow non-GET/HEAD methods
  createdAt: string;
  lastTest?: { ok: boolean; detail: string; at: string };
};

// What the API/UI sees — secrets reduced to a boolean.
export type ConnectorPublic = Omit<Connector, "auth"> & {
  auth: { type: ConnectorAuthType; in?: "header" | "query"; name?: string; username?: string; secretSet: boolean };
};

// ─── Persistence (secrets encrypted at rest; legacy plaintext migrated on load) ───
function load(): Connector[] {
  try {
    if (!existsSync(CONFIG_PATH)) return [];
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (!Array.isArray(parsed)) return [];
    let sawPlaintext = false;
    const list = (parsed as Connector[]).map(c => {
      const auth = { ...(c.auth ?? { type: "none" }) } as ConnectorAuth;
      for (const f of SECRET_AUTH_FIELDS) {
        const v = auth[f];
        if (typeof v === "string" && v) {
          if (isEncrypted(v)) {
            try { auth[f] = decryptSecret(v); }
            catch { /* wrong/rotated key — leave blob; call will error clearly */ }
          } else {
            sawPlaintext = true; // legacy unencrypted record
          }
        }
      }
      return { ...c, auth };
    });
    if (sawPlaintext) { try { save(list); } catch { /* best-effort migration */ } }
    return list;
  } catch { return []; }
}

function save(list: Connector[]): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  const onDisk = list.map(c => {
    const auth = { ...c.auth } as ConnectorAuth;
    for (const f of SECRET_AUTH_FIELDS) {
      const v = auth[f];
      if (typeof v === "string" && v && !isEncrypted(v)) auth[f] = encryptSecret(v);
    }
    return { ...c, auth };
  });
  writeFileSync(CONFIG_PATH, JSON.stringify(onDisk, null, 2), { encoding: "utf8", mode: 0o600 });
}

function toPublic(c: Connector): ConnectorPublic {
  const secretSet = SECRET_AUTH_FIELDS.some(f => typeof c.auth?.[f] === "string" && (c.auth[f] as string).length > 0);
  return {
    ...c,
    auth: { type: c.auth?.type ?? "none", in: c.auth?.in, name: c.auth?.name, username: c.auth?.username, secretSet },
  };
}

export function listConnectors(): ConnectorPublic[] {
  return load().map(toPublic);
}

export function getConnectorPublic(idOrLabel: string): ConnectorPublic | undefined {
  const c = findConnector(idOrLabel);
  return c ? toPublic(c) : undefined;
}

// Internal — returns the connector with secrets DECRYPTED. Never expose directly.
function findConnector(idOrLabel: string): Connector | undefined {
  const list = load();
  const key = idOrLabel.trim().toLowerCase();
  return list.find(c => c.id === idOrLabel) ?? list.find(c => c.label.toLowerCase() === key);
}

function normalizeAuth(input: any): ConnectorAuth {
  const type = (["none", "apiKey", "bearer", "basic", "header"].includes(input?.type) ? input.type : "none") as ConnectorAuthType;
  const auth: ConnectorAuth = { type };
  if (type === "apiKey") {
    auth.in = input?.in === "query" ? "query" : "header";
    auth.name = String(input?.name ?? "").trim() || (auth.in === "query" ? "api_key" : "X-API-Key");
    if (input?.value) auth.value = String(input.value);
  } else if (type === "bearer") {
    if (input?.token) auth.token = String(input.token);
  } else if (type === "basic") {
    auth.username = String(input?.username ?? "").trim();
    if (input?.password) auth.password = String(input.password);
  } else if (type === "header") {
    auth.name = String(input?.name ?? "").trim() || "Authorization";
    if (input?.value) auth.value = String(input.value);
  }
  return auth;
}

function normalizeEndpoints(input: any): ConnectorEndpoint[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const eps = input
    .map((e: any) => {
      const name = String(e?.name ?? "").trim();
      const path = String(e?.path ?? "").trim();
      if (!name || !path) return null;
      return {
        name,
        method: String(e?.method ?? "GET").trim().toUpperCase(),
        path,
        description: e?.description ? String(e.description) : undefined,
        query: Array.isArray(e?.query) ? e.query.map((q: any) => String(q)) : undefined,
        body: e?.body ? String(e.body) : undefined,
      } as ConnectorEndpoint;
    })
    .filter((x): x is ConnectorEndpoint => x !== null);
  return eps.length ? eps : undefined;
}

function normalizeHeaders(input: any): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = String(k).trim();
    if (key) out[key] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

export function addConnector(input: {
  label: string; baseUrl: string; description?: string;
  auth?: any; headers?: any; endpoints?: any; writeEnabled?: boolean;
}): ConnectorPublic {
  const label = String(input.label ?? "").trim();
  const baseUrl = String(input.baseUrl ?? "").trim();
  if (!label) throw new Error("label is required");
  if (!baseUrl) throw new Error("baseUrl is required");
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error(`baseUrl is not a valid URL: ${baseUrl}`); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("baseUrl must be http(s)");
  }
  const conn: Connector = {
    id: randomUUID(),
    label,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    description: input.description ? String(input.description) : undefined,
    auth: normalizeAuth(input.auth),
    headers: normalizeHeaders(input.headers),
    endpoints: normalizeEndpoints(input.endpoints),
    writeEnabled: input.writeEnabled === true,
    createdAt: new Date().toISOString(),
  };
  const list = load();
  list.push(conn);
  save(list);
  return toPublic(conn);
}

export function updateConnector(id: string, patch: {
  label?: string; baseUrl?: string; description?: string;
  auth?: any; headers?: any; endpoints?: any; writeEnabled?: boolean;
}): ConnectorPublic | null {
  const list = load();
  const c = list.find(x => x.id === id);
  if (!c) return null;
  if (patch.label !== undefined) c.label = String(patch.label).trim() || c.label;
  if (patch.baseUrl !== undefined) {
    const baseUrl = String(patch.baseUrl).trim();
    try { new URL(baseUrl); } catch { throw new Error(`baseUrl is not a valid URL: ${baseUrl}`); }
    c.baseUrl = baseUrl.replace(/\/+$/, "");
  }
  if (patch.description !== undefined) c.description = patch.description ? String(patch.description) : undefined;
  if (patch.auth !== undefined) {
    // Preserve existing secrets when the patch omits them (UI sends blanks to mean "unchanged").
    const next = normalizeAuth(patch.auth);
    for (const f of SECRET_AUTH_FIELDS) {
      if (!next[f] && c.auth?.[f]) next[f] = c.auth[f];
    }
    c.auth = next;
  }
  if (patch.headers !== undefined) c.headers = normalizeHeaders(patch.headers);
  if (patch.endpoints !== undefined) c.endpoints = normalizeEndpoints(patch.endpoints);
  if (patch.writeEnabled !== undefined) c.writeEnabled = patch.writeEnabled === true;
  save(list);
  return toPublic(c);
}

export function removeConnector(id: string): boolean {
  const list = load();
  const next = list.filter(c => c.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}

function recordTest(id: string, result: { ok: boolean; detail: string }): void {
  const list = load();
  const c = list.find(x => x.id === id);
  if (!c) return;
  c.lastTest = { ...result, at: new Date().toISOString() };
  try { save(list); } catch { /* best-effort */ }
}

// ─── Calling a connector ───
type CallInput = {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  headers?: Record<string, string>;
};

export type CallResult = {
  ok: boolean;
  status: number;
  url: string;
  method: string;
  contentType?: string;
  body: unknown;       // parsed JSON when possible, else text (truncated)
  truncated?: boolean;
  error?: string;
};

const MAX_BODY_CHARS = 20000;
const DEFAULT_TIMEOUT_MS = 30000;

function applyAuth(auth: ConnectorAuth, url: URL, headers: Record<string, string>): void {
  switch (auth.type) {
    case "bearer":
      if (auth.token) headers["authorization"] = `Bearer ${auth.token}`;
      break;
    case "basic":
      if (auth.username || auth.password)
        headers["authorization"] = `Basic ${Buffer.from(`${auth.username ?? ""}:${auth.password ?? ""}`).toString("base64")}`;
      break;
    case "apiKey":
      if (auth.value) {
        if (auth.in === "query") url.searchParams.set(auth.name ?? "api_key", auth.value);
        else headers[(auth.name ?? "X-API-Key")] = auth.value;
      }
      break;
    case "header":
      if (auth.name && auth.value) headers[auth.name] = auth.value;
      break;
    case "none":
    default:
      break;
  }
}

// Resolve a call's path against the connector baseUrl and HARD-FAIL if it
// escapes the configured origin (SSRF guard). Returns the safe URL.
function resolveUrl(baseUrl: string, path: string): URL {
  const base = new URL(baseUrl);
  // A relative path resolves under base; an absolute URL would override host —
  // we detect that and reject any host mismatch below.
  const target = new URL(path, base.href.endsWith("/") ? base.href : base.href + "/");
  if (target.host !== base.host || target.protocol !== base.protocol) {
    throw new Error(`path "${path}" resolves to ${target.origin}, which is outside the connector's base origin ${base.origin}`);
  }
  return target;
}

export async function callConnector(idOrLabel: string, input: CallInput): Promise<CallResult> {
  const conn = findConnector(idOrLabel);
  if (!conn) return { ok: false, status: 0, url: "", method: "", body: null, error: `connector "${idOrLabel}" not found` };

  const method = String(input.method ?? "GET").trim().toUpperCase();
  const isRead = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (!isRead && !conn.writeEnabled) {
    return { ok: false, status: 0, url: "", method, body: null,
      error: `connector "${conn.label}" is read-only — ${method} is blocked. Enable writes on the connector to allow it.` };
  }

  let url: URL;
  try { url = resolveUrl(conn.baseUrl, input.path ?? ""); }
  catch (e: any) { return { ok: false, status: 0, url: "", method, body: null, error: String(e?.message ?? e) }; }

  if (input.query) for (const [k, v] of Object.entries(input.query)) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = { accept: "application/json", ...(conn.headers ?? {}) };
  if (input.headers) for (const [k, v] of Object.entries(input.headers)) headers[k] = String(v);
  applyAuth(conn.auth, url, headers);

  let payload: string | undefined;
  if (!isRead && input.body !== undefined && input.body !== null) {
    if (typeof input.body === "string") {
      payload = input.body;
      headers["content-type"] = headers["content-type"] ?? "text/plain";
    } else {
      payload = JSON.stringify(input.body);
      headers["content-type"] = headers["content-type"] ?? "application/json";
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const r = await fetch(url.toString(), { method, headers, body: payload, signal: ctrl.signal });
    const contentType = r.headers.get("content-type") ?? undefined;
    const raw = await r.text();
    const truncated = raw.length > MAX_BODY_CHARS;
    const slice = truncated ? raw.slice(0, MAX_BODY_CHARS) : raw;
    let parsed: unknown = slice;
    if (contentType?.includes("application/json")) {
      try { parsed = JSON.parse(slice); } catch { parsed = slice; }
    }
    return {
      ok: r.ok, status: r.status, url: url.toString(), method, contentType,
      body: parsed, truncated: truncated || undefined,
      error: r.ok ? undefined : `HTTP ${r.status}`,
    };
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? `request timed out after ${DEFAULT_TIMEOUT_MS}ms` : String(e?.message ?? e);
    return { ok: false, status: 0, url: url.toString(), method, body: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Non-destructive reachability + auth probe. GETs the baseUrl root (or the
// first GET endpoint in the manifest) and reports the HTTP status.
export async function testConnector(id: string): Promise<{ ok: boolean; detail: string }> {
  const conn = findConnector(id);
  if (!conn) return { ok: false, detail: "connector not found" };
  const firstGet = conn.endpoints?.find(e => e.method === "GET");
  const probePath = firstGet?.path ?? "/";
  const r = await callConnector(id, { method: "GET", path: probePath });
  // Any response below 500 means the host is reachable and answered. 401/403
  // means reachable-but-auth-rejected — surfaced honestly so the operator can fix creds.
  const ok = r.status > 0 && r.status < 500;
  const detail = r.status === 0
    ? (r.error ?? "unreachable")
    : r.status === 401 || r.status === 403
      ? `reachable but auth rejected (HTTP ${r.status}) — check credentials`
      : `reachable (HTTP ${r.status})`;
  recordTest(id, { ok, detail });
  return { ok, detail };
}
