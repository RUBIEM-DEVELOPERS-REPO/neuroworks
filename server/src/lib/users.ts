// Users + auth registry — the org's people who can sign in, plus the session
// and login-event tracking behind the Login page and the admin Users page.
//
// This is an IDENTITY layer, not a hardened network boundary (the origin-guard
// is that — the API is loopback-only). Login attributes activity to a person
// and tracks who's active. Passwords are hashed at rest with scrypt
// (node:crypto, no dependency). The agent reads the directory (name/email/role/
// org membership) via the users.list / users.lookup primitives.
//
// Persisted under .neuroworks/ (gitignored): users.json (incl. password hash),
// sessions.json (live tokens), login-events.json (audit trail, capped).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, "../../../.neuroworks");
const USERS_PATH = resolve(CONFIG_DIR, "users.json");
const SESSIONS_PATH = resolve(CONFIG_DIR, "sessions.json");
const EVENTS_PATH = resolve(CONFIG_DIR, "login-events.json");

const MAX_SESSIONS = 100;
const MAX_EVENTS = 200;

export type Role = "admin" | "member" | "viewer";
export type UserStatus = "active" | "invited" | "disabled";

type StoredUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  title?: string;
  department?: string;
  status: UserStatus;
  passwordHash?: string;        // scrypt$salt$hash — absent = not set yet (claim on first login)
  createdAt: string;
  lastLoginAt?: string;
  loginCount: number;
};

// What the API/UI sees — never the hash; just whether one is set.
export type PublicUser = Omit<StoredUser, "passwordHash"> & { hasPassword: boolean };

export type Session = { token: string; userId: string; createdAt: string; lastSeenAt: string };
export type LoginEvent = { at: string; userId?: string; email: string; name?: string; ok: boolean; reason?: string; ip?: string; userAgent?: string };

// ─── persistence ───
function readJson<T>(path: string, fallback: T): T {
  try { if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as T; } catch { /* ignore */ }
  return fallback;
}
function writeJson(path: string, value: unknown): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
}

function loadUsers(): StoredUser[] { return ensureSeed(readJson<StoredUser[]>(USERS_PATH, [])); }
function saveUsers(list: StoredUser[]): void { writeJson(USERS_PATH, list); }
function loadSessions(): Session[] { return readJson<Session[]>(SESSIONS_PATH, []); }
function saveSessions(list: Session[]): void { writeJson(SESSIONS_PATH, list.slice(-MAX_SESSIONS)); }
function loadEvents(): LoginEvent[] { return readJson<LoginEvent[]>(EVENTS_PATH, []); }
function saveEvents(list: LoginEvent[]): void { writeJson(EVENTS_PATH, list.slice(-MAX_EVENTS)); }

// Seed the org's first admin so the system is usable on day one. Arthur is the
// operator (admin@rubiem.com). No password is set — first login claims one,
// so the operator is never locked out of their own local tool.
function ensureSeed(list: StoredUser[]): StoredUser[] {
  if (list.length > 0) return list;
  const seeded: StoredUser[] = [{
    id: randomUUID(),
    name: "Arthur Magaya",
    email: "admin@rubiem.com",
    role: "admin",
    title: "Operator",
    department: "Executive",
    status: "active",
    createdAt: new Date().toISOString(),
    loginCount: 0,
  }];
  try { saveUsers(seeded); } catch { /* tolerate */ }
  return seeded;
}

// ─── password hashing (scrypt) ───
export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  try {
    const test = scryptSync(plain, salt, 64);
    const orig = Buffer.from(hash, "hex");
    return test.length === orig.length && timingSafeEqual(test, orig);
  } catch { return false; }
}

function toPublic(u: StoredUser): PublicUser {
  const { passwordHash, ...rest } = u;
  return { ...rest, hasPassword: !!passwordHash };
}

const normEmail = (e: string) => String(e ?? "").trim().toLowerCase();

// ─── users CRUD ───
export function listUsers(): PublicUser[] {
  return loadUsers().map(toPublic).sort((a, b) => a.name.localeCompare(b.name));
}
export function getUserById(id: string): StoredUser | undefined { return loadUsers().find(u => u.id === id); }
export function getUserByEmail(email: string): StoredUser | undefined {
  const e = normEmail(email);
  return loadUsers().find(u => normEmail(u.email) === e);
}

export function addUser(input: { name: string; email: string; role?: Role; title?: string; department?: string; password?: string }): PublicUser {
  const name = String(input.name ?? "").trim();
  const email = normEmail(input.email);
  if (!name) throw new Error("name is required");
  if (!email || !email.includes("@")) throw new Error("a valid email is required");
  const list = loadUsers();
  if (list.some(u => normEmail(u.email) === email)) throw new Error(`a user with email "${email}" already exists`);
  const u: StoredUser = {
    id: randomUUID(), name, email,
    role: (["admin", "member", "viewer"].includes(input.role as string) ? input.role : "member") as Role,
    title: input.title?.trim() || undefined,
    department: input.department?.trim() || undefined,
    status: "active",
    passwordHash: input.password ? hashPassword(input.password) : undefined,
    createdAt: new Date().toISOString(),
    loginCount: 0,
  };
  list.push(u);
  saveUsers(list);
  return toPublic(u);
}

