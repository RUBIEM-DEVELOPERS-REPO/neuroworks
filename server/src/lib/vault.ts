import { readFileSync, readdirSync, renameSync, statSync, writeFileSync, mkdirSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { simpleGit } from "simple-git";
import { config } from "../config.js";
import { scanForSecurityRisks } from "./security.js";

const VAULT = config.vaultPath;

// Set CLAWBOT_VAULT_SCAN=0 to disable. Default: ON. The scanner is fast (regex
// only) and prevents secrets that landed in an LLM response from being
// committed + pushed to a remote. High-severity findings refuse the write.
const VAULT_SCAN_ENABLED = process.env.CLAWBOT_VAULT_SCAN !== "0";

export type VaultNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: VaultNode[];
};

const HIDDEN_PREFIXES = [".obsidian", ".git", "node_modules"];

// Stale-lock recovery. A `.git/index.lock` file that's older than this
// threshold AND can be safely removed (we can't see the process holding it)
// is treated as left over from a crashed git process. Git itself takes the
// lock for milliseconds; anything more than 60s is almost certainly stale.
// Tunable via env in case someone runs a slow filesystem sync on the vault.
const STALE_LOCK_AGE_MS = Number(process.env.CLAWBOT_STALE_LOCK_AGE_MS ?? "60000");
// Known lock files git creates. We only ever touch `index.lock` — the others
// are rare enough that auto-removing them could mask a real concurrent op.
// If users hit those repeatedly we can add them later.
const VAULT_LOCK_PATH = join(VAULT, ".git", "index.lock");

// Before each git operation, look for a stale `.git/index.lock` and remove
// it. Two safety rails:
//   (1) Only delete locks older than STALE_LOCK_AGE_MS.
//   (2) Try the delete and tolerate EBUSY (real git op in progress).
// If the lock is fresh, we DO NOT delete — that would race with whatever
// real git invocation is mid-commit.
export function clearStaleVaultLock(): { cleared: boolean; reason?: string; ageMs?: number } {
  try {
    if (!existsSync(VAULT_LOCK_PATH)) return { cleared: false, reason: "no lock present" };
    const st = statSync(VAULT_LOCK_PATH);
    const ageMs = Date.now() - st.mtimeMs;
    if (ageMs < STALE_LOCK_AGE_MS) {
      return { cleared: false, reason: `lock is fresh (${(ageMs / 1000).toFixed(1)}s) — leaving alone`, ageMs };
    }
    try {
      rmSync(VAULT_LOCK_PATH, { force: true });
      console.log(`[vault] removed stale .git/index.lock (age ${(ageMs / 1000).toFixed(1)}s)`);
      return { cleared: true, ageMs };
    } catch (e: any) {
      const msg = String(e?.code ?? e?.message ?? e);
      if (msg === "EBUSY" || msg.includes("ENOTEMPTY")) {
        return { cleared: false, reason: `delete failed — real git op in progress (${msg})`, ageMs };
      }
      return { cleared: false, reason: msg, ageMs };
    }
  } catch (e: any) {
    return { cleared: false, reason: String(e?.message ?? e) };
  }
}

export function listVault(rel = ""): VaultNode[] {
  const full = resolve(VAULT, rel);
  ensureInsideVault(full);
  if (!existsSync(full)) return [];
  const entries = readdirSync(full, { withFileTypes: true })
    .filter(e => !HIDDEN_PREFIXES.some(p => e.name.startsWith(p)))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  return entries.map(e => {
    const childRel = relative(VAULT, join(full, e.name)).split(sep).join("/");
    return e.isDirectory()
      ? { name: e.name, path: childRel, type: "dir" as const }
      : { name: e.name, path: childRel, type: "file" as const };
  });
}

export function readVaultFile(rel: string): string {
  const full = resolve(VAULT, rel);
  ensureInsideVault(full);
  return readFileSync(full, "utf8");
}

export class VaultSecurityRefusal extends Error {
  findings: { type: string; severity: string; reason: string }[];
  constructor(findings: { type: string; severity: string; reason: string }[]) {
    super(`refusing vault write — ${findings.length} high-severity finding(s): ${findings.map(f => f.type).join(", ")}`);
    this.findings = findings;
    this.name = "VaultSecurityRefusal";
  }
}

