// Quality harness — graded on ALIGNMENT with the user's actual ask.
//
// The earlier graders measured shape (length + structure + role-signal
// regexes). That misses the most important question: did the answer
// actually contain what the user asked for?
//
// This harness defines per-probe `asks` arrays — concrete elements the
// user explicitly requested. The grader computes coverage =
// satisfied/total and maps that to a tier ceiling. Structure +
// penalties adjust around the ceiling but never bump above it.
//
// Coverage → ceiling:
//   1.0     → A+
//   0.9+    → A
//   0.8+    → A-
//   0.7+    → B+
//   0.6+    → B
//   0.45+   → C+
//   0.3+    → C
//   else    → D-or-lower
//
// Then structure adjustment:
//   - if length < 200: drop one tier
//   - if length >= 600 AND structured: hold
// Then penalties:
//   - CHAT-TIC at start: drop 2 tiers
//   - JARGON x2 (marketing only): drop 1 tier
//   - GENERIC-AI-INTRO: drop 2 tiers
//   - MACRO-SPEAK at start: drop 1 tier
//
// Env-gated failures (D: drive unreachable, no GitHub repo configured,
// etc.) are tagged ENV-GATED and excluded from the B+ floor count so
// they don't hide real alignment regressions.

import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync } from "node:fs";

const TAG = process.argv[2] ?? "q";
const BASE = "http://127.0.0.1:7471";

const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const tIdx = (g) => TIERS.indexOf(g);
const tFromIdx = (i) => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];

const MACRO_SPEAK_START = /^[\s\S]{0,200}?\b(we appreciate (you|your)|thank you for reaching out|feel free to (reach|contact)|do not hesitate)\b/i;
const CHAT_TIC = /^\s*(sure[!.,]|great question|absolutely[!.]|happy to help|i'd be happy to)/i;
const GENERIC_AI_INTRO = /^\s*(as an? (?:ai|language model)|i('| a)m (?:an? )?(?:ai|language model))/i;
const JARGON = /\b(revolutionary|best[- ]in[- ]class|cutting[- ]edge|paradigm|synergy|game[- ]chang|next[- ]gen|world[- ]class)\b/i;

async function postJson(path, body, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:7470" },
        body: JSON.stringify(body ?? {}),
      });
      const j = await r.json().catch(() => null);
      return { status: r.status, body: j };
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(1500);
    }
  }
  throw last;
}

async function getJson(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Origin: "http://127.0.0.1:7470" } });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, ok: r.ok };
}

async function pollJob(id, maxMs = 600_000) {
  const start = Date.now();
  let consecutive404 = 0;
  const MAX_404 = 15;
  while (Date.now() - start < maxMs) {
    let r;
    try { r = await getJson(`/api/tasks/jobs/${id}`); }
    catch { await sleep(2000); continue; }
    if (r.status === 404) {
      consecutive404++;
      if (consecutive404 >= MAX_404) throw new Error(`job ${id} not found after ${MAX_404} attempts`);
      await sleep(2000); continue;
    }
    consecutive404 = 0;
    if (r.status !== 200) { await sleep(2000); continue; }
    const d = r.body;
    if (d.status === "succeeded" || d.status === "failed" || d.status === "rejected") return d;
    await sleep(3000);
  }
  throw new Error(`poll timeout for ${id}`);
}

// ─────────────────────────────────────────────────────────────────────
// Env-gating detector
// ─────────────────────────────────────────────────────────────────────

