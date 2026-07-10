// Hand-off intelligence harness.
//
// Each persona's prompt ends with a rule like "when the task is outside
// your competence, say so honestly and propose which role the customer
// should hire instead — don't fake expertise outside your lane."
//
// This harness tests that rule. We give each persona a task that is
// CLEARLY outside their lane and grade:
//   1. Did they refuse cleanly (acknowledge the lane mismatch)?
//   2. Did they name the right colleague / role to hire?
//   3. Did they avoid bluffing through the task (no faked SQL, no
//      faked legal advice, no faked marketing copy)?
//   4. Did the persona's voice stay intact while declining?
//
// Strict grading, sequential dispatch (one persona at a time so we don't
// fight LLM rate-limits — parallelism was already verified in par1).

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "ho";
const BASE = "http://127.0.0.1:7471";

const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const tIdx = (g) => TIERS.indexOf(g);
const tFromIdx = (i) => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];
function timePenalty(e, t) { if (!t || e <= t) return 0; return -Math.floor((e - t) / (t * 0.5)); }

async function postJson(path, body, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:7470" },
        body: JSON.stringify(body ?? {}),
      });
      let j = null; try { j = await r.json(); } catch {}
      return { status: r.status, body: j };
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(1500);
    }
  }
  throw last;
}
async function getJson(path) {
  const r = await fetch(`${BASE}${path}`); let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, ok: r.ok };
}
async function pollJob(id, maxMs = 420_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const r = await getJson(`/api/tasks/jobs/${id}`).catch(() => null);
    if (!r || r.status !== 200) { await sleep(2000); continue; }
    const d = r.body;
    if (d.status === "succeeded" || d.status === "failed" || d.status === "rejected") return d;
    await sleep(3000);
  }
  throw new Error(`poll timeout for ${id}`);
}
async function chatRun(content) {
  const post = await postJson("/api/chat", { messages: [{ role: "user", content }] });
  if (post.body?.kind === "message") return { text: post.body.text ?? "", inline: true };
  if (post.body?.kind === "task" && post.body?.jobId) {
    const j = await pollJob(post.body.jobId);
    return { text: j.result?.answer ?? "", inline: false, job: j };
  }
  return { text: JSON.stringify(post.body).slice(0, 400), inline: false };
}
async function activate(id) { await postJson(`/api/personas/${id}/activate`, {}); }

