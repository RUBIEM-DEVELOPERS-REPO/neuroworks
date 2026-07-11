// Skills registry. Skills are short markdown playbooks the agent can load
// when working on a relevant task — "how to write a good email", "how to
// structure meeting notes", "how to do solid research". They're not personas
// (which set identity); they're closer to checklists / employee handbooks
// that bias the synth's output toward what a good operator would produce.
//
// Two sources:
//   • Built-in: ships in server/src/skills/*.md (8 curated playbooks).
//   • Local-user: server/src/skills/_user/*.md (gitignored), so the user
//     can drop their own .md files without rebuilding.
//
// Lookup is by stable name (the `name:` frontmatter field, or the filename
// without .md). Auto-suggestion matches a task's detected intent to the
// `applies_to` frontmatter — e.g. intent=draft-email pulls email-writing.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_BUILTIN = resolve(__dirname, "../skills");
const SKILLS_USER = resolve(__dirname, "../skills/_user");

export type Skill = {
  name: string;
  description: string;
  applies_to: string[];
  body: string;          // full markdown body (after the frontmatter block)
  source: "builtin" | "user" | "remote";
  path: string;          // absolute path on disk
};

// Cache parsed skills by absolute path + mtime so we don't re-parse on every
// list/load call. Bust an entry when its mtime advances.
const cache = new Map<string, { mtime: number; skill: Skill }>();

