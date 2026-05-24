import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plan } from "./agent.js";
import { journal } from "./journal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Persist outside the vault and outside the source tree — survives reinstalls.
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const FILE = join(STATE_DIR, "custom-templates.json");

export type CustomTemplate = {
  id: string;            // custom-<slug>
  role: "Custom";
  title: string;
  description: string;
  origin: { task: string; createdAt: string };
  plan: Plan;            // the verified plan to re-run
  runCount: number;
  lastRunAt?: string;
};

let cache: CustomTemplate[] | null = null;
let cacheMtime: number = 0;

export function loadCustomTemplates(): CustomTemplate[] {
  if (!existsSync(FILE)) {
    if (!cache) cache = [];
    return cache;
  }
  // Re-read when the file's mtime advances since our cache was set. Lets
  // out-of-band seeders (e.g. _seed-employee-templates.mjs) refresh the
  // registry without a server restart. Without this we'd have to bounce
  // tsx every time the customs file grew.
  try {
    const mt = statSync(FILE).mtimeMs;
    if (cache && mt === cacheMtime) return cache;
    const data = JSON.parse(readFileSync(FILE, "utf8")) as CustomTemplate[];
    cache = Array.isArray(data) ? data : [];
    cacheMtime = mt;
  } catch { if (!cache) cache = []; }
  return cache;
}

export function saveCustomTemplate(t: CustomTemplate): void {
  const all = loadCustomTemplates();
  const existing = all.findIndex(x => x.id === t.id);
  if (existing >= 0) all[existing] = t;
  else all.push(t);
  persist(all);
  void journal({
    kind: "template",
    slug: t.id,
    title: `${t.title} (${t.id})`,
    frontmatter: { templateId: t.id, role: t.role, originTask: t.origin.task },
    body: [
      `${t.description}`,
      "",
      `**Origin task:** ${t.origin.task}`,
      "",
      `## Saved plan`,
      "",
      "```json",
      JSON.stringify(t.plan, null, 2),
      "```",
    ].join("\n"),
  });
}

export function bumpRunCount(id: string): void {
  const all = loadCustomTemplates();
  const t = all.find(x => x.id === id);
  if (!t) return;
  t.runCount = (t.runCount ?? 0) + 1;
  t.lastRunAt = new Date().toISOString();
  persist(all);
}

export function findCustomTemplate(id: string): CustomTemplate | undefined {
  return loadCustomTemplates().find(t => t.id === id);
}

export function deleteCustomTemplate(id: string): boolean {
  const all = loadCustomTemplates();
  const idx = all.findIndex(t => t.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  persist(all);
  return true;
}

function persist(list: CustomTemplate[]): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(list, null, 2), "utf8");
  cache = list;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "task";
}
