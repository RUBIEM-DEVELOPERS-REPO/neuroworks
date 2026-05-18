// Skills registry. Skills are short markdown playbooks the agent can load
// when working on a relevant task — "how to write a good email", "how to
// structure meeting notes", "how to do solid research". They're not personas
// (which set identity); they're closer to checklists / employee handbooks
// that bias the synth's output toward what a good operator would produce.
//
// Two sources:
//   • Built-in: ships in server/src/skills/*.md (8 curated playbooks).
//   • Local-user: server/src/skills/_user/*.md (gitignored), so the user
//     can drop their own .md files without rebuilding.
//
// Lookup is by stable name (the `name:` frontmatter field, or the filename
// without .md). Auto-suggestion matches a task's detected intent to the
// `applies_to` frontmatter — e.g. intent=draft-email pulls email-writing.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_BUILTIN = resolve(__dirname, "../skills");
const SKILLS_USER = resolve(__dirname, "../skills/_user");

export type Skill = {
  name: string;
  description: string;
  applies_to: string[];
  body: string;          // full markdown body (after the frontmatter block)
  source: "builtin" | "user" | "remote";
  path: string;          // absolute path on disk
};

// Cache parsed skills by absolute path + mtime so we don't re-parse on every
// list/load call. Bust an entry when its mtime advances.
const cache = new Map<string, { mtime: number; skill: Skill }>();

function parseFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const metaRaw = m[1];
  const body = m[2];
  const meta: Record<string, any> = {};
  for (const line of metaRaw.split("\n")) {
    const kv = line.match(/^\s*([\w_-]+):\s*(.+?)\s*$/);
    if (!kv) continue;
    const key = kv[1];
    let val: any = kv[2].trim();
    // Array form: [a, b, c] — split on commas, strip quotes.
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, "");
    }
    meta[key] = val;
  }
  return { meta, body };
}

function loadSkillFromDisk(fullPath: string, source: Skill["source"]): Skill | null {
  try {
    const st = statSync(fullPath);
    const hit = cache.get(fullPath);
    if (hit && hit.mtime === st.mtimeMs) return hit.skill;
    const raw = readFileSync(fullPath, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const name = String(meta.name ?? basename(fullPath, ".md")).trim();
    const description = String(meta.description ?? "(no description)").trim();
    const applies_to = Array.isArray(meta.applies_to) ? meta.applies_to.map(String) : [];
    const skill: Skill = { name, description, applies_to, body: body.trim(), source, path: fullPath };
    cache.set(fullPath, { mtime: st.mtimeMs, skill });
    return skill;
  } catch {
    return null;
  }
}

export function listSkills(): Skill[] {
  const out: Skill[] = [];
  for (const dir of [SKILLS_BUILTIN, SKILLS_USER]) {
    if (!existsSync(dir)) continue;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const full = join(dir, name);
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      const source: Skill["source"] = dir === SKILLS_BUILTIN ? "builtin" : "user";
      const skill = loadSkillFromDisk(full, source);
      if (skill) out.push(skill);
    }
  }
  return out;
}

// Resolve a skill by name. Match is case-insensitive on the stable name.
// User-source wins over builtin when there's a name collision — lets a user
// override a built-in playbook without forking the codebase.
export function loadSkill(name: string): Skill | null {
  const target = name.trim().toLowerCase();
  const all = listSkills();
  const user = all.find(s => s.source === "user" && s.name.toLowerCase() === target);
  if (user) return user;
  return all.find(s => s.name.toLowerCase() === target) ?? null;
}

// Pick the best skill(s) for a given intent. Returns at most `limit` matches
// scored by how specifically the skill targets that intent (an applies_to
// list of [draft-email] is more specific than [draft-email, draft-other, …]).
// Returns [] when no skill targets the intent — caller should treat absence
// as "no skill guidance".
export function suggestSkillsForIntent(intent: string, limit = 2): Skill[] {
  const all = listSkills();
  const target = intent.trim().toLowerCase();
  if (!target) return [];
  const scored: { skill: Skill; score: number }[] = [];
  for (const s of all) {
    if (!s.applies_to.length) continue;
    const matches = s.applies_to.some(t => t.toLowerCase() === target);
    if (!matches) continue;
    // Fewer applies_to entries = more specific. Invert so smaller list wins.
    const specificity = 10 - Math.min(9, s.applies_to.length);
    scored.push({ skill: s, score: specificity });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.skill);
}

