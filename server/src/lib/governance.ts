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

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { llmGenerate } from "./llm.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONSTRAINT_DIR = resolve(__dirname, "../../../.neuroworks/constraints");

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

// ─── Constraint extraction ───
// Extracted from policy docs by the LLM. Each constraint is a structured rule
// the agent must follow. Hard constraints are enforced (the agent must obey)
// while soft constraints are preferences (the agent should prefer).

export type ConstraintSeverity = "hard" | "soft";

export type ExtractedConstraint = {
  id: string;
  policyName: string;       // source policy doc
  rule: string;             // one-sentence rule
  severity: ConstraintSeverity;
  category: string;         // e.g. "data-privacy", "brand-voice", "security"
  details?: string;         // longer explanation or exception conditions
  reviewed: boolean;        // operator has reviewed this constraint
  accepted: boolean;        // operator accepted or rejected
  createdAt: string;
};

// Store constraints per-policy as JSON files in .neuroworks/constraints/
function constraintPath(policyName: string): string {
  return join(CONSTRAINT_DIR, `${policyName}.json`);
}

function loadConstraintsForPolicy(policyName: string): ExtractedConstraint[] {
  const path = constraintPath(policyName);
  try {
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf8")) as ExtractedConstraint[];
  } catch { return []; }
}

