// Role Presets — one-click "hire a worker" bundles, the jarvis `init --preset`
// idea applied to NeuroWorks. Each preset wires up a complete role in a single
// action: it activates the matching built-in persona, makes sure that persona's
// starter templates exist, optionally stands up a recurring schedule (e.g. a
// morning briefing emailed to the user), and surfaces which integrations + skills
// that role leans on so the user knows what to connect next.
//
// Everything a preset touches already exists as its own subsystem (personas,
// persona-templates, schedules, integrations, skills) — a preset is just a
// curated composition over them, so there's no new persistence here.

import { loadPersonas, setActivePersona, type Persona } from "./personas.js";
import { refreshPersonaTemplates, buildStarterTemplates } from "./persona-templates.js";
import { listPersonaTemplates } from "./persona-templates.js";
import { createSchedule, type Cadence, type ScheduleDelivery } from "./schedules.js";

// A schedule a preset can stand up. cadence is the friendly day/time shape the
// scheduler already understands; templateId is what it runs.
export type PresetSchedule = {
  name: string;
  templateId: string;
  inputs?: Record<string, unknown>;
  cadence: Cadence;
  // When true, the apply call's `deliverEmail` (if supplied) is attached so the
  // result is emailed the moment the job finishes.
  emailResult?: boolean;
};

export type Preset = {
  id: string;
  name: string;            // display name, e.g. "Executive Assistant"
  tagline: string;         // one-line "what you get"
  personaId: string;       // built-in persona this preset activates
  recommendedSkills: string[];       // skill slugs this role leans on
  recommendedIntegrations: string[]; // integration provider ids to connect
  schedules?: PresetSchedule[];      // recurring jobs to optionally create
};

// Friendly cadence helpers.
const weekdaysAt = (hour: number, minute = 0): Cadence => ({ daysOfWeek: [1, 2, 3, 4, 5], hour, minute });
const everyDayAt = (hour: number, minute = 0): Cadence => ({ daysOfWeek: [], hour, minute });
const mondayAt = (hour: number, minute = 0): Cadence => ({ daysOfWeek: [1], hour, minute });

export const PRESETS: Preset[] = [
  {
    id: "exec-assistant",
    name: "Executive Assistant",
    tagline: "Protects your time — morning briefing, inbox triage, meeting prep.",
    personaId: "executive-assistant",
    recommendedSkills: ["daily-briefing", "email-triage", "meeting-prep-pack", "pre-read", "eod-handoff"],
    recommendedIntegrations: ["google", "slack"],
    schedules: [
      { name: "Morning briefing", templateId: "daily-briefing", cadence: weekdaysAt(8), emailResult: true },
    ],
  },
  {
    id: "sales-sdr",
    name: "Sales SDR",
    tagline: "Runs the pipeline — qualification, follow-ups, discovery prep.",
    personaId: "account-executive",
    recommendedSkills: ["lead-qualification", "meddic-qualification", "follow-up-cadence", "discovery-call-prep", "objection-handling-script"],
    recommendedIntegrations: ["hubspot", "google", "slack"],
    schedules: [
      { name: "Pipeline review", templateId: "daily-briefing", inputs: { focus: "sales pipeline and follow-ups due" }, cadence: weekdaysAt(8, 30), emailResult: true },
    ],
  },
  {
    id: "support-desk",
    name: "Support Desk",
    tagline: "Handles customers — triage, replies that resolve, churn signals.",
    personaId: "customer-success",
    recommendedSkills: ["email-triage", "support-escalation", "churn-risk-flag", "customer-360", "renewal-conversation"],
    recommendedIntegrations: ["google", "slack", "hubspot"],
    schedules: [
      { name: "Support themes roundup", templateId: "daily-briefing", inputs: { focus: "open customer issues and recurring support themes" }, cadence: weekdaysAt(9), emailResult: true },
    ],
  },
  {
    id: "recruiter",
    name: "Recruiter",
    tagline: "Fills roles — JD writing, CV screening, candidate comms.",
    personaId: "recruiter",
    recommendedSkills: ["jd-writing", "cv-screening", "jd-to-tasks", "intro-email", "decline-politely"],
    recommendedIntegrations: ["google", "linkedin", "slack"],
  },
  {
    id: "research-analyst",
    name: "Research Analyst",
    tagline: "Investigates anything — multi-perspective, cited, captured to vault.",
    personaId: "researcher",
    recommendedSkills: ["research-deep", "fact-check", "source-triangulation", "landscape-scan", "competitive-analysis"],
    recommendedIntegrations: ["notion", "slack"],
  },
  {
    id: "ops-coordinator",
    name: "Operations Coordinator",
    tagline: "Removes ambiguity — runbooks, schedules, status rollups.",
    personaId: "operations-coordinator",
    recommendedSkills: ["runbook-writing", "sop-writing", "project-status-rollup", "risk-register", "standup-summary"],
    recommendedIntegrations: ["slack", "msteams", "webhook"],
    schedules: [
      { name: "Weekly status rollup", templateId: "daily-briefing", inputs: { focus: "project status, blockers, and what's due this week" }, cadence: mondayAt(9), emailResult: true },
    ],
  },
  {
    id: "content-studio",
    name: "Content Studio",
    tagline: "Makes media — script, voiceover, video, and music from one brief.",
    personaId: "multimedia-producer",
    recommendedSkills: ["multimedia-package", "voiceover-script", "video-prompt", "music-brief", "launch-positioning"],
    recommendedIntegrations: ["slack", "google"],
  },
  {
    id: "engineer",
    name: "Software Engineer",
    tagline: "Ships fixes — code review, bug investigation, trade-off memos.",
    personaId: "software-engineer",
    recommendedSkills: ["code-review", "debugging-help", "root-cause-analysis", "testing-strategy", "release-notes-from-commits"],
    recommendedIntegrations: ["github", "slack", "jira"],
  },
];