export function writeVaultFile(rel: string, content: string) {
  const full = resolve(VAULT, rel);
  ensureInsideVault(full);
  if (VAULT_SCAN_ENABLED) {
    const findings = scanForSecurityRisks(content, "note");
    const high = findings.filter(f => f.severity === "high");
    if (high.length > 0) {
      // Refuse — never commit a secret. The agent can call security.scan
      // explicitly to redact and retry, but the default-on guardrail blocks
      // the write outright.
      throw new VaultSecurityRefusal(high.map(f => ({ type: f.type, severity: f.severity, reason: f.reason })));
    }
  }
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  // Vault changed — drop the search cache so the next searchVault picks up
  // the new note instead of returning stale results from the 60s window.
  invalidateSearchCache();
}

// Copy a binary file INTO the vault. PDFs, DOCXs, images — anything the
// text-based writeVaultFile can't safely scan or write. Skips the secret
// scan (binaries aren't strings; we'd produce garbage hits) but still
// applies the inside-vault containment check so a path-traversal arg
// can't escape D:\Main brain.
//
// Returns the absolute path written so the caller can compute file size,
// log provenance, etc.
export function importBinaryIntoVault(rel: string, sourceAbsPath: string): { rel: string; abs: string; size: number } {
  const full = resolve(VAULT, rel);
  ensureInsideVault(full);
  const st = statSync(sourceAbsPath);
  if (!st.isFile()) throw new Error(`source is not a file: ${sourceAbsPath}`);
  mkdirSync(resolve(full, ".."), { recursive: true });
  // copyFileSync preserves the original — the agent's contract with the
  // user is COPY-not-MOVE for "save to my vault" unless the user
  // explicitly asks to remove the original.
  copyFileSync(sourceAbsPath, full);
  invalidateSearchCache();
  return { rel, abs: full, size: st.size };
}

// Push the current HEAD without committing. Used to retry a failed push when
// the prior commitAndPush left commits locally but couldn't reach origin (the
// most common case: large pack history times out the first push, but a retry
// from a now-warm git connection works). Same 15s timeout to keep the UI
// responsive.
export async function pushOnly(): Promise<{ pushed: boolean; error?: string; aheadBy?: number }> {
  // Stale-lock sweep — defensive cleanup before touching the repo. Cheap;
  // does nothing if no lock exists or the lock is recent.
  clearStaleVaultLock();
  const git = simpleGit(VAULT);
  let aheadBy: number | undefined;
  try {
    const status = await git.status();
    aheadBy = status.ahead;
  } catch { /* tolerate */ }
  try {
    await raceTimeout(git.push("origin", "HEAD"), 15_000, "push timeout");
    return { pushed: true, aheadBy };
  } catch (e: any) {
    return { pushed: false, error: String(e?.message ?? e), aheadBy };
  }
}

