import { readFileSync, readdirSync, renameSync, statSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { simpleGit } from "simple-git";
import { config } from "../config.js";

const VAULT = config.vaultPath;

export type VaultNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: VaultNode[];
};

const HIDDEN_PREFIXES = [".obsidian", ".git", "node_modules"];

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

export function writeVaultFile(rel: string, content: string) {
  const full = resolve(VAULT, rel);
  ensureInsideVault(full);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

export async function commitAndPush(message: string) {
  const git = simpleGit(VAULT);
  await git.add(".");
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

  // Stale-ref recovery path also bounded.
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

export function searchVault(query: string, limit = 50): { path: string; line: number; preview: string }[] {
  const q = query.toLowerCase();
  const out: { path: string; line: number; preview: string }[] = [];
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
  return out;
}

function ensureInsideVault(full: string) {
  const r = resolve(full);
  if (!r.startsWith(resolve(VAULT))) {
    throw new Error(`path escapes vault: ${full}`);
  }
}
