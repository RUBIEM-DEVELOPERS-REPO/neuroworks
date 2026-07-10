// Deliverable classification — shared by the planner (agent.ts) and the
// quality grader (primitives.ts) so they never disagree about what kind of
// thing was asked for.
//
//   research   — questions/analysis where citations + factuality matter
//   creative   — marketing/announcement/copy: aspirational, uncited by nature
//   procedural — runbook/how-to/checklist: operational know-how, not citations
//   code       — code/tests/technical artifacts: judged on correctness
//
// The grader uses this to pick the right scoring rubric; the planner uses it
// to route creative/procedural tasks straight to a persona-knowledge answer
// instead of running speculative web research (which produces thin "sources"
// that then drag the citation score down and waste minutes).

export type DeliverableClass = "research" | "creative" | "procedural" | "code";

export function classifyDeliverable(task: string): DeliverableClass {
  const s = task.toLowerCase();
  if (/\b(runbook|playbook|how[- ]?to|step[- ]by[- ]step|step by step|tutorial|walkthrough|checklist|\bsop\b|standard operating|procedure|ordered steps|setup guide|onboarding (?:doc|guide)|installation guide)\b/.test(s)) return "procedural";
  if (/\b(launch announcement|announcement|marketing|tagline|slogan|ad copy|advert|social (?:media )?post|tweet|blog post|press release|newsletter|campaign|landing page|copywriting|headline|elevator pitch|jingle|poem|short story|caption)\b/.test(s)) return "creative";
  if (/\b(code|function|script|implement|snippet|regex|sql query|api endpoint|class definition|refactor|unit tests?|test cases?|gherkin|pseudocode|algorithm)\b/.test(s)) return "code";
  return "research";
}

// True when the task explicitly asks to consult external or vault sources. In
// that case even a creative/procedural deliverable should run the research
// pipeline (the user wants grounding), so the planner must NOT force a direct
// persona-knowledge answer.
export function taskWantsResearch(task: string): boolean {
  const s = task.toLowerCase();
  // NB: deliberately NOT matching the bare word "reference(s)" — it shows up
  // as a verb in unrelated framing (e.g. the team alignment directive says
  // "reference A, B, AND C") and would false-trigger on most tasks. The
  // citation intent is covered by "cite"/"citations"/"with sources".
  return /\b(search|look up|look for|research|cite|citations?|with sources|according to|latest|recent|current (?:state|status|news|landscape)|news|our|internal|company|in[- ]house|from (?:the |my )?(?:vault|second brain|notes|docs))\b/.test(s)
    || /https?:\/\//.test(s);
}
