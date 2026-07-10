// Lane gate — pre-flight check that decides if a customer task is in the
// active persona's lane BEFORE any planning or tool execution kicks off.
//
// Background: each persona's systemPromptOverride carries a "lane rule"
// asking the model to refuse out-of-lane work and hand off to the right
// colleague. That rule only fires at SYNTH time, after the planner has
// already run vault.search / research.deep / web.scrape — by which point
// the model has burned context and feels obligated to produce SOMETHING.
// In ho1 + ho2 hand-off harnesses the prompt-level rule got 1/14 above B-.
//
// This module adds a separate, deterministic gate that runs before
// planning. If the task is clearly out-of-lane, we return a refusal
// inline without invoking the planner — no tool calls, no LLM synth, no
// fake SQL from Customer Success, no fake legal verdicts from engineers.
//
// Design choices:
//   • Small, fast LLM classification call (extraction profile, ~1-2s).
//   • Strict prompt — bias toward refusing rather than letting through.
//   • Fail-open: if the lane check itself errors, we let the task through
//     and rely on the persona's prompt-level rule. Better to occasionally
//     process a misrouted task than to wrongly reject a valid one.
//   • Roster awareness — the gate names a specific colleague to hire so
//     the customer's next action is a single click ("switch to Maya")
//     rather than guesswork.

import { ollamaGenerate } from "./ollama.js";
import type { Persona } from "./personas.js";

export type LaneCheck = {
  inLane: boolean;
  reason: string;
  suggestedHire?: string;
};

// The roster the gate hands off to. Match this against the persona names in
// personas.ts (BUILTIN_*_PERSONA) so the gate's suggestions are always
// resolvable in the dashboard. Custom personas the customer created are not
// listed here — the gate can still suggest them by role, but it can't name
// a specific Riley/Drew analogue inside the customer's own workspace.
const ROSTER_BLURB =
  "Casey (Customer Success Lead), Olivia (Operations Coordinator), Sam (Software Engineer), " +
  "Maya (Marketing Manager), Researcher (Investigative Analyst), Drew (Account Executive), " +
  "Riley (Talent Recruiter), Fiona (Financial Analyst), Priya (Product Manager), " +
  "Dani (Product Designer), Dale (Data Analyst), Logan (Contracts Reviewer), " +
  "Evie (Executive Assistant), Quinn (QA Engineer), Devon (DevOps / SRE), Tao (Technical Writer)";

// Tight LLM-check timeout. The heuristic above catches the obvious mismatches
// in a few milliseconds with zero LLM round-trip. The LLM only runs for cases
// the heuristic isn't sure about — typically subtler boundary calls. We'd
// rather fail-open quickly (let task through, persona prompt handles it) than
// stall a user for 25s on a small classification.
const LANE_CHECK_TIMEOUT_MS = Number(process.env.CLAWBOT_LANE_CHECK_TIMEOUT_MS ?? "6000");

// ─── Heuristic out-of-lane catcher ───────────────────────────────────
//
// Quick keyword check that catches the most obvious mismatches without an
// LLM round-trip. Returns null when uncertain (caller falls through to the
// LLM check); returns a LaneCheck when confident.
//
// The heuristic is intentionally conservative — it only fires when the
// task contains a STRONG signal of a domain that ISN'T this persona's
// lane (e.g. raw SQL keywords for a non-coder). When the heuristic is
// silent, the LLM check has the final word.

type HeuristicProfile = {
  // Domain signals — patterns whose presence in the task strongly
  // suggests a particular role's lane.
  codeSignal: RegExp;
  sqlSignal: RegExp;
  legalSignal: RegExp;
  marketingSignal: RegExp;
  financeSignal: RegExp;
  sreSignal: RegExp;
  csmSignal: RegExp;
  designSignal: RegExp;
  prdSignal: RegExp;
  qaSignal: RegExp;
};

