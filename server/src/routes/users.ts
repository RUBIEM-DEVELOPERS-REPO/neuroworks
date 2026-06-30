import { Router } from "express";
import { listUsers, addUser, updateUser, setPassword, removeUser } from "../lib/users.js";

// Users API — the admin Users page. The org's people who can sign in, with
// roles + org membership (name/email/role/title/department/status). Password
// hashes are never returned (only `hasPassword`).
//
// Note: the app is an identity layer on a loopback-only API (the origin-guard
// is the network boundary), so these endpoints aren't separately role-gated at
// the HTTP layer — any local caller is already past the guard. The UI restricts
// the Users page to admins.

export const usersRouter = Router();

usersRouter.get("/", (_req, res) => res.json({ users: listUsers() }));

usersRouter.post("/", (req, res) => {
  try {
    const b = req.body ?? {};
    res.json({ user: addUser({ name: b.name, email: b.email, role: b.role, title: b.title, department: b.department, password: b.password }) });
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

usersRouter.patch("/:id", (req, res) => {
  const u = updateUser(String(req.params.id), req.body ?? {});
  if (!u) return res.status(404).json({ error: "user not found" });
  res.json({ user: u });
});

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