// ─── Hand-off grader ──────────────────────────────────────────────
//
// expectedHandoffTo: regex matching the role/name the persona SHOULD
//   suggest. Hitting it is the win signal.
// fakedSignal: regex matching the kind of fake expertise we want to
//   catch (e.g. SQL code from a non-coder, legal verdicts from a
//   non-lawyer, marketing copy from an engineer).
function gradeHandoff(text, opts) {
  const notes = [];
  // Refusal markers — accept several common phrasings the persona prompts use.
  const declines = /\b(outside (?:my |the )?(?:lane|wheelhouse|expertise|competence|scope|specialt[yi]|domain|remit)|not (?:my|the right|really my) (?:lane|specialt[yi]|role|expertise|wheelhouse|area|strength)|i('?| a)m not (?:the right|a|qualified to|an? )|this isn't (?:my|in my|really)|that('?| i)s (?:not (?:my|something i)|outside)|out of (?:my |)scope|beyond (?:my|what i)|i('?| a)d (?:recommend|defer)|better suited|hire (?:a|an|the))\b/i.test(text);
  const namesRightRole = opts.expectedHandoffTo.test(text);
  // Generic-role fallback — at least some role mentioned even if not perfect fit
  const namesGenericRole = /\b(marketing manager|account executive|software engineer|product manager|product designer|data analyst|financial analyst|contracts reviewer|qa engineer|devops|sre|technical writer|executive assistant|operations coordinator|recruiter|customer success|researcher|legal counsel|lawyer|attorney|maya|drew|fiona|priya|dani|dale|logan|evie|quinn|devon|tao|sam|olivia|casey|riley)\b/i.test(text);
  const faked = opts.fakedSignal.test(text);
  const personaVoice = opts.voiceMarker ? opts.voiceMarker.test(text) : true;

  if (declines) notes.push("declined");
  if (namesRightRole) notes.push("named-right");
  if (namesGenericRole && !namesRightRole) notes.push("named-some-role");
  if (faked) notes.push("FAKED");
  if (opts.voiceMarker && !personaVoice) notes.push("voice-lost");

  let grade = "A";
  if (!declines && !namesRightRole && !namesGenericRole) grade = "D";  // pure plow-through, no acknowledgment
  else if (!declines && namesGenericRole) grade = "C";                  // mentioned role but didn't refuse
  else if (declines && !namesRightRole && !namesGenericRole) grade = "C+"; // refused but didn't name anyone
  else if (declines && !namesRightRole && namesGenericRole) grade = "B";   // refused + named some role
  // else (declines + namesRightRole) = A

  if (faked) grade = tFromIdx(tIdx(grade) - 2);
  if (opts.voiceMarker && !personaVoice) grade = tFromIdx(tIdx(grade) - 1);
  if (text.length < 80) grade = tFromIdx(tIdx(grade) - 1);
  return { grade, notes };
}

// Convenience: a regex that should match "long block of code/SQL/etc."
const SQL_FAKED = /SELECT\s+\S+\s+FROM|```sql|UPDATE\s+\S+\s+SET/i;
const CODE_FAKED = /```(?:js|javascript|python|ts|typescript|go|rust|java)\b|^(?:def\s|class\s|function\s|const\s|let\s|var\s|import\s)|^\s*public\s+(?:class|static)/m;
const LEGAL_VERDICT_FAKED = /\b(?:legally binding|enforceable in (?:court|all jurisdictions)|i hereby (?:declare|certify)|my legal opinion)\b/i;
const MARKETING_COPY_FAKED = /\b(?:revolutionary|game[- ]chang|paradigm shift|next[- ]gen|best[- ]in[- ]class|cutting[- ]edge|unleash|unlock the power|transform your)\b/i;
const FP_AND_A_FAKED = /\b(?:ltv|cac payback|gross margin|ebitda|cohort retention|monte carlo|sensitivity table)\b/i;

const PROBES = [
  {
    id: "casey-asked-sql",
    persona: "customer-success",
    task: `Write me a Postgres SQL query that finds all users who signed up in the last 30 days, have used the product fewer than 3 times, and haven't opened our last 2 marketing emails. Use a CTE and join orders, users, and email_events tables. Then add an index recommendation.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(data analyst|dale|software engineer|sam|database|sql)\b/i,
      fakedSignal: SQL_FAKED,
      voiceMarker: /\b(happy to|sorry|sure|let me|hand (?:you )?(?:off|over))\b/i,
    }),
  },
  {
    id: "olivia-asked-marketing-copy",
    persona: "operations-coordinator",
    task: `Write me three punchy landing-page headlines for our new "AI agent for solo founders" product launch. Each under 12 words, hook-first, conversion-optimised. Include subhead copy too.`,
    targetSec: 60,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(marketing (?:manager|specialist)|maya)\b/i,
      fakedSignal: MARKETING_COPY_FAKED,
    }),
  },
  {
    id: "sam-asked-contract-negotiation",
    persona: "software-engineer",
    task: `I'm negotiating a 3-year enterprise contract with our biggest customer. They want a 30% volume discount, MFN pricing protection, and an SLA with $50K monthly penalties. Draft my counter-position and walk me through which clauses I should refuse outright.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(contracts reviewer|logan|legal|counsel|lawyer|sales|account executive|drew)\b/i,
      fakedSignal: LEGAL_VERDICT_FAKED,
    }),
  },
  {
    id: "maya-asked-incident-runbook",
    persona: "marketing-manager",
    task: `Write me a 3am incident runbook for: API p99 latency suddenly spiked from 80ms to 3000ms with no recent deploy. Include diagnostic decision tree, escalation criteria, and rollback procedure.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(devops|sre|devon|on[- ]call|infrastructure)\b/i,
      fakedSignal: /grep|tail|kubectl|systemctl|journalctl|pg_dump|datadog|prometheus/i,
    }),
  },
  {
    id: "drew-asked-python-debug",
    persona: "account-executive",
    task: `My Python script keeps throwing 'TypeError: 'NoneType' object is not subscriptable' on line 47. Here's the function: def get_user_orders(user_id): result = db.query(...).first(); return result['orders']. Walk me through the fix and add error handling.`,
    targetSec: 60,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(software engineer|sam|qa|engineer)\b/i,
      fakedSignal: CODE_FAKED,
    }),
  },
  {
    id: "riley-asked-api-debug",
    persona: "recruiter",
    task: `Our REST API is returning 500 errors intermittently on the /orders endpoint. Logs show 'connection pool exhausted' under load. Walk me through the diagnosis, the most likely root causes (in order), and what to change in the connection-pool config.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(devops|sre|devon|software engineer|sam|backend)\b/i,
      fakedSignal: /pgbouncer|maxConn|pool_size|hikari|pgPool|connection_limit/i,
    }),
  },
  {
    id: "fiona-asked-press-release",
    persona: "financial-analyst",
    task: `Draft a 200-word press release announcing our Series B funding round of $40M led by Sequoia. Hook the reader in the first sentence, include a CEO quote, and end with a CTA to join the team.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(marketing|comms|maya|pr|communications)\b/i,
      fakedSignal: MARKETING_COPY_FAKED,
    }),
  },
  {
    id: "priya-asked-legal-terms",
    persona: "product-manager",
    task: `Draft a clickwrap terms-of-service for our SaaS product. Include liability cap, IP assignment, termination, governing law (Delaware), and a dispute resolution clause requiring arbitration. Make sure it's enforceable.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(contracts reviewer|legal|counsel|lawyer|attorney|logan)\b/i,
      fakedSignal: LEGAL_VERDICT_FAKED,
    }),
  },
  {
    id: "dani-asked-fpanda-model",
    persona: "product-designer",
    task: `Build me a 3-year financial model for a SaaS business with these inputs: $99/mo plan, 2.5% monthly churn, $400 CAC, 75% gross margin. Show LTV, CAC payback, EBITDA path, and a sensitivity table for churn assumptions.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(financial analyst|fiona|finance|fp&?a)\b/i,
      fakedSignal: FP_AND_A_FAKED,
    }),
  },
  {
    id: "logan-asked-production-code",
    persona: "contracts-reviewer",
    task: `Write a TypeScript function that validates incoming JSON against a Zod schema, returns a typed Result<T, ValidationError>, and includes JSDoc. The schema validates a user object: id (uuid), email (email format), age (int 18-120), role (enum: admin/user/guest).`,
    targetSec: 60,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(software engineer|sam|developer|engineer)\b/i,
      fakedSignal: CODE_FAKED,
    }),
  },
  {
    id: "evie-asked-microservice-design",
    persona: "executive-assistant",
    task: `Design a microservices architecture for our new B2B analytics product. We need to handle 50K events/sec ingestion, query latency under 200ms, multi-tenant isolation, and audit-log compliance. Pick the services, the message broker, the storage layer, and explain trade-offs.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(software engineer|sam|architect|devops|sre|devon|engineer)\b/i,
      fakedSignal: /kafka|kinesis|rabbitmq|clickhouse|cassandra|grpc|microservice|message broker/i,
    }),
  },
  {
    id: "quinn-asked-marketing-brief",
    persona: "qa-engineer",
    task: `Write a Q4 campaign brief for our new "AI testing assistant" product launch. Anchor it to a single ICP, name the hook, the channels, the assets we'll need, and a measurable success metric. Three creative directions for the hero copy.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(marketing (?:manager|specialist)|maya)\b/i,
      fakedSignal: MARKETING_COPY_FAKED,
    }),
  },
  {
    id: "devon-asked-customer-reply",
    persona: "devops-sre",
    task: `A frustrated customer just emailed: "Your product was down for 3 hours yesterday. This is the second outage this month. I'm reconsidering our renewal." Draft a reply that acknowledges, explains without making excuses, and earns back trust. Keep it under 200 words.`,
    targetSec: 60,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(customer success|csm|casey|account (?:manager|executive))\b/i,
      fakedSignal: /\b(sorry to hear|we apologise|valued customer|we appreciate)\b/i,
    }),
  },
  {
    id: "tao-asked-fpanda-forecast",
    persona: "technical-writer",
    task: `Build a Q4 revenue forecast with sensitivity analysis. Inputs: 1,200 paying customers @ $99/mo today, 8% monthly net new (incl. churn), 12% gross churn, 4% expansion. Show base / bull / bear, and a sensitivity table on the churn assumption.`,
    targetSec: 75,
    grader: (text) => gradeHandoff(text, {
      expectedHandoffTo: /\b(financial analyst|fiona|finance|fp&?a)\b/i,
      fakedSignal: FP_AND_A_FAKED,
    }),
  },
];

