// Defends the local API against DNS rebinding and cross-origin POSTs.
//
// Loopback bind (127.0.0.1) is not enough by itself. Two real attack
// shapes a malicious web page can exploit against a localhost API:
//
//   (a) Cross-origin POST. The browser blocks reading the response but
//       still SENDS the request. text/plain JSON is a CORS-"simple"
//       request → no preflight → side-effecting endpoints execute.
//   (b) DNS rebinding. Attacker controls evil.com:7471, has it resolve
//       first to attacker IP then to 127.0.0.1. Browser issues
//       fetch("http://evil.com:7471/api/chat"); request reaches our
//       server with Host: evil.com:7471.
//
// Defense in depth:
//   - Host header MUST be 127.0.0.1:<port> or localhost:<port>. DNS
//     rebinding fails because the Host carries the attacker's domain.
//   - Origin header (when present) MUST be in the web allow-list.
//     Cross-origin POSTs from a normal evil.com page fail here.
//   - Origin absent (curl, server-to-server peer calls) → allowed,
//     because there's no cross-origin browser model to defeat.
//
// /api/health and /api/peers/self are allowed unconditionally — they
// expose no secrets and peer probes need them to succeed pre-handshake.
// Everything else flows through both checks.
//
// Override with CLAWBOT_ORIGIN_GUARD=0 if you're running the server
// behind a reverse proxy that rewrites Host. The override is logged.

import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

const PORT = String(config.port);

// Hosts we accept on inbound requests. The literal port matches whichever
// instance is running (primary 7471, secondary 7473), so the secondary
// auto-permits 127.0.0.1:7473 without extra config.
const ALLOWED_HOSTS = new Set<string>([
  `127.0.0.1:${PORT}`,
  `localhost:${PORT}`,
]);

// Extra hosts for single-port production (SERVE_WEB), where the SPA and API
// share one origin on the operator's real hostname/domain. Comma-separated,
// e.g. CLAWBOT_ALLOWED_HOSTS=neuroworks.example.com,neuroworks.example.com:7471
// Without this the Host allow-list would 403 every /api call from the deployed
// SPA. Static asset GETs are exempt below, so only the SPA's XHRs need this.
for (const h of (process.env.CLAWBOT_ALLOWED_HOSTS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)) {
  ALLOWED_HOSTS.add(h);
}

// Web UI origin. Vite dev binds 7470; if you change that, set
// CLAWBOT_WEB_ORIGIN to the new value (comma-separated for multiple).
const WEB_ORIGIN_ENV = process.env.CLAWBOT_WEB_ORIGIN?.trim();
// Exported so index.ts's CORS header reflects the SAME allow-list this guard
// enforces, instead of a second hardcoded copy that drifts from it.
export const ALLOWED_ORIGINS = new Set<string>(
  (WEB_ORIGIN_ENV ? WEB_ORIGIN_ENV.split(",").map(s => s.trim()) : [
    "http://127.0.0.1:7470",
    "http://localhost:7470",
  ]).map(s => s.toLowerCase()),
);

// Paths the guard never blocks. Keep this list tight — every entry is a
// surface a malicious page could probe. /api/health returns config flags
// (no secrets); /api/peers/self is the peer handshake endpoint and runs
// before any registry has authenticated the caller.
const EXEMPT_PATHS = new Set<string>([
  "/api/health",
  "/api/peers/self",
  // Stripe webhook — posts from Stripe's servers (cross-host, no browser
  // Origin). Authenticity is enforced by the signature check in the handler,
  // which is strictly stronger than a Host/Origin allow-list here.
  "/api/payments/webhook",
  // Paynow posts result updates server-to-server; authenticity is the SHA-512
  // hash over the integration key, not the request origin.
  "/api/payments/paynow/result",
]);

const DISABLED = process.env.CLAWBOT_ORIGIN_GUARD === "0";
if (DISABLED) {
  console.warn("[origin-guard] DISABLED via CLAWBOT_ORIGIN_GUARD=0 — DNS rebinding + cross-origin POST attacks are NOT defended.");
}

export function originGuard(req: Request, res: Response, next: NextFunction): void {
  if (DISABLED) return next();
  // CORS preflight — let the CORS middleware handle it.
  if (req.method === "OPTIONS") return next();
  // Static SPA assets (SERVE_WEB single-port prod): any non-/api GET just
  // returns a bundled file or the SPA shell — no secrets, no side effects — so
  // it needn't match the Host allow-list. This lets the SPA load over the
  // operator's real hostname while every /api endpoint below stays guarded.
  if (req.method === "GET" && !req.path.startsWith("/api/")) return next();
  // Exempt read-only / handshake endpoints.
  if (EXEMPT_PATHS.has(req.path)) return next();
  // External machine-dispatch surface. These endpoints authenticate with an
  // API-key bearer token (see routes/dispatch.ts), which is strictly stronger
  // than a Host/Origin allow-list — they're server-to-server, not browser
  // requests. Key management stays under the guarded /api/dispatch-keys path.
  if (req.path.startsWith("/api/v1/")) return next();
  // Public Finance System ingest/read surface — server-to-server pushes from
  // the company Finance System (no cross-origin browser model). Writes are
  // gated by FINANCE_SYNC_TOKEN inside the handler, which is stronger than a
  // Host/Origin allow-list. See routes/public-finance.ts.
  if (req.path.startsWith("/api/public/")) return next();

  const host = String(req.headers.host ?? "").toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    res.status(403).json({
      error: "host_not_allowed",
      message:
        `Request Host header "${host || "(none)"}" is not in the allow-list. ` +
        `This API only accepts requests where Host is 127.0.0.1:${PORT} or localhost:${PORT}. ` +
        `If you reached this through a domain, that's likely DNS rebinding. ` +
        `Override with CLAWBOT_ORIGIN_GUARD=0 if you genuinely need a reverse-proxy setup.`,
    });
    return;
  }

  // Origin only matters when the browser actually sends one. CLIs and
  // server-to-server fetches (including peer roll-call, delegation,
  // review) leave it blank — those are not cross-origin browser
  // requests and don't need the check.
  const originHeader = req.headers.origin;
  if (typeof originHeader === "string" && originHeader.length > 0) {
    const origin = originHeader.toLowerCase();
    // Same-origin request: the Origin's host matches the request Host, which we
    // JUST validated against ALLOWED_HOSTS above. In single-port production
    // (SERVE_WEB) the SPA is served from this same origin, so its POSTs are
    // same-origin and safe. DNS rebinding is still blocked at the Host layer —
    // an attacker domain never reaches here because Host wouldn't be allow-listed.
    let originHost = "";
    try { originHost = new URL(originHeader).host.toLowerCase(); } catch { /* malformed origin */ }
    if (originHost && originHost === host) return next();
    if (!ALLOWED_ORIGINS.has(origin)) {
      res.status(403).json({
        error: "origin_not_allowed",
        message:
          `Origin "${originHeader}" is not in the allow-list. ` +
          `The local API only accepts browser requests from ${[...ALLOWED_ORIGINS].join(", ")}. ` +
          `Set CLAWBOT_WEB_ORIGIN=<your-web-origin> to add a custom web origin.`,
      });
      return;
    }
  }

  next();
}