// Doc-type keyword → skill name. Used as a SECONDARY signal after intent
// matching: if the user literally says "draft a PRD" or "ADR for X", we
// load the matching skill even when the intent classifier missed (e.g. it
// labelled the task as generic "draft-other" because it didn't recognise PRD).
//
// Map keys are the *substring* we search for in the task body (case-
// insensitive). Word-boundary matching for short tokens prevents false hits
// ("api" wouldn't match "rapid").
const SKILL_KEYWORDS: { skill: string; patterns: RegExp[] }[] = [
  { skill: "email-writing",          patterns: [/\bemail\b/i, /\breply\s+to\b/i] },
  { skill: "memo-writing",           patterns: [/\bmemo\b/i] },
  { skill: "report-writing",         patterns: [/\b(?:full|quarterly|annual)\s+report\b/i, /\banalysis\s+report\b/i] },
  { skill: "brief-writing",          patterns: [/\b(?:executive\s+)?brief\b/i, /\bone[-\s]?pager\b/i] },
  { skill: "proposal-writing",       patterns: [/\bproposal\b/i, /\bpitch\s+(?:doc|deck)\b/i, /\brfp\s+response\b/i] },
  { skill: "product-spec",           patterns: [/\bprd\b/i, /\bproduct\s+(?:spec|requirements)\b/i, /\bproduct\s+brief\b/i] },
  { skill: "design-doc",             patterns: [/\bdesign\s+doc(?:ument)?\b/i, /\brfc\b/i, /\btechnical\s+design\b/i] },
  { skill: "decision-doc",           patterns: [/\badr\b/i, /\brfd\b/i, /\barchitecture\s+decision\b/i, /\bdecision\s+record\b/i] },
  { skill: "incident-post-mortem",   patterns: [/\bpost[\s-]?mortem\b/i, /\bincident\s+(?:report|review)\b/i, /\bretro\s+for\s+(?:the\s+)?(?:incident|outage)\b/i] },
  { skill: "root-cause-analysis",    patterns: [/\broot\s+cause\b/i, /\brca\b/i, /\b5\s+whys?\b/i, /\bfive\s+whys?\b/i] },
  { skill: "competitive-analysis",   patterns: [/\bcompetitor\b/i, /\bcompetitive\s+(?:analysis|landscape)\b/i, /\bmarket\s+landscape\b/i] },
  { skill: "okr-writing",            patterns: [/\bokrs?\b/i, /\bobjectives?\s+and\s+key\s+results\b/i] },
  { skill: "one-on-one-prep",        patterns: [/\b1[\s:.-]?1\b/i, /\bone[\s-]on[\s-]one\b/i] },
  { skill: "performance-review",     patterns: [/\b(?:perf|performance)\s+review\b/i, /\bself[\s-]?review\b/i] },
  { skill: "status-update",          patterns: [/\bstatus\s+update\b/i, /\bweekly\s+update\b/i, /\bstandup\s+(?:update|note)\b/i] },
  { skill: "weekly-review",          patterns: [/\bweekly\s+review\b/i, /\bweek\s+in\s+review\b/i] },
  { skill: "meeting-agenda",         patterns: [/\b(?:meeting\s+)?agenda\b/i] },
  { skill: "meeting-notes",          patterns: [/\bmeeting\s+notes\b/i, /\bminutes\s+of\s+the\s+meeting\b/i] },
  { skill: "announcement-writing",   patterns: [/\bannouncement\b/i, /\bannounce\b/i] },
  { skill: "feedback-giving",        patterns: [/\b(?:give|deliver|share)\s+(?:some\s+)?feedback\b/i, /\bfeedback\s+for\b/i] },
  { skill: "risk-assessment",        patterns: [/\brisk\s+(?:assessment|analysis|register)\b/i, /\bidentify\s+risks?\b/i] },
  { skill: "fact-check",             patterns: [/\bfact[\s-]?check\b/i, /\bverify\s+(?:a\s+|the\s+|this\s+)?claim\b/i, /\bis\s+it\s+true\s+that\b/i] },
  { skill: "comparison",             patterns: [/\bcompare\s+\S+\s+(?:to|with|vs\.?|and|versus)\s+\S/i, /\bside[\s-]by[\s-]side\b/i] },
  { skill: "contract-summary",       patterns: [/\bcontract\b/i, /\bagreement\b/i, /\bterms\s+of\s+service\b/i, /\btos\b/i, /\bnda\b/i] },
  { skill: "local-doc-summary",      patterns: [/\b(?:what(?:'?s|\s+is|\s+does)\s+in\s+this\b|summari[sz]e\s+this\s+(?:doc|file|pdf))/i] },
  { skill: "pr-description-writing", patterns: [/\bpull\s+request\b/i, /\bpr\s+description\b/i, /\bpr\s+body\b/i] },
  { skill: "commit-message-writing", patterns: [/\bcommit\s+message\b/i, /\bgit\s+commit\s+msg\b/i] },
  { skill: "testing-strategy",       patterns: [/\btest(?:ing)?\s+(?:strategy|plan)\b/i, /\bqa\s+plan\b/i] },
  { skill: "api-design",             patterns: [/\bapi\s+design\b/i, /\brest\s+api\b/i, /\bendpoint\s+design\b/i] },
  { skill: "debugging-help",         patterns: [/\bdebug\b/i, /\berror\b/i, /\bcrashe?s?\b/i, /\bstack\s+trace\b/i, /\bnot\s+working\b/i] },
  { skill: "code-review",            patterns: [/\bcode\s+review\b/i, /\breview\s+(?:this\s+|the\s+|my\s+)?code\b/i] },
  { skill: "edit-pass",              patterns: [/\bedit\s+(?:this|my)\b/i, /\bcopy[\s-]?edit\b/i, /\bpolish\b/i, /\bclean\s+up\s+the\s+writing\b/i] },
  // "summarise/summarize" is intentionally NOT here — it's too generic and
  // already covered by intent=summarize, AND it'd false-positive over more
  // specific skills like contract-summary or local-doc-summary. tl;dr is fine.
  { skill: "summarization",          patterns: [/\btl;?dr\b/i] },
  { skill: "research-deep",          patterns: [/\bresearch\b/i, /\bdig\s+into\b/i, /\bdeep\s+dive\b/i] },
  { skill: "vault-organization",     patterns: [/\bvault\b/i, /\bsecond\s+brain\b/i, /\bobsidian\b/i] },
  { skill: "list-making",            patterns: [/\b(?:make|give|write)\s+(?:me\s+)?(?:a\s+)?(?:bulleted?\s+|numbered\s+|checklist|to[\s-]?do)\b/i] },
  { skill: "table-making",           patterns: [/\b(?:make|build|create|give)\s+(?:me\s+)?(?:a\s+)?(?:comparison\s+)?table\b/i, /\b(?:as|in)\s+a\s+table\b/i] },
];

// Combined picker: matches BOTH on intent AND on doc-type keywords in the
// task body. Solves the "intent classifier missed but the user literally
// said 'write a PRD'" gap. Returns the top `limit` skills by composite
// score:
//   • 20 + specificity bonus when applies_to contains the intent exactly
//   • 15 per distinct keyword pattern that matches the task body
//   • 0 otherwise (skill is filtered out)
//
// Use this as the PRIMARY picker for the synth step. Falls back to intent-
// only matching when no task text is supplied.
export function suggestSkillsForTask(task: string, intent?: string, limit = 2): Skill[] {
  const all = listSkills();
  const intentTarget = intent?.trim().toLowerCase() ?? "";
  const taskText = (task ?? "").slice(0, 2000); // cap the regex window
  const scored: { skill: Skill; score: number; reasons: string[] }[] = [];

  for (const s of all) {
    let score = 0;
    const reasons: string[] = [];

    if (intentTarget && s.applies_to.length > 0 && s.applies_to.some(t => t.toLowerCase() === intentTarget)) {
      const specificity = 10 - Math.min(9, s.applies_to.length);
      score += 20 + specificity;
      reasons.push(`intent=${intentTarget}`);
    }

    if (taskText) {
      const map = SKILL_KEYWORDS.find(e => e.skill === s.name);
      if (map) {
        for (const pat of map.patterns) {
          if (pat.test(taskText)) {
            score += 15;
            reasons.push(`keyword=${pat.source.slice(0, 30)}`);
            break; // one keyword hit per skill is plenty
          }
        }
      }
    }

    if (score > 0) scored.push({ skill: s, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.skill);
}

// Return the composite score for the top-matched skill on this task, or
// null if no skill matched. Used by the auto-draft trigger to decide
// whether the matched skill is strong enough to skip drafting a new one.
export function topSkillScoreForTask(task: string, intent?: string): { skill: Skill; score: number } | null {
  const all = listSkills();
  const intentTarget = intent?.trim().toLowerCase() ?? "";
  const taskText = (task ?? "").slice(0, 2000);
  let best: { skill: Skill; score: number } | null = null;
  for (const s of all) {
    let score = 0;
    if (intentTarget && s.applies_to.some(t => t.toLowerCase() === intentTarget)) {
      score += 20 + (10 - Math.min(9, s.applies_to.length));
    }
    if (taskText) {
      const map = SKILL_KEYWORDS.find(e => e.skill === s.name);
      if (map && map.patterns.some(p => p.test(taskText))) score += 15;
    }
    if (score > 0 && (best === null || score > best.score)) best = { skill: s, score };
  }
  return best;
}

// Compact one-line render for the planner's prompt catalog ("you have these
// skills available: …"). Avoids dumping every skill body.
export function skillsCatalog(): string {
  const all = listSkills();
  if (all.length === 0) return "No skills installed.";
  return all.map(s => `- ${s.name}: ${s.description}`).join("\n");
}

// Draft a brand-new skill .md when no built-in or user skill targets the
// task's intent — the "self-improvement loop": clawbot notices it's
// struggling, asks the LLM to write the playbook it wishes it had, saves
// it to skills/_user/, and the next run on a similar task loads the new
// skill automatically (since suggestSkillsForIntent reads from disk).
//
// We deliberately use the LARGE-tier LLM (forced complexity:"high") for the
// draft when OpenRouter is available — playbook quality is what determines
// whether the loop actually helps. A small-model skill that hallucinates
// rules makes the agent worse, not better.
//
// Inputs:
//   • intent — the detected intent label (e.g. "draft-email", "summarize")
//   • taskSample — the actual user request that exposed the skill gap
//   • failureReason — what went wrong (low quality score, missing structure,
//     etc.) so the LLM knows what to address in the playbook
//
// Returns the saved skill or null if the draft was unusable (too short,
// malformed frontmatter). Caller should fall back to the default synth on
// null — the agent shouldn't crash because the meta-skill draft missed.
export async function draftSkillForIntent(args: {
  intent: string;
  taskSample: string;
  failureReason?: string;
}): Promise<Skill | null> {
  // Lazy-import the LLM dispatcher to keep skills.ts free of the heavy
  // ollama/openrouter dependency tree at module load.
  const { llmGenerate } = await import("./llm.js");
  const intentSlug = args.intent.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!intentSlug) return null;

  const sys = `You write skill playbooks — short markdown documents that teach an AI agent how to deliver employee-quality output for a specific task type. Each skill follows the same template; emit ONLY the markdown, no commentary, no fences around the whole doc.

Template (replicate exactly, fill the placeholders):

---
name: <kebab-case-name-matching-the-intent>
description: <one-line, what this skill is for>
applies_to: [<intent-label>]
---

# Skill: <Human-readable name>

## Goal

<One sentence on what good looks like for this task.>

## <Process | Structure | Format>

<3-7 bullets OR a numbered process OR a template block. Match the section name to the deliverable.>

## Rules

- <Concrete rule, not vague advice. "Lead with the recommendation in the first 2 sentences" beats "be clear">
- <…>
- <…>

## Pitfalls

- <Common failure mode with a one-line fix>
- <…>

Rules for YOUR draft:
- Be concrete. Generic advice ("be clear", "stay focused") doesn't help an agent — give it specifics it can apply mechanically.
- 50-100 lines total. Skills that don't fit on one screen don't get loaded.
- If the task has a deliverable shape (email, memo, report, code, etc.), include an explicit template block.
- Reference real failure modes — what would an inexperienced operator get wrong?
- No "this skill helps you…" preamble. Skills are read by the agent, not the user.`;

  const userPrompt = `Intent: ${args.intent}
Sample task that exposed the skill gap: "${args.taskSample.slice(0, 600)}"
${args.failureReason ? `What went wrong on the previous attempt: ${args.failureReason.slice(0, 400)}` : ""}

Draft the skill playbook for this intent. Output only the markdown — no preamble, no fences around the whole thing.`;

  let raw: string;
  try {
    raw = await llmGenerate(userPrompt, sys, { profile: "synthesis", complexity: "high", maxTokens: 1024 });
  } catch {
    return null;
  }
  raw = raw.trim().replace(/^```(?:markdown|md)?\n?([\s\S]+?)\n?```$/i, "$1").trim();
  // Sanity: the draft must start with `---` (frontmatter) AND contain at
  // least one `##` heading. Otherwise it's not a usable skill.
  if (!raw.startsWith("---") || !raw.includes("##")) return null;

  const { meta } = parseFrontmatter(raw);
  const baseName = String(meta.name ?? `auto-${intentSlug}`).replace(/[^a-zA-Z0-9-_]+/g, "-").toLowerCase().slice(0, 60) || `auto-${intentSlug}`;
  // Always namespace auto-drafted skills with `auto-` so the user can tell
  // them apart from curated ones at a glance.
  const filename = baseName.startsWith("auto-") ? `${baseName}.md` : `auto-${baseName}.md`;
  mkdirSync(SKILLS_USER, { recursive: true });
  const dest = join(SKILLS_USER, filename);
  writeFileSync(dest, raw, "utf8");
  cache.delete(dest);
  return loadSkillFromDisk(dest, "user");
}

// Fetch a remote skill .md (e.g. from GitHub raw, gist, or a curated repo)
// and save it under skills/_user/ so it's available on the next list call.
// Gated by CLAWBOT_REMOTE_SKILLS=1 — by default we refuse remote fetches so
// the user has to opt in to pulling agent guidance from external sources.
export async function fetchRemoteSkill(url: string): Promise<{ saved: string; skill: Skill }> {
  if (process.env.CLAWBOT_REMOTE_SKILLS !== "1") {
    throw new Error("Remote skill fetch is disabled. Set CLAWBOT_REMOTE_SKILLS=1 in .env to allow pulling skill .md files from the internet.");
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Remote skill URL must be http(s): ${url}`);
  }
  // SECURITY: SSRF block — opt-in CLAWBOT_REMOTE_SKILLS=1 doesn't imply
  // "and also reach internal services". Anyone wanting to pull a skill from
  // a private host must additionally set CLAWBOT_WEB_ALLOW_PRIVATE=1.
  const { assertSafePublicUrl } = await import("./security-gates.js");
  assertSafePublicUrl(url);
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`Failed to fetch ${url}: HTTP ${r.status}`);
  const raw = await r.text();
  // Derive a filename from the URL's last segment or the frontmatter name.
  const { meta } = parseFrontmatter(raw);
  let name = String(meta.name ?? "").trim();
  if (!name) {
    const last = url.split("/").pop() ?? "skill.md";
    name = last.replace(/\.md$/i, "");
  }
  // Sanitize — no path traversal, no weird filenames.
  name = name.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "skill";
  mkdirSync(SKILLS_USER, { recursive: true });
  const dest = join(SKILLS_USER, `${name}.md`);
  writeFileSync(dest, raw, "utf8");
  // Drop the cache entry for this path so the next list call re-reads it.
  cache.delete(dest);
  const skill = loadSkillFromDisk(dest, "user");
  if (!skill) throw new Error(`Saved ${dest} but couldn't parse it as a skill`);
  return { saved: dest, skill };
}
