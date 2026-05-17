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

// Compact one-line render for the planner's prompt catalog ("you have these
// skills available: …"). Avoids dumping every skill body.
export function skillsCatalog(): string {
  const all = listSkills();
  if (all.length === 0) return "No skills installed.";
  return all.map(s => `- ${s.name}: ${s.description}`).join("\n");
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
