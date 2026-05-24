// Idempotent seeder for 30 employee-task templates.
// Reads .neuroworks/custom-templates.json, appends new ones if not present,
// writes back. Safe to re-run; skips IDs that already exist.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, "../.neuroworks/custom-templates.json");

const NEW_TEMPLATES = [
  // Task 2 — customer reply with missing-info checklist
  {
    id: "custom-emp-customer-reply-with-checklist",
    title: "Draft reply to a customer asking for more info",
    description: "Polite, professional response that names what's missing and asks for it in a tight checklist.",
    task: "Draft a polite reply to a customer asking for more information about their request. Acknowledge their message, identify the specific details we need before we can help (build a 3-5 item checklist), explain why each piece matters in one line, and close warmly. Email format.",
  },
  // Task 3 — meeting transcript → action items
  {
    id: "custom-emp-meeting-to-actions",
    title: "Turn meeting transcript into action items",
    description: "Owner, task, deadline, priority — table-only output.",
    task: "Turn this meeting transcript into an action-items table. Columns: owner, action, deadline (absolute date), priority. Separately list decisions with no action attached, items needing an owner, and parked topics. Be strict — only firm commitments become action items.",
  },
  // Task 4 — daily team briefing
  {
    id: "custom-emp-daily-team-briefing",
    title: "Daily team briefing",
    description: "Short summary of projects, blockers, deadlines, meetings.",
    task: "Prepare a daily briefing for my team. Use the status-update format: ## Today (in-progress + blocked + shipping), ## Blockers (owner + ask), ## Deadlines (this week + next week), ## Meetings (count + what to prep for). Under 250 words.",
  },
  // Task 5 — sales call follow-up
  {
    id: "custom-emp-sales-followup-email",
    title: "Sales call follow-up email",
    description: "Personalized follow-up referencing what was discussed + clear next step.",
    task: "Create a personalised follow-up email after this sales call. Open by referencing one specific thing they said. Confirm the next step with a date. Attach any relevant resource. Email format with subject line. Tone: warm but commercially clear. Under 180 words.",
  },
  // Task 6 — CRM update from notes
  {
    id: "custom-emp-crm-update-from-notes",
    title: "Update CRM from call notes",
    description: "Structured CRM-ready fields with source quotes per field.",
    task: "Update our CRM from these call notes. Output canonical fields: contact, deal stage, size estimate, close date, MEDDIC summary (metric / economic buyer / decision criteria / decision process / pain / champion), next step (single action with owner + date), and gaps to close on the next call. Quote the source line for each non-trivial field.",
  },
  // Task 8 — weekly progress report
  {
    id: "custom-emp-weekly-progress-report",
    title: "Weekly progress report (exec-ready)",
    description: "Wins, risks, next steps — board-ready summary.",
    task: "Generate a weekly progress report. Structure: ## TL;DR (2 sentences), ## Wins (3-5 bullets, quantified where possible), ## Risks (3-5 bullets with mitigation), ## Asks (what we need from leadership), ## Next week (3-5 bullets — owners + outcomes). Exec-readable; under 400 words.",
  },
  // Task 9 — proposal review
  {
    id: "custom-emp-proposal-review",
    title: "Review proposal for clarity + professionalism",
    description: "Edited version plus a short notes block with concrete improvements.",
    task: "Review this proposal for clarity and professionalism. Output the edited version directly (no quoting the original — just deliver the polished text), then add a short ## Notes block with 3-5 specific improvements made and any remaining concerns.",
  },
  // Task 10 — JD to tasks
  {
    id: "custom-emp-jd-to-task-workflow",
    title: "Job description → role workflow",
    description: "Convert a JD into the recurring tasks this role actually owns, grouped by cadence.",
    task: "Create a task list from this job description. Identify the role's primary deliverables, then list the recurring tasks that produce them — grouped by cadence (daily / weekly / monthly / quarterly). Mark which can be AI-assisted vs human-only, and name which skill or persona to use for the AI-assisted ones.",
  },
  // Task 11 — onboarding plan
  {
    id: "custom-emp-onboarding-30-60-90",
    title: "30/60/90-day onboarding plan",
    description: "Plan, checklist, and welcome email for a new hire.",
    task: "Help me onboard a new employee. Produce: (1) a 30/60/90-day plan with goals + key meetings for each phase, (2) a week-1 checklist (access, training, intros), (3) a warm welcome email. Use the role specified; if not specified, ask in one short paragraph for role + team size + start date.",
  },
  // Task 12 — CV screening
  {
    id: "custom-emp-cv-screening",
    title: "Screen CVs against a JD",
    description: "Ranked shortlist with reasons and concerns per candidate.",
    task: "Screen these CVs against this job description. Pull 3 must-haves from the JD; rank candidates as SCREEN / MAYBE / PASS with one-sentence reasons. For SCREEN candidates, list 2-3 standout signals + 1-2 questions to probe at the call. Note any pipeline gaps. Reasons must be job-related (no proxy for protected class).",
  },
  // Task 13 — interview questions
  {
    id: "custom-emp-interview-questions",
    title: "Draft interview questions for a role",
    description: "Technical, behavioural, and culture-fit questions sequenced for one panel slot.",
    task: "Draft interview questions for this role. Output 4-6 technical questions (calibrated to seniority), 4-6 behavioural questions (STAR-format), 2-3 culture-fit questions, plus 'what to look for' guidance for each. Total panel time target: 45-60 min.",
  },
  // Task 14 — performance review
  {
    id: "custom-emp-perf-review-summary",
    title: "Performance review summary from notes",
    description: "Balanced review with achievements, gaps, goals.",
    task: "Create a performance review summary from these notes. Use the performance-review format: ## Headline (1-line verdict), ## Achievements (3-5 with impact), ## Areas to grow (2-3 specific, actionable, not personality-based), ## Goals for next period (SMART), ## Manager support needed. Keep balanced — equal rigor on praise and gaps.",
  },
  // Task 15 — job advert
  {
    id: "custom-emp-job-advert",
    title: "Write a job advert (LinkedIn / careers page)",
    description: "Professional posting with outcomes, must-haves, and comp range.",
    task: "Write a job advert for this position suitable for LinkedIn / careers page. Lead with outcomes (what success looks like in first 90 days), 3-5 must-haves (not a wish list), name comp range and remote policy, end with how to apply. Avoid corporate jargon — write like a person.",
  },
  // Task 16 — vendor comparison
  {
    id: "custom-emp-vendor-comparison",
    title: "Compare vendor quotes + recommend",
    description: "Cost / risk / fit matrix with a single recommendation and pushback list.",
    task: "Compare vendor quotes and recommend one. Normalise to 12-month TCO including onboarding + training + implementation. Build a comparison matrix on cost / risk / fit / implementation / support / exit-cost (with weights). Recommend ONE with reasons. End with 1-3 specific terms to push back on before signing.",
  },
  // Task 17 — contract terms
  {
    id: "custom-emp-contract-terms-extract",
    title: "Extract key contract terms",
    description: "Obligations, deadlines, risks, approval flags.",
    task: "Extract key terms from this contract. Output as a table: term, our obligation, their obligation, deadline / date, risk (low/med/high), approval needed (legal / finance / exec). Then a ## Watch list of any clause that could bite us. Standard not-legal-advice caveat.",
  },
  // Task 18 — compliance check
  {
    id: "custom-emp-compliance-check",
    title: "Check document for compliance issues",
    description: "Risk summary; items flagged HIGH / MEDIUM / LOW with approver.",
    task: "Check this document for compliance issues. Identify the doc type first (contract / marketing / customer comm / HR / privacy). Flag findings HIGH (legal sign-off needed), MEDIUM (manager approval), LOW (note + ship). Each finding: quote the text, explain why, suggest a rewrite (LOW/MEDIUM only). End with what couldn't be assessed. Standard not-legal-advice caveat.",
  },
  // Task 19 — invoice follow-up
  {
    id: "custom-emp-invoice-followup",
    title: "Invoice follow-up message",
    description: "Firm but polite payment reminder.",
    task: "Prepare an invoice follow-up message. Tone: firm but polite. Reference the invoice number and original due date, state the days overdue, offer one easy payment path, give a clear new deadline before escalation. Email format with subject. Under 150 words.",
  },
  // Task 21 — travel itinerary
  {
    id: "custom-emp-travel-itinerary",
    title: "Build a travel itinerary from bookings",
    description: "Full itinerary — times, addresses, transfers, reminders, contingencies.",
    task: "Create a travel itinerary from these bookings. Order chronologically with local times; compute transfer windows; full venue addresses; confirmation numbers prominently surfaced; flag time-zone changes; include a reminders checklist and contingency notes for flight delays / hotel issues / lost passport.",
  },
  // Task 24 — support themes
  {
    id: "custom-emp-support-ticket-themes",
    title: "Cluster support tickets by theme",
    description: "Issue clusters, frequency, urgency, suggested fixes.",
    task: "Summarise these customer support tickets by theme. Cluster by underlying cause (not symptom). For each cluster: count, severity, example ticket, suggested single fix, owner. Separately list singletons (no trend yet). Recommend the top 3 fixes ranked by user-pain reduction per engineering hour.",
  },
  // Task 26 — support escalation
  {
    id: "custom-emp-support-escalation-triage",
    title: "Escalate serious support tickets",
    description: "Escalation list with trigger, owner, SLA risk, next action.",
    task: "Escalate any support tickets that look serious. Apply explicit triggers (data loss / data exposure / billing error / named-VIP customer / SLA breach / 3+ tickets same customer / public-channel mention / compliance language). For each: trigger that fired, suggested owner (role or name), SLA risk (quantified), customer context, single next action. List what's NOT escalated so the triage is complete.",
  },
  // Task 27 — KB article from solved ticket
  {
    id: "custom-emp-kb-article-from-ticket",
    title: "Knowledge-base article from a solved ticket",
    description: "Help-center-ready article — symptom, cause, 3-step fix.",
    task: "Create a knowledge-base article from this solved ticket. Title matches what a user would search for (their words, not ours). Sections: what you'll see, why this happens (plain English), 3-step fix, still-stuck section with what info to send support. Date it. Add 2-3 related-article links if known.",
  },
  // Task 28 — feedback trends
  {
    id: "custom-emp-feedback-trends",
    title: "Analyse customer feedback for trends",
    description: "Sentiment, recurring themes, product implications.",
    task: "Analyse this customer feedback and identify trends. Tag each item with sentiment / theme / intensity. Cluster themes. Rank by frequency × intensity. Separate 'what they love' from 'what's hurting' from 'emerging signals'. For each hurting theme, suggest one concrete product response. End with pinnable quotes.",
  },
  // Task 29 — product update announcement
  {
    id: "custom-emp-product-update-announce",
    title: "Product update announcement",
    description: "Customer-friendly release note or email.",
    task: "Write a product update announcement. Lead with the customer benefit (not the feature name). Cover: what's new, what changed for the user, what they need to do (if anything), where to learn more. Email format. Casual-professional tone. Under 200 words.",
  },
  // Task 32 — slide outline
  {
    id: "custom-emp-slide-outline",
    title: "Slide-by-slide outline for a presentation",
    description: "Per-slide title, key bullets, suggested visual, speaker notes.",
    task: "Create a slide outline for this presentation. Identify audience and ask up front. Output 7-12 slides. Each slide: title that IS the message (full sentence), max 3 bullets, suggested visual, one-line speaker note. End with a next-steps slide that names owners + dates. Include a pre-flight checklist.",
  },
  // Task 33 — competitor summary
  {
    id: "custom-emp-competitor-summary",
    title: "Competitor summary",
    description: "Who they are, what they do better, what we do better, sales talking point.",
    task: "Research competitors and summarise differences. For each: literal positioning (quoted), 2-3 things they do better than us, 2-3 things we do better, pricing if available, sales talking point (one line that ends in a customer question), and what we don't yet know. Date sources.",
  },
  // Task 36 — lead qualification
  {
    id: "custom-emp-lead-qualification",
    title: "Lead qualification summary",
    description: "Fit + intent + urgency, recommended next action.",
    task: "Create a lead qualification summary. Score fit / intent / urgency (each: H/M/L or H/W/C). Cite the signal for each score. Surface 1-2 anticipated objections. Recommend a single next action (discovery call now / nurture / disqualify / hand to partner) with a talk-track opener + what to prep before the call.",
  },
  // Task 42 — translate + respond
  {
    id: "custom-emp-translate-and-respond",
    title: "Translate customer message + draft response",
    description: "Translation with tone preserved + response in target language + back-translation.",
    task: "Translate this customer message and draft a response. Identify source + target language explicitly. Translate the inbound preserving tone. Draft response in the target language at the appropriate register. Provide a back-translation so I can verify the meaning. Note any cultural / register choices and untranslated terms.",
  },
  // Task 43 — SOP writing
  {
    id: "custom-emp-sop-writing",
    title: "Turn a process into an SOP",
    description: "Trigger, outcome, numbered steps, escalation paths, change log.",
    task: "Turn this process into a Standard Operating Procedure. Use the SOP format: trigger, outcome, prerequisites, atomic numbered steps (each with owner / input / action / output / checkpoint / escalation), escalation table for non-routine cases, linked artifacts, change log entry. Owners are roles, not names.",
  },
  // Task 47 — procurement request
  {
    id: "custom-emp-procurement-request",
    title: "Procurement request from a need",
    description: "Justification, options, TCO, suggested approver, risks, pushback list.",
    task: "Generate a procurement request from this need. Restate the need precisely. Evaluate 2-3 options. Show TCO (year-1 + 3-year) including onboarding + training + implementation. Recommend one with reasons. Tie to a business goal. Risks + mitigations. Suggest the approver based on amount. End with 1-3 negotiation pushbacks.",
  },
  // Task 50 — tomorrow's work plan
  {
    id: "custom-emp-tomorrow-work-plan",
    title: "Tomorrow's work plan",
    description: "Capacity-honest, prioritised, time-boxed.",
    task: "Create my tomorrow work plan from today's unfinished tasks. Compute available focus time (subtract meetings + 15-min prep before each). Identify the ONE thing for the protected morning slot. Group by energy (deep / shallow). Explicit 'deferred' section with reasons. End with end-of-day verification — concrete shipped artifacts that define 'done'.",
  },
];

function main() {
  if (!existsSync(dirname(FILE))) mkdirSync(dirname(FILE), { recursive: true });
  let existing = [];
  if (existsSync(FILE)) {
    try { existing = JSON.parse(readFileSync(FILE, "utf8")); }
    catch (e) { console.error("Couldn't parse existing customs:", e); process.exit(1); }
  }
  if (!Array.isArray(existing)) existing = [];
  console.log(`Existing customs: ${existing.length}`);

  const existingIds = new Set(existing.map(t => t.id));
  let added = 0, skipped = 0;
  const now = new Date().toISOString();
  for (const t of NEW_TEMPLATES) {
    if (existingIds.has(t.id)) { skipped++; continue; }
    existing.push({
      id: t.id,
      role: "Custom",
      title: t.title,
      description: t.description,
      origin: { task: t.task, createdAt: now },
      plan: { steps: [] },  // empty plan → re-plans against active persona on each run
      runCount: 0,
    });
    added++;
  }

  writeFileSync(FILE, JSON.stringify(existing, null, 2), "utf8");
  console.log(`Added ${added}, skipped ${skipped} (already present). Total now: ${existing.length}`);
}

main();