const SIGNALS: HeuristicProfile = {
  // Hard-coded signals — phrases that almost-always belong to one domain.
  // Each regex is anchored on technical / domain-specific vocabulary so we
  // don't flag generic mentions ("our marketing team is...") as marketing.
  codeSignal: /\b(?:typescript|javascript|python|golang|rust|java(?!script)|c\+\+)\s+(?:function|script|class|module|library|package)|\b(?:debug|refactor|fix|implement) (?:my|a|the|this) (?:code|function|method|class|component)|TypeError|NullPointer|ReferenceError|undefined is not|cannot read prop|NoneType|null pointer|stack trace|line \d+ of [\w.]+\.(?:ts|js|py|go|rs|java)|`{3}(?:ts|js|python|py|go|rust|java)/i,
  sqlSignal: /\bSELECT\s+[\w*]+\s+FROM\b|\bUPDATE\s+\w+\s+SET\b|\bINSERT\s+INTO\b|\b(?:join|left join|inner join|outer join)\b\s+\w+\s+on\b|\bCTE\b|common table expression|window function|`{3}sql\b/i,
  legalSignal: /\b(?:NDA|non[- ]disclosure|MSA|master services agreement|SOW|contract clause|liability cap|indemnification|terms of service|tos\b|privacy policy|DPA\b|data processing agreement|MFN\b|most[- ]favored[- ]nation|arbitration clause|governing law|jurisdiction (?:clause|in)|enforceable|redline|negotiat(?:e|ion|ing) (?:a |the |my )?(?:contract|deal|agreement))\b/i,
  marketingSignal: /\b(?:press release|landing[- ]page (?:copy|headline)|ad creative|campaign brief|messaging brief|positioning (?:statement|sprint)|hero copy|tagline|brand voice|CTA copy|email sequence|drip campaign|nurture flow|conversion[- ]?optimised)\b/i,
  financeSignal: /\b(?:financial model|FP&?A|forecast|p&l|profit and loss|EBITDA|gross margin|net margin|LTV|CAC payback|unit economics|cohort retention|monte carlo|sensitivity (?:table|analysis)|variance analysis|revenue projection|burn rate|runway)\b/i,
  // SLO / SLA omitted as bare terms — SLAs in CONTRACTS are sales / legal
  // territory, not SRE. The SRE flavor of SLA matches more specific phrases
  // like "SLA breach", "SLA dashboard", "SLA monitoring", "error budget".
  sreSignal: /\b(?:incident runbook|on[- ]call (?:rotation|escalation)|p95|p99 latency|SLO\s+(?:breach|burn|dashboard|target|target)|SLA\s+(?:breach|monitoring|dashboard|burn)|error budget|blameless postmortem|kubectl|systemctl|journalctl|prometheus|grafana|datadog|kafka(?:\s+(?:cluster|partition))?|kubernetes|container orchestration|connection pool exhausted|service mesh|microservices?\s+architecture|message broker|event(?:s?[- ]?per[- ]sec|s?\/sec)|multi[- ]tenant\s+isolation|architecture\s+for|system\s+design|ingestion\s+pipeline)\b/i,
  csmSignal: /\b(?:draft (?:a |the )?(?:reply|response) to (?:a |the |our )?customer|frustrated customer|churn risk|renewal (?:memo|conversation|prep)|customer (?:success|health) (?:plan|check)|customer onboarding (?:plan|email)|win[- ]back)\b/i,
  designSignal: /\b(?:UX flow|wireframe|design (?:critique|review|system)|user journey map|accessibility (?:audit|check)|figma|sketch|usability (?:test|study)|interaction design|visual hierarchy|design tokens?)\b/i,
  prdSignal: /\b(?:PRD|product requirements? doc|RICE score|ICE score|product spec|jobs[- ]to[- ]be[- ]done|user stories?|acceptance criteria|product brief)\b/i,
  qaSignal: /\b(?:test plan|test cases?|test strategy|regression (?:suite|test)|exploratory testing|bug repro|reproduction steps?|edge cases? to test|test coverage|smoke test)\b/i,
};

