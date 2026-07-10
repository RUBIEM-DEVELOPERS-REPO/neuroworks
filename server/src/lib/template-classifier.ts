// Runtime classifier for custom templates.
//
// Custom templates are persisted with role: "Custom" because at save time we
// didn't know which lane they should live in. This module derives the right
// lane on read by looking at three signals (in priority order):
//
//   1. The persona-id prefix in the template id (e.g. custom-financial-analyst-*
//      → financial-analyst → "Insights"). Most accurate when present.
//   2. Topic keywords in the title and description ("MEDDIC" → sales/Ops,
//      "runbook" → Engineering, "PRD" → Insights). Catches templates whose
//      ids don't carry a persona prefix.
//   3. Fallback to "Custom" so the user can still find untagged saves.
//
// Cheap (regex only, no LLM) so it's safe to run on every /api/templates GET.

export type TemplateRole = "Engineering" | "Knowledge" | "Operations" | "Insights" | "Custom";

// Map known built-in persona-ids to their natural template lane. Extended over
// time as new personas appear. Personas not in this map fall through to the
// keyword pass.
const PERSONA_ID_TO_ROLE: Record<string, TemplateRole> = {
  // Engineering lane
  "software-engineer": "Engineering",
  "devops-sre": "Engineering",
  "qa-engineer": "Engineering",
  "head-of-ai": "Engineering",

  // Knowledge lane (writing, docs, research)
  "technical-writer": "Knowledge",
  "researcher": "Knowledge",

  // Operations lane (admin, coordination, customer-facing ops, legal review)
  "operations-coordinator": "Operations",
  "executive-assistant": "Operations",
  "recruiter": "Operations",
  "contracts-reviewer": "Operations",
  "customer-success": "Operations",
  "account-executive": "Operations",
  "insurance-sales-agent": "Operations",
  "insurance-underwriter": "Operations",

  // Insights lane (analysis, strategy, design, finance)
  "financial-analyst": "Insights",
  "data-analyst": "Insights",
  "product-manager": "Insights",
  "designer": "Insights",
  "marketing-manager": "Insights",
  "aiia-marketing-specialist": "Insights",
  "aiia-marketing-specialist-v2": "Insights",

  // Meta / unattributed
  "clawbot": "Custom",
  "knowitall": "Custom",
};

// Topic keyword → role, used when the persona-id prefix doesn't resolve.
// Patterns are case-insensitive. First match wins, so more specific patterns
// (multi-word phrases) appear before single-word ones.
const KEYWORD_TO_ROLE: { re: RegExp; role: TemplateRole }[] = [
  // Engineering
  { re: /\b(runbook|incident|postmortem|on[- ]?call|observability|SLO|telemetry|CI\/CD|deploy(?:ment)?|IaC|terraform|kubernetes|k8s|kafka)\b/i, role: "Engineering" },
  { re: /\b(code review|pull request|PR review|merge request|test plan|unit test|regression|repro|bug repro)\b/i, role: "Engineering" },
  { re: /\b(API|endpoint|schema|migration|database|backend|frontend|architecture|refactor)\b/i, role: "Engineering" },
  // Knowledge
  { re: /\b(documentation|reference docs?|tutorial|how[- ]?to|getting started|knowledge base|KB article|explain|distill)\b/i, role: "Knowledge" },
  { re: /\b(research|investigate|multiperspective|deep dive|literature review|background|context)\b/i, role: "Knowledge" },
  { re: /\b(summarize|summary|recap|digest|tldr|bottom line)\b/i, role: "Knowledge" },
  // Operations
  { re: /\b(MEDDIC|discovery call|sales call|pipeline|quote|proposal|MSA|NDA|SOW|contract|redline)\b/i, role: "Operations" },
  { re: /\b(invoice|reconciliation|expense|vendor|procurement|policy|compliance|SOC[- ]?2|GDPR|HIPAA|audit)\b/i, role: "Operations" },
  { re: /\b(customer (?:reply|email|complaint|message|outreach)|support ticket|ticket triage|case (?:management|escalation))\b/i, role: "Operations" },
  { re: /\b(calendar|schedule|meeting (?:notes?|brief)|agenda|onboarding|offboarding|JD|job description|interview loop|resume screen)\b/i, role: "Operations" },
  { re: /\b(insurance|underwriting|claim|premium|broker)\b/i, role: "Operations" },
  // Insights
  { re: /\b(PRD|product (?:requirements?|spec)|RICE|ICE|kano|jobs[- ]?to[- ]?be[- ]?done|JTBD)\b/i, role: "Insights" },
  { re: /\b(forecast|variance|scenario|unit economics|CAC|LTV|payback|board pack|board deck|one[- ]?pager|exec summary)\b/i, role: "Insights" },
  { re: /\b(positioning|messaging|campaign|launch (?:plan|brief|story)|persona research|competitive|GTM|go[- ]?to[- ]?market)\b/i, role: "Insights" },
  { re: /\b(data analysis|dashboard|metric|KPI|cohort|funnel|retention|churn analysis|segment)\b/i, role: "Insights" },
  { re: /\b(wireframe|user flow|UX|UI|prototype|usability|interaction design)\b/i, role: "Insights" },
];

// Strip the "custom-" prefix from a template id and try to recognise a
// persona-id at the start. The slug format is custom-<slug-of-task>, where
// the task often begins with the persona-id (because the chat handler tags
// the saved task with the active persona). We try increasingly long prefixes
// to match multi-word persona ids like "software-engineer".
function extractPersonaIdFromTemplateId(id: string): string | null {
  if (!id.startsWith("custom-")) return null;
  const rest = id.slice("custom-".length);
  const parts = rest.split("-");
  // Try longest prefix first so "software-engineer" beats "software".
  for (let length = Math.min(parts.length, 5); length > 0; length--) {
    const candidate = parts.slice(0, length).join("-");
    if (PERSONA_ID_TO_ROLE[candidate]) return candidate;
  }
  return null;
}

export function classifyCustomTemplate(t: { id: string; title?: string; description?: string }): TemplateRole {
  // Pass 1: persona-id prefix in template id.
  const personaId = extractPersonaIdFromTemplateId(t.id);
  if (personaId && PERSONA_ID_TO_ROLE[personaId]) return PERSONA_ID_TO_ROLE[personaId];

  // Pass 2: keyword scan across id, title, description.
  const haystack = `${t.id} ${t.title ?? ""} ${t.description ?? ""}`;
  for (const { re, role } of KEYWORD_TO_ROLE) {
    if (re.test(haystack)) return role;
  }

  // Nothing matched, leave as Custom.
  return "Custom";
}
