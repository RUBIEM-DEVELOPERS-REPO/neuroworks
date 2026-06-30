import { Router, type Request } from "express";
import { login, logout, sessionUser, listLoginEvents } from "../lib/users.js";

// Auth API — login / logout / current session, plus the login-event audit feed
// the admin Users page renders. Sessions are bearer tokens; the web client
// stores the token and sends it as `Authorization: Bearer <token>`.

export const authRouter = Router();

export function tokenFrom(req: Request): string | undefined {
  const h = req.headers["authorization"];
  if (typeof h === "string" && h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const x = req.headers["x-session-token"];
  return typeof x === "string" && x ? x : undefined;
}

authRouter.post("/login", (req, res) => {
  const email = String(req.body?.email ?? "");
  const password = String(req.body?.password ?? "");
  if (!email) return res.status(400).json({ error: "email is required" });
  const meta = { ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200) };
  const r = login(email, password, meta);
  if (!r.ok) return res.status(401).json({ error: r.reason ?? "login failed" });
  res.json({ ok: true, user: r.user, token: r.token });
});

authRouter.post("/logout", (req, res) => {
  logout(tokenFrom(req));
  res.json({ ok: true });
});

authRouter.get("/session", (req, res) => {
  res.json({ user: sessionUser(tokenFrom(req)) });
});

// Login activity feed (admin view). ?limit= default 50.
authRouter.get("/login-events", (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json({ events: listLoginEvents(limit) });
});