export async function commitAndPush(message: string) {
  // Stale-lock sweep — removes a left-over `.git/index.lock` from a previously
  // crashed git process so this commit doesn't fail with the "Unable to
  // create '.git/index.lock': File exists" error. Cheap and bounded; if the
  // lock is fresh OR EBUSY (real git op in flight) we leave it alone.
  clearStaleVaultLock();
  const git = simpleGit(VAULT);
  // Retry once on lock-conflict — if a real git op held the lock and finished
  // between our sweep and the .add() call, the second attempt sees no lock.
  // Anything more aggressive than one retry risks masking real concurrent
  // commits, so we stop there.
  try {
    await git.add(".");
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/index\.lock|File exists/.test(msg)) {
      console.warn("[vault] git.add hit lock; sweeping + retrying once");
      clearStaleVaultLock();
      await git.add(".");
    } else {
      throw e;
    }
  }
  const before = await git.status();
  if (before.staged.length === 0 && before.created.length === 0 && before.modified.length === 0 && before.deleted.length === 0 && before.renamed.length === 0) {
    return { committed: false };
  }
  await git.commit(message);

  // Time-box the push. Vault repos with large pack history can stall HTTP push
  // for minutes before timing out — that hangs every clawbot task. We bound at
  // 15s; if we can't push in that window, return success-with-deferred and let
  // the user resolve the sync separately (the local commit is already durable).
  const PUSH_TIMEOUT_MS = 15_000;

  let pushErr: any = null;
  try {
    await raceTimeout(git.push("origin", "HEAD"), PUSH_TIMEOUT_MS, "push timeout");
    return { committed: true, pushed: true };
  } catch (e: any) {
    pushErr = e;
    const msg = String(e.message ?? e);
    if (msg === "push timeout") {
      return { committed: true, pushed: false, error: "push exceeded 15s; commit is local-only — fix vault.git size or sync manually" };
    }
    if (!/rejected|fetch first|non-fast-forward|fast-forward/i.test(msg)) {
      return { committed: true, pushed: false, error: msg };
    }
  }

  // Stale-ref recovery path. DEFAULT OFF — when origin/main is divergent (the
  // common case for a private vault that hasn't been pushed yet), `pull --rebase`
  // rewinds local commits and replays them, which can drop into a paused
  // interactive-rebase state and cause every subsequent journal commit to
  // re-trigger the same loop. The local commit is already durable; let the user
  // reconcile the remote manually. Set CLAWBOT_AUTO_REBASE_RECOVERY=1 to opt in.
  if (process.env.CLAWBOT_AUTO_REBASE_RECOVERY !== "1") {
    return { committed: true, pushed: false, error: `push rejected; auto-rebase disabled (set CLAWBOT_AUTO_REBASE_RECOVERY=1 to enable). Original error: ${String(pushErr.message ?? pushErr).slice(0, 200)}` };
  }
  try {
    return await raceTimeout(rebaseWithSidesteppedConflicts(git, String(pushErr.message ?? pushErr)), PUSH_TIMEOUT_MS * 2, "rebase timeout");
  } catch (e: any) {
    return { committed: true, pushed: false, error: String(e.message ?? e) };
  }
}

function raceTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// Pull --rebase, but if it fails because untracked-and-gitignored files would be overwritten by an
// intermediate rebase commit, move those specific files aside, retry, and restore them. This is what
// happens when older history added files that are now gitignored locally (e.g. the notepad sync).
async function rebaseWithSidesteppedConflicts(git: ReturnType<typeof simpleGit>, originalErr: string, attempt = 0): Promise<any> {
  let conflictPaths: string[] = [];
  const matchAttempt = async (): Promise<{ ok: true } | { ok: false; err: string }> => {
    try {
      try { await git.raw(["rebase", "--abort"]); } catch {}
      await git.fetch("origin", "main");
      await git.pull("origin", "main", { "--rebase": "true" });
      await git.push("origin", "HEAD");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, err: String(e.message ?? e) };
    }
  };

  // First attempt — already failed (we got here because the basic push + rebase didn't work).
  // Parse the conflict paths from the original push/rebase error and move them aside.
  conflictPaths = parseUntrackedConflicts(originalErr);

  if (conflictPaths.length === 0 && attempt === 0) {
    // No specific paths to sidestep — try a plain rebase
    const r = await matchAttempt();
    if (r.ok) return { committed: true, pushed: true, rebased: true };
    if (attempt >= 3) return { committed: true, pushed: false, rebased: true, error: r.err };
    return rebaseWithSidesteppedConflicts(git, r.err, attempt + 1);
  }

  // Move conflict paths aside, retry, restore
  const stashRoot = join(tmpdir(), `clawbot-presync-${randomUUID()}`);
  mkdirSync(stashRoot, { recursive: true });
  const moved: { src: string; tmp: string }[] = [];
  for (const p of conflictPaths) {
    const src = resolve(VAULT, p);
    if (!existsSync(src)) continue;
    const tmp = join(stashRoot, p.replace(/[\\/]/g, "_"));
    try { renameSync(src, tmp); moved.push({ src, tmp }); } catch {}
  }
  try {
    const r = await matchAttempt();
    if (r.ok) return { committed: true, pushed: true, rebased: true, sidestepped: moved.length };
    if (attempt < 3) {
      // Maybe more conflicts surfaced
      return rebaseWithSidesteppedConflicts(git, r.err, attempt + 1);
    }
    return { committed: true, pushed: false, rebased: true, error: r.err, sidestepped: moved.length };
  } finally {
    for (const m of moved) {
      try { renameSync(m.tmp, m.src); } catch {}
    }
    try { rmSync(stashRoot, { recursive: true, force: true }); } catch {}
  }
}

