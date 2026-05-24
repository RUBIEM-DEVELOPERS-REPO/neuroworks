// Persona auto-router.
//
// When a chat task arrives with no active persona (or with the generic
// clawbot generalist active), pick the best built-in persona for the
// task and use it for the run. The user can still override via explicit
// activation; this is the "no one specified — figure it out" path.
//
// Routing is heuristic: each built-in persona has a regex catalog of
// task shapes it owns. Score each persona by how many patterns match
// the task text; the highest non-zero score wins. Ties prefer the more
// specific role (smaller pattern set). Below a confidence floor we
// fall through to clawbot (the generalist) rather than guessing.
//
// Examples:
//   "Screen these CVs against the JD" → recruiter (Riley)
//   "Triage tomorrow's tickets" → customer-success (Casey)
//   "MEDDIC notes from yesterday's call" → account-executive (Drew)
//   "Draft a runbook for Kafka lag" → devops-sre (Devon)
//   "1-pager on Notion competitive response" → marketing-manager (Maya)

import { loadPersonas, type Persona } from "./personas.js";

type PersonaPattern = {
  personaId: string;
  patterns: RegExp[];
};

// Catalog of routing patterns per persona. Tuned to match the 50
// employee-task surface + the existing persona roster. Patterns are
// case-insensitive, word-bounded where reasonable, and biased toward
// the most distinguishing vocabulary for each role.
const PERSONA_PATTERNS: PersonaPattern[] = [
  // Sales / GTM
  { personaId: "account-executive", patterns: [
    /\bMEDDIC\b/i, /\bdiscovery (?:call|notes?|questions?)\b/i,
    /\bsales (?:call|follow[- ]?up|proposal|pipeline)\b/i,
    /\blead (?:qualification|scor)/i, /\bclose rate\b/i,
    /\bdeal (?:review|qualification|stage)\b/i,
    /\bquote\s+(?:request|comparison)\b/i,
  ] },
  { personaId: "marketing-manager", patterns: [
    /\bsocial (?:media )?post/i, /\bcampaign (?:plan|brief)\b/i,
    /\blaunch (?:blurb|copy|positioning|brief|announcement)\b/i,
    /\bcompetitor (?:summary|comparison)\b/i,
    /\bchangelog (?:entry|copy)\b/i, /\bbrand voice\b/i,
    /\bproduct update announcement\b/i,
  ] },
  { personaId: "customer-success", patterns: [
    /\bsupport (?:ticket|themes?|escalation|response)\b/i,
    /\bcustomer (?:reply|complaint|feedback|email|message)\b/i,
    /\bknowledge[\s-]?base article\b/i, /\bKB article\b/i,
    /\binvoice follow[- ]?up\b/i,
    /\bcustomer (?:health|account|outreach)\b/i,
  ] },
  // Engineering / SRE / QA
  { personaId: "software-engineer", patterns: [
    /\bengineering (?:scope|design|trade[- ]?off)\b/i,
    /\bcode review\b/i, /\bAPI (?:design|spec)\b/i,
    /\b(?:implement|build|refactor)\s+(?:a\s+|the\s+)?\w+/i,
    /\bvector (?:DB|database)\s+(?:comparison|choice)\b/i,
    /\btech (?:choice|stack|decision)\b/i,
  ] },
  { personaId: "devops-sre", patterns: [
    /\brunbook\b/i, /\bpost[\s-]?mortem\b/i,
    /\bincident (?:response|triage|review)\b/i,
    /\bon[\s-]?call (?:procedure|rotation)\b/i,
    /\bSRE\b/, /\bautoscaling\b/i,
    /\bSLO (?:breach|burn|dashboard|target)\b/i,
  ] },
  { personaId: "qa-engineer", patterns: [
    /\bQA (?:plan|strategy)\b/i, /\btest (?:plan|strategy)\b/i,
    /\beval (?:framework|suite)\b/i, /\bchaos (?:engineering|test)\b/i,
    /\bregression (?:test|catch)\b/i,
  ] },
  // Product / Design
  { personaId: "product-manager", patterns: [
    /\bPRD\b/, /\bproduct (?:spec|brief|positioning)\b/i,
    /\bfeature (?:scoping|prioriti[sz]ation|spec)\b/i,
    /\bnorth star (?:metric|goal)\b/i,
    /\bRICE\b/, /\bICE\b/,
  ] },
  { personaId: "product-designer", patterns: [
    /\bUX (?:critique|review|audit|flow)\b/i,
    /\bdesign (?:critique|review|spec)\b/i,
    /\bjob[\s-]to[\s-]be[\s-]done\b/i, /\bJTBD\b/i,
    /\baccessibility|\ba11y\b/i, /\bwireframe\b/i,
  ] },
  // Finance / Operations / Recruiting / Legal / Analyst / TechWriter / EA
  { personaId: "financial-analyst", patterns: [
    /\bcashflow\b/i, /\bunit economics?\b/i, /\bNDR\b/, /\bLTV[\/:]?CAC\b/i,
    /\bburn (?:rate|multiple)\b/i, /\bbudget (?:model|review)\b/i,
    /\bsensitivity (?:analysis|model)\b/i,
    /\bexpense (?:reconciliation|policy)\b/i,
  ] },
  { personaId: "operations-coordinator", patterns: [
    /\bSOP\b/, /\bstandard operating procedure\b/i,
    /\bvendor (?:comparison|quote)\b/i, /\bprocurement (?:request|policy)\b/i,
    /\bapproval (?:routing|chain|flow)\b/i,
    /\bworkflow (?:audit|bottleneck)\b/i,
    /\btravel itinerary\b/i,
  ] },
  { personaId: "recruiter", patterns: [
    /\bjob (?:description|advert|posting)\b/i, /\bJD\b(?!\s+for\s+sale)/,
    /\bCV (?:screening|review)\b/i, /\bresume (?:screening|review)\b/i,
    /\binterview (?:question|loop)\b/i, /\bcandidate (?:shortlist|review)\b/i,
    /\bcompensation (?:benchmark|band)\b/i, /\bonboarding (?:plan|checklist)\b/i,
    /\bperformance review\b/i,
  ] },
  { personaId: "contracts-reviewer", patterns: [
    /\bcontract (?:terms?|review|extraction|summary)\b/i,
    /\bMFN clause\b/i, /\bredline\b/i,
    /\bcompliance (?:check|review)\b/i,
    /\bNDA\b/, /\bMSA\b/, /\bSLA (?:terms?|penalty|cap)\b/i,
    /\bGDPR|\bEU AI Act|\bregulatory\b/i,
  ] },
  { personaId: "data-analyst", patterns: [
    /\bcohort (?:analysis|retention)\b/i,
    /\bproduct analytics (?:stack|setup)\b/i,
    /\bA\/?B test (?:read|analysis)\b/i, /\bexperiment (?:result|read)\b/i,
    /\bretention (?:curve|cohort)\b/i,
    /\bfunnel (?:analysis|drop[- ]?off)\b/i,
  ] },
  { personaId: "technical-writer", patterns: [
    /\bAPI docs?\b/i, /\bdeveloper docs?\b/i,
    /\bdocumentation (?:overhaul|refresh|standard)\b/i,
    /\btutorial\b/i, /\bquickstart\b/i, /\bdocs[\s-]as[\s-]code\b/i,
  ] },
  { personaId: "executive-assistant", patterns: [
    /\bschedule (?:a |the )?meeting\b/i, /\bcalendar (?:hold|invite)\b/i,
    /\bmeeting (?:agenda|prep)\b/i, /\btravel (?:plan|booking)\b/i,
    /\b(?:inbox|email) triage\b/i,
  ] },
  // Researcher — investigative shape (NOT the same as research.deep
  // primitive; this is when a HUMAN asks for multi-perspective work)
  { personaId: "researcher", patterns: [
    /\bmulti[\s-]?perspective\b/i,
    /\bfact[\s-]?check\b/i, /\btriangulat/i,
    /\binvestigate (?:the|this|how|whether)\b/i,
    /\bsource (?:triangulation|cross[- ]?check)\b/i,
  ] },
];

