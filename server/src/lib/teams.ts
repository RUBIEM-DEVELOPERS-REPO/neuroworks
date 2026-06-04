// Pre-organized teams + reusable team-brief templates.
//
// A PRE-ORGANIZED TEAM is a named group of personas the user dispatches as a
// unit: pick the team + give one objective, and clawbot fans the objective out
// to each member, framed for their role. Built-in / static.
//
// A TEAM TEMPLATE is a saved, reusable brief — a named set of {persona, task}
// pairs for a recurring multi-persona workflow (e.g. "launch announcement
// pack"). Tasks may contain the placeholder {{objective}}, substituted at
// dispatch. A few are seeded per team; users can add/remove their own
// (persisted to .neuroworks/team-templates.json).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const FILE = join(STATE_DIR, "team-templates.json");

export type TeamMember = { personaId: string; role: string };
export type PreorgTeam = { id: string; name: string; description: string; members: TeamMember[] };

export const BUILTIN_TEAMS: PreorgTeam[] = [
  {
    id: "product-squad",
    name: "Product squad",
    description: "Feature scoping, builds, and releases.",
    members: [
      { personaId: "product-manager", role: "Product Manager" },
      { personaId: "software-engineer", role: "Software Engineer" },
      { personaId: "qa-engineer", role: "QA Engineer" },
      { personaId: "product-designer", role: "Product Designer" },
      { personaId: "devops-sre", role: "DevOps / SRE" },
    ],
  },
  {
    id: "launch-marketing",
    name: "Launch & marketing",
    description: "Launches, campaigns, and announcements.",
    members: [
      { personaId: "marketing-manager", role: "Marketing Manager" },
      { personaId: "aiia-marketing-specialist", role: "AIIA Marketing Specialist" },
      { personaId: "product-manager", role: "Product Manager" },
      { personaId: "product-designer", role: "Product Designer" },
    ],
  },
  {
    id: "insurance-desk",
    name: "Insurance desk",
    description: "Quotes, underwriting, and policy/contract review.",
    members: [
      { personaId: "insurance-sales-agent", role: "Insurance Sales Agent" },
      { personaId: "insurance-underwriter", role: "Insurance Underwriter" },
      { personaId: "contracts-reviewer", role: "Contracts Reviewer" },
      { personaId: "financial-analyst", role: "Financial Analyst" },
    ],
  },
  {
    id: "research-gtm",
    name: "Research & GTM",
    description: "Research pods and go-to-market / deal work.",
    members: [
      { personaId: "researcher", role: "Investigative analyst" },
      { personaId: "data-analyst", role: "Data Analyst" },
      { personaId: "head-of-ai", role: "Head of AI" },
      { personaId: "account-executive", role: "Account Executive" },
      { personaId: "customer-success", role: "Customer Success Lead" },
    ],
  },
];

export function listTeams(): PreorgTeam[] {
  return BUILTIN_TEAMS.slice();
}
export function getTeam(id: string): PreorgTeam | undefined {
  return BUILTIN_TEAMS.find(t => t.id === id);
}

export type TeamTemplateTask = { persona: string; content: string };
export type TeamTemplate = {
  id: string;
  name: string;
  description?: string;
  teamId?: string;            // optional link to a pre-org team
  tasks: TeamTemplateTask[];  // content may contain {{objective}}
  builtin?: boolean;
  createdAt: string;
};