function parseUntrackedConflicts(stderr: string): string[] {
  // git emits one path per line, each prefixed with a tab, between the headline and "Please move..."
  const lines = stderr.split(/\r?\n/);
  const paths: string[] = [];
  for (const line of lines) {
    if (line.startsWith("\t") || /^\s\s+/.test(line)) {
      const p = line.trim();
      if (p && !p.startsWith("hint:") && !p.toLowerCase().includes("please move") && !p.includes("Aborting")) {
        paths.push(p);
      }
    }
  }
  return paths;
}

// In-process search cache. The full disk walk + per-file read can take
// 10-15s on a multi-thousand-note vault (measured on D:\Main brain\), and a
// single chat task hits searchVault multiple times (triage, planner, research
// primitives). A 60s TTL keyed by (query, limit) collapses repeat calls
// inside one task into a single walk while still picking up new notes on
// the next task. Bust on every vault write so a just-saved note shows up
// on the very next search.
type SearchHit = { path: string; line: number; preview: string };
const SEARCH_CACHE = new Map<string, { at: number; results: SearchHit[] }>();
const SEARCH_CACHE_TTL_MS = Number(process.env.CLAWBOT_VAULT_SEARCH_TTL_MS ?? "60000");
const SEARCH_CACHE_MAX = 200;

function invalidateSearchCache() {
  SEARCH_CACHE.clear();
}

// Filename-only vault scan. Walks the vault tree but ONLY checks the .md
// filename for the query — never opens the file. Fast (~50-200ms on a multi-
// thousand-note vault) vs ~10-15s for full-content searchVault().
//
// Used by the triage block ("does this user already have notes on X?") where
// we don't need real matches — we just need a yes/no signal that the topic
// is present in the vault. Content search is overkill there; the slow walk
// was the root cause of the 11s gap measured before this fix.
export function searchVaultFilenames(query: string, limit = 5): SearchHit[] {
  const q = query.toLowerCase();
  // Normalise hyphens/underscores in filenames so "vault edit" matches
  // "vault-edit.md" / "vault_edit.md". Multi-token queries require every
  // token to appear in the filename.
  const tokens = q.replace(/[-_\s]+/g, " ").split(" ").filter(Boolean);
  if (tokens.length === 0) return [];
  const out: SearchHit[] = [];
  function walk(dir: string) {
    if (out.length >= limit) return;
    let entries: any[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (HIDDEN_PREFIXES.some(p => e.name.startsWith(p))) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith(".md")) continue;
      const normalised = e.name.slice(0, -3).toLowerCase().replace(/[-_]+/g, " ");
      if (tokens.every(t => normalised.includes(t))) {
        out.push({
          path: relative(VAULT, full).split(sep).join("/"),
          line: 0,
          preview: e.name,
        });
      }
    }
  }
  walk(VAULT);
  return out;
}

export function searchVault(query: string, limit = 50): SearchHit[] {
  const q = query.toLowerCase();
  const key = `${q}|${limit}`;
  const hit = SEARCH_CACHE.get(key);
  if (hit && Date.now() - hit.at < SEARCH_CACHE_TTL_MS) {
    return hit.results;
  }
  const out: SearchHit[] = [];
  function walk(dir: string) {
    if (out.length >= limit) return;
    let entries: any[] = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (HIDDEN_PREFIXES.some(p => e.name.startsWith(p))) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".md") && statSync(full).size < 1_000_000) {
        try {
          const content = readFileSync(full, "utf8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && out.length < limit; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              out.push({ path: relative(VAULT, full).split(sep).join("/"), line: i + 1, preview: lines[i].slice(0, 200) });
              break;
            }
          }
        } catch {}
      }
    }
  }
  walk(VAULT);
  // Cap the cache so a long-running worker doesn't bleed memory on a wide
  // range of unique queries. Drop the oldest entry when over the cap.
  if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) {
    const oldest = [...SEARCH_CACHE.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) SEARCH_CACHE.delete(oldest[0]);
  }
  SEARCH_CACHE.set(key, { at: Date.now(), results: out });
  return out;
}

function ensureInsideVault(full: string) {
  const r = resolve(full);
  if (!r.startsWith(resolve(VAULT))) {
    throw new Error(`path escapes vault: ${full}`);
  }
}