function saveConstraintsForPolicy(policyName: string, constraints: ExtractedConstraint[]): void {
  if (!existsSync(CONSTRAINT_DIR)) mkdirSync(CONSTRAINT_DIR, { recursive: true });
  writeFileSync(constraintPath(policyName), JSON.stringify(constraints, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function getConstraints(policyName?: string): { constraints: ExtractedConstraint[]; byPolicy: Record<string, ExtractedConstraint[]> } {
  const all = listGovernance();
  const byPolicy: Record<string, ExtractedConstraint[]> = {};
  for (const p of all) {
    if (p.reference) continue;
    const cs = loadConstraintsForPolicy(p.name);
    if (cs.length > 0) byPolicy[p.name] = cs;
  }
  const constraints = policyName ? loadConstraintsForPolicy(policyName) : Object.values(byPolicy).flat();
  return { constraints, byPolicy };
}

export function updateConstraint(policyName: string, constraintId: string, patch: Partial<ExtractedConstraint>): ExtractedConstraint | null {
  const cs = loadConstraintsForPolicy(policyName);
  const idx = cs.findIndex(c => c.id === constraintId);
  if (idx === -1) return null;
  cs[idx] = { ...cs[idx], ...patch };
  saveConstraintsForPolicy(policyName, cs);
  return cs[idx];
}

// LLM extraction: given a policy doc body, ask the LLM to extract constraints.
const EXTRACT_SYSTEM = `You are a policy analyst. Extract every explicit rule, restriction, requirement, or preference from the given policy document.

For each rule, output a JSON object with these fields:
- rule: a one-sentence description of what the agent must or should do
- severity: "hard" if the rule uses MUST, MUST NOT, REQUIRED, PROHIBITED, FORBIDDEN, SHALL, SHALL NOT, NEVER, ALWAYS, BANNED, or similar absolute language. "soft" if it uses SHOULD, RECOMMENDED, MAY, OPTIONAL, PREFER, AVOID, or similar advisory language.
- category: one of: data-privacy, security, brand-voice, compliance, ethical, operational, access-control, communication, quality, other
- details: (optional) any exceptions, conditions, or additional context

Output a JSON array. Do NOT add commentary outside the JSON.`;

export async function extractConstraints(policyName: string): Promise<ExtractedConstraint[]> {
  const path = join(config.vaultPath, "_governance", `${policyName}.md`);
  if (!existsSync(path)) throw new Error(`Policy "${policyName}" not found`);

  // Check if already extracted.
  const existing = loadConstraintsForPolicy(policyName);
  if (existing.length > 0) return existing;

  const body = readFileSync(path, "utf8");
  // Remove frontmatter for cleaner LLM input.
  const clean = body.replace(/^---[\s\S]*?---\r?\n/, "").trim();

  const result = await llmGenerate(
    `Extract rules from this policy document:\n\n${clean.slice(0, 8000)}`,
    EXTRACT_SYSTEM,
    { profile: "extraction", temperature: 0.1, maxTokens: 2048 },
  );

  let constraints: { rule: string; severity: string; category: string; details?: string }[];
  try {
    const parsed = JSON.parse(result);
    constraints = Array.isArray(parsed) ? parsed : (parsed.constraints ?? parsed.rules ?? []);
  } catch {
    // Try to extract JSON array from the raw string.
    const m = result.match(/\[\s*\{.*\}\s*\]/s);
    if (m) {
      try { constraints = JSON.parse(m[0]); }
      catch { constraints = []; }
    } else {
      constraints = [];
    }
  }

  const now = new Date().toISOString();
  const extracted: ExtractedConstraint[] = constraints
    .filter(c => c.rule && typeof c.rule === "string")
    .map((c, i) => ({
      id: `${policyName}-${i}`,
      policyName,
      rule: String(c.rule).trim(),
      severity: (c.severity === "hard" || c.severity === "soft") ? c.severity : "soft",
      category: String(c.category ?? "other"),
      details: c.details ? String(c.details).trim() : undefined,
      reviewed: false,
      accepted: false,
      createdAt: now,
    }));

  saveConstraintsForPolicy(policyName, extracted);
  return extracted;
}

// Check a proposed action string against all active constraints.
// Returns any constraints the action would violate.
export function checkActionAgainstConstraints(action: string, constraints: ExtractedConstraint[]): { violated: ExtractedConstraint[]; reason: string }[] {
  const results: { violated: ExtractedConstraint[]; reason: string }[] = [];
  const lowerAction = action.toLowerCase();
  for (const c of constraints) {
    if (!c.accepted) continue;
    const lower = c.rule.toLowerCase();
    // Simple keyword overlap check — looks for action keywords matching constraint topics.
    const actionWords = new Set(lowerAction.split(/\s+/).filter(w => w.length > 3));
    const constraintWords = lower.split(/\s+/).filter(w => w.length > 3);
    const overlap = constraintWords.filter(w => actionWords.has(w));
    if (overlap.length >= 2) {
      results.push({ violated: [c], reason: `"${c.rule}" (${c.severity} constraint, category: ${c.category})` });
    }
  }
  return results;
}

// ─── Enforcement ───
// Everything above this line (extract/review/checkAction) already existed as
// a standalone review workbench — an admin could upload a policy, extract
// constraints, accept/reject them, and manually paste an action into the
// "test" box. None of that touched real agent execution: quality.check and
// security.scan run automatically after every synth, but there was no third
// gate reading accepted constraints, and no gate on the plan steps
// themselves. A hard "never email outside the finance domain" constraint
// could sit accepted in the review UI while email.send fired anyway — the
// exact class of incident this system exists to prevent. The functions below
// close that gap: one pre-execution check on side-effecting plan steps
// (blocks before the tool runs), one post-synth check on the final answer
// text (mirrors quality.check/security.scan's Phase-A wiring in agent.ts).

// Tools whose side effects are worth gating before they run. Deliberately a
// narrow, explicit allowlist — read-only tools (vault.read, web.fetch,
// research.*) can't violate an org policy by running, only by what they DO
// with the result, which the post-synth content check catches instead.
export const CONSEQUENTIAL_TOOLS = new Set([
  "email.send",
  "vault.write", "vault.edit", "vault.create_zettel", "vault.append", "vault.write_pdf",
  "fs.import_to_vault",
  "github.create_issue", "github.comment_on_issue", "github.update_issue", "github.request_review",
  "webhook.post", "slack.post", "telegram.send", "discord.post", "msteams.post", "googlechat.post",
  "connector.call",
  "payment.link", "payment.paynow_link",
  "db.write",
  "code.exec",
]);

// Build a compact, keyword-rich description of a plan step so the overlap
// check in checkActionAgainstConstraints has real signal to match against —
// the tool name alone ("email.send") shares no words with a policy rule
// ("never email customer financial data to external domains"), but the
// resolved args usually do.
export function describeStepAction(tool: string, args: Record<string, any>): string {
  const parts: string[] = [tool];
  for (const key of ["to", "path", "vaultFolder", "title", "subject", "body", "content", "url", "channel", "source", "code", "kind"]) {
    const v = args?.[key];
    if (v === undefined || v === null) continue;
    const s = Array.isArray(v) ? v.join(", ") : String(v);
    if (s.trim().length === 0) continue;
    parts.push(s.slice(0, 500));
  }
  return parts.join(" | ");
}

export type GovernanceGate = {
  blocked: boolean;
  violations: { rule: string; policyName: string; severity: ConstraintSeverity; category: string }[];
};

// Only "reviewed && accepted && hard" constraints are enforceable — matches
// the bar the /check-action route already uses for "accepted" (an
// extracted-but-unreviewed constraint is a draft, not policy yet), narrowed
// further to hard since soft constraints are preferences, not something a
// step or answer should be blocked over.
export function filterEnforceable(constraints: ExtractedConstraint[]): ExtractedConstraint[] {
  return constraints.filter(c => c.reviewed && c.accepted && c.severity === "hard");
}

// Pure core: given an action/content string and an already-filtered
// enforceable set, decide block/pass. Disk-free and deterministic — the I/O
// wrappers below (checkStepAgainstGovernance, checkContentAgainstGovernance)
// just supply the enforceable set from getConstraints().
export function gateAction(action: string, enforceable: ExtractedConstraint[]): GovernanceGate {
  if (enforceable.length === 0) return { blocked: false, violations: [] };
  const hits = checkActionAgainstConstraints(action, enforceable);
  if (hits.length === 0) return { blocked: false, violations: [] };
  return {
    blocked: true,
    violations: hits.map(h => ({ rule: h.violated[0].rule, policyName: h.violated[0].policyName, severity: h.violated[0].severity, category: h.violated[0].category })),
  };
}

// Pre-execution gate for a single plan step.
export function checkStepAgainstGovernance(tool: string, args: Record<string, any>): GovernanceGate {
  if (!CONSEQUENTIAL_TOOLS.has(tool)) return { blocked: false, violations: [] };
  const enforceable = filterEnforceable(getConstraints().constraints);
  if (enforceable.length === 0) return { blocked: false, violations: [] };
  return gateAction(describeStepAction(tool, args), enforceable);
}

// Post-synth gate for the final answer text — checked against the drafted
// answer rather than a tool call. Wired into agent.ts's Phase A alongside
// quality.check/security.scan via the governance.check primitive.
export function checkContentAgainstGovernance(content: string): GovernanceGate {
  const enforceable = filterEnforceable(getConstraints().constraints);
  return gateAction(content, enforceable);
}

// Fast pre-check so callers on a hot path (runStep, once per consequential
// step) can skip the getConstraints() read entirely when governance isn't in
// use. listGovernance() is already 60s-cached, so this is cheap even when
// called often, but most installs will never touch _governance/ at all.
export function hasEnforceableConstraints(): boolean {
  return filterEnforceable(getConstraints().constraints).length > 0;
}
