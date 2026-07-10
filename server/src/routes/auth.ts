import { Router, type Request } from "express";
import { login, logout, sessionUser, listLoginEvents, signupUser, listPendingUsers } from "../lib/users.js";

// Auth API — login / logout / current session, plus the login-event audit feed
// the admin Users page renders. Sessions are bearer tokens; the web client
// stores the token and sends it as `Authorization: Bearer <token>`.

export const authRouter = Router();

// ── abuse guards (security sweep 2026-07-04) ──
// Login: 5 failures per email+IP in 10 minutes → back off. In-memory is fine:
// a restart resetting counters is acceptable for a loopback-bound service.
const loginFails = new Map<string, { count: number; firstAt: number }>();
const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW_MS = 10 * 60_000;
function loginKey(req: Request, email: string): string {
  return `${req.ip ?? "?"}|${String(email).trim().toLowerCase()}`;
}
function loginBlocked(key: string): boolean {
  const rec = loginFails.get(key);
  if (!rec) return false;
  if (Date.now() - rec.firstAt > LOGIN_FAIL_WINDOW_MS) { loginFails.delete(key); return false; }
  return rec.count >= LOGIN_FAIL_LIMIT;
}
function recordLoginFail(key: string): void {
  const rec = loginFails.get(key);
  if (!rec || Date.now() - rec.firstAt > LOGIN_FAIL_WINDOW_MS) loginFails.set(key, { count: 1, firstAt: Date.now() });
  else rec.count += 1;
}
// Signup: 3 per IP per hour, and a global cap on pending accounts so an
// unattended queue can't be flooded.
const signupHits = new Map<string, { count: number; firstAt: number }>();
const SIGNUP_LIMIT_PER_HOUR = 3;
const MAX_PENDING_ACCOUNTS = 25;

export function tokenFrom(req: Request): string | undefined {
  const h = req.headers["authorization"];
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const x = req.headers["x-session-token"];
  return typeof x === "string" && x ? x : undefined;
}

authRouter.post("/login", (req, res) => {
  const email = String(req.body?.email ?? "");
  const key = loginKey(req, email);
  if (loginBlocked(key)) {
    return res.status(429).json({ error: "Too many failed sign-in attempts — wait a few minutes and try again." });
  }
  const password = String(req.body?.password ?? "");
  if (!email) return res.status(400).json({ error: "email is required" });
  const meta = { ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200) };
  const r = login(email, password, meta);
  if (!r.ok) {
    recordLoginFail(key);
    return res.status(401).json({ error: r.reason ?? "login failed" });
  }
  loginFails.delete(key);
  res.json({ ok: true, user: r.user, token: r.token });
});

// Public self-signup — lands as a PENDING account (cannot sign in) until an
// admin approves it on the Admin page. Password is captured now so approval
// is one click; role is always staff until an admin says otherwise.
authRouter.post("/signup", (req, res) => {
  try {
    // Flood guards: 3 sign-ups per IP per hour, and a hard cap on the pending
    // queue so an unattended inbox can't be spammed into uselessness.
    const ip = String(req.ip ?? "?");
    const hit = signupHits.get(ip);
    if (hit && Date.now() - hit.firstAt <= 3600_000 && hit.count >= SIGNUP_LIMIT_PER_HOUR) {
      return res.status(429).json({ error: "Too many sign-up requests from this address — try again later." });
    }
    if (listPendingUsers().length >= MAX_PENDING_ACCOUNTS) {
      return res.status(429).json({ error: "The sign-up queue is full — ask an administrator to review pending requests." });
    }
    const b = req.body ?? {};
    const user = signupUser({ name: b.name, email: b.email, password: b.password, department: b.department, title: b.title });
    if (!hit || Date.now() - hit.firstAt > 3600_000) signupHits.set(ip, { count: 1, firstAt: Date.now() });
    else hit.count += 1;
    res.json({ ok: true, user, message: "Sign-up received — an administrator will approve your access." });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

authRouter.post("/logout", (req, res) => {
  logout(tokenFrom(req));
  res.json({ ok: true });
});

// The layer bundles (what each access level sees/loses) — single source for
// the Add-user modal's access preview and any onboarding step.
authRouter.get("/layers", async (_req, res) => {
  const { LAYER_BUNDLES } = await import("../lib/access.js");
  res.json({ layers: LAYER_BUNDLES });
});

authRouter.get("/session", (req, res) => {
  res.json({ user: sessionUser(tokenFrom(req)) });
});

// Login activity feed (admin view). ?limit= default 50.
authRouter.get("/login-events", (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ events: listLoginEvents(limit) });
});
