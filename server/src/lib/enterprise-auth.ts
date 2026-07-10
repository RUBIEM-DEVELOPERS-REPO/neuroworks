// Enterprise-mode gate — OFF by default, toggled with NEUROWORKS_ENTERPRISE_MODE=1.
//
// The problem this closes: lib/access.ts's requireLayer() explicitly lets
// token-less requests through ("machine/operator context"), and only 7 of
// 46+ route groups call requireLayer() at all. origin-guard.ts is a real
// defense against BROWSER attacks (DNS rebinding, cross-origin POST) but its
// own logic exempts any request with no Origin header — exactly what a
// non-browser client (curl, a script, a network-adjacent attacker) sends.
// Together: fine for "runs on my own machine, never network-exposed" (the
// current default), but the moment this API is reachable from a wider
// network, there is effectively no authentication left on ~39 of 46 route
// groups, including shell access, credentials, and money.
//
// This middleware is the fix, designed to be a single flip: off changes
// nothing (today's local behaviour, unchanged); on requires every non-exempt
// request to prove it's either a logged-in human (session token — already
// works, see lib/access.ts) or a trusted machine (a "machine:full"-scoped
// API key — see lib/api-keys.ts, reusing the same infrastructure the
// external dispatch surface already relies on).
//
// Same-machine requests are exempt regardless of the flag — verified via the
// OS-level socket remoteAddress (not a spoofable header), so local peers/
// workers on the same host keep working with zero extra config. A peer or
// worker on a DIFFERENT host needs a "machine:full" key attached as
// `Authorization: Bearer nw_...` once enterprise mode is on — that wiring is
// NOT done for you across every internal caller (peers.ts has 7+ scattered
// fetch() call sites); mint a key via POST /api/dispatch-keys and attach it
// by hand to any cross-host peer config until that's centralized.

import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { callerOf } from "./access.js";
import { verifyApiKey, keyHasScope } from "./api-keys.js";

// Mirrors origin-guard's exemption list, plus the extra surfaces that already
// carry their own strictly-stronger auth (dispatch API keys, finance sync
// token, Stripe/Paynow signature checks) or that must stay reachable to log
// in at all.
const EXEMPT_PATHS = new Set<string>([
  "/api/health",
  "/api/peers/self",
  "/api/payments/webhook",
  "/api/payments/paynow/result",
]);
const EXEMPT_PREFIXES = [
  "/api/v1/",       // external dispatch — own bearer-key auth (routes/dispatch.ts)
  "/api/public/",    // Finance System ingest — own token gate (routes/public-finance.ts)
  "/api/auth/",      // must stay reachable to obtain a session token in the first place
];

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || a === "localhost";
}

export function enterpriseAuthGuard(req: Request, res: Response, next: NextFunction): void {
  if (!config.enterpriseMode) return next();
  if (req.method === "OPTIONS") return next();
  // Static SPA assets / non-API GETs carry no secrets and no side effects.
  if (req.method === "GET" && !req.path.startsWith("/api/")) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();
  if (EXEMPT_PREFIXES.some(p => req.path.startsWith(p))) return next();
  // Same-machine caller — the OS told us this connection originated from
  // this host, which a remote attacker cannot forge (unlike Host/Origin
  // headers). Covers local peers, local workers, local cron/schedule ticks.
  if (isLoopback(req.socket.remoteAddress)) return next();

  // Human session token (web UI).
  if (callerOf(req)) return next();

  // Machine API key.
  const auth = req.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  const token = m ? m[1] : (req.get("x-api-key") ?? "");
  const rec = token ? verifyApiKey(token) : null;
  if (rec && keyHasScope(rec, "machine:full")) return next();

  res.status(401).json({
    error: "unauthorized",
    message:
      "NEUROWORKS_ENTERPRISE_MODE is on — this request is neither same-machine, a logged-in session, " +
      "nor carrying a valid 'machine:full' API key. Provide 'Authorization: Bearer nw_...' " +
      "(mint one via POST /api/dispatch-keys with scopes:[\"machine:full\"]) or log in via /api/auth.",
  });
}
