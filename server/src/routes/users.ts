import { Router } from "express";
import { listUsers, addUser, updateUser, setPassword, removeUser, listPendingUsers, approveUser, listSessionViews, revokeSessionByPrefix, orgOverview } from "../lib/users.js";
import { callerLayer, redactUserFor } from "../lib/access.js";

// Users API — the admin Users page. The org's people who can sign in, with
// roles + org membership (name/email/role/title/department/status). Password
// hashes are never returned (only `hasPassword`).
//
// Note: the app is an identity layer on a loopback-only API (the origin-guard
// is the network boundary), so these endpoints aren't separately role-gated at
// the HTTP layer — any local caller is already past the guard. The UI restricts
// the Users page to admins.

export const usersRouter = Router();

// Salary is superadmin-only (money) — admins run people, not payroll.
usersRouter.get("/", (req, res) => {
  const layer = callerLayer(req);
  res.json({ users: listUsers().map(u => redactUserFor(layer, u)) });
});

usersRouter.post("/", (req, res) => {
  try {
    const b = req.body ?? {};
    res.json({ user: addUser({ name: b.name, email: b.email, role: b.role, title: b.title, department: b.department, password: b.password, workMode: b.workMode, salaryMonthly: b.salaryMonthly }) });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

usersRouter.patch("/:id", (req, res) => {
  const layer = callerLayer(req);
  const body = req.body ?? {};
  // Money guard: only a superadmin session (or machine context) may touch
  // salaries; role changes to/from superadmin need superadmin too.
  if (layer !== null && layer !== "superadmin") {
    if (body.salaryMonthly !== undefined) return res.status(403).json({ error: "salaries require super admin access" });
    if (body.role === "superadmin") return res.status(403).json({ error: "granting super admin requires super admin access" });
  }
  let u;
  try { u = updateUser(String(req.params.id), body); }
  catch (e: any) { return res.status(400).json({ error: String(e?.message ?? e) }); }
  if (!u) return res.status(404).json({ error: "user not found" });
  res.json({ user: redactUserFor(callerLayer(req), u) });
});

// ── org management (Admin page) — router is admin-gated at the mount ──

// Pending self-signups awaiting approval.
usersRouter.get("/pending", (_req, res) => res.json({ pending: listPendingUsers() }));

// Approve a sign-up, optionally setting layer/department/work-mode in the
// same stroke. Granting superadmin still requires a superadmin session.
usersRouter.post("/:id/approve", (req, res) => {
  const layer = callerLayer(req);
  const b = req.body ?? {};
  if (b.role === "superadmin" && layer !== null && layer !== "superadmin") {
    return res.status(403).json({ error: "granting super admin requires super admin access" });
  }
  try {
    const u = approveUser(String(req.params.id), { role: b.role, department: b.department, workMode: b.workMode, title: b.title });
    if (!u) return res.status(404).json({ error: "user not found" });
    res.json({ user: redactUserFor(layer, u) });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Reject = delete the pending account (they can sign up again).
usersRouter.post("/:id/reject", (req, res) => {
  try {
    const ok = removeUser(String(req.params.id));
    if (!ok) return res.status(404).json({ error: "user not found" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// Active sessions — who is signed in right now. Exposes token PREFIXES only.
usersRouter.get("/sessions", (_req, res) => res.json({ sessions: listSessionViews() }));
usersRouter.post("/sessions/revoke", (req, res) => {
  const ok = revokeSessionByPrefix(String(req.body?.id ?? ""));
  if (!ok) return res.status(404).json({ error: "session not found (or ambiguous prefix)" });
  res.json({ ok: true });
});

// Headline org numbers for the Admin page.
usersRouter.get("/overview", (_req, res) => res.json(orgOverview()));

usersRouter.post("/:id/password", (req, res) => {
  const password = String(req.body?.password ?? "");
  if (!password || password.length < 4) return res.status(400).json({ error: "password must be at least 4 characters" });
  const ok = setPassword(String(req.params.id), password);
  if (!ok) return res.status(404).json({ error: "user not found" });
  res.json({ ok: true });
});

usersRouter.delete("/:id", (req, res) => {
  try {
    const ok = removeUser(String(req.params.id));
    if (!ok) return res.status(404).json({ error: "user not found" });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});
