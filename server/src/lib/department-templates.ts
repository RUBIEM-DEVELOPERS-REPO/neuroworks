// Pre-configured department bundles. Each bundle defines the persona(s),
// starter templates, recommended integrations, and workflows for a department.
// Applying a department template creates the personas and templates in one step.

export type DepartmentTemplateStep = {
  persona: string;         // persona role name
  task: string;            // what this agent does in the workflow
};

export type DepartmentTemplate = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  color: string;           // tailwind color class
  agents: {
    name: string;
    role: string;
    jobDescription: string;
    tone?: string;
  }[];
  recommendedIntegrations: string[];
  recommendedTemplates: string[];
  schedule?: {             // optional daily briefing
    name: string;
    templateId: string;
    cadence: { daysOfWeek: number[]; hour: number; minute: number };
  };
  workflow: DepartmentTemplateStep[];  // handoff chain
};

export const DEPARTMENT_TEMPLATES: DepartmentTemplate[] = [
  {
    id: "it-devops",
    name: "IT & DevOps",
    tagline: "Infrastructure monitoring, GitHub automation, deployment workflows",
    description: "A complete IT department: monitor repos, triage issues, run deployments, and keep the engineering team aligned. Includes a daily digest of all project activity.",
    icon: "Terminal",
    color: "violet",
    agents: [
      {
        name: "DevOps Engineer",
        role: "Engineering",
        jobDescription: "Monitor GitHub repos for new issues, PRs, and commits. Triage incoming issues by priority. Run deployment workflows and flag failures. Summarize weekly engineering velocity.",
        tone: "technical, precise, actionable",
      },
    ],
    recommendedIntegrations: ["slack", "github"],
    recommendedTemplates: ["summarize-repo", "run-digest", "publish-folder"],
    schedule: {
      name: "Daily engineering digest",
      templateId: "run-digest",
      cadence: { daysOfWeek: [1, 2, 3, 4, 5], hour: 8, minute: 0 },
    },
    workflow: [
      { persona: "DevOps Engineer", task: "Scan all repos for new activity and summarize" },
      { persona: "DevOps Engineer", task: "Triage open issues by severity and label" },
      { persona: "DevOps Engineer", task: "Deploy pending changes and report status" },
    ],
  },
  {
    id: "marketing",
    name: "Marketing & Comms",
    tagline: "Content creation, social media monitoring, brand compliance",
    description: "Marketing team that drafts content, monitors brand mentions, enforces brand voice guidelines, and produces weekly performance reports.",
    icon: "Megaphone",
    color: "coral",
    agents: [
      {
        name: "Content Strategist",
        role: "Knowledge",
        jobDescription: "Draft blog posts, social media content, and newsletters. Research industry trends and competitors. Ensure all content follows brand voice guidelines. Produce weekly content performance reports.",
        tone: "engaging, professional, on-brand",
      },
    ],
    recommendedIntegrations: ["slack", "google", "webhook"],
    recommendedTemplates: ["search-brain", "add-note", "daily-briefing"],
    schedule: {
      name: "Weekly content report",
      templateId: "daily-briefing",
      cadence: { daysOfWeek: [5], hour: 16, minute: 0 },
    },
    workflow: [
      { persona: "Content Strategist", task: "Research trending topics in the industry" },
      { persona: "Content Strategist", task: "Draft content aligned with brand voice" },
      { persona: "Content Strategist", task: "Review for brand compliance and publish" },
    ],
  },
  {
    id: "sales",
    name: "Sales & CRM",
    tagline: "Lead qualification, pipeline tracking, follow-up automation",
    description: "Sales team that qualifies leads, updates CRM records, drafts follow-up emails, and generates weekly pipeline reports. Integrates with HubSpot and Google.",
    icon: "TrendingUp",
    color: "green",
    agents: [
      {
        name: "Sales Analyst",
        role: "Operations",
        jobDescription: "Qualify incoming leads from CRM. Update deal stages and contact records. Draft personalized follow-up emails. Generate weekly pipeline reports with win/loss analysis.",
        tone: "professional, persuasive, concise",
      },
    ],
    recommendedIntegrations: ["hubspot", "google", "slack"],
    recommendedTemplates: ["daily-briefing", "search-brain"],
    schedule: {
      name: "Weekly pipeline report",
      templateId: "daily-briefing",
      cadence: { daysOfWeek: [1], hour: 9, minute: 0 },
    },
    workflow: [
      { persona: "Sales Analyst", task: "Review new leads and qualify by priority" },
      { persona: "Sales Analyst", task: "Update deal stages in CRM" },
      { persona: "Sales Analyst", task: "Draft follow-up sequence for warm leads" },
    ],
  },
  {
    id: "hr",
    name: "HR & People Ops",
    tagline: "Employee onboarding, policy management, HR compliance",
    description: "HR team that manages employee records, drafts policies, handles onboarding documentation, and ensures HR compliance with labor regulations.",
    icon: "Users",
    color: "blue",
    agents: [
      {
        name: "HR Coordinator",
        role: "Operations",
        jobDescription: "Manage employee records and onboarding documentation. Draft and update HR policies. Track leave balances and compliance training. Generate headcount reports.",
        tone: "empathetic, professional, clear",
      },
    ],
    recommendedIntegrations: ["google", "slack"],
    recommendedTemplates: ["add-note", "search-brain", "daily-briefing"],
    workflow: [
      { persona: "HR Coordinator", task: "Process new employee onboarding documents" },
      { persona: "HR Coordinator", task: "Review and update HR policies for compliance" },
      { persona: "HR Coordinator", task: "Generate monthly headcount and leave report" },
    ],
  },
  {
    id: "finance",
    name: "Finance & Accounting",
    tagline: "Expense tracking, financial reporting, budget monitoring",
    description: "Finance team that tracks expenses, monitors budgets, generates financial reports, and flags anomalies. Connects to company data sources for live financial querying.",
    icon: "CreditCard",
    color: "amber",
    agents: [
      {
        name: "Financial Analyst",
        role: "Operations",
        jobDescription: "Monitor expenses against budgets. Generate weekly financial summaries. Flag unusual transactions. Prepare month-end reports. Query financial data sources for live numbers.",
        tone: "precise, detail-oriented, conservative",
      },
    ],
    recommendedIntegrations: ["google", "webhook"],
    recommendedTemplates: ["daily-briefing", "search-brain"],
    schedule: {
      name: "Weekly finance summary",
      templateId: "daily-briefing",
      cadence: { daysOfWeek: [1], hour: 7, minute: 30 },
    },
    workflow: [
      { persona: "Financial Analyst", task: "Review expenses and flag anomalies" },
      { persona: "Financial Analyst", task: "Update budget vs actuals report" },
      { persona: "Financial Analyst", task: "Prepare weekly financial summary" },
    ],
  },
  {
    id: "legal",
    name: "Legal & Compliance",
    tagline: "Contract review, compliance monitoring, policy drafting",
    description: "Legal team that reviews contracts, monitors regulatory compliance, drafts policies, and manages risk assessments. Integrates with governance guardrails.",
    icon: "Scale",
    color: "purple",
    agents: [
      {
        name: "Legal Counsel",
        role: "Insights",
        jobDescription: "Review contracts and agreements for compliance risks. Monitor regulatory changes relevant to the business. Draft policies and standard clauses. Conduct compliance assessments of new initiatives.",
        tone: "precise, authoritative, risk-aware",
      },
    ],
    recommendedIntegrations: ["google", "webhook"],
    recommendedTemplates: ["search-brain", "add-note", "daily-briefing"],
    workflow: [
      { persona: "Legal Counsel", task: "Review documents for compliance risks" },
      { persona: "Legal Counsel", task: "Research regulatory requirements for new initiative" },
      { persona: "Legal Counsel", task: "Draft compliance assessment report" },
    ],
  },
  {
    id: "customer-support",
    name: "Customer Support",
    tagline: "Ticket triage, response drafting, satisfaction tracking",
    description: "Support team that triages incoming tickets, drafts responses, tracks resolution SLAs, and monitors customer satisfaction trends.",
    icon: "Headphones",
    color: "teal",
    agents: [
      {
        name: "Support Agent",
        role: "Operations",
        jobDescription: "Triage incoming support tickets by urgency and category. Draft response templates for common issues. Track resolution times against SLAs. Summarize weekly support trends and escalation patterns.",
        tone: "helpful, patient, solution-focused",
      },
    ],
    recommendedIntegrations: ["slack", "google"],
    recommendedTemplates: ["daily-briefing"],
    workflow: [
      { persona: "Support Agent", task: "Triage new tickets and prioritize" },
      { persona: "Support Agent", task: "Draft responses for pending tickets" },
      { persona: "Support Agent", task: "Generate weekly support metrics report" },
    ],
  },
  {
    id: "operations",
    name: "Operations & Admin",
    tagline: "Process automation, reporting, vendor management",
    description: "Operations team that automates recurring processes, manages vendor relationships, generates operational reports, and keeps the business running smoothly.",
    icon: "Settings",
    color: "slate",
    agents: [
      {
        name: "Operations Manager",
        role: "Operations",
        jobDescription: "Automate recurring operational processes. Track vendor contracts and renewals. Generate daily operations status reports. Monitor key operational metrics and flag deviations.",
        tone: "efficient, systematic, proactive",
      },
    ],
    recommendedIntegrations: ["slack", "google", "webhook"],
    recommendedTemplates: ["daily-briefing", "run-digest", "search-brain"],
    schedule: {
      name: "Daily ops briefing",
      templateId: "daily-briefing",
      cadence: { daysOfWeek: [1, 2, 3, 4, 5], hour: 7, minute: 0 },
    },
    workflow: [
      { persona: "Operations Manager", task: "Review overnight alerts and system status" },
      { persona: "Operations Manager", task: "Check vendor deliverables against SLAs" },
      { persona: "Operations Manager", task: "Publish daily operations status report" },
    ],
  },
];

export function listDepartmentTemplates(): DepartmentTemplate[] {
  return DEPARTMENT_TEMPLATES;
}

export function getDepartmentTemplate(id: string): DepartmentTemplate | undefined {
  return DEPARTMENT_TEMPLATES.find(d => d.id === id);
}

export function applyDepartmentTemplate(id: string): { template: DepartmentTemplate; personas: { name: string; role: string }[] } {
  const tpl = getDepartmentTemplate(id);
  if (!tpl) throw new Error(`unknown department template "${id}"`);
  const personas = tpl.agents.map(a => ({ name: a.name, role: a.role }));
  return { template: tpl, personas };
}