// Map each persona id to:
//   • inLane(text) - which domain signals are IN their lane (always permit)
//   • outOfLane(text) - which signals are definitively OUT of their lane
function heuristicCheck(persona: Persona, task: string): LaneCheck | null {
  const id = persona.id;
  const t = task;

  // Per-persona out-of-lane signals + suggested hire.
  // The structure: each entry = { sig: signal regex, hire: who to recommend }.
  // We pick the FIRST matching signal. If no signal matches, return null
  // (caller falls through to LLM check).
  type Rule = { sig: RegExp; hire: string };
  const rulesByPersona: Record<string, Rule[]> = {
    "customer-success":      [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }, { sig: SIGNALS.qaSignal, hire: "Quinn (QA Engineer)" }],
    "operations-coordinator":[{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }],
    "software-engineer":     [{ sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.csmSignal, hire: "Casey (Customer Success Lead)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }],
    "marketing-manager":     [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }, { sig: SIGNALS.qaSignal, hire: "Quinn (QA Engineer)" }],
    "researcher":            [{ sig: SIGNALS.csmSignal, hire: "Casey (Customer Success Lead)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }],
    "account-executive":     [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }],
    "recruiter":             [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }],
    "financial-analyst":     [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.csmSignal, hire: "Casey (Customer Success Lead)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }],
    "product-manager":       [{ sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }],
    "product-designer":      [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }],
    "data-analyst":          [{ sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.csmSignal, hire: "Casey (Customer Success Lead)" }],
    "contracts-reviewer":    [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.csmSignal, hire: "Casey (Customer Success Lead)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }, { sig: SIGNALS.qaSignal, hire: "Quinn (QA Engineer)" }],
    "executive-assistant":   [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }, { sig: SIGNALS.qaSignal, hire: "Quinn (QA Engineer)" }],
    "qa-engineer":           [{ sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.csmSignal, hire: "Casey (Customer Success Lead)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }],
    "devops-sre":            [{ sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.marketingSignal, hire: "Maya (Marketing Manager)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.csmSignal, hire: "Casey (Customer Success Lead)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.prdSignal, hire: "Priya (Product Manager)" }],
    "technical-writer":      [{ sig: SIGNALS.codeSignal, hire: "Sam (Software Engineer)" }, { sig: SIGNALS.sqlSignal, hire: "Dale (Data Analyst)" }, { sig: SIGNALS.legalSignal, hire: "Logan (Contracts Reviewer)" }, { sig: SIGNALS.financeSignal, hire: "Fiona (Financial Analyst)" }, { sig: SIGNALS.csmSignal, hire: "Casey (Customer Success Lead)" }, { sig: SIGNALS.designSignal, hire: "Dani (Product Designer)" }, { sig: SIGNALS.sreSignal, hire: "Devon (DevOps / SRE)" }],
  };

  const rules = rulesByPersona[id];
  if (!rules) return null; // Unknown persona — fall through to LLM check.
  for (const r of rules) {
    if (r.sig.test(t)) {
      return {
        inLane: false,
        reason: `Heuristic match — the task references domain-specific terms outside ${persona.role}'s lane.`,
        suggestedHire: r.hire,
      };
    }
  }
  return null; // No strong signal — LLM check has the call.
}

export async function checkLaneFit(persona: Persona, task: string): Promise<LaneCheck> {
  // First: fast heuristic. If it fires, we don't need the LLM round-trip.
  const heuristic = heuristicCheck(persona, task);
  if (heuristic) return heuristic;

  // Compact prompt — the LLM check fires after the heuristic above passed,
  // so we're handling subtler cases. Keep it terse so local qwen2.5:3b can
  // respond in under 6 seconds.
  const sys = `Is the customer task in ${persona.name}'s lane (Role: ${persona.role})?

${persona.name}'s responsibilities: ${persona.responsibilities.slice(0, 4).join("; ") || persona.description}

Other employees the customer could hire instead: ${ROSTER_BLURB}.

Be strict — out-of-lane means recommend the right hire from the roster.

Reply ONLY with a JSON object:
{"inLane": true|false, "reason": "<one short line>", "hire": "<Name (Role)>"}

Omit "hire" when inLane is true.`;

  // Force the lane check to local Ollama, NOT OpenRouter. The free-tier OR
  // model gets rate-limited hard when the user is also running other tasks,
  // and a 429 here would make every out-of-lane request slip through (fail-
  // open). Local Ollama is always reachable and qwen2.5:3b handles a small
  // JSON classification in 2-3s comfortably.
  async function callLocal(): Promise<string> {
    return Promise.race([
      ollamaGenerate(`Customer task: ${task.slice(0, 1800)}`, sys, { profile: undefined }),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error(`lane check timeout after ${LANE_CHECK_TIMEOUT_MS}ms`)), LANE_CHECK_TIMEOUT_MS),
      ),
    ]);
  }

  try {
    const out = await callLocal();
    const m = out.match(/\{[\s\S]*\}/);
    if (!m) return { inLane: true, reason: "lane check returned no JSON; permitting" };
    const parsed = JSON.parse(m[0]);
    return {
      inLane: Boolean(parsed.inLane),
      reason: String(parsed.reason ?? "").slice(0, 240),
      suggestedHire: parsed.hire ? String(parsed.hire).slice(0, 80) : undefined,
    };
  } catch (e: any) {
    // Fail-open: a stuck/erroring lane check shouldn't block valid work.
    // The persona's own prompt-level lane rule is the backup.
    return { inLane: true, reason: `lane check failed: ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

export function buildOutOfLaneRefusal(persona: Persona, check: LaneCheck): string {
  const lines: string[] = [];
  lines.push(`This is outside my lane as a ${persona.role}.`);
  if (check.reason) {
    lines.push("");
    lines.push(check.reason);
  }
  lines.push("");
  if (check.suggestedHire) {
    lines.push(`For this kind of work, hire **${check.suggestedHire}**. Switch to that employee in the dashboard and re-send the task — they'll handle it properly.`);
  } else {
    lines.push(`Pick the right employee from the NeuroWorks roster and re-send. The full lineup: ${ROSTER_BLURB}.`);
  }
  lines.push("");
  lines.push(`If part of the task IS in ${persona.role} territory, tell me which part and I'll scope it.`);
  return lines.join("\n");
}