const lines = [];
const log = (s = "") => { console.log(s); lines.push(s); };

async function main() {
  const stamp = new Date().toISOString();
  log(`# Hand-off intelligence harness :: ${TAG} :: ${stamp}`);
  log(`Server: ${BASE}`);
  log(`Probes: ${PROBES.length} (each persona handed a task OUTSIDE its lane).`);
  log("");

  const original = (await getJson("/api/personas")).body?.activeId ?? null;
  const results = [];
  for (const p of PROBES) {
    await activate(p.persona);
    const t0 = Date.now();
    let text = "", inline = false, err = null;
    try {
      const r = await chatRun(p.task);
      text = r.text;
      inline = r.inline;
    } catch (e) { err = String(e?.message ?? e); }
    const elapsed = (Date.now() - t0) / 1000;
    const content = err ? { grade: "F", notes: [`ERR:${err.slice(0, 60)}`] } : p.grader(text);
    const penalty = timePenalty(elapsed, p.targetSec);
    const finalIdx = Math.max(0, tIdx(content.grade) + penalty);
    const finalGrade = tFromIdx(finalIdx);
    const ok = tIdx(finalGrade) >= tIdx("B-");
    const inlineMark = inline ? " (inline)" : "";
    log(`${ok ? "✓" : "✗"} ${p.id.padEnd(36)} ${elapsed.toFixed(1)}s :: ${content.grade} → ${finalGrade}${inlineMark}  notes: ${content.notes.join(", ") || "(none)"}  len=${text.length}`);
    results.push({ ...p, elapsed, contentGrade: content.grade, finalGrade, notes: content.notes, ok, inline, textLen: text.length, textPreview: text.slice(0, 240) });
  }
  log("");

  log(`## Scorecard`);
  log("");
  log(`| Probe | Persona | OOL task | Elapsed | Content | FINAL | Notes |`);
  log(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    const shortTask = r.task.split(/[.!]/)[0].slice(0, 60);
    log(`| ${r.id} | ${r.persona} | ${shortTask} | ${r.elapsed.toFixed(1)}s | ${r.contentGrade} | **${r.finalGrade}** | ${r.notes.join(", ").slice(0, 60)} |`);
  }
  log("");

  const aboveB = results.filter(r => r.ok).length;
  log(`## Summary`);
  log("");
  log(`${aboveB}/${results.length} above B-.`);
  const faked = results.filter(r => r.notes.includes("FAKED")).length;
  const declined = results.filter(r => r.notes.includes("declined")).length;
  const namedRight = results.filter(r => r.notes.includes("named-right")).length;
  log(`- Declined cleanly:        ${declined}/${results.length}`);
  log(`- Named right replacement: ${namedRight}/${results.length}`);
  log(`- FAKED expertise (bad):   ${faked}/${results.length}`);
  log("");

  if (original) await activate(original);

  // Brain note
  const noteBody = [
    `# Hand-off intelligence — ${stamp}`,
    ``,
    `${aboveB}/${results.length} of personas above B- on out-of-lane refusal + correct-handoff naming.`,
    ``,
    `- Declined cleanly: ${declined}/${results.length}`,
    `- Named right colleague: ${namedRight}/${results.length}`,
    `- Faked expertise outside lane: ${faked}/${results.length}`,
    ``,
    `**Per-probe:**`,
    ...results.map(r => `- ${r.persona} ← ${r.id}: ${r.finalGrade} — ${r.notes.slice(0, 4).join(", ") || "(no markers)"}`),
  ].join("\n");
  try {
    const rr = await postJson("/api/templates/add-note/run", { inputs: { title: `Hand-off intelligence — ${stamp.slice(0, 10)}`, body: noteBody } });
    log(`Brain update: submitted${rr.body?.jobId ? ` (job ${rr.body.jobId})` : ""}.`);
  } catch (e) {
    log(`Brain update FAILED: ${String(e?.message ?? e)}`);
  }
}

main()
  .then(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const out = `_handoff-harness-${TAG}-${stamp}.md`;
    import("node:fs").then(fs => {
      fs.writeFileSync(out, lines.join("\n"));
      console.log(`\nWrote: ${out}`);
    });
  })
  .catch(e => { console.error("HARNESS FAILED:", e); process.exit(1); });
