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
    // Per-agent language pin — falls back to defaultLanguage below when
    // unset. Both are optional: a department with neither set produces
    // agents that follow the org-wide onboarding language (unchanged
    // default behavior for every existing template).
    language?: "en" | "sn" | "nd";
  }[];
  // Department-level default language new agents inherit unless they set
  // their own `language` above.
  defaultLanguage?: "en" | "sn" | "nd";
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
    name: "Customer Service",
    tagline: "Ticket triage, response drafting, satisfaction tracking",
    description: "Support team that triages incoming tickets, drafts responses, tracks resolution SLAs, and monitors customer satisfaction trends. Both agents can be pinned to Shona or Ndebele independently (Personas page) for a local-language support desk.",
    icon: "Headphones",
    color: "teal",
    agents: [
      {
        name: "Ticket Responder",
        role: "Operations",
        jobDescription: "Triage incoming support tickets by urgency and category. Draft customer-facing responses that resolve the underlying issue, not just the surface complaint. Match the customer's tone — acknowledge frustration before troubleshooting.",
        tone: "helpful, patient, solution-focused",
      },
      {
        name: "Support Summariser",
        role: "Operations",
        jobDescription: "Track resolution times against SLAs. Summarize weekly support trends, recurring issues, and escalation patterns into a digest for the team lead.",
        tone: "concise, pattern-focused, actionable",
      },
    ],
    recommendedIntegrations: ["slack", "google"],
    recommendedTemplates: ["daily-briefing"],
    workflow: [
      { persona: "Ticket Responder", task: "Triage new tickets and prioritize" },
      { persona: "Ticket Responder", task: "Draft responses for pending tickets" },
      { persona: "Support Summariser", task: "Generate weekly support metrics report" },
    ],
  },
  {
    id: "communications",
    name: "Communications",
    tagline: "Press releases, announcements, media & inbound response",
    description: "Communications team that drafts press releases and announcements, monitors and responds to media/public inquiries, and keeps messaging consistent under normal operations and during a crisis.",
    icon: "Megaphone",
    color: "coral",
    agents: [
      {
        name: "Comms Writer",
        role: "Knowledge",
        jobDescription: "Draft press releases, announcements, and public statements. Keep messaging consistent with brand voice and, where relevant, crisis-communications guidelines. Prepare statements ahead of known sensitive dates or events.",
        tone: "clear, on-message, calm under pressure",
      },
      {
        name: "Comms Responder",
        role: "Knowledge",
        jobDescription: "Monitor and respond to media and public inquiries. Route sensitive or high-risk questions for human review rather than answering them directly. Log inbound requests and their outcomes.",
        tone: "measured, accurate, non-committal on anything unconfirmed",
      },
    ],
    recommendedIntegrations: ["slack", "google", "webhook"],
    recommendedTemplates: ["daily-briefing"],
    workflow: [
      { persona: "Comms Writer", task: "Draft a release or statement for a pending announcement" },
      { persona: "Comms Responder", task: "Triage and respond to inbound media/public inquiries" },
      { persona: "Comms Writer", task: "Review outgoing statements for consistency before publishing" },
    ],
  },
  {
    id: "grant-writing",
    name: "Grant Writing",
    tagline: "Donor proposals, program reports, funder-ready summaries",
    description: "Grant writing team for NGOs and development-sector organizations: drafts funding proposals, writes quarterly donor reports, and summarizes program/M&E data into funder-ready narrative. Pairs naturally with the NGO & Civil Society sector.",
    icon: "HandHeart",
    color: "green",
    agents: [
      {
        name: "Grant Writer",
        role: "Knowledge",
        jobDescription: "Draft funding proposals and letters of inquiry against a donor's stated priorities and format requirements. Translate program activities into the outcomes language funders expect.",
        tone: "persuasive, evidence-led, funder-aware",
      },
      {
        name: "Donor Report Writer",
        role: "Knowledge",
        jobDescription: "Write quarterly and end-of-grant narrative reports pairing program activities with verifiable indicators. Flag any indicator that's off-track early rather than at report deadline.",
        tone: "precise, indicator-anchored, honest about gaps",
      },
      {
        name: "Program Summariser",
        role: "Knowledge",
        jobDescription: "Summarize beneficiary tracking and M&E data into short digests the Grant Writer and Donor Report Writer can draw on, so every proposal and report is grounded in current program numbers.",
        tone: "concise, numbers-first, current",
      },
    ],
    recommendedIntegrations: ["slack", "google"],
    recommendedTemplates: ["daily-briefing", "research-deep"],
    workflow: [
      { persona: "Program Summariser", task: "Digest current program/M&E data" },
      { persona: "Grant Writer", task: "Draft a funding proposal against a donor's priorities" },
      { persona: "Donor Report Writer", task: "Write the quarterly donor narrative report" },
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
