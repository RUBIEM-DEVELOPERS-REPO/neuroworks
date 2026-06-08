// Governance policies — admin-curated vault documents that become guardrails
// applied to every general-task / synth call.
//
// Layout: every `*.md` file under `<vault>/_governance/` is treated as a
// policy. We load them at request time, cap the total bytes to fit in any
// reasonable context budget, and concat them into a single prefix string
// that callers prepend to their system prompt.
//
// Cache: 60-second TTL. Vault watcher events also bust the cache so an
// admin upload via the /governance page is reflected within seconds, not
// minutes.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const POLICY_DIR_REL = "_governance";

// Hard cap so a runaway admin upload can't blow up planner context. 32KB
// fits ~6-8 typical policy docs at a few KB each, leaves room for the rest
// of the system prompt + the task body.
const MAX_PREFIX_BYTES = 32 * 1024;
const CACHE_TTL_MS = 60_000;

export type GovernancePolicy = {
  path: string;        // relative to vault root, e.g. "_governance/data-privacy.md"
  name: string;        // filename without extension, used as the section header
  bytes: number;
  lastModified: string;
  reference?: boolean; // true = a manual/reference doc — listed + downloadable, but NOT injected into the prompt prefix
};

// A doc can opt out of the guardrail prefix with frontmatter `reference: true`
// (e.g. the API-creation blueprint — useful to agents on demand, but pure noise
// prepended to every task). We only need to peek at the leading frontmatter.
function isReferenceDoc(full: string): boolean {
  try {
    const head = readFileSync(full, "utf8").slice(0, 1024);
    const m = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return false;
    return /^\s*reference\s*:\s*true\s*$/im.test(m[1]);
  } catch { return false; }
}

let prefixCache: { value: string; builtAt: number } | null = null;
let listCache: { value: GovernancePolicy[]; builtAt: number } | null = null;

function policyRoot(): string {
  return join(config.vaultPath, POLICY_DIR_REL);
}

export function invalidateGovernanceCache(): void {
  prefixCache = null;
  listCache = null;
}

export function listGovernance(): GovernancePolicy[] {
  if (listCache && Date.now() - listCache.builtAt < CACHE_TTL_MS) return listCache.value;
  const root = policyRoot();
  if (!existsSync(root)) {
    listCache = { value: [], builtAt: Date.now() };
    return [];
  }
  const out: GovernancePolicy[] = [];
  try {
    for (const f of readdirSync(root)) {
      if (!f.toLowerCase().endsWith(".md")) continue;
      const full = join(root, f);
      try {
        const st = statSync(full);
        if (!st.isFile()) continue;
        out.push({
          path: `${POLICY_DIR_REL}/${f}`,
          name: f.replace(/\.md$/i, ""),
          bytes: st.size,
          lastModified: st.mtime.toISOString(),
          reference: isReferenceDoc(full),
        });
      } catch { /* tolerate one bad file */ }
    }
  } catch { /* tolerate readdir error (e.g. perms) */ }
  // Sort newest first so admin sees the freshest policy at the top of the
  // page; the prefix order matches so latest policies get loaded first.
  out.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  listCache = { value: out, builtAt: Date.now() };
  return out;
}

// Build the system-prompt prefix. Empty string when no policies exist
// (caller can safely concat unconditionally). Each policy is wrapped in
// a labelled section so the model can cite which one is active when it
// declines a task.
export function loadGovernancePrefix(): string {
  if (prefixCache && Date.now() - prefixCache.builtAt < CACHE_TTL_MS) return prefixCache.value;
  const policies = listGovernance();
  if (policies.length === 0) {
    prefixCache = { value: "", builtAt: Date.now() };
    return "";
  }
  const root = policyRoot();
  const parts: string[] = [
    "=== GOVERNANCE POLICIES (organizational guardrails) ===",
    "The customer's organization has set the policies below. These OVERRIDE any user request that conflicts. When you decline, name the specific policy you're honoring.",
    "",
  ];
  let bytesSoFar = parts.join("\n").length;
  let included = 0;
  let skipped = 0;
  for (const p of policies) {
    // Reference/manual docs are listed + downloadable on the page but are NOT
    // guardrails — keep them out of the system-prompt prefix.
    if (p.reference) continue;
    try {
      const body = readFileSync(join(root, p.path.replace(`${POLICY_DIR_REL}/`, "")), "utf8").trim();
      const header = `--- Policy: ${p.name} ---`;
      const block = `${header}\n${body}\n`;
      if (bytesSoFar + block.length > MAX_PREFIX_BYTES) { skipped += 1; continue; }
      parts.push(block);
      bytesSoFar += block.length;
      included += 1;
    } catch { /* tolerate read failure */ }
  }
  if (skipped > 0) parts.push(`(${skipped} policy file${skipped === 1 ? "" : "s"} omitted to fit context budget)`);
  parts.push("=== END GOVERNANCE ===");
  parts.push("");
  const value = parts.join("\n");
  prefixCache = { value, builtAt: Date.now() };
  if (included > 0) console.log(`[governance] loaded ${included} policy file${included === 1 ? "" : "s"} into system prefix (${(value.length / 1024).toFixed(1)}KB)`);
  return value;
}
