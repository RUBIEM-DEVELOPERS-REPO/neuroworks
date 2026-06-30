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
    // Node's fetch() wraps the real error in TypeError with e.cause — unwrap it
    // so users see "connect ETIMEDOUT" not just "fetch failed".
    const cause = e?.cause ? (typeof e.cause === "object" ? String(e.cause?.message ?? e.cause) : String(e.cause)) : undefined;
    const surface = cause ?? e?.message ?? String(e);
    const msg = e?.name === "AbortError"
      ? `request to ${url.host} timed out after ${DEFAULT_TIMEOUT_MS / 1000}s`
      : surface;
    return { ok: false, status: 0, url: url.toString(), method, body: null, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Non-destructive reachability + auth probe. GETs the baseUrl root (or the
// first GET endpoint in the manifest) and reports the HTTP status. The detail
// includes the error message from callConnector which now unwraps the
// underlying network error (ETIMEDOUT, ECONNREFUSED, DNS failure, etc.).
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
    ? `${r.error ?? "unreachable"} — ${r.url || conn.baseUrl}`
    : r.status === 401 || r.status === 403
      ? `reachable but auth rejected (HTTP ${r.status}) — check credentials`
      : `reachable (HTTP ${r.status})`;
  recordTest(id, { ok, detail });
  return { ok, detail };
}

// ─── Seeding ───

const AIIA_WEBSITE_LABEL = "AIIA Website";

export function seedAiiAWebsiteConnector(): ConnectorPublic | null {
  const existing = listConnectors().find(c => c.label === AIIA_WEBSITE_LABEL);
  if (existing) return null;

  return addConnector({
    label: AIIA_WEBSITE_LABEL,
    baseUrl: "https://www.aiinstituteafrica.com",
    description:
      "AIIA (Africa Institute of Artificial Intelligence) website CMS — events, articles, contact forms, program applications, payments, and admin management. Public endpoints are open; admin endpoints require a bearer token.",
    writeEnabled: true,
    endpoints: [
      // ── Public ──
      { name: "list-events",                method: "GET",  path: "/api/events",                          description: "List all public events" },
      { name: "list-articles",              method: "GET",  path: "/api/articles",                       description: "List all published articles" },
      { name: "list-local-articles",        method: "GET",  path: "/api/local-articles",                 description: "List local/Zimbabwe articles" },
      { name: "get-local-article",          method: "GET",  path: "/api/local-articles/{id}",            description: "Single local article by ID" },
      { name: "submit-contact",             method: "POST", path: "/api/contact",                        description: "Submit a general contact/enquiry form", body: "{ name, email, message }" },
      { name: "submit-conference-contact",  method: "POST", path: "/api/conference/contact",             description: "Conference-specific contact form", body: "{ name, email, phone?, organisation?, message }" },
      { name: "newsletter-signup",          method: "POST", path: "/api/newsletter",                     description: "Subscribe to newsletter", body: "{ email, name? }" },
      { name: "submit-student-lead",        method: "POST", path: "/api/student-leads",                  description: "Student lead/intent-to-enrol submission", body: "{ fullName, email, phone?, programme?, country? }" },
      { name: "submit-program-application", method: "POST", path: "/api/program-applications",           description: "Full program application", body: "{ programmeId, applicant: {...}, documents?: [...], referee?: {...} }" },
      { name: "submit-summit-registration", method: "POST", path: "/api/summit-applications",            description: "Summit/event registration", body: "{ eventId, attendee: {...}, ticketType?, dietaryRequirements? }" },
      { name: "initiate-payment",           method: "POST", path: "/api/payments",                       description: "Initiate a payment (e.g. application fee, ticket)", body: "{ amount, currency, reference, callbackUrl? }" },
      { name: "track-application",          method: "GET",  path: "/api/track/{referenceNumber}",        description: "Track an application by reference number" },
      { name: "verify-document",            method: "POST", path: "/api/verify-document",                description: "Submit a document for verification", body: "{ documentBase64, documentType, applicantId }" },
      { name: "get-referee-form",           method: "GET",  path: "/api/referee/{token}",                description: "Fetch referee form by unique token" },
      { name: "submit-referee-response",    method: "POST", path: "/api/referee/{token}",                description: "Submit referee assessment", body: "{ relationship, competence, comments }" },

      // ── Admin (authenticated — requires bearer token) ──
      { name: "admin-list-members",         method: "GET",  path: "/api/admin/members",                  description: "Admin: list all members" },
      { name: "admin-bulk-import-members",  method: "POST", path: "/api/admin/members/bulk",             description: "Admin: bulk import members", body: "{ members: [{...}] }" },
      { name: "admin-list-payments",        method: "GET",  path: "/api/admin/payments",                 description: "Admin: list all payments with filters" },
      { name: "admin-list-contacts",        method: "GET",  path: "/api/admin/contacts",                 description: "Admin: list contact form submissions" },
      { name: "admin-list-summit-regs",     method: "GET",  path: "/api/admin/summit-registrations",     description: "Admin: list summit registrations" },
      { name: "admin-dashboard-stats",      method: "GET",  path: "/api/admin/dashboard/stats",          description: "Admin: dashboard statistics" },
      { name: "admin-list-events",          method: "GET",  path: "/api/admin/events",                   description: "Admin: list all events (incl. drafts)" },
      { name: "admin-create-event",         method: "POST", path: "/api/admin/events",                   description: "Admin: create a new event", body: "{ title, date, description, type, ... }" },
      { name: "admin-update-event",         method: "PUT",  path: "/api/admin/events/{id}",             description: "Admin: update an event" },
      { name: "admin-delete-event",         method: "DELETE",path: "/api/admin/events/{id}",             description: "Admin: delete an event" },
      { name: "admin-list-articles",        method: "GET",  path: "/api/admin/articles",                 description: "Admin: list all articles (incl. drafts)" },
      { name: "admin-create-article",       method: "POST", path: "/api/admin/articles",                 description: "Admin: create a new article", body: "{ title, content, authorId, tags?, published? }" },
      { name: "admin-update-article",       method: "PUT",  path: "/api/admin/articles/{id}",           description: "Admin: update an article" },
      { name: "admin-delete-article",       method: "DELETE",path: "/api/admin/articles/{id}",           description: "Admin: delete an article" },
      { name: "admin-list-local-articles",  method: "GET",  path: "/api/admin/local-articles",           description: "Admin: list local articles" },
      { name: "admin-create-local-article", method: "POST", path: "/api/admin/local-articles",           description: "Admin: create local article" },
      { name: "admin-update-local-article", method: "PUT",  path: "/api/admin/local-articles/{id}",     description: "Admin: update local article" },
      { name: "admin-delete-local-article", method: "DELETE",path: "/api/admin/local-articles/{id}",     description: "Admin: delete local article" },
      { name: "admin-get-program-app",      method: "GET",  path: "/api/admin/program-applications/{id}",description: "Admin: get single program application" },
      { name: "admin-patch-program-app",    method: "PATCH",path: "/api/admin/program-applications/{id}", description: "Admin: update program application status", body: "{ status, notes? }" },
      { name: "admin-get-program-docs",     method: "GET",  path: "/api/admin/program-applications/{id}/documents", description: "Admin: get application documents" },
      { name: "admin-send-marketing-email", method: "POST", path: "/api/admin/marketing-email",          description: "Admin: send a marketing email campaign", body: "{ subject, bodyHtml, recipientFilter }" },
      { name: "admin-upload-event-image",   method: "POST", path: "/api/admin/event-image-upload",       description: "Admin: upload event image", body: "{ imageBase64, eventId }" },
      { name: "admin-upload-article-image", method: "POST", path: "/api/admin/article-image-upload",     description: "Admin: upload article image", body: "{ imageBase64, articleId }" },

      // ── Utility ──
      { name: "diag-env",                   method: "GET",  path: "/api/diag-env",                       description: "Server environment diagnostics" },
      { name: "chat",                       method: "GET",  path: "/api/chat",                           description: "AI chat endpoint", query: ["message", "sessionId?"] },
      { name: "news-feed",                  method: "GET",  path: "/api/news",                           description: "News feed" },
      { name: "membership-count",           method: "GET",  path: "/api/membership",                     description: "Current membership count" },
      { name: "vision-page",                method: "GET",  path: "/api/vision",                         description: "Vision/mission page data" },
    ],
  });
}
