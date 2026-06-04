// Persona auto-router.
//
// When a chat task arrives with no active persona (or with the generic
// clawbot generalist active), pick the best built-in persona for the
// task and use it for the run. The user can still override via explicit
// activation; this is the "no one specified — figure it out" path.
//
// Routing is heuristic but task-shape weighted: each persona has a regex
// catalog where "shape" patterns (verb + topic, "draft a runbook", "review
// these CVs") carry weight 2 and bare-keyword patterns ("SRE", "NDA",
// "wireframe") carry weight 1. A persona needs an effective score ≥ 2 to
// win — a single bare keyword like "explain MSA to me" no longer hijacks
// routing onto contracts-reviewer. Two corroborating signals (or one
// definitive shape match) are required. The fallback is clawbot.
//
// Examples:
//   "Screen these CVs against the JD" → recruiter (Riley)
//   "Triage tomorrow's tickets" → customer-success (Casey)
//   "MEDDIC notes from yesterday's call" → account-executive (Drew)
//   "Draft a runbook for Kafka lag" → devops-sre (Devon)
//   "1-pager on Notion competitive response" → marketing-manager (Maya)

import { loadPersonas, type Persona } from "./personas.js";

// A pattern is either:
//   - a bare RegExp (legacy entries) — weighted at 1 (keyword signal)
//   - { re, weight } — explicit weight (use 2 for verb+topic shape matches)
// Effective score is the SUM of weights of all matching patterns. A
// persona needs ≥ 2 to win, so a single weight-1 keyword match alone is
// never enough — it must corroborate with a shape match or another keyword.
type WeightedPattern = { re: RegExp; weight?: number };
type PersonaPattern = {
  personaId: string;
  patterns: (RegExp | WeightedPattern)[];
};

function patternWeight(p: RegExp | WeightedPattern): number {
  if (p instanceof RegExp) return 1;
  return p.weight ?? 1;
}
function patternRegex(p: RegExp | WeightedPattern): RegExp {
  return p instanceof RegExp ? p : p.re;
}

