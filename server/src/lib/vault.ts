import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
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
  const status = await git.status();
  if (status.files.length === 0) return { committed: false };
  await git.add(".");
  await git.commit(message);
  try {
    await git.push("origin", "HEAD");
    return { committed: true, pushed: true };
  } catch (e: any) {
    return { committed: true, pushed: false, error: e.message };
  }
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