// Seeded templates — one recurring brief per team. {{objective}} is replaced
// with the caller's objective at dispatch (left as a generic prompt if absent).
const SEED_TEMPLATES: TeamTemplate[] = [
  {
    id: "tpl-launch-pack", name: "Launch announcement pack", teamId: "launch-marketing", builtin: true, createdAt: "",
    description: "Coordinated launch assets across marketing, social, positioning, and visuals.",
    tasks: [
      { persona: "marketing-manager", content: "Draft a B2B launch announcement (3-4 crisp bullets, no hype) for: {{objective}}" },
      { persona: "aiia-marketing-specialist", content: "Write 3 short social posts (LinkedIn tone) announcing: {{objective}}" },
      { persona: "product-manager", content: "Write a one-paragraph positioning statement and the top 3 customer benefits for: {{objective}}" },
      { persona: "product-designer", content: "Describe a simple visual/hero concept (layout + key message) for the launch of: {{objective}}" },
    ],
  },
  {
    id: "tpl-feature-kickoff", name: "Feature kickoff", teamId: "product-squad", builtin: true, createdAt: "",
    description: "Problem statement, technical approach, test plan, rollout, and UX for a new feature.",
    tasks: [
      { persona: "product-manager", content: "Write a crisp problem statement and 3 measurable success metrics for: {{objective}}" },
      { persona: "software-engineer", content: "Sketch a technical approach (key components, data flow, 3 edge cases) for: {{objective}}" },
      { persona: "qa-engineer", content: "Write 6 test cases (Gherkin style, incl. 2 edge cases) for: {{objective}}" },
      { persona: "devops-sre", content: "Outline a rollout + rollback runbook (5 ordered steps) for shipping: {{objective}}" },
      { persona: "product-designer", content: "Outline the core UX flow (key screens + states) for: {{objective}}" },
    ],
  },
  {
    id: "tpl-policy-review", name: "New policy review", teamId: "insurance-desk", builtin: true, createdAt: "",
    description: "Underwriting risk, sales angle, contract clauses, and pricing for a policy.",
    tasks: [
      { persona: "insurance-underwriter", content: "Assess the key underwriting risks and required information for: {{objective}}" },
      { persona: "insurance-sales-agent", content: "Draft a concise customer-facing pitch and 3 FAQs for: {{objective}}" },
      { persona: "contracts-reviewer", content: "List the 5 clauses to check first and what a red flag looks like in each, for: {{objective}}" },
      { persona: "financial-analyst", content: "Outline a simple pricing/margin model and the key assumptions for: {{objective}}" },
    ],
  },
  {
    id: "tpl-market-scan", name: "Market scan", teamId: "research-gtm", builtin: true, createdAt: "",
    description: "Landscape, metrics, AI implications, opportunities, and retention angle.",
    tasks: [
      { persona: "researcher", content: "Summarize the current landscape and 3 key players for: {{objective}} (cite sources)" },
      { persona: "data-analyst", content: "Propose the 3 metrics you'd track and how you'd measure them for: {{objective}}" },
      { persona: "head-of-ai", content: "Assess the AI implications and 2 build-vs-buy considerations for: {{objective}}" },
      { persona: "account-executive", content: "Identify the top 3 sales opportunities and the ideal customer profile for: {{objective}}" },
      { persona: "customer-success", content: "Note the main retention/adoption risks and one mitigation each for: {{objective}}" },
    ],
  },
];

type Store = { templates: TeamTemplate[] };
let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(FILE)) {
    cache = { templates: [] };
    persist();
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8"));
    cache = { templates: Array.isArray(parsed.templates) ? parsed.templates : [] };
  } catch (e) {
    console.warn(`[teams] failed to read ${FILE}: ${(e as Error).message}. Starting empty.`);
    cache = { templates: [] };
  }
  return cache;
}

function persist() {
  if (!cache) return;
  try { writeFileSync(FILE, JSON.stringify(cache, null, 2)); }
  catch (e) { console.warn(`[teams] persist failed: ${(e as Error).message}`); }
}

// Built-in seeds first, then the user's saved templates.
export function listTeamTemplates(): TeamTemplate[] {
  return [...SEED_TEMPLATES, ...load().templates];
}

export function getTeamTemplate(id: string): TeamTemplate | undefined {
  return listTeamTemplates().find(t => t.id === id);
}

export function createTeamTemplate(input: { name: string; description?: string; teamId?: string; tasks: TeamTemplateTask[] }): TeamTemplate {
  const s = load();
  const tpl: TeamTemplate = {
    id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    description: input.description,
    teamId: input.teamId,
    tasks: input.tasks,
    createdAt: new Date().toISOString(),
  };
  s.templates.push(tpl);
  persist();
  return tpl;
}

export function deleteTeamTemplate(id: string): boolean {
  const s = load();
  const before = s.templates.length;
  s.templates = s.templates.filter(t => t.id !== id);
  if (s.templates.length === before) return false;
  persist();
  return true;
}

// Expand a pre-org team + objective into per-member tasks, each framed for the
// member's role so they contribute their slice rather than duplicating work.
export function buildTasksForTeam(teamId: string, objective: string): TeamTemplateTask[] {
  const team = getTeam(teamId);
  if (!team) return [];
  const obj = objective.trim();
  return team.members.map(m => ({
    persona: m.personaId,
    content: `${obj}\n\n(Contribute the part that fits your role as ${m.role}. Produce your slice of this objective; assume teammates cover the rest.)`,
  }));
}

// Expand a team template into tasks, substituting {{objective}} when provided.
export function buildTasksForTemplate(templateId: string, objective?: string): TeamTemplateTask[] {
  const tpl = getTeamTemplate(templateId);
  if (!tpl) return [];
  const obj = (objective ?? "").trim();
  return tpl.tasks.map(t => ({
    persona: t.persona,
    content: obj ? t.content.replace(/\{\{\s*objective\s*\}\}/gi, obj) : t.content.replace(/\{\{\s*objective\s*\}\}/gi, "the stated objective"),
  }));
}