// Catalog of routing patterns per persona. Tuned to match the 50
// employee-task surface + the existing persona roster. Patterns are
// case-insensitive, word-bounded where reasonable, and biased toward
// the most distinguishing vocabulary for each role.
const PERSONA_PATTERNS: PersonaPattern[] = [
  // Sales / GTM
  { personaId: "account-executive", patterns: [
    { re: /\bMEDDIC\s+(?:notes?|qualification|review|template)\b/i, weight: 2 },
    { re: /\bdiscovery (?:call|notes?|questions?)\b/i, weight: 2 },
    { re: /\bsales (?:call|follow[- ]?up|proposal|pipeline)\b/i, weight: 2 },
    { re: /\blead (?:qualification|scor)/i, weight: 2 },
    /\bMEDDIC\b/i,
    /\bclose rate\b/i,
    { re: /\bdeal (?:review|qualification|stage)\b/i, weight: 2 },
    { re: /\bquote\s+(?:request|comparison)\b/i, weight: 2 },
  ] },
  { personaId: "marketing-manager", patterns: [
    { re: /\b(?:draft|write|create|prepare) (?:a |the )?(?:social|launch|campaign|changelog)\b/i, weight: 2 },
    { re: /\bsocial (?:media )?post\b/i, weight: 2 },
    { re: /\bcampaign (?:plan|brief)\b/i, weight: 2 },
    { re: /\blaunch (?:blurb|copy|positioning|brief|announcement)\b/i, weight: 2 },
    { re: /\bcompetitor (?:summary|comparison)\b/i, weight: 2 },
    { re: /\bchangelog (?:entry|copy)\b/i, weight: 2 },
    /\bbrand voice\b/i,
    { re: /\bproduct update announcement\b/i, weight: 2 },
  ] },
  { personaId: "customer-success", patterns: [
    { re: /\bsupport (?:ticket|themes?|escalation|response)\b/i, weight: 2 },
    { re: /\bcustomer (?:reply|complaint|feedback|email|message)\b/i, weight: 2 },
    { re: /\b(?:write|draft|create|prepare) (?:a |the )?(?:KB|knowledge[ -]?base) article\b/i, weight: 2 },
    /\bknowledge[\s-]?base article\b/i, /\bKB article\b/i,
    { re: /\binvoice follow[- ]?up\b/i, weight: 2 },
    { re: /\bcustomer (?:health|account|outreach)\b/i, weight: 2 },
  ] },
  // Engineering / SRE / QA
  { personaId: "software-engineer", patterns: [
    { re: /\bengineering (?:scope|design|trade[- ]?off)\b/i, weight: 2 },
    { re: /\bcode review\b/i, weight: 2 },
    { re: /\bAPI (?:design|spec)\b/i, weight: 2 },
    { re: /\b(?:implement|build|refactor)\s+(?:a\s+|the\s+)?\w+/i, weight: 2 },
    { re: /\bvector (?:DB|database)\s+(?:comparison|choice)\b/i, weight: 2 },
    { re: /\btech (?:choice|stack|decision)\b/i, weight: 2 },
  ] },
  { personaId: "devops-sre", patterns: [
    { re: /\b(?:write|draft|create|prepare) (?:a |the )?runbook\b/i, weight: 2 },
    /\brunbook\b/i,
    { re: /\bpost[\s-]?mortem\s+(?:for|on|of|template|review|write[- ]?up)\b/i, weight: 2 },
    /\bpost[\s-]?mortem\b/i,
    { re: /\bincident (?:response|triage|review)\b/i, weight: 2 },
    { re: /\bon[\s-]?call (?:procedure|rotation)\b/i, weight: 2 },
    { re: /\b(?:as an?|join the|like an?|act as) SRE\b/i, weight: 2 },
    { re: /\bSRE (?:team|engineer|workflow|playbook|process|policy)\b/i, weight: 2 },
    { re: /\bautoscaling (?:policy|config|rule|threshold|setup|design)\b/i, weight: 2 },
    { re: /\bSLO (?:breach|burn|dashboard|target)\b/i, weight: 2 },
  ] },
  { personaId: "qa-engineer", patterns: [
    { re: /\bQA (?:plan|strategy)\b/i, weight: 2 },
    { re: /\btest (?:plan|strategy)\b/i, weight: 2 },
    { re: /\beval (?:framework|suite)\b/i, weight: 2 },
    { re: /\bchaos (?:engineering|test)\b/i, weight: 2 },
    { re: /\bregression (?:test|catch)\b/i, weight: 2 },
  ] },
  // Product / Design
  { personaId: "product-manager", patterns: [
    { re: /\b(?:write|draft|create|prepare) (?:a |the )?PRD\b/i, weight: 2 },
    { re: /\bPRD\s+(?:for|on|of|template|review|draft)\b/i, weight: 2 },
    /\bPRD\b/,
    { re: /\bproduct (?:spec|brief|positioning)\b/i, weight: 2 },
    { re: /\bfeature (?:scoping|prioriti[sz]ation|spec)\b/i, weight: 2 },
    { re: /\bnorth star (?:metric|goal)\b/i, weight: 2 },
    { re: /\bRICE (?:scor|prioriti|exercise|model|template)\b/i, weight: 2 },
    { re: /\bICE (?:score|prioriti|exercise|model)\b/i, weight: 2 },
  ] },
  { personaId: "product-designer", patterns: [
    { re: /\bUX (?:critique|review|audit|flow)\b/i, weight: 2 },
    { re: /\bdesign (?:critique|review|spec)\b/i, weight: 2 },
    { re: /\bjob[\s-]to[\s-]be[\s-]done\b/i, weight: 2 },
    { re: /\bJTBD (?:interview|map|statement|exercise|template)\b/i, weight: 2 },
    /\bJTBD\b/i,
    { re: /\baccessibility (?:audit|review|check)\b/i, weight: 2 },
    { re: /\ba11y (?:audit|review|check)\b/i, weight: 2 },
    { re: /\b(?:draft|create|review|critique) (?:a |the )?wireframe\b/i, weight: 2 },
    /\bwireframe\b/i,
  ] },
  // Finance / Operations / Recruiting / Legal / Analyst / TechWriter / EA
  { personaId: "financial-analyst", patterns: [
    /\bcashflow\b/i,
    { re: /\bunit economics?\b/i, weight: 2 },
    { re: /\bNDR (?:calculation|target|model|trend|breakdown)\b/i, weight: 2 },
    { re: /\bLTV[\/:]?CAC\b/i, weight: 2 },
    { re: /\bburn (?:rate|multiple)\b/i, weight: 2 },
    { re: /\bbudget (?:model|review)\b/i, weight: 2 },
    { re: /\bsensitivity (?:analysis|model)\b/i, weight: 2 },
    { re: /\bexpense (?:reconciliation|policy)\b/i, weight: 2 },
  ] },
  { personaId: "operations-coordinator", patterns: [
    { re: /\b(?:write|draft|create|prepare) (?:a |the )?SOP\b/i, weight: 2 },
    { re: /\bSOP\s+(?:for|on|template|review|draft)\b/i, weight: 2 },
    /\bSOP\b/,
    { re: /\bstandard operating procedure\b/i, weight: 2 },
    { re: /\bvendor (?:comparison|quote)\b/i, weight: 2 },
    { re: /\bprocurement (?:request|policy)\b/i, weight: 2 },
    { re: /\bapproval (?:routing|chain|flow)\b/i, weight: 2 },
    { re: /\bworkflow (?:audit|bottleneck)\b/i, weight: 2 },
    { re: /\btravel itinerary\b/i, weight: 2 },
  ] },
  { personaId: "recruiter", patterns: [
    { re: /\bjob (?:description|advert|posting)\b/i, weight: 2 },
    { re: /\bJD\b(?!\s+for\s+sale)/, weight: 2 },
    { re: /\bCV (?:screening|review)\b/i, weight: 2 },
    { re: /\bresume (?:screening|review)\b/i, weight: 2 },
    { re: /\binterview (?:question|loop)\b/i, weight: 2 },
    { re: /\bcandidate (?:shortlist|review)\b/i, weight: 2 },
    { re: /\bcompensation (?:benchmark|band)\b/i, weight: 2 },
    { re: /\bonboarding (?:plan|checklist)\b/i, weight: 2 },
    { re: /\bperformance review\b/i, weight: 2 },
  ] },
  { personaId: "contracts-reviewer", patterns: [
    { re: /\bcontract (?:terms?|review|extraction|summary)\b/i, weight: 2 },
    { re: /\bMFN clause\b/i, weight: 2 },
    { re: /\bredline (?:the|this|a |an |contract|MSA|NDA|clause|terms)\b/i, weight: 2 },
    /\bredline\b/i,
    { re: /\bcompliance (?:check|review)\b/i, weight: 2 },
    { re: /\bNDA (?:review|terms?|clauses?|draft|template)\b/i, weight: 2 },
    /\bNDA\b/,
    { re: /\bMSA (?:review|terms?|clauses?|draft|template|extraction)\b/i, weight: 2 },
    /\bMSA\b/,
    { re: /\bSLA (?:terms?|penalty|cap)\b/i, weight: 2 },
    /\bGDPR\b/, /\bEU AI Act\b/, /\bregulatory\b/i,
  ] },
  { personaId: "data-analyst", patterns: [
    { re: /\bcohort (?:analysis|retention)\b/i, weight: 2 },
    { re: /\bproduct analytics (?:stack|setup)\b/i, weight: 2 },
    { re: /\bA\/?B test (?:read|analysis)\b/i, weight: 2 },
    { re: /\bexperiment (?:result|read)\b/i, weight: 2 },
    { re: /\bretention (?:curve|cohort)\b/i, weight: 2 },
    { re: /\bfunnel (?:analysis|drop[- ]?off)\b/i, weight: 2 },
  ] },
  { personaId: "technical-writer", patterns: [
    { re: /\bAPI docs?\b/i, weight: 2 },
    { re: /\bdeveloper docs?\b/i, weight: 2 },
    { re: /\bdocumentation (?:overhaul|refresh|standard)\b/i, weight: 2 },
    { re: /\b(?:write|draft|create|prepare|build) (?:a |the )?tutorial\b/i, weight: 2 },
    { re: /\btutorial (?:series|article|outline|guide)\b/i, weight: 2 },
    { re: /\bquickstart (?:guide|article|doc|tutorial)\b/i, weight: 2 },
    /\bquickstart\b/i,
    { re: /\bdocs[\s-]as[\s-]code\b/i, weight: 2 },
  ] },
  { personaId: "executive-assistant", patterns: [
    { re: /\bschedule (?:a |the )?meeting\b/i, weight: 2 },
    { re: /\bcalendar (?:hold|invite)\b/i, weight: 2 },
    { re: /\bmeeting (?:agenda|prep)\b/i, weight: 2 },
    { re: /\btravel (?:plan|booking)\b/i, weight: 2 },
    { re: /\b(?:inbox|email) triage\b/i, weight: 2 },
  ] },
  // Researcher — investigative shape (NOT the same as research.deep
  // primitive; this is when a HUMAN asks for multi-perspective work)
  { personaId: "researcher", patterns: [
    { re: /\bmulti[\s-]?perspective\b/i, weight: 2 },
    { re: /\bfact[\s-]?check\b/i, weight: 2 },
    /\btriangulat/i,
    { re: /\binvestigate (?:the|this|how|whether)\b/i, weight: 2 },
    { re: /\bsource (?:triangulation|cross[- ]?check)\b/i, weight: 2 },
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
// Confidence floor for an auto-route. A single bare keyword match
// (weight=1) is never enough; you need either a shape match (weight=2)
// or two corroborating keyword signals. Set higher to be more
// conservative; the unit tests are calibrated to 2.
const CONFIDENCE_FLOOR = 2;

export function pickPersonaForTask(text: string): { personaId: string; score: number; matched: string[] } | null {
  if (!text || text.length < 8) return null;
  const cap = text.slice(0, 4000);
  let best: { personaId: string; score: number; matched: string[] } | null = null;
  const tied: string[] = [];
  for (const entry of PERSONA_PATTERNS) {
    const matches: string[] = [];
    let score = 0;
    for (const pat of entry.patterns) {
      const re = patternRegex(pat);
      const m = cap.match(re);
      if (m) {
        matches.push(m[0].slice(0, 32));
        score += patternWeight(pat);
      }
    }
    if (matches.length === 0) continue;
    if (!best || score > best.score) {
      best = { personaId: entry.personaId, score, matched: matches };
      tied.length = 0;
    } else if (score === best.score) {
      tied.push(entry.personaId);
    }
  }
  // Below the confidence floor, fall through to clawbot — a single
  // bare-keyword hit ("explain MSA to me", "what is autoscaling")
  // shouldn't drag the user onto a specialist persona by accident.
  if (!best || best.score < CONFIDENCE_FLOOR) return null;
  // If multiple personas tied at the top, we don't have a clear winner —
  // fall through to clawbot rather than picking one over the others.
  if (tied.length > 0) return null;
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