export function updateUser(id: string, patch: { name?: string; email?: string; role?: Role; title?: string; department?: string; status?: UserStatus }): PublicUser | null {
  const list = loadUsers();
  const u = list.find(x => x.id === id);
  if (!u) return null;
  if (patch.name !== undefined) u.name = String(patch.name).trim() || u.name;
  if (patch.email !== undefined) {
    const e = normEmail(patch.email);
    if (e && e.includes("@") && !list.some(x => x.id !== id && normEmail(x.email) === e)) u.email = e;
  }
  if (patch.role !== undefined && ["admin", "member", "viewer"].includes(patch.role)) u.role = patch.role;
  if (patch.title !== undefined) u.title = patch.title.trim() || undefined;
  if (patch.department !== undefined) u.department = patch.department.trim() || undefined;
  if (patch.status !== undefined && ["active", "invited", "disabled"].includes(patch.status)) u.status = patch.status;
  saveUsers(list);
  return toPublic(u);
}

export function setPassword(id: string, password: string): boolean {
  const list = loadUsers();
  const u = list.find(x => x.id === id);
  if (!u) return false;
  u.passwordHash = password ? hashPassword(password) : undefined;
  saveUsers(list);
  return true;
}

export function removeUser(id: string): boolean {
  const list = loadUsers();
  // Never allow removing the last admin — that would orphan the org.
  const target = list.find(u => u.id === id);
  if (!target) return false;
  if (target.role === "admin" && list.filter(u => u.role === "admin").length <= 1) {
    throw new Error("can't remove the last admin");
  }
  const next = list.filter(u => u.id !== id);
  saveUsers(next);
  // Drop any live sessions for the removed user.
  saveSessions(loadSessions().filter(s => s.userId !== id));
  return true;
}

// ─── auth / sessions ───
export function login(email: string, password: string, meta: { ip?: string; userAgent?: string } = {}): { ok: boolean; user?: PublicUser; token?: string; reason?: string } {
  const list = loadUsers();
  const u = list.find(x => normEmail(x.email) === normEmail(email));
  const recordEvent = (ok: boolean, reason?: string) => {
    const events = loadEvents();
    events.push({ at: new Date().toISOString(), userId: u?.id, email: normEmail(email), name: u?.name, ok, reason, ip: meta.ip, userAgent: meta.userAgent });
    saveEvents(events);
  };

  if (!u) { recordEvent(false, "no such user"); return { ok: false, reason: "No account with that email." }; }
  if (u.status === "disabled") { recordEvent(false, "disabled"); return { ok: false, reason: "This account is disabled." }; }

  if (u.passwordHash) {
    if (!password || !verifyPassword(password, u.passwordHash)) {
      recordEvent(false, "bad password");
      return { ok: false, reason: "Incorrect password." };
    }
  } else {
    // No password set yet — claim-on-first-login: if one is supplied, set it.
    // Keeps the operator from being locked out before a password is configured.
    if (password) { u.passwordHash = hashPassword(password); }
  }

  u.lastLoginAt = new Date().toISOString();
  u.loginCount = (u.loginCount ?? 0) + 1;
  u.status = u.status === "invited" ? "active" : u.status;
  saveUsers(list);

  const token = randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  const sessions = loadSessions();
  sessions.push({ token, userId: u.id, createdAt: now, lastSeenAt: now });
  saveSessions(sessions);

  recordEvent(true);
  return { ok: true, user: toPublic(u), token };
}

export function sessionUser(token: string | undefined): PublicUser | null {
  if (!token) return null;
  const sessions = loadSessions();
  const s = sessions.find(x => x.token === token);
  if (!s) return null;
  const u = getUserById(s.userId);
  if (!u || u.status === "disabled") return null;
  s.lastSeenAt = new Date().toISOString();
  saveSessions(sessions);
  return toPublic(u);
}

export function logout(token: string | undefined): boolean {
  if (!token) return false;
  const sessions = loadSessions();
  const next = sessions.filter(s => s.token !== token);
  if (next.length === sessions.length) return false;
  saveSessions(next);
  return true;
}

export function listLoginEvents(limit = 50): LoginEvent[] {
  return loadEvents().slice(-Math.max(1, Math.min(MAX_EVENTS, limit))).reverse();
}

// ─── agent directory (used by users.list / users.lookup primitives) ───
export function directory(): { name: string; email: string; role: Role; title?: string; department?: string; status: UserStatus }[] {
  return loadUsers()
    .filter(u => u.status !== "disabled")
    .map(u => ({ name: u.name, email: u.email, role: u.role, title: u.title, department: u.department, status: u.status }));
}

export function lookupUser(query: string): { name: string; email: string; role: Role; title?: string; department?: string } | null {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return null;
  // Rank by match QUALITY, not store order. A bare "Arthur" must resolve to the
  // person whose name IS "Arthur" (arthur@aiinstituteafrica.com), not merely the
  // first record that happens to contain the substring "arthur" (e.g. "Arthur
  // Magaya"/admin@rubiem.com). Exact and whole-token matches beat substrings.
  const score = (x: StoredUser): number => {
    const email = normEmail(x.email);
    const name = x.name.toLowerCase();
    const local = email.split("@")[0];
    const nameTokens = name.split(/\s+/).filter(Boolean);
    if (email === q) return 100;             // exact email
    if (name === q) return 90;               // exact full name
    if (local === q) return 85;              // q is the email's local part ("arthur" → arthur@…)
    if (nameTokens.includes(q)) return 70;   // exact whole name token (first/last)
    if (name.startsWith(q)) return 55;
    if (email.startsWith(q)) return 50;
    if (name.includes(q)) return 30;         // substring (weakest)
    if (email.includes(q)) return 20;
    return 0;
  };
  let best: StoredUser | null = null;
  let bestScore = 0;
  for (const x of loadUsers()) {
    const s = score(x);
    if (s > bestScore) { best = x; bestScore = s; }
  }
  return best ? { name: best.name, email: best.email, role: best.role, title: best.title, department: best.department } : null;
}