export function listPresets(): Preset[] {
  return PRESETS.slice();
}

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find(p => p.id === id);
}

export type ApplyResult = {
  preset: Preset;
  persona: { id: string; name: string; role: string };
  templatesEnsured: number;
  schedulesCreated: { id: string; name: string; emailTo?: string }[];
  missingIntegrations: string[];   // recommended providers not yet connected
};

// Apply a preset: activate the persona, ensure its templates, stand up any
// schedules (attaching email delivery when requested + an address is given),
// and report which recommended integrations still need connecting. Idempotent
// on the persona/templates; schedules are additive (calling twice makes two).
export async function applyPreset(
  presetId: string,
  opts: { deliverEmail?: string; createSchedules?: boolean } = {},
): Promise<ApplyResult> {
  const preset = getPreset(presetId);
  if (!preset) throw new Error(`unknown preset: ${presetId}`);

  // 1. Resolve + activate the persona.
  const store = loadPersonas();
  const persona: Persona | undefined = store.personas.find(p => p.id === preset.personaId);
  if (!persona) throw new Error(`preset "${presetId}" references missing persona "${preset.personaId}"`);
  setActivePersona(persona.id);

  // 2. Ensure starter templates exist for that persona.
  let templatesEnsured = listPersonaTemplates(persona.id).length;
  if (templatesEnsured === 0) {
    try {
      const r = refreshPersonaTemplates(persona);
      templatesEnsured = r.kept + r.added;
    } catch {
      templatesEnsured = buildStarterTemplates(persona).length; // best-effort count
    }
  }

  // 3. Schedules — opt-in (default on). Attach email delivery when the schedule
  //    asks for it AND the caller supplied an address.
  const schedulesCreated: ApplyResult["schedulesCreated"] = [];
  const wantSchedules = opts.createSchedules !== false;
  if (wantSchedules && preset.schedules?.length) {
    for (const spec of preset.schedules) {
      const deliver: ScheduleDelivery | undefined =
        spec.emailResult && opts.deliverEmail ? { email: opts.deliverEmail } : undefined;
      const created = createSchedule({
        name: spec.name,
        templateId: spec.templateId,
        inputs: spec.inputs ?? {},
        cadence: spec.cadence,
        enabled: true,
        deliver,
      });
      schedulesCreated.push({ id: created.id, name: created.name, emailTo: deliver?.email });
    }
  }

  // 4. Which recommended integrations are not connected yet.
  let connectedProviders = new Set<string>();
  try {
    const { listConnections } = await import("./integrations.js");
    connectedProviders = new Set(listConnections().map((c: any) => c.providerId));
  } catch { /* integrations optional — treat all as missing */ }
  const missingIntegrations = preset.recommendedIntegrations.filter(p => !connectedProviders.has(p));

  return {
    preset,
    persona: { id: persona.id, name: persona.name, role: persona.role },
    templatesEnsured,
    schedulesCreated,
    missingIntegrations,
  };
}

// Keep the unused helper referenced so tree-shakers/linters don't complain when
// a preset doesn't use it.
void everyDayAt;