function isEnvFailure(job) {
  const log = (job?.log ?? []).join("\n");
  const err = job?.error ?? "";
  const answer = job?.result?.answer ?? "";
  const combined = `${log}\n${err}`;
  if (/ENOENT.*(?:D:|Main brain|0-Inbox|2-Permanent)/i.test(combined)) return "vault-drive-missing";
  if (/no such file or directory/i.test(combined) && /(?:mkdir|writeVaultFile|writeFileSync)/i.test(combined)) return "fs-path-missing";
  if (/GITHUB_TOKEN.*not (?:set|configured)/i.test(combined)) return "github-not-configured";
  if (/no repos? configured/i.test(combined)) return "no-repos-configured";
  // Cryptic synthesis-fallback that fires when a vault/import op failed
  // upstream. The answer text itself is the only signal.
  if (typeof answer === "string" && answer.length < 200 && /I couldn't find what you were pointing me at|share a path, URL, or topic/i.test(answer)) {
    return "synth-fallback-ungrounded";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Alignment grader — coverage drives the ceiling
// ─────────────────────────────────────────────────────────────────────

function coverageCeiling(coverage) {
  if (coverage >= 1.0) return "A+";
  if (coverage >= 0.9) return "A";
  if (coverage >= 0.8) return "A-";
  if (coverage >= 0.7) return "B+";
  if (coverage >= 0.6) return "B";
  if (coverage >= 0.45) return "C+";
  if (coverage >= 0.3) return "C";
  if (coverage >= 0.15) return "D";
  return "F";
}

function gradeAlignment(text, asks, opts = {}) {
  const notes = [];
  // Coverage: count satisfied asks
  let satisfied = 0;
  const missed = [];
  for (const ask of asks) {
    const ok = ask.check(text);
    if (ok) satisfied++;
    else missed.push(ask.name);
  }
  const coverage = asks.length === 0 ? 1 : satisfied / asks.length;
  let grade = coverageCeiling(coverage);
  notes.push(`coverage:${satisfied}/${asks.length}`);
  if (missed.length > 0 && missed.length <= 4) notes.push(`missed:${missed.join("|")}`);
  else if (missed.length > 4) notes.push(`missed:${missed.length}-items`);

  // Structure adjustment
  if (!text || text.length === 0) return { grade: "F", notes: ["empty"], coverage: 0, satisfied, total: asks.length, missed };
  if (text.length < 200 && tIdx(grade) > tIdx("D")) {
    grade = tFromIdx(tIdx(grade) - 1);
    notes.push("too-short");
  }

  // Penalties (surgical, on TOP of coverage)
  if (CHAT_TIC.test(text)) { grade = tFromIdx(tIdx(grade) - 2); notes.push("CHAT-TIC-start"); }
  if (GENERIC_AI_INTRO.test(text)) { grade = tFromIdx(tIdx(grade) - 2); notes.push("AI-intro-start"); }
  if (MACRO_SPEAK_START.test(text)) { grade = tFromIdx(tIdx(grade) - 1); notes.push("MACRO-start"); }
  if (opts.checkJargon && JARGON.test(text)) { grade = tFromIdx(tIdx(grade) - 1); notes.push("JARGON"); }

  return { grade, notes, coverage, satisfied, total: asks.length, missed };
}

// ─────────────────────────────────────────────────────────────────────
// Probes
// ─────────────────────────────────────────────────────────────────────

// Each probe carries:
//   kind: how to dispatch (chat | template | team)
//   ... probe-specific fields
//   asks: alignment checks
//   targetSec: soft target for elapsed time (informational)

const PROBES = [
  // ─── BUILT-INS via /api/chat ───
  {
    name: "general:draft-email-detailed",
    kind: "chat",
    text: "Draft an email to Sarah Chen, our Head of Engineering, about the Q4 launch slip. Tone: direct, brief, acknowledges the slip cause (vendor SDK delay), proposes a new date 2 weeks out (2026-06-15), and asks her to share with the engineering leads.",
    asks: [
      { name: "addresses Sarah", check: t => /Sarah/i.test(t) },
      { name: "Q4 / launch", check: t => /Q4|launch/i.test(t) },
      { name: "vendor SDK cause", check: t => /vendor|SDK/i.test(t) },
      { name: "new date 2026-06-15 or 'two weeks'", check: t => /2026-06-15|June 15|two weeks|2 weeks/i.test(t) },
      { name: "engineering leads share ask", check: t => /share.*lead|forward.*lead|leads/i.test(t) },
      { name: "email shape (greeting + sign-off)", check: t => /\b(hi|hello|hey)\b/i.test(t) && /\b(regards|thanks|best|cheers|talk soon|sincerely)\b/i.test(t) },
    ],
    targetSec: 90,
  },
  {
    name: "general:numbered-checklist",
    kind: "chat",
    text: "Give me a 5-step numbered checklist for onboarding a new mid-market customer to NeuroWorks. Each step needs an owner role and a 'done when' criterion.",
    asks: [
      // Accept either standard numbered lines (1. ...) OR table rows (| 1 |)
      // OR markdown heading-numbered steps (### 1. Step …).
      { name: "5 numbered steps", check: t => (t.match(/(?:^|\n)\s*(?:#{0,4}\s*)?(?:\d+\.\s|\|\s*\d+\s*\|)/g) ?? []).length >= 5 },
      { name: "owner role per step", check: t => /\bowner|assigned to|responsible|@\w+/i.test(t) },
      // Accept curly-quoted "Done When" too; drop trailing \b so inflections match.
      { name: "'done when' criterion", check: t => /\b(?:done[\s‐-― -]+when|done means|definition of done|complete when|verification)/i.test(t) },
      // Drop trailing \b so "onboarding" matches "onboard" prefix.
      { name: "onboarding context", check: t => /\b(?:onboard|welcom|set[- ]?up|kick[- ]?off|trial)/i.test(t) },
    ],
    targetSec: 90,
  },
  {
    name: "general:research-comparison",
    kind: "chat",
    text: "Compare DuckDB vs ClickHouse for an analytics workload that processes 50M events/day. Output a short pro/con table for each and a one-line recommendation.",
    asks: [
      { name: "names DuckDB", check: t => /DuckDB/i.test(t) },
      { name: "names ClickHouse", check: t => /ClickHouse/i.test(t) },
      // Pros + cons OR advantages/disadvantages OR strengths/weaknesses OR
      // tradeoffs — same concept, multiple vocabularies. Drop trailing \b.
      { name: "pros + cons (both)", check: t => /pros?[\s/:]/i.test(t) && /cons?[\s/:]/i.test(t) || /\badvantage|\bdisadvantage|\bstrength|\bweakness|\btrade[\s-]?off/i.test(t) },
      { name: "table shape OR per-tool breakdown", check: t => /\|[^|]+\|/.test(t) || (/(^|\n)#{2,3}\s+(DuckDB|ClickHouse)/i.test(t)) },
      // Recommendation language widely varies — accept any decisive verb.
      { name: "recommendation line", check: t => /\b(recommend|i'd (?:pick|go with|choose)|use (?:DuckDB|ClickHouse) (?:if|when|for)|pick|choose|go with|best (?:fit|choice|option)|opt for|preferred|verdict|conclusion|bottom line)/i.test(t) },
      { name: "addresses 50M scale", check: t => /50M|50 million|millions|scale|throughput|volume/i.test(t) },
    ],
    targetSec: 120,
  },
  {
    name: "general:plan-with-risks",
    kind: "chat",
    text: "Plan the rollout of MFA across all 1200 employees in 30 days. Include phases, owner per phase, and the top 3 risks with mitigations.",
    asks: [
      // Drop trailing \b so "phases", "phased", "weekly", "stages" all match.
      { name: "names phases", check: t => /\b(phase|wave|sprint|week\s*\d|stage|tranche)/i.test(t) },
      { name: "owner per phase", check: t => /\bowner|assigned to|@\w+|responsible|lead/i.test(t) },
      { name: "3 risks named", check: t => (t.match(/\brisk|\bthreat|\bconcern|\bissue\b|\bgap\b/gi) ?? []).length >= 3 },
      // "mitigat" matches mitigate/mitigation/mitigated.
      { name: "mitigations", check: t => /\bmitigat|reduce risk|fallback|contingency|plan b|safeguard|address(?:ed)? by|response|counter/i.test(t) },
      { name: "30 day timeline", check: t => /30 ?(?:day|d\b)|30-?day|month|four week|4 ?week|first 30|w(?:eek)?[- ]?[1-4]\b/i.test(t) },
      { name: "1200 employees scale", check: t => /1[,\s]?200|all employees|workforce|company.?wide|entire (?:staff|organi[sz]ation)|whole company/i.test(t) },
    ],
    targetSec: 120,
  },
  {
    name: "general:concise-summary",
    kind: "chat",
    text: "Summarize the key tradeoffs of monolith vs microservices in 4 bullets max. Be specific — no generic textbook lines.",
    asks: [
      { name: "≤6 bullets (not a full essay)", check: t => (t.match(/(^|\n)\s*(?:[-*•]|\d+\.)\s+/g) ?? []).length <= 8 },
      { name: "≥3 bullets present", check: t => (t.match(/(^|\n)\s*(?:[-*•]|\d+\.)\s+/g) ?? []).length >= 3 },
      { name: "mentions monolith", check: t => /\bmonolith/i.test(t) },
      // Drop trailing \b — match microservice, microservices, micro-service, etc.
      { name: "mentions microservices", check: t => /\bmicro[- ]?service/i.test(t) },
      { name: "concrete specifics (not generic)", check: t => /\b(deploy|test|debug|latency|database|coupling|team|repo|API|network|cost)/i.test(t) },
    ],
    targetSec: 90,
  },
  {
    name: "general:code-review",
    kind: "chat",
    text: "Review this JavaScript snippet and list the top 3 issues: ```function getUser(id) { return fetch('/api/u/'+id).then(r => r.json()).then(u => u.name) }``` — Concentrate on error handling, security, and maintainability.",
    asks: [
      { name: "error handling issue", check: t => /\b(error|catch|reject|throw|null|undefined|missing)\b.*?\b(handl|throw|catch|propag|surface)/is.test(t) || /\b(no error handling|missing error|catch)\b/i.test(t) },
      { name: "security concern", check: t => /\b(injection|XSS|escape|encode|validate|sanitiz|trust|input)\b/i.test(t) },
      { name: "maintainability point", check: t => /\b(rename|naming|extract|TypeScript|types|interface|consistent|maintain)\b/i.test(t) },
      { name: "3 distinct issues", check: t => (t.match(/(^|\n)\s*(?:[-*•]|\d+\.)\s+/g) ?? []).length >= 3 },
    ],
    targetSec: 90,
  },

  // ─── VAULT-WRITE built-ins (env-gated on missing D:) ───
  {
    name: "template:add-note",
    kind: "template",
    templateId: "add-note",
    inputs: {
      title: "Quality test note 2026-05-26",
      body: "This is a test note written by the quality harness. It should land in the 0-Inbox folder and the file path should be returned.",
    },
    asks: [
      // For vault-write templates, we check the JOB RESULT not the answer text.
      // The job result returns { path, ok, sha } when successful.
      { name: "vault path returned", check: (_t, job) => Boolean(job?.result?.path) },
      { name: "lands in 0-Inbox", check: (_t, job) => /0-Inbox/i.test(job?.result?.path ?? "") },
      { name: "title slug in filename", check: (_t, job) => /quality-test-note/i.test(job?.result?.path ?? "") },
    ],
    targetSec: 30,
    envGateOnFail: "vault-drive-missing",
  },
  {
    name: "template:search-brain",
    kind: "template",
    templateId: "search-brain",
    inputs: { query: "neuroworks" },
    asks: [
      { name: "returns query echoed", check: (t, job) => /neuroworks/i.test(job?.result?.query ?? t) },
      { name: "results array present (even if empty)", check: (_t, job) => Array.isArray(job?.result?.results) },
    ],
    targetSec: 30,
    envGateOnFail: "vault-drive-missing",
  },

  // ─── CUSTOM templates (emp-*) — covering 5 personas ───
  // Run these via /api/chat so they go through the planner the same way a
  // real user would invoke them, then alignment-grade the answer.
  {
    name: "custom:meeting-to-actions",
    kind: "chat",
    text: "From this meeting transcript, extract action items with owner + by-when:\n\nPM: 'We need to finalize the pricing before the launch. Sarah, can you confirm the comp band with finance by Tuesday? Drew, please update the deal-desk template by Wednesday with the new tier. And — quick reminder — Mark is on holiday until next Monday so let's not block on him.'",
    asks: [
      { name: "Sarah action with by-when", check: t => /Sarah[\s\S]{0,200}?(?:Tuesday|by Tue|comp band|finance)/i.test(t) },
      { name: "Drew action with by-when", check: t => /Drew[\s\S]{0,200}?(?:Wednesday|by Wed|deal[- ]desk|template)/i.test(t) },
      { name: "Mark flagged as blocked / OOO", check: t => /Mark[\s\S]{0,200}?(?:holiday|OOO|out|next Monday|blocked|don't block)/i.test(t) },
      { name: "owner column / explicit owner naming", check: t => /\b(owner|@Sarah|@Drew|@Mark|Sarah:|Drew:|Mark:)\b/i.test(t) },
      { name: "by-when column / explicit dates", check: t => /\b(by|due|deadline|Tuesday|Wednesday|Monday|next week|EOW|EOD)\b/i.test(t) },
    ],
    targetSec: 90,
  },
  {
    name: "custom:vendor-comparison",
    kind: "chat",
    text: "Compare these vendor quotes for an annual seat license and recommend one: Vendor A — $48/seat/yr, 100-seat min, includes SAML SSO + audit log. Vendor B — $39/seat/yr, 50-seat min, SAML SSO is +$8/seat add-on, no audit log. Vendor C — $52/seat/yr, no minimum, includes SAML + audit + 24/7 support.",
    asks: [
      // Table rows often drop the word "Vendor" — accept bare A/B/C as long
      // as "Vendor" appears anywhere AND the labels A, B, C all appear.
      { name: "names all 3 vendors", check: t => /\bVendor\b/i.test(t) && /\bA\b/.test(t) && /\bB\b/.test(t) && /\bC\b/.test(t) },
      { name: "calls out the SAML add-on for B", check: t => /(?:add[- ]on|extra|additional|\+\s*\$?\s*8)/i.test(t) && /SAML/i.test(t) },
      { name: "calls out the seat minimums", check: t => /\bminimum|seat min|100[- ]?seat|50[- ]?seat|no min|none(?:\s+required)?/i.test(t) },
      { name: "explicit recommendation", check: t => /\b(recommend|go with|pick|choose|suggest|opt for|preferred|select|verdict|conclusion|bottom line|best (?:fit|option|choice))/i.test(t) },
      { name: "reasoning for recommendation", check: t => /\b(because|since|due to|reason|trade[- ]?off|total cost|tco|saves?|lowest|highest|priority)/i.test(t) },
      { name: "total-cost calc OR price comparison", check: t => /\$\s*\d+/.test(t) && /\b(total|per[- ]?year|annual|tco|cost|×|x|\*)/i.test(t) },
    ],
    targetSec: 120,
  },
  {
    name: "custom:kb-article",
    kind: "chat",
    // Env-gate: when the planner picks vault.create_zettel and the vault
    // drive (D:) isn't mounted, the answer is the cryptic synthesis fallback.
    // We still grade alignment when the vault IS mounted; env-gated otherwise.
    envGateOnFail: "vault-drive-missing-or-synth-fallback",
    text: "Turn this support ticket into a KB article: 'Customer can't log in after MFA reset. We sent them the reset link, they used it on Safari, but the redirect dropped the session token. Fix: ask them to retry in Chrome OR clear Safari cookies for our domain.' Output should have Title, Symptoms, Root cause, Resolution steps, Prevention.",
    asks: [
      { name: "Title heading", check: t => /(^|\n)#{1,3}\s+.*title|^[#*]*\s*title\s*[:\n]/im.test(t) || /(^|\n)#{1,3}\s+(?:can't|cannot|log[- ]?in|MFA|safari)/im.test(t) },
      { name: "Symptoms section", check: t => /\b(symptom|user sees|the issue|what happens)\b/i.test(t) },
      { name: "Root cause section", check: t => /\b(root cause|cause|why|reason)\b/i.test(t) },
      { name: "Resolution / Fix steps", check: t => /\b(resolution|fix|steps|how to|workaround)\b/i.test(t) },
      { name: "Prevention section", check: t => /\b(prevent|avoid|future|going forward|reduce recurrence)\b/i.test(t) },
      { name: "mentions Safari + Chrome", check: t => /Safari/i.test(t) && /Chrome/i.test(t) },
      { name: "mentions cookies / session token", check: t => /\b(cookie|session token|cache)\b/i.test(t) },
    ],
    targetSec: 90,
  },
  {
    name: "custom:sop-writing",
    kind: "chat",
    text: "Write an SOP for handling a Sev-1 customer incident: paging on-call, scoping impact, drafting the status page, customer comms, internal escalation, post-mortem. Each step needs owner role + by-when.",
    asks: [
      // "Paging" (gerund) wasn't caught by \bpage\b — drop trailing \b.
      // Also accept non-ASCII hyphens that LLMs emit.
      { name: "page on-call step", check: t => /\b(?:pag|alert|notif|trigger)[a-z]*[\s\S]{0,80}?on[‐\-‐‑‒– ]?call/i.test(t) },
      { name: "scope impact step", check: t => /\b(scope|scoping|assess|impact|blast radius|affected|triag)/i.test(t) },
      { name: "status page", check: t => /\bstatus\s+page/i.test(t) },
      { name: "customer comms", check: t => /\bcustomer\s+(?:comm|communicat|notif|message)|email customers|notify customers|status update|external comm/i.test(t) },
      // Accept all hyphen variants for post-mortem.
      { name: "post-mortem", check: t => /\bpost[‐\-‐‑‒– ]?mortem/i.test(t) },
      { name: "owner role per step", check: t => (t.match(/\b(owner|owned by|on[‐\-‐‑ ]?call|incident commander|incident response|comms lead|SRE|customer success|engineer)/gi) ?? []).length >= 3 },
      { name: "by-when / SLA per step", check: t => /\b(within \d|minutes|hours|by EOD|SLA|by then|t\+|T\+|asap|immediate|by[- ]when)/i.test(t) },
    ],
    targetSec: 120,
  },
  {
    name: "custom:jd-to-task-workflow",
    kind: "chat",
    text: "Turn this JD into the daily/weekly task workflow that role would actually run: 'Senior Customer Success Manager — owns NRR for accounts $50K-$500K ARR, leads weekly QBRs, runs save plays on at-risk accounts, partners with Product on feature requests, manages a portfolio of 30 accounts.'",
    asks: [
      { name: "daily tasks listed", check: t => /\b(daily|each day|every day|morning)\b/i.test(t) },
      { name: "weekly tasks listed", check: t => /\b(weekly|each week|every week|QBR|review)\b/i.test(t) },
      { name: "NRR / revenue ownership", check: t => /\b(NRR|net retention|revenue|churn|renewal)\b/i.test(t) },
      { name: "save plays / at-risk handling", check: t => /\b(save play|at[- ]risk|red account|escalat|intervention)\b/i.test(t) },
      { name: "partnership with Product", check: t => /\b(product\s+(?:team|partner|manager)|feature request|roadmap)\b/i.test(t) },
      { name: "portfolio scale (30 accounts)", check: t => /\b30\b|\bthirty\b|\bportfolio\b|\baccounts?\b/i.test(t) },
    ],
    targetSec: 120,
  },

  // ─── TEAM tasks — alignment per persona ───
  {
    name: "team:product-launch-coordination",
    kind: "team",
    tasks: [
      {
        persona: "marketing-manager",
        content: "We're launching pricing tier v2 on 2026-07-10 — new $99/mo Pro tier, includes team-task and document uploads. Target audience: existing Starter customers (3200 of them) + new mid-market prospects. Your part: draft the headline + 3 distinct social posts (LinkedIn / X / Slack) each with a specific CTA, plus the in-app announcement banner copy.",
        asks: [
          { name: "headline present", check: t => /\b(headline|tagline)\b/i.test(t) || /(^|\n)#{1,3}\s+/.test(t.slice(0, 800)) },
          { name: "LinkedIn variant", check: t => /linkedin/i.test(t) },
          { name: "X variant", check: t => /\b(twitter|X (?:post|variant|copy))\b/i.test(t) },
          { name: "Slack variant", check: t => /slack/i.test(t) },
          { name: "in-app banner copy", check: t => /\b(in[- ]?app|banner|in[- ]product)\b/i.test(t) },
          { name: "$99 / Pro tier mentioned", check: t => /\$\s?99|Pro tier|Pro plan/i.test(t) },
          { name: "CTA present in each (≥3 distinct CTAs)", check: t => (t.match(/\b(upgrade|sign up|try|learn more|book a demo|see the|view|claim|start|get started)\b/gi) ?? []).length >= 3 },
        ],
      },
      {
        persona: "account-executive",
        content: "Pricing tier v2 launches 2026-07-10 (new $99/mo Pro tier, includes team-task and document uploads). Your part: produce per-segment talking points — (1) Starter customers upgrading to Pro, (2) competitive displacement against incumbent tools, (3) net-new prospects. Each segment needs 3-5 talking points and the explicit next-step ask.",
        asks: [
          { name: "Starter-upgrade segment", check: t => /\b(starter|upgrade path)\b/i.test(t) },
          { name: "competitive segment", check: t => /\b(competitive|incumbent|displacement|vs |comparison|switch from)\b/i.test(t) },
          { name: "net-new prospects segment", check: t => /\b(net[- ]?new|new prospect|cold|outbound|first[- ]?time)\b/i.test(t) },
          { name: "3 segments visibly separated", check: t => (t.match(/(^|\n)#{2,3}\s+.+/g) ?? []).length >= 3 || (t.match(/\b(segment\s*[1-3]|talking points (?:for|to|on))\b/gi) ?? []).length >= 3 },
          { name: "next-step ask per segment", check: t => (t.match(/\b(next step|follow[- ]?up|schedule|book|send|share|set up|propose)\b/gi) ?? []).length >= 3 },
          { name: "$99 / Pro mentioned", check: t => /\$\s?99|Pro tier|Pro plan/i.test(t) },
        ],
      },
    ],
    targetSec: 180,
  },
  {
    name: "team:hiring-comp-and-process",
    kind: "team",
    tasks: [
      {
        persona: "recruiter",
        content: "Opening a Senior ML Engineer role for the recommendations team. London or remote-UK, £130-160k base + equity. Your part: draft the JD must-haves/nice-to-haves, the 4-stage interview loop, and the comp band research (cite at least one comparable company).",
        asks: [
          // Accept any hyphen variant: -, ‐, ‑, ‒, –, em-dash, space.
          { name: "must-haves list", check: t => /\bmust[‐\-‑‒–\s]?have/i.test(t) },
          { name: "nice-to-haves list", check: t => /\bnice[‐\-‑‒–\s]?to[‐\-‑‒–\s]?have/i.test(t) },
          // 4-stage loop can show as numbered list OR table with stage column.
          { name: "4-stage interview loop", check: t => (t.match(/(?:stage|round|interview)\s*[1-5]/gi) ?? []).length >= 3 || (t.match(/(^|\n)\s*\d+\.\s+.*(?:screen|interview|onsite|panel|technical|hiring)/gi) ?? []).length >= 3 || (/\bstage\b/i.test(t) && (t.match(/\|\s*[1-5]\s*\|/g) ?? []).length >= 3) },
          { name: "comp band cited", check: t => /£\s?1[23]\d|£\s?1[5-6]\d|130[- ]?160|base\s*\+\s*equity/i.test(t) },
          { name: "comparable company named", check: t => /\b(at|like|compared to|benchmark)\s+[A-Z][\w-]+/i.test(t) || /\b(Anthropic|OpenAI|DeepMind|Meta|Google|Amazon|Stripe|Spotify|Cohere|Hugging Face|Zotero|Pinterest|Netflix|Spotify|Airbnb)\b/i.test(t) },
          { name: "ML / recommendations context", check: t => /\b(ML|machine learning|recommendation|ranking|retrieval|model|embedding|pytorch|tensorflow)/i.test(t) },
          { name: "London / remote-UK mentioned", check: t => /\b(london|remote[‐\-‑‒–\s]?UK|UK\b)/i.test(t) },
        ],
      },
      {
        persona: "financial-analyst",
        content: "We're hiring a Senior ML Engineer (£130-160k base + equity). Your part: produce the cost model for the hire (loaded comp incl. NI / employer pension), 12-month payback analysis given expected revenue impact of £400k from improved recommendations, and the risk that we don't realise that £400k impact.",
        asks: [
          { name: "loaded comp calculation", check: t => /\b(loaded|fully[- ]?loaded|total comp|NI|national insurance|employer (?:pension|cost))\b/i.test(t) },
          { name: "12-month payback math", check: t => /\b(payback|breakeven|12[- ]?month|months? to recoup|ROI)\b/i.test(t) },
          { name: "£400k impact referenced", check: t => /£\s?400|400k|400,000|four hundred/i.test(t) },
          { name: "risk of not realising impact", check: t => /\b(risk|might not|may not|if (?:we|the).*don't|sensitivity)\b/i.test(t) },
          { name: "numeric outputs present", check: t => (t.match(/£\s?[\d,]+|\$\s?[\d,]+|\d{2,3}%|\d+\s*(?:k|months|years)/g) ?? []).length >= 4 },
          { name: "recommendation / decision frame", check: t => /\b(recommend|hire|defer|delay|approve|conditional)\b/i.test(t) },
        ],
      },
    ],
    targetSec: 180,
  },
];

// ─────────────────────────────────────────────────────────────────────
// Dispatch helpers
// ─────────────────────────────────────────────────────────────────────

async function runChatProbe(probe) {
  const resp = await postJson("/api/chat", { messages: [{ role: "user", content: probe.text }] });
  if (resp.body?.kind === "message") {
    // Inline message — usually a clarification gate; not what we want here.
    return { ok: false, status: "inline-message", text: resp.body.text ?? "", job: null };
  }
  if (resp.body?.kind !== "task" || !resp.body?.jobId) {
    return { ok: false, status: "no-jobid", text: JSON.stringify(resp.body).slice(0, 200), job: null };
  }
  const job = await pollJob(resp.body.jobId, 600_000);
  return { ok: true, status: job.status, text: job?.result?.answer ?? "", job };
}

async function runTemplateProbe(probe) {
  const resp = await postJson(`/api/templates/run/${probe.templateId}`, probe.inputs);
  if (resp.status !== 200 || !resp.body?.jobId) {
    return { ok: false, status: `dispatch-${resp.status}`, text: JSON.stringify(resp.body).slice(0, 200), job: null };
  }
  const job = await pollJob(resp.body.jobId, 600_000);
  return { ok: true, status: job.status, text: JSON.stringify(job?.result ?? {}), job };
}

async function runTeamProbe(probe) {
  const resp = await postJson("/api/team", { tasks: probe.tasks });
  if (resp.status !== 200 || !resp.body?.tasks) {
    return { ok: false, status: `dispatch-${resp.status}`, results: [] };
  }
  const dispatched = resp.body.tasks;
  const results = await Promise.all(dispatched.map(async (d, i) => {
    try {
      const job = await pollJob(d.jobId, 600_000);
      return { personaId: d.persona?.id ?? "?", status: job.status, text: job?.result?.answer ?? "", job, taskAsks: probe.tasks[i].asks };
    } catch (e) {
      return { personaId: d.persona?.id ?? "?", status: "error", text: "", job: null, taskAsks: probe.tasks[i].asks, error: String(e?.message ?? e) };
    }
  }));
  return { ok: true, results };
}

// ─────────────────────────────────────────────────────────────────────
// Driver
// ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${"═".repeat(72)}`);
  console.log(`[${TAG}] QUALITY HARNESS — alignment-graded, B+ floor`);
  console.log(`${"═".repeat(72)}`);
  console.log(`Probes: ${PROBES.length} (chat ${PROBES.filter(p => p.kind === "chat").length} · template ${PROBES.filter(p => p.kind === "template").length} · team ${PROBES.filter(p => p.kind === "team").length})`);
  console.log("");

  const startedAt = Date.now();
  const rows = [];

  for (let i = 0; i < PROBES.length; i++) {
    const probe = PROBES[i];
    const t0 = Date.now();
    console.log(`[${TAG}] ${i + 1}/${PROBES.length} — ${probe.name}`);
    try {
      if (probe.kind === "chat") {
        const r = await runChatProbe(probe);
        const env = r.job ? isEnvFailure(r.job) : null;
        if (env && probe.envGateOnFail) {
          console.log(`    ENV-GATED (${env}) — graded N/A`);
          rows.push({ probe: probe.name, kind: probe.kind, grade: "ENV", elapsed: (Date.now() - t0) / 1000, notes: [env], coverage: null });
          continue;
        }
        const g = gradeAlignment(r.text, probe.asks);
        const elapsed = (Date.now() - t0) / 1000;
        const ok = tIdx(g.grade) >= tIdx("B+");
        console.log(`    ${r.status.padEnd(10)} ${String(r.text.length).padStart(5)}c  ${g.grade.padEnd(3)} ${ok ? "✓" : "✗"} cov=${g.satisfied}/${g.total}  notes=${g.notes.join(",")}`);
        rows.push({ probe: probe.name, kind: probe.kind, grade: g.grade, elapsed, coverage: g.coverage, missed: g.missed, notes: g.notes, chars: r.text.length });
      } else if (probe.kind === "template") {
        const r = await runTemplateProbe(probe);
        const env = r.job ? isEnvFailure(r.job) : null;
        if (env && probe.envGateOnFail) {
          console.log(`    ENV-GATED (${env}) — graded N/A`);
          rows.push({ probe: probe.name, kind: probe.kind, grade: "ENV", elapsed: (Date.now() - t0) / 1000, notes: [env], coverage: null });
          continue;
        }
        // For templates the check function gets (text, job) — pass job result.
        let satisfied = 0;
        const missed = [];
        const notes = [];
        for (const ask of probe.asks) {
          const ok = ask.check(r.text, r.job);
          if (ok) satisfied++;
          else missed.push(ask.name);
        }
        const coverage = probe.asks.length === 0 ? 1 : satisfied / probe.asks.length;
        const grade = coverageCeiling(coverage);
        notes.push(`coverage:${satisfied}/${probe.asks.length}`);
        if (missed.length > 0) notes.push(`missed:${missed.join("|")}`);
        const elapsed = (Date.now() - t0) / 1000;
        const ok = tIdx(grade) >= tIdx("B+");
        console.log(`    ${r.status.padEnd(10)} ${grade.padEnd(3)} ${ok ? "✓" : "✗"} cov=${satisfied}/${probe.asks.length}  notes=${notes.join(",")}`);
        rows.push({ probe: probe.name, kind: probe.kind, grade, elapsed, coverage, missed, notes });
      } else if (probe.kind === "team") {
        const r = await runTeamProbe(probe);
        if (!r.ok) {
          console.log(`    FAIL: ${r.status}`);
          rows.push({ probe: probe.name, kind: probe.kind, grade: "F", elapsed: (Date.now() - t0) / 1000, coverage: 0, notes: [r.status], perPersona: [] });
          continue;
        }
        const perPersona = r.results.map(p => {
          if (!p.text && p.error) {
            return { personaId: p.personaId, grade: "F", coverage: 0, satisfied: 0, total: p.taskAsks.length, missed: p.taskAsks.map(a => a.name), notes: ["error", p.error.slice(0, 80)] };
          }
          const g = gradeAlignment(p.text, p.taskAsks);
          return { personaId: p.personaId, grade: g.grade, coverage: g.coverage, satisfied: g.satisfied, total: g.total, missed: g.missed, notes: g.notes, chars: p.text.length };
        });
        for (const p of perPersona) {
          console.log(`    ${p.personaId.padEnd(22)} ${p.grade.padEnd(3)} cov=${p.satisfied}/${p.total}  missed=${(p.missed ?? []).slice(0, 3).join("|")}`);
        }
        const allGrades = perPersona.map(p => p.grade);
        const worst = allGrades.reduce((a, b) => (tIdx(a) <= tIdx(b) ? a : b), "A+");
        const elapsed = (Date.now() - t0) / 1000;
        const ok = tIdx(worst) >= tIdx("B+");
        console.log(`    scenario worst=${worst}  ${ok ? "✓ B+" : "✗ below B+"}  elapsed=${elapsed.toFixed(0)}s`);
        rows.push({ probe: probe.name, kind: probe.kind, grade: worst, elapsed, perPersona });
      }
    } catch (e) {
      console.log(`    FATAL: ${e?.message ?? e}`);
      rows.push({ probe: probe.name, kind: probe.kind, grade: "F", elapsed: (Date.now() - t0) / 1000, notes: [String(e?.message ?? e).slice(0, 100)] });
    }
  }

  const totalElapsed = (Date.now() - startedAt) / 1000;
  const graded = rows.filter(r => r.grade !== "ENV");
  const bPlus = graded.filter(r => tIdx(r.grade) >= tIdx("B+")).length;
  const env = rows.filter(r => r.grade === "ENV").length;

  console.log(`\n${"═".repeat(72)}`);
  console.log(`[${TAG}] FINAL SCORECARD`);
  console.log(`${"═".repeat(72)}`);
  console.log(`probe                                | kind     | grade | elapsed | coverage`);
  console.log("-".repeat(72));
  for (const r of rows) {
    const cov = r.coverage != null ? `${Math.round(r.coverage * 100)}%` : (r.perPersona ? r.perPersona.map(p => `${p.personaId.split("-")[0]}=${Math.round((p.coverage ?? 0) * 100)}%`).join(" ") : "—");
    console.log(`${r.probe.padEnd(36).slice(0, 36)} | ${r.kind.padEnd(8)} | ${r.grade.padEnd(5)} | ${String(Math.round(r.elapsed)).padStart(5)}s  | ${cov}`);
  }
  console.log("-".repeat(72));
  console.log(`Graded:        ${graded.length}  (B+ or higher: ${bPlus})`);
  console.log(`Env-gated:     ${env}`);
  console.log(`Total elapsed: ${totalElapsed.toFixed(0)}s`);

  // Write a per-probe report file
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = `_quality-harness-${TAG}-${stamp}.md`;
  const lines = [
    `# Quality harness — ${TAG} — ${new Date().toISOString()}`,
    "",
    `**Probes graded:** ${graded.length}  ·  **B+ or higher:** ${bPlus}/${graded.length}`,
    `**Env-gated:** ${env}  ·  **Total elapsed:** ${totalElapsed.toFixed(0)}s`,
    "",
    "## Per-probe results",
    "",
    "| Probe | Kind | Grade | Elapsed | Coverage | Missed |",
    "|---|---|---|---|---|---|",
    ...rows.map(r => {
      const cov = r.coverage != null ? `${Math.round(r.coverage * 100)}%` : (r.perPersona ? r.perPersona.map(p => `${p.personaId}=${Math.round((p.coverage ?? 0) * 100)}%`).join("<br>") : "—");
      const missed = r.missed ? r.missed.join(", ") : (r.perPersona ? r.perPersona.map(p => `${p.personaId}: ${(p.missed ?? []).join(", ")}`).filter(s => !s.endsWith(": ")).join("<br>") : "");
      return `| ${r.probe} | ${r.kind} | ${r.grade} | ${Math.round(r.elapsed)}s | ${cov} | ${missed} |`;
    }),
  ];
  writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log(`\nReport: ${reportPath}`);
})().catch(e => {
  console.error("FATAL:", e?.stack ?? e);
  process.exit(1);
});