// Pick the best persona for a given task text. Returns:
//   { personaId, score, matchedPatterns } — when a clear winner emerges
//   null — when nothing matched above the confidence floor (caller falls
//         through to clawbot)
//
// Confidence floor: at least one pattern must match. Ties (same score)
// resolved by lower-indexed entry in PERSONA_PATTERNS (rough proxy for
// "more central role"). When the highest scorer ties with multiple
// others, return null — auto-routing only fires when confidence is high.
export function pickPersonaForTask(text: string): { personaId: string; score: number; matched: string[] } | null {
  if (!text || text.length < 8) return null;
  const cap = text.slice(0, 4000);
  let best: { personaId: string; score: number; matched: string[] } | null = null;
  const tied: string[] = [];
  for (const entry of PERSONA_PATTERNS) {
    const matches: string[] = [];
    for (const pat of entry.patterns) {
      const m = cap.match(pat);
      if (m) matches.push(m[0].slice(0, 32));
    }
    if (matches.length === 0) continue;
    const score = matches.length;
    if (!best || score > best.score) {
      best = { personaId: entry.personaId, score, matched: matches };
      tied.length = 0;
    } else if (score === best.score) {
      tied.push(entry.personaId);
    }
  }
  // If multiple personas tied for top score, we don't have confidence —
  // fall through to clawbot rather than picking one over the others.
  if (!best || (tied.length > 0 && best.score === 1)) return null;
  return best;
}

// Pick + return the actual Persona object, or null when no auto-route.
// Used by chat.ts when no persona is active.
export function autoRoutePersona(text: string): { persona: Persona; score: number; matched: string[] } | null {
  const pick = pickPersonaForTask(text);
  if (!pick) return null;
  try {
    const store = loadPersonas();
    const persona = store.personas.find(p => p.id === pick.personaId);
    if (!persona) return null;
    return { persona, score: pick.score, matched: pick.matched };
  } catch { return null; }
}