function parseFrontmatter(rawIn: string): { meta: Record<string, any>; body: string } {
  // Normalize CRLF first — core.autocrlf on Windows checks these .md files
  // out with \r\n, and the frontmatter regex below requires bare \n. Without
  // this, every skill's applies_to silently comes back empty after any fresh
  // Windows checkout (intent-based matching goes dark; keyword matching still
  // partly works since it falls back to the filename, which masked this for
  // a while).
  const raw = rawIn.replace(/\r\n/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const metaRaw = m[1];
  const body = m[2];
  const meta: Record<string, any> = {};
  for (const line of metaRaw.split("\n")) {
    const kv = line.match(/^\s*([\w_-]+):\s*(.+?)\s*$/);
    if (!kv) continue;
    const key = kv[1];
    let val: any = kv[2].trim();
    // Array form: [a, b, c] — split on commas, strip quotes.
    if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map((s: string) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      val = val.replace(/^["']|["']$/g, "");
    }
    meta[key] = val;
  }
  return { meta, body };
}

function loadSkillFromDisk(fullPath: string, source: Skill["source"]): Skill | null {
  try {
    const st = statSync(fullPath);
    const hit = cache.get(fullPath);
    if (hit && hit.mtime === st.mtimeMs) return hit.skill;
    const raw = readFileSync(fullPath, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const name = String(meta.name ?? basename(fullPath, ".md")).trim();
    const description = String(meta.description ?? "(no description)").trim();
    const applies_to = Array.isArray(meta.applies_to) ? meta.applies_to.map(String) : [];
    const skill: Skill = { name, description, applies_to, body: body.trim(), source, path: fullPath };
    cache.set(fullPath, { mtime: st.mtimeMs, skill });
    return skill;
  } catch {
    return null;
  }
}

export function listSkills(): Skill[] {
  const out: Skill[] = [];
  for (const dir of [SKILLS_BUILTIN, SKILLS_USER]) {
    if (!existsSync(dir)) continue;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith(".md")) continue;
      const full = join(dir, name);
      const stat = statSync(full);
      if (!stat.isFile()) continue;
      const source: Skill["source"] = dir === SKILLS_BUILTIN ? "builtin" : "user";
      const skill = loadSkillFromDisk(full, source);
      if (skill) out.push(skill);
    }
  }
  return out;
}

// Resolve a skill by name. Match is case-insensitive on the stable name.
// User-source wins over builtin when there's a name collision — lets a user
// override a built-in playbook without forking the codebase.
export function loadSkill(name: string): Skill | null {
  const target = name.trim().toLowerCase();
  const all = listSkills();
  const user = all.find(s => s.source === "user" && s.name.toLowerCase() === target);
  if (user) return user;
  return all.find(s => s.name.toLowerCase() === target) ?? null;
}

// Pick the best skill(s) for a given intent. Returns at most `limit` matches
// scored by how specifically the skill targets that intent (an applies_to
// list of [draft-email] is more specific than [draft-email, draft-other, …]).
// Returns [] when no skill targets the intent — caller should treat absence
// as "no skill guidance".
export function suggestSkillsForIntent(intent: string, limit = 2): Skill[] {
  const all = listSkills();
  const target = intent.trim().toLowerCase();
  if (!target) return [];
  const scored: { skill: Skill; score: number }[] = [];
  for (const s of all) {
    if (!s.applies_to.length) continue;
    const matches = s.applies_to.some(t => t.toLowerCase() === target);
    if (!matches) continue;
    // Fewer applies_to entries = more specific. Invert so smaller list wins.
    const specificity = 10 - Math.min(9, s.applies_to.length);
    scored.push({ skill: s, score: specificity });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.skill);
}

// Doc-type keyword → skill name. Used as a SECONDARY signal after intent
// matching: if the user literally says "draft a PRD" or "ADR for X", we
// load the matching skill even when the intent classifier missed (e.g. it
// labelled the task as generic "draft-other" because it didn't recognise PRD).
//
// Map keys are the *substring* we search for in the task body (case-
// insensitive). Word-boundary matching for short tokens prevents false hits
// ("api" wouldn't match "rapid").
const SKILL_KEYWORDS: { skill: string; patterns: RegExp[] }[] = [
  // The bare \bemail\b trigger is deliberately broad ("catch ANY email
  // task"), which meant it TIED with send-attachment's keyword score on any
  // "attach the file to the email" ask (both flat +15, and email-writing
  // wins ties by file/array order) — so the agent loaded generic email
  // guidance instead of the attach-don't-inline rule on exactly the tasks
  // that needed it (2026-07-08, Summit Recon incident regression guard).
  // Negative lookahead excludes tasks that also mention "attach" so those
  // route to send-attachment instead; plain email tasks are unaffected.
  { skill: "email-writing",          patterns: [/^(?!.*\battach).*\bemail\b/is, /\breply\s+to\b/i, /\bsend\s+(?:\w+\s+){0,3}(?:a\s+|an\s+|the\s+)?(?:report|update|summary|recap|status)\b/i] },
  { skill: "memo-writing",           patterns: [/\bmemo\b/i] },
  { skill: "report-writing",         patterns: [/\b(?:full|quarterly|annual)\s+report\b/i, /\banalysis\s+report\b/i] },
  { skill: "brief-writing",          patterns: [/(?<!negotiation[\s-])(?<!campaign[\s-])\b(?:executive\s+)?brief\b/i, /\bone[-\s]?pager\b/i] },
  { skill: "proposal-writing",       patterns: [/\bproposal\b/i, /\bpitch\s+(?:doc|deck)\b/i, /\brfp\s+response\b/i] },
  { skill: "product-spec",           patterns: [/\bprd\b/i, /\bproduct\s+(?:spec|requirements)\b/i, /\bproduct\s+brief\b/i] },
  { skill: "design-doc",             patterns: [/\bdesign\s+doc(?:ument)?\b/i, /\brfc\b/i, /\btechnical\s+design\b/i] },
  { skill: "decision-doc",           patterns: [/\badr\b/i, /\brfd\b/i, /\barchitecture\s+decision\b/i, /\bdecision\s+record\b/i] },
  { skill: "incident-post-mortem",   patterns: [/\bpost[\s-]?mortem\b/i, /\bincident\s+(?:report|review)\b/i, /\bretro\s+for\s+(?:the\s+)?(?:incident|outage)\b/i] },
  { skill: "root-cause-analysis",    patterns: [/\broot\s+cause\b/i, /\brca\b/i, /\b5\s+whys?\b/i, /\bfive\s+whys?\b/i] },
  { skill: "competitive-analysis",   patterns: [/\bcompetitor\b/i, /\bcompetitive\s+(?:analysis|landscape)\b/i, /\bmarket\s+landscape\b/i] },
  { skill: "okr-writing",            patterns: [/\bokrs?\b/i, /\bobjectives?\s+and\s+key\s+results\b/i] },
  { skill: "one-on-one-prep",        patterns: [/\b1[\s:.-]?1\b/i, /\bone[\s-]on[\s-]one\b/i] },
  { skill: "performance-review",     patterns: [/\b(?:perf|performance)\s+review\b/i, /\bself[\s-]?review\b/i] },
  { skill: "status-update",          patterns: [/\bstatus\s+update\b/i, /\bweekly\s+update\b/i, /\bstandup\s+(?:update|note)\b/i] },
  { skill: "weekly-review",          patterns: [/\bweekly\s+review\b/i, /\bweek\s+in\s+review\b/i] },
  { skill: "meeting-agenda",         patterns: [/\b(?:meeting\s+)?agenda\b/i] },
  { skill: "meeting-notes",          patterns: [/\bmeeting\s+notes\b/i, /\bminutes\s+of\s+the\s+meeting\b/i] },
  { skill: "announcement-writing",   patterns: [/\bannouncement\b/i, /\bannounce\b/i] },
  { skill: "feedback-giving",        patterns: [/\b(?:give|deliver|share)\s+(?:some\s+)?feedback\b/i, /\bfeedback\s+for\b/i] },
  { skill: "risk-assessment",        patterns: [/\brisk\s+(?:assessment|analysis|register)\b/i, /\bidentify\s+risks?\b/i] },
  { skill: "fact-check",             patterns: [/\bfact[\s-]?check\b/i, /\bverify\s+(?:a\s+|the\s+|this\s+)?claim\b/i, /\bis\s+it\s+true\s+that\b/i] },
  { skill: "comparison",             patterns: [/\bcompare\s+\S+\s+(?:to|with|vs\.?|and|versus)\s+\S/i, /\bside[\s-]by[\s-]side\b/i] },
  { skill: "contract-summary",       patterns: [/\bcontract\b/i, /\bagreement\b/i, /\bterms\s+of\s+service\b/i, /\btos\b/i, /\bnda\b/i] },
  { skill: "local-doc-summary",      patterns: [/\b(?:what(?:'?s|\s+is|\s+does)\s+in\s+this\b|summari[sz]e\s+this\s+(?:doc|file|pdf))/i] },
  // pc-doc-handling fires for "move/copy/save/file/import/add X to my vault/
  // knowledge/neuroworks/brain". Higher specificity than local-doc-summary
  // because it covers the find→read→file flow, not just read.
  { skill: "pc-doc-handling",        patterns: [/\b(?:move|copy|import|save|file|add|put|drop|stash|archive)\b.{0,40}\b(?:to|into|in)\s+(?:my\s+|the\s+)?(?:vault|second\s+brain|knowledge|neuroworks|obsidian|brain|inbox)\b/i] },
  { skill: "pr-description-writing", patterns: [/\bpull\s+request\b/i, /\bpr\s+description\b/i, /\bpr\s+body\b/i] },
  { skill: "commit-message-writing", patterns: [/\bcommit\s+message\b/i, /\bgit\s+commit\s+msg\b/i] },
  { skill: "testing-strategy",       patterns: [/\btest(?:ing)?\s+(?:strategy|plan)\b/i, /\bqa\s+plan\b/i] },
  { skill: "api-design",             patterns: [/\bapi\s+design\b/i, /\brest\s+api\b/i, /\bendpoint\s+design\b/i] },
  { skill: "debugging-help",         patterns: [/\bdebug\b/i, /\berror\b/i, /\bcrashe?s?\b/i, /\bstack\s+trace\b/i, /\bnot\s+working\b/i] },
  { skill: "code-review",            patterns: [/\bcode\s+review\b/i, /\breview\s+(?:this\s+|the\s+|my\s+)?code\b/i] },
  { skill: "edit-pass",              patterns: [/\bedit\s+(?:this|my)\b/i, /\bcopy[\s-]?edit\b/i, /\bpolish\b/i, /\bclean\s+up\s+the\s+writing\b/i] },
  // "summarise/summarize" is intentionally NOT here — it's too generic and
  // already covered by intent=summarize, AND it'd false-positive over more
  // specific skills like contract-summary or local-doc-summary. tl;dr is fine.
  { skill: "summarization",          patterns: [/\btl;?dr\b/i] },
  { skill: "research-deep",          patterns: [/\bresearch\b/i, /\bdig\s+into\b/i, /\bdeep\s+dive\b/i] },
  // 2026-07-09 reflection: bare /\bvault\b/i matched ANY mention of the word
  // (including "what's the vault path", "check my bank vault") and always
  // scored the flat keyword floor (15) — the picker was guessing, not
  // matching. Require an organize-shaped verb near "vault" instead; keep
  // "second brain" / "obsidian" as standalone triggers since those two
  // terms are distinctive enough on their own.
  { skill: "vault-organization",     patterns: [
    /\b(?:organi[sz]e|clean(?:[\s-]?up)?|tidy(?:\s+up)?|sweep|consolidate|restructure|reorgani[sz]e|file|place|structure|index)\w*\b[\s\S]{0,30}\b(?:vault|second[\s-]?brain|obsidian|knowledge\s*base|zettelkasten)\b/i,
    /\bsecond[\s-]?brain\b/i,
    /\bobsidian\b/i,
  ] },
  { skill: "list-making",            patterns: [/\b(?:make|give|write)\s+(?:me\s+)?(?:a\s+)?(?:bulleted?\s+|numbered\s+|checklist|to[\s-]?do)\b/i] },
  { skill: "table-making",           patterns: [/\b(?:make|build|create|give)\s+(?:me\s+)?(?:a\s+)?(?:comparison\s+)?table\b/i, /\b(?:as|in)\s+a\s+table\b/i] },
  // ─── 2026-05-23: role-specific deliverable skills ───
  { skill: "runbook-writing",        patterns: [/\brunbook\b/i, /\bincident\s+(?:response|triage|playbook)\b/i, /\bon[- ]?call\s+(?:procedure|playbook)\b/i] },
  { skill: "meddic-qualification",   patterns: [/\bMEDDIC\b/i, /\bdiscovery\s+(?:call|notes?|questions?)\b/i, /\bdeal\s+(?:qualification|review|forecast)\b/i, /\benterprise\s+(?:sales|deal)\b/i, /\bsales\s+(?:position|qualification|pipeline)\b/i] },
  { skill: "jd-writing",             patterns: [/\bjob\s+description\b/i, /\bJD\b(?!\s+for\s+sale)/i, /\bwrite\s+(?:a\s+|the\s+)?(?:job\s+post|JD|role\s+description)\b/i] },
  { skill: "launch-positioning",     patterns: [/\blaunch\s+(?:blurb|copy|positioning|brief)\b/i, /\bchangelog\s+(?:entry|copy|blurb)\b/i, /\b(?:product|feature)\s+positioning\b/i] },
  { skill: "ux-critique",            patterns: [/\bUX\s+(?:critique|review|audit|flow)\b/i, /\b(?:design|user\s+experience)\s+critique\b/i, /\bcritique\s+(?:this|the|our)\s+(?:UX|flow|design|UI)\b/i] },
  { skill: "trade-off-memo",         patterns: [/\btrade[- ]?off\s+(?:memo|doc|analysis|review)\b/i, /\boption\s+comparison\s+memo\b/i, /\bA\s+vs\s+B\s+(?:memo|comparison)\b/i] },
  { skill: "unit-economics",         patterns: [/\bunit\s+economics?\b/i, /\bLTV\s*(?:\/|to|vs|over)\s*CAC\b/i, /\bCAC\s+payback\b/i, /\bSaaS\s+benchmark\b/i, /\bnet\s+dollar\s+retention\b/i, /\bNDR\b/] },
  { skill: "ab-test-read",           patterns: [/\bA\/?B\s+test\b/i, /\bsplit\s+test\b/i, /\bexperiment\s+result\b/i, /\bvariant\s+vs\s+control\b/i] },
  { skill: "retry-different-approach", patterns: [/\b(?:try (?:again |a |another )(?:approach|angle|take|way|differently|different)|different (?:approach|angle|take))\b/i, /\b(?:that('?| i)s not (?:quite |what )?(?:it|right|what i wanted)|missed (?:the )?(?:point|mark)|wrong (?:approach|angle|tack))\b/i, /\b(?:redo (?:this|it|that)|do (?:it |this )?(?:again|over) (?:but )?differently|rethink (?:this|it)|another (?:take|go|attempt))\b/i] },
  // ─── 2026-05-23: research/analysis skills — bias the synth toward
  // properly grounded answers when the task implies external sourcing ───
  { skill: "benchmark-lookup",       patterns: [/\b(?:benchmark|industry[- ]?(?:standard|typical|average|median)|best[- ]in[- ]class|where\s+should\s+(?:our|my|we)\s+\S+\s+sit|what\s+(?:do|does)\s+(?:typical|standard|best)\s+companies)\b/i, /\b(?:what(?:'?s|\s+is)\s+(?:a\s+)?(?:typical|standard|industry|good|healthy)\s+(?:range|number|value|figure)\s+for)\b/i, /\b(?:NDR|GRR|CAC\s+payback|LTV[\/: ]?CAC|gross\s+margin|net\s+revenue\s+retention)\s+benchmark/i] },
  { skill: "source-triangulation",   patterns: [/\b(?:triangulat|cross[- ]?(?:check|verify|reference)|verify\s+across|multiple\s+sources|three\s+sources|independent\s+sources)\b/i, /\b(?:confirm(?:ed)?\s+(?:by|with|across)|corroborat)\b/i] },
  { skill: "primary-source-check",   patterns: [/\b(?:primary\s+source|official\s+(?:source|page|filing|docs?|documentation)|go\s+to\s+the\s+(?:source|filing|docs?|primary)|filing|10[- ]K|SEC\s+filing|press\s+release)\b/i, /\b(?:from\s+(?:their|the\s+company['']?s?)\s+(?:own\s+)?(?:site|page|docs?|documentation|pricing))\b/i] },
  { skill: "landscape-scan",         patterns: [/\b(?:landscape|market\s+(?:landscape|map|overview|scan)|who(?:'?s|\s+is)\s+(?:playing|in)\s+(?:this|the)\s+(?:market|category|space)|map\s+(?:the\s+|out\s+the\s+)?market|category\s+overview|state\s+of\s+the\s+(?:market|category|industry))\b/i] },
  // ─── 2026-05-24: employee-task skills (50 canonical tasks) ───
  { skill: "meeting-actions",        patterns: [/\b(?:meeting\s+transcript|action\s+items?|turn\s+(?:this|the)\s+(?:meeting|transcript)|extract\s+action\s+items?|from\s+this\s+transcript)\b/i] },
  { skill: "crm-update",             patterns: [/\bupdate\s+(?:our\s+|the\s+)?(?:CRM|HubSpot|Salesforce|Pipedrive)\b/i, /\b(?:CRM[-\s]ready|CRM\s+(?:fields?|update|record)|structured\s+(?:CRM|sales)\s+(?:fields?|updates?))\b/i] },
  { skill: "jd-to-tasks",            patterns: [/\b(?:from\s+this\s+job\s+description|task\s+list\s+from\s+(?:this\s+)?(?:JD|job\s+description)|role[-\s]based\s+(?:workflow|task)|JD\s+(?:to|→)\s+tasks?)\b/i] },
  { skill: "cv-screening",           patterns: [/\b(?:screen\s+(?:these\s+|the\s+)?(?:CVs?|resumes?|candidates?)|rank(?:ed)?\s+shortlist|CV\s+(?:screening|review)|candidate\s+(?:shortlist|screening|review))\b/i] },
  { skill: "vendor-comparison",      patterns: [/\b(?:compare\s+(?:vendor|supplier)\s+(?:quotes?|proposals?)|vendor\s+(?:comparison|quotes?|matrix)|TCO\s+(?:comparison|breakdown))\b/i] },
  { skill: "compliance-check",       patterns: [/\b(?:compliance\s+(?:check|review|issues?|audit)|check\s+(?:this|the)\s+document\s+for\s+compliance|legal\s+(?:risk|review)\s+(?:check|of)|items?\s+needing\s+(?:legal|manager)\s+approval)\b/i] },
  { skill: "travel-itinerary",       patterns: [/\b(?:travel\s+itinerary|itinerary\s+from\s+(?:these|the)\s+bookings?|trip\s+(?:itinerary|plan)|full\s+itinerary)\b/i] },
  { skill: "support-themes",         patterns: [/\b(?:support\s+tickets?\s+by\s+theme|cluster\s+(?:these\s+)?(?:tickets?|complaints?|feedback)|ticket\s+(?:themes?|clusters?|trends?)|issue\s+(?:clusters?|themes?)|summari[sz]e\s+(?:customer\s+)?(?:support\s+)?tickets?)\b/i] },
  { skill: "support-escalation",     patterns: [/\b(?:escalat\w*\s+(?:any\s+)?(?:support\s+)?tickets?|escalation\s+(?:list|triage)|tickets?\s+that\s+(?:look|need)\s+(?:serious|escalation)|escalation\s+with\s+reason)\b/i] },
  { skill: "kb-article",             patterns: [/\b(?:knowledge[-\s]?base\s+article|KB\s+article|help[-\s]?center\s+article|from\s+(?:this\s+)?solved\s+ticket|help[-\s]?center[-\s]?ready)\b/i] },
  { skill: "feedback-trends",        patterns: [/\b(?:customer\s+feedback\s+(?:trends?|analysis|themes?)|analy[sz]e\s+(?:customer\s+)?feedback|sentiment\s+(?:analysis|trends?)|recurring\s+themes?\s+in\s+feedback|NPS\s+(?:analysis|trends?))\b/i] },
  { skill: "slide-outline",          patterns: [/\bslide\s+(?:outline|structure|deck\s+outline)|slide[-\s]?by[-\s]?slide\s+(?:structure|outline)|presentation\s+(?:outline|structure)|deck\s+(?:outline|structure)\b/i] },
  { skill: "competitor-summary",     patterns: [/\bcompetitor\s+(?:summary|comparison\s+table)|summari[sz]e\s+(?:our\s+)?competitors?\b|research\s+competitors?\s+and\s+summari[sz]e/i] },
  { skill: "lead-qualification",     patterns: [/\blead\s+(?:qualification|scor(?:ing|e)|qualif\w+)|qualify\s+(?:this|the)\s+lead|lead\s+fit\s+(?:assessment|analysis)|inbound\s+lead\s+(?:scor|review)/i] },
  { skill: "translation",            patterns: [/\btranslate\s+(?:this|the)\s+(?:customer\s+)?(?:message|email|reply|response)|translation\s+(?:plus|and)\s+(?:response|reply)|translate\s+to\s+\w+\s+and\s+draft/i] },
  { skill: "sop-writing",            patterns: [/\b(?:standard\s+operating\s+procedure|SOP\s+(?:for|writing|creation)|turn\s+(?:this|the)\s+process\s+into\s+(?:an\s+)?SOP|process\s+to\s+SOP|write\s+(?:an?\s+)?SOP)\b/i] },
  { skill: "procurement-request",    patterns: [/\bprocurement\s+request|purchase\s+request|generate\s+(?:a\s+)?(?:procurement|purchase)\s+request|structured\s+purchase\s+(?:order|request)\b/i] },
  { skill: "training-quiz",          patterns: [/\btraining\s+quiz|generate\s+(?:a\s+)?quiz\s+from|quiz\s+from\s+(?:this\s+)?(?:policy|training|doc)|quiz\s+(?:questions?|with\s+answer\s+key)/i] },
  { skill: "tomorrow-plan",          patterns: [/\btomorrow(?:'s|\s+work)?\s+plan|plan\s+(?:for\s+)?tomorrow|tomorrow'?s?\s+(?:schedule|priorities|tasks?)|prioriti[sz]ed\s+schedule\s+(?:for\s+)?tomorrow|unfinished\s+tasks?\s+(?:for|to)\s+tomorrow/i] },
  // ─── 2026-06-05: integrations + data-source skills ───
  { skill: "channel-notify",         patterns: [/\b(?:notify|ping|alert|message|post|send|drop)\b.{0,30}\b(?:slack|teams|telegram|discord|google\s*chat|webhook|channel|the\s+team)\b/i, /\b(?:post|send)\s+(?:this|it|that|a\s+message)\s+to\b/i, /\blet\s+(?:the\s+team|everyone|\w+)\s+know\s+(?:on|in|via)\b/i] },
  { skill: "database-lookup",        patterns: [/\b(?:query|look\s*up|pull|fetch|count|how\s+many)\b.{0,30}\b(?:database|db|table|collection|records?|rows?|mongo(?:db)?|postgres|mysql|sql\s*server)\b/i, /\bfrom\s+(?:our|the|my)\s+(?:database|db|crm|warehouse)\b/i] },
  // ─── 2026-06-06: media-production skills (MiniMax media.* primitives) ───
  { skill: "voiceover-script",       patterns: [/\b(?:voice[\s-]?over|voiceover)\b/i, /\b(?:narrat(?:e|ion)|read (?:this|it|aloud))\b/i, /\btext[\s-]?to[\s-]?speech\b/i, /\bTTS\b/, /\b(?:audio|spoken)\s+(?:version|briefing|summary|clip)\b/i, /\bIVR\b/, /\bphone\s+(?:prompt|menu|greeting)\b/i] },
  { skill: "video-prompt",           patterns: [/\b(?:make|create|generate|produce|render)\s+(?:a\s+|an\s+|the\s+)?(?:short\s+)?(?:video|clip|reel|teaser|ad)\b/i, /\b(?:video|reel|tiktok|shorts)\s+(?:clip|ad|teaser|prompt)\b/i, /\bimage[\s-]?to[\s-]?video\b/i, /\bstoryboard\b/i, /\bproduct\s+teaser\b/i] },
  { skill: "music-brief",            patterns: [/\b(?:compose|generate|produce|write|make)\s+(?:a\s+|an\s+|some\s+)?(?:jingle|music|track|theme|soundtrack|beat|tune)\b/i, /\b(?:background|hold)\s+music\b/i, /\bjingle\b/i, /\bsoundtrack\b/i, /\b(?:theme|backing)\s+(?:song|track|music)\b/i] },
  { skill: "multimedia-package",     patterns: [/\b(?:content|media|video|ad)\s+package\b/i, /\b(?:script|storyboard)\s+(?:\+|and)\s+(?:voice(?:over)?|video|music|audio)\b/i, /\bexplainer\s+(?:video|with\s+(?:voice|narration|music))\b/i, /\b(?:social|video|content)\s+ad\b.{0,30}\b(?:voice(?:over)?|narration|music|audio)\b/i, /\b(?:voice(?:over)?|narration)\s+(?:\+|and)\s+(?:video|music)\b/i, /\b(?:video|music)\s+(?:\+|and)\s+(?:voice(?:over)?|narration|music)\b/i] },
  // Aiia must appear NEAR a finance/readout cue — a bare mention (e.g. "save
  // the Aiia reference letter to my vault") is a doc-handling task, not a
  // finance readout, so don't let \bAiia\b hijack it (regression guard).
  { skill: "aiia-finance-readout",   patterns: [/\bAiia\b.{0,40}\b(?:financ|revenue|expenses?|dashboard|figures?|numbers?|position|readout|P&L|balance|cash\s*flow|report)\b/i, /\b(?:financ|revenue|expenses?|dashboard|figures?|numbers?|position|readout|P&L|balance|cash\s*flow)\b.{0,40}\bAiia\b/i, /\bfinancial dashboard\b/i, /\b(?:finance|financial|revenue|expense)\s+(?:dashboard|overview|figures?|numbers?|position)\b/i, /\b(?:pull|fetch|read|show me|get)\s+(?:the\s+|our\s+|my\s+)?(?:live\s+)?(?:financials?|finance|dashboard)\b/i, /\bdashboard\s+for\s+(?:year\s+)?\d{4}\b/i] },
  // ─── 2026-06-10: department task-type skills (cover the 12 new dept personas) ───
  { skill: "brd-writing",                patterns: [/\bBR[DS]\b/i, /\bbusiness requirements?\b/i, /\bbusiness requirements?\s+(?:doc|document|spec|specification)\b/i, /\brequirements?\s+(?:doc|document|specification)\b/i] },
  { skill: "user-stories",               patterns: [/\buser stor(?:y|ies)\b/i, /\bacceptance criteria\b/i, /\bgiven\b.{0,12}\bwhen\b.{0,12}\bthen\b/i, /\bepic\b.{0,20}\bstor(?:y|ies)\b/i] },
  { skill: "process-mapping",            patterns: [/\bas[\s-]?is\b[\s\S]{0,24}\bto[\s-]?be\b/i, /\bprocess\s+(?:map|mapping|flow)\b/i, /\bcurrent state\b[\s\S]{0,24}\bfuture state\b/i, /\bworkflow\s+(?:map|diagram|mapping)\b/i] },
  { skill: "press-release",              patterns: [/\bpress release\b/i, /\bfor immediate release\b/i, /\bmedia (?:release|statement|advisory)\b/i] },
  { skill: "crisis-comms",               patterns: [/\bcrisis\s+(?:comm|statement|response|management|plan)/i, /\bholding statement\b/i, /\b(?:incident|crisis)\s+(?:statement|Q&?A|response)\b/i, /\bdamage control\b/i] },
  { skill: "reconciliation",             patterns: [/\brecon(?:cile|ciliation)\b/i, /\b(?:bank|account|ledger|statement|invoice)\s+recon/i, /\btie[\s-]?out\b/i] },
  { skill: "invoice-statement",          patterns: [/\b(?:create|draft|generate|prepare|issue|raise)\s+(?:an?\s+)?invoice\b/i, /\binvoice\b/i, /\bstatement of account\b/i, /\bbilling statement\b/i] },
  { skill: "financial-statement-summary",patterns: [/\bfinancial statements?\b/i, /\b(?:income statement|balance sheet|cash[\s-]?flow statement)\b/i, /\bsummar(?:y|ise|ize)\b[\s\S]{0,24}\b(?:financials?|P&?L|accounts)\b/i] },
  { skill: "hr-policy",                  patterns: [/\bHR policy\b/i, /\b(?:draft|write|create)\s+(?:an?\s+|a new\s+|company\s+)?policy\b/i, /\b(?:leave|remote[\s-]?work|code of conduct|disciplinary|expense|attendance|grievance)\s+policy\b/i] },
  { skill: "access-provisioning",        patterns: [/\baccess\s+(?:provision|request|grant|review|plan|matrix)/i, /\b(?:provision|deprovision|de[\s-]?provision|onboard|offboard)\s+(?:access|accounts?|a user|the user)\b/i, /\bleast privilege\b/i, /\bIAM\b/i, /\bpermissions?\s+(?:plan|matrix|setup)\b/i] },
  { skill: "device-setup-checklist",     patterns: [/\b(?:device|laptop|machine|workstation|pc)\s+(?:setup|provision|imaging|onboarding|build)\b/i, /\b(?:new\s+)?(?:laptop|device|machine)\s+checklist\b/i, /\bIT\s+(?:setup|provisioning|onboarding)\b/i] },
  { skill: "rfp-writing",                patterns: [/\bRF[PQ]\b/i, /\b(?:request for (?:proposal|quotation|quote)|invitation to tender|tender)\b/i, /\bbid\s+(?:document|invitation|request|pack)\b/i] },
  { skill: "negotiation-brief",          patterns: [/\bnegotiat(?:e|ion|ing)\b/i, /\bBATNA\b/i, /\bnegotiation\s+(?:brief|strategy|plan|prep)\b/i, /\b(?:counter|deal)\s*(?:position|offer)\b/i] },
  { skill: "cold-outreach",              patterns: [/\bcold\s+(?:outreach|email|call)\b/i, /\b(?:outreach|prospect(?:ing)?|email)\s+(?:sequence|cadence)\b/i, /\b(?:sales|sdr)\s+(?:sequence|cadence)\b/i] },
  { skill: "prospect-research",          patterns: [/\bprospect(?:ing)?\s+(?:research|brief)\b/i, /\b(?:research|profile)\s+(?:a\s+|this\s+)?(?:prospect|lead|account|company)\b[\s\S]{0,30}\b(?:before|outreach|opener|reach out)/i, /\baccount\s+research\b/i, /\bbuying committee\b/i] },
  { skill: "audit-prep",                 patterns: [/\baudit\s+(?:prep|readiness|preparation|checklist)\b/i, /\b(?:prepare|ready|get ready)\s+for\s+(?:an?\s+|the\s+)?audit\b/i, /\b(?:SOC ?2|ISO ?27001|compliance|internal)\s+audit\b/i] },
  { skill: "event-runsheet",             patterns: [/\brun[\s-]?(?:sheet|of[\s-]?show)\b/i, /\b(?:event|conference|launch|show)\s+(?:run[\s-]?sheet|logistics|plan|schedule)\b/i] },
  { skill: "training-curriculum",        patterns: [/\b(?:training|learning)\s+(?:curriculum|program(?:me)?|path|plan)\b/i, /\bcurriculum\b/i, /\bcourse\s+(?:outline|design|syllabus|plan)\b/i, /\bsyllabus\b/i] },
  { skill: "facilitator-guide",          patterns: [/\bfacilitat(?:or|ion)\s+(?:guide|notes|plan)\b/i, /\bworkshop\s+(?:guide|plan|facilitat|design)\b/i, /\b(?:run|design|facilitate)\s+a\s+workshop\b/i] },
  { skill: "project-plan",               patterns: [/\bproject\s+plan\b/i, /\bproject\s+(?:roadmap|timeline|schedule|milestones?)\b/i, /\bwork\s+breakdown\b/i, /\bWBS\b/i] },
  { skill: "raid-log",                   patterns: [/\bRAID\s+(?:log|register)\b/i, /\brisks?,?\s+assumptions?,?\s+issues?,?\s+(?:and\s+)?dependencies\b/i] },
  { skill: "fulfillment-plan",           patterns: [/\b(?:fulfil?lment|shipment|shipping|delivery|consignment)\s+(?:plan|schedule)\b/i, /\b(?:ship|fulfil?l)\s+(?:an?\s+|the\s+)?order\b/i, /\bfreight\s+(?:plan|booking)\b/i, /\bincoterm/i] },
  { skill: "inventory-analysis",         patterns: [/\binventory\s+(?:analysis|review|report|level|management|count)\b/i, /\b(?:re[\s-]?order|restock|stock)\s+(?:point|analysis|level|recommendation|report)\b/i, /\bsafety stock\b/i, /\bstock[\s-]?out\b/i, /\bEOQ\b/i, /\bdays of (?:cover|stock)\b/i] },
  { skill: "logistics-exception",        patterns: [/\b(?:logistics?|shipment|delivery|order)\s+(?:exception|issue|problem|delay|incident)\b/i, /\b(?:lost|damaged|delayed|stuck|held|missing)\s+(?:shipment|order|consignment|package|delivery)\b/i, /\bcustoms\s+hold\b/i] },
  // ─── 2026-06-10: keyword triggers for skills that previously routed ONLY via
  // generic applies_to intents (so they were effectively never picked). Each
  // gets a specific content trigger so on-topic tasks reach it. ───
  { skill: "action-item-extraction",     patterns: [/\baction items?\b/i, /\b(?:extract|pull|list)\s+(?:the\s+)?(?:action items?|to[\s-]?dos?|takeaways)\b/i] },
  { skill: "churn-risk-flag",            patterns: [/\bchurn\s+(?:risk|flag|signal|score)\b/i, /\b(?:at[\s-]?risk|flight[\s-]?risk)\s+(?:account|customer|client)\b/i] },
  { skill: "code-writing",               patterns: [/\b(?:write|implement|code)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+|some\s+)?(?:code|function|method|class|script|module|component|endpoint)\b/i, /\bwrite\s+(?:a\s+)?(?:python|javascript|typescript|java|go|rust|sql)\b/i] },
  { skill: "company-knowledge-lookup",   patterns: [/\b(?:look up|find|search|check)\b[\s\S]{0,30}\b(?:company|internal|our)\s+(?:knowledge|docs?|wiki|policy|handbook)\b/i, /\bwhat does (?:our|the company)\b/i] },
  { skill: "company-onboarding",         patterns: [/\b(?:company|employee|new[\s-]?hire|staff)\s+onboarding\b/i, /\bonboard(?:ing)?\s+(?:plan|pack|checklist|guide)\b/i] },
  { skill: "css-animation-snippet",      patterns: [/\bcss\s+animation\b/i, /\b(?:keyframes?|@keyframes|css\s+transition)\b/i] },
  { skill: "customer-360",               patterns: [/\bcustomer\s*[\s-]?360\b/i, /\b360[\s-]?(?:degree\s+)?(?:view|profile)\s+of\b/i, /\baccount\s+360\b/i] },
  { skill: "daily-briefing",             patterns: [/\bdaily\s+(?:briefing|brief|digest|rundown)\b/i, /\bmorning\s+(?:briefing|brief)\b/i] },
  { skill: "decline-politely",           patterns: [/\b(?:politely\s+)?decline\b/i, /\b(?:say no to|turn down|reject)\s+(?:the\s+|this\s+|a\s+)?(?:request|invite|invitation|offer|meeting|proposal)\b/i] },
  { skill: "difficult-conversation-script", patterns: [/\bdifficult conversation\b/i, /\b(?:tough|hard|crucial|awkward)\s+(?:conversation|chat|talk)\b/i] },
  { skill: "discovery-call-prep",        patterns: [/\bdiscovery call\b/i, /\b(?:prep|prepare)\s+(?:for\s+)?(?:a\s+|the\s+)?(?:discovery|sales|intro)\s+call\b/i] },
  { skill: "email-triage",               patterns: [/\b(?:triage|sort|prioriti[sz]e|process)\s+(?:my\s+|the\s+)?(?:inbox|emails?)\b/i, /\binbox\s+(?:triage|zero)\b/i] },
  { skill: "eod-handoff",                patterns: [/\b(?:end[\s-]?of[\s-]?day|EOD)\s+(?:handoff|hand[\s-]?over|summary|update|report)\b/i] },
  { skill: "expense-report",             patterns: [/\bexpense report\b/i, /\b(?:file|submit|create|do)\s+(?:an?\s+|my\s+)?expenses?\b/i] },
  { skill: "follow-up-cadence",          patterns: [/\bfollow[\s-]?up\s+(?:cadence|sequence|plan|schedule|cadences)\b/i, /\b(?:nurture|drip)\s+(?:cadence|sequence|campaign)\b/i] },
  { skill: "intro-email",                patterns: [/\b(?:intro|introduction|introductory|warm)\s+(?:email|intro)\b/i, /\bintroduce\s+\w+\s+to\s+\w+/i] },
  { skill: "investor-update",            patterns: [/\binvestor\s+(?:update|letter|memo|report)\b/i, /\b(?:monthly|quarterly)\s+investor\b/i] },
  { skill: "loading-state-design",       patterns: [/\bloading\s+(?:state|spinner|skeleton|indicator|screen)\b/i, /\bskeleton\s+(?:screen|loader|ui)\b/i] },
  { skill: "meeting-prep-pack",          patterns: [/\bmeeting\s+(?:prep|preparation)\s+(?:pack|doc|pack)\b/i, /\bprep(?:are)?\s+(?:a\s+)?(?:pack|brief)\s+(?:for\s+)?(?:the\s+|a\s+)?meeting\b/i] },
  { skill: "microinteraction-spec",      patterns: [/\bmicro[\s-]?interaction/i] },
  { skill: "motion-design-pass",         patterns: [/\bmotion\s+design\b/i, /\b(?:animation|motion)\s+(?:pass|spec|review|polish)\b/i] },
  { skill: "objection-handling-script",  patterns: [/\bobjection\s+(?:handling|response|script)\b/i, /\bhandle\s+(?:the\s+|sales\s+)?objection/i] },
  { skill: "p-and-l-summary",            patterns: [/\bP\s*&\s*L\b/i, /\bprofit (?:and|&) loss\b/i, /\bincome statement\s+(?:summary|review)\b/i] },
  { skill: "pipeline-review",            patterns: [/\b(?:sales\s+)?pipeline\s+(?:review|health|analysis|inspection)\b/i, /\bdeal\s+(?:pipeline|review)\b/i] },
  { skill: "planning-doc",               patterns: [/\bplanning doc(?:ument)?\b/i, /\b(?:sprint|quarterly|strategic)\s+planning\s+doc/i] },
  { skill: "pre-read",                   patterns: [/\bpre[\s-]?read\b/i, /\b(?:background|briefing)\s+(?:doc|memo)\s+(?:before|ahead of)\b/i] },
  { skill: "precedent-finder",           patterns: [/\b(?:find|search for|look for)\s+(?:legal\s+|relevant\s+)?precedent/i, /\bprecedent(?:s)?\s+(?:for|on|search)\b/i] },
  { skill: "pricing-proposal",           patterns: [/\bpricing proposal\b/i, /\b(?:price|pricing)\s+(?:quote|proposal|tiers?)\b/i] },
  { skill: "project-status-rollup",      patterns: [/\b(?:status|project)\s+roll[\s-]?up\b/i, /\bproject status\s+(?:rollup|roll[\s-]?up|summary|report)\b/i, /\bprogram\s+status\b/i] },
  { skill: "release-notes-from-commits", patterns: [/\brelease notes\b/i, /\bchangelog\b/i, /\brelease notes\s+from\s+(?:the\s+)?commits?\b/i] },
  { skill: "renewal-conversation",       patterns: [/\brenewal\s+(?:conversation|discussion|call|email|prep)\b/i, /\b(?:contract|subscription|account)\s+renewal\b/i] },
  { skill: "risk-register",              patterns: [/\brisk register\b/i] },
  { skill: "standup-summary",            patterns: [/\bstand[\s-]?up\s+(?:summary|notes|update|recap)\b/i, /\bdaily stand[\s-]?up\b/i] },
  { skill: "timesheet-fill",             patterns: [/\btimesheet\b/i, /\b(?:fill in|complete|log)\s+(?:my\s+|the\s+)?(?:hours|time|timesheet)\b/i] },
  // ─── 2026-07-08: new-feature skills (email attachments, hybrid-workforce
  // hand-off, Paynow/Stripe payment collection, Intellinexus publishing) ───
  { skill: "send-attachment",            patterns: [/\battach(?:ment|ed|ing)?\b/i, /\bsend\s+(?:me\s+|him\s+|her\s+|them\s+)?(?:the\s+|that\s+|this\s+)?(?:file|document|doc|spreadsheet|pdf|report)\b.{0,20}\b(?:email|attached|attachment)\b/i, /\bemail\b.{0,25}\b(?:the\s+|that\s+|this\s+)?(?:file|document|doc|spreadsheet|pdf)\b/i] },
  { skill: "human-handoff",              patterns: [/\bhuman[\s-]?(?:request|handoff|hand[\s-]?off|in[\s-]?the[\s-]?loop)\b/i, /\bask\s+(?:a\s+|the\s+)?human\b/i, /\bwaiting\s+on\s+(?:a\s+)?human\b/i, /\bneeds?\s+(?:human|manual)\s+(?:input|approval|review)\b/i] },
  { skill: "payment-collection",         patterns: [/\b(?:payment|paynow)\s+link\b/i, /\bcollect\s+payment\b/i, /\b(?:send|create)\s+(?:an?\s+)?invoice\s+(?:link|for)\b/i, /\bcharge\s+(?:the\s+)?(?:customer|client)\b/i, /\bhas\s+\w+\s+paid\b/i, /\bpayment\s+status\b/i] },
  { skill: "dataset-publish",            patterns: [/\bpublish\s+(?:this\s+|the\s+)?(?:data|dataset)\b/i, /\bintellinexus\b/i, /\badd\s+(?:this\s+|to\s+)?(?:the\s+)?data\s+pipeline\b/i, /\bturn\s+this\s+into\s+a\s+dataset\b/i, /\bmake\s+(?:this\s+)?(?:data\s+)?(?:available\s+to|queryable\s+by)\s+(?:the\s+)?(?:other\s+)?agents\b/i] },
  { skill: "caveman-mode",                patterns: [/\bcaveman\s+mode\b/i, /\btalk\s+like\s+(?:a\s+)?caveman\b/i, /\/caveman\b/i, /\b(?:be|reply|answer)\s+(?:more\s+)?(?:brief|terse|concise)\b.{0,20}\b(?:tokens?|words?)\b/i, /\bfewer\s+(?:tokens|words)\b/i, /\bless\s+tokens\b/i] },
];

// Combined picker: matches BOTH on intent AND on doc-type keywords in the
// task body. Solves the "intent classifier missed but the user literally
// said 'write a PRD'" gap. Returns the top `limit` skills by composite
// score:
//   • 20 + specificity bonus when applies_to contains the intent exactly
//   • 15 per distinct keyword pattern that matches the task body
//   • 0 otherwise (skill is filtered out)
//
// Use this as the PRIMARY picker for the synth step. Falls back to intent-
// only matching when no task text is supplied.
export function suggestSkillsForTask(task: string, intent?: string, limit = 2): Skill[] {
  const all = listSkills();
  const intentTarget = intent?.trim().toLowerCase() ?? "";
  const taskText = (task ?? "").slice(0, 2000); // cap the regex window
  const scored: { skill: Skill; score: number; reasons: string[] }[] = [];

  for (const s of all) {
    let score = 0;
    const reasons: string[] = [];

    if (intentTarget && s.applies_to.length > 0 && s.applies_to.some(t => t.toLowerCase() === intentTarget)) {
      const specificity = 10 - Math.min(9, s.applies_to.length);
      score += 20 + specificity;
      reasons.push(`intent=${intentTarget}`);
    }

    if (taskText) {
      const map = SKILL_KEYWORDS.find(e => e.skill === s.name);
      if (map) {
        for (const pat of map.patterns) {
          if (pat.test(taskText)) {
            score += 15;
            reasons.push(`keyword=${pat.source.slice(0, 30)}`);
            break; // one keyword hit per skill is plenty
          }
        }
      }
    }

    if (score > 0) scored.push({ skill: s, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(x => x.skill);
}

// Return the composite score for the top-matched skill on this task, or
// null if no skill matched. Used by the auto-draft trigger to decide
// whether the matched skill is strong enough to skip drafting a new one.
export function topSkillScoreForTask(task: string, intent?: string): { skill: Skill; score: number } | null {
  const all = listSkills();
  const intentTarget = intent?.trim().toLowerCase() ?? "";
  const taskText = (task ?? "").slice(0, 2000);
  let best: { skill: Skill; score: number } | null = null;
  for (const s of all) {
    let score = 0;
    if (intentTarget && s.applies_to.some(t => t.toLowerCase() === intentTarget)) {
      score += 20 + (10 - Math.min(9, s.applies_to.length));
    }
    if (taskText) {
      const map = SKILL_KEYWORDS.find(e => e.skill === s.name);
      if (map && map.patterns.some(p => p.test(taskText))) score += 15;
    }
    if (score > 0 && (best === null || score > best.score)) best = { skill: s, score };
  }
  return best;
}

// Compact one-line render for the planner's prompt catalog ("you have these
// skills available: …"). Avoids dumping every skill body.
export function skillsCatalog(): string {
  const all = listSkills();
  if (all.length === 0) return "No skills installed.";
  return all.map(s => `- ${s.name}: ${s.description}`).join("\n");
}

// Draft a brand-new skill .md when no built-in or user skill targets the
// task's intent — the "self-improvement loop": clawbot notices it's
// struggling, asks the LLM to write the playbook it wishes it had, saves
// it to skills/_user/, and the next run on a similar task loads the new
// skill automatically (since suggestSkillsForIntent reads from disk).
//
// We deliberately use the LARGE-tier LLM (forced complexity:"high") for the
// draft when OpenRouter is available — playbook quality is what determines
// whether the loop actually helps. A small-model skill that hallucinates
// rules makes the agent worse, not better.
//
// Inputs:
//   • intent — the detected intent label (e.g. "draft-email", "summarize")
//   • taskSample — the actual user request that exposed the skill gap
//   • failureReason — what went wrong (low quality score, missing structure,
//     etc.) so the LLM knows what to address in the playbook
//
// Returns the saved skill or null if the draft was unusable (too short,
// malformed frontmatter). Caller should fall back to the default synth on
// null — the agent shouldn't crash because the meta-skill draft missed.
export async function draftSkillForIntent(args: {
  intent: string;
  taskSample: string;
  failureReason?: string;
}): Promise<Skill | null> {
  // Lazy-import the LLM dispatcher to keep skills.ts free of the heavy
  // ollama/openrouter dependency tree at module load.
  const { llmGenerate } = await import("./llm.js");
  const intentSlug = args.intent.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!intentSlug) return null;

  const sys = `You write skill playbooks — short markdown documents that teach an AI agent how to deliver employee-quality output for a specific task type. Each skill follows the same template; emit ONLY the markdown, no commentary, no fences around the whole doc.

Template (replicate exactly, fill the placeholders):

---
name: <kebab-case-name-matching-the-intent>
description: <one-line, what this skill is for>
applies_to: [<intent-label>]
---

# Skill: <Human-readable name>

## Goal

<One sentence on what good looks like for this task.>

## <Process | Structure | Format>

<3-7 bullets OR a numbered process OR a template block. Match the section name to the deliverable.>

## Rules

- <Concrete rule, not vague advice. "Lead with the recommendation in the first 2 sentences" beats "be clear">
- <…>
- <…>

## Pitfalls

- <Common failure mode with a one-line fix>
- <…>

Rules for YOUR draft:
- Be concrete. Generic advice ("be clear", "stay focused") doesn't help an agent — give it specifics it can apply mechanically.
- 50-100 lines total. Skills that don't fit on one screen don't get loaded.
- If the task has a deliverable shape (email, memo, report, code, etc.), include an explicit template block.
- Reference real failure modes — what would an inexperienced operator get wrong?
- No "this skill helps you…" preamble. Skills are read by the agent, not the user.`;

  const userPrompt = `Intent: ${args.intent}
Sample task that exposed the skill gap: "${args.taskSample.slice(0, 600)}"
${args.failureReason ? `What went wrong on the previous attempt: ${args.failureReason.slice(0, 400)}` : ""}

Draft the skill playbook for this intent. Output only the markdown — no preamble, no fences around the whole thing.`;

  let raw: string;
  try {
    raw = await llmGenerate(userPrompt, sys, { profile: "synthesis", complexity: "high", maxTokens: 1024 });
  } catch {
    return null;
  }
  raw = raw.trim().replace(/^```(?:markdown|md)?\n?([\s\S]+?)\n?```$/i, "$1").trim();
  // Sanity: the draft must start with `---` (frontmatter) AND contain at
  // least one `##` heading. Otherwise it's not a usable skill.
  if (!raw.startsWith("---") || !raw.includes("##")) return null;

  const { meta } = parseFrontmatter(raw);
  const baseName = String(meta.name ?? `auto-${intentSlug}`).replace(/[^a-zA-Z0-9-_]+/g, "-").toLowerCase().slice(0, 60) || `auto-${intentSlug}`;
  // Always namespace auto-drafted skills with `auto-` so the user can tell
  // them apart from curated ones at a glance.
  const filename = baseName.startsWith("auto-") ? `${baseName}.md` : `auto-${baseName}.md`;
  mkdirSync(SKILLS_USER, { recursive: true });
  const dest = join(SKILLS_USER, filename);
  writeFileSync(dest, raw, "utf8");
  cache.delete(dest);
  return loadSkillFromDisk(dest, "user");
}

// Fetch a remote skill .md (e.g. from GitHub raw, gist, or a curated repo)
// and save it under skills/_user/ so it's available on the next list call.
// Gated by NEUROWORKS_REMOTE_SKILLS=1 — by default we refuse remote fetches so
// the user has to opt in to pulling agent guidance from external sources.
export async function fetchRemoteSkill(url: string): Promise<{ saved: string; skill: Skill }> {
  if (process.env.NEUROWORKS_REMOTE_SKILLS !== "1") {
    throw new Error("Remote skill fetch is disabled. Set NEUROWORKS_REMOTE_SKILLS=1 in .env to allow pulling skill .md files from the internet.");
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`Remote skill URL must be http(s): ${url}`);
  }
  // SECURITY: SSRF block — opt-in NEUROWORKS_REMOTE_SKILLS=1 doesn't imply
  // "and also reach internal services". Anyone wanting to pull a skill from
  // a private host must additionally set NEUROWORKS_WEB_ALLOW_PRIVATE=1.
  const { assertSafePublicUrlAsync } = await import("./security-gates.js");
  await assertSafePublicUrlAsync(url);
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`Failed to fetch ${url}: HTTP ${r.status}`);
  const raw = await r.text();
  // Derive a filename from the URL's last segment or the frontmatter name.
  const { meta } = parseFrontmatter(raw);
  let name = String(meta.name ?? "").trim();
  if (!name) {
    const last = url.split("/").pop() ?? "skill.md";
    name = last.replace(/\.md$/i, "");
  }
  // Sanitize — no path traversal, no weird filenames.
  name = name.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "skill";
  mkdirSync(SKILLS_USER, { recursive: true });
  const dest = join(SKILLS_USER, `${name}.md`);
  writeFileSync(dest, raw, "utf8");
  // Drop the cache entry for this path so the next list call re-reads it.
  cache.delete(dest);
  const skill = loadSkillFromDisk(dest, "user");
  if (!skill) throw new Error(`Saved ${dest} but couldn't parse it as a skill`);
  return { saved: dest, skill };
}
