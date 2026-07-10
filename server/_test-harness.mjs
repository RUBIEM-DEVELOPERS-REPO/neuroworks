// Live test harness for grading agent outcomes. Fires a set of queries
// at /api/chat, polls /api/tasks/jobs/:id until done, then prints a
// per-query report with content + time-weighted grade.
//
// Usage: pnpm exec tsx _test-harness.mjs [tag]
// `tag` is a label written into the report (e.g. "local" / "openrouter")
// so the same harness can be re-run after a config change.

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "live";
const BASE = "http://127.0.0.1:7471";

const QUERIES = [
  // ──────────────────────────────────────────────────────────────────
  // Tier 1 — trivial direct (target <5s, B+ baseline)
  { id: "hi",        q: "hi",                          tier: "trivial",        targetSec:   5 },
  { id: "math",      q: "what is 2+2",                 tier: "trivial",        targetSec:   5 },
  // Tier 2 — direct answer / short research (target <60s)
  { id: "vault-sum", q: "summarise neuroworks",        tier: "research-light", targetSec:  60 },
  { id: "hanta",     q: "what is the hanta virus",     tier: "research-light", targetSec:  60 },
  // Tier 3 — multi-step + tool chain (target <180s)
  { id: "fs-find",   q: "find resume.pdf in my downloads and tell me what's inside", tier: "multi-step", targetSec: 120 },
  { id: "gh-prs",    q: "list the open PRs in clawbot", tier: "multi-step",    targetSec:  90 },
  { id: "compare",   q: "compare what my vault says about neuroworks with the clawbot README on github", tier: "multi-step", targetSec: 180 },
  { id: "multi",     q: "analyse the case for and against giving every employee an AI agent", tier: "multi-step", targetSec: 180 },
];

async function postChat(q) {
  // Retry on transient fetch-failed (e.g. tsx watch reloaded the
  // server, brief connection refused). 3 attempts with 4s backoff.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:7470" },
        body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
      });
      return r.json();
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(4000);
    }
  }
  throw lastErr;
}

async function pollJob(id, maxMs = 900_000) {
  const start = Date.now();
  let consecutive404 = 0;
  while (Date.now() - start < maxMs) {
    let r;
    try {
      r = await fetch(`${BASE}/api/tasks/jobs/${id}`);
    } catch (e) {
      // Network blip / server restart — give it a moment.
      await sleep(2000);
      continue;
    }
    if (r.status === 404) {
      consecutive404++;
      // Job evicted from in-memory cache (server restart wiped it),
      // or the job ID never existed. Bail after 3 consecutive 404s.
      if (consecutive404 >= 3) throw new Error(`job ${id} not found (likely server restart wiped in-memory cache)`);
      await sleep(2000);
      continue;
    }
    consecutive404 = 0;
    if (!r.ok) { await sleep(2000); continue; }
    const d = await r.json();
    if (d.status === "succeeded" || d.status === "failed" || d.status === "rejected") return d;
    await sleep(4000);
  }
  throw new Error(`poll timeout for ${id}`);
}

// Letter grade arithmetic helpers — A+ = 12, F = 0.
const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
function tierIdx(g) { return TIERS.indexOf(g); }
function tierFromIdx(i) { return TIERS[Math.max(0, Math.min(TIERS.length - 1, i))]; }

function gradeContent(text, q) {
  if (!text) return "F";
  // Hard failure markers — always F or D-.
  if (/^fetch failed$/i.test(text.trim())) return "F";
  if (/synthesiser couldn't run|partial result/i.test(text)) return "D-";

  // Arithmetic queries: correctness check beats length. We compute the
  // expected answer and verify it appears in the response.
  const arithMatch = q.match(/^\s*(?:what(?:'?s|\s+is)\s+)?([\d\s+\-*/().,]+)\s*\??\s*$/i);
  if (arithMatch && /\d/.test(arithMatch[1]) && /[+\-*/]/.test(arithMatch[1])) {
    try {
      const expr = arithMatch[1].replace(/,/g, "").trim();
      if (/^[\d\s+\-*/().]+$/.test(expr)) {
        const expected = new Function(`"use strict"; return (${expr});`)();
        if (typeof expected === "number" && Number.isFinite(expected)) {
          // Look for the expected number in the answer (with tolerance
          // for trailing punctuation / formatting).
          const re = new RegExp(`\\b${expected.toString().replace(".", "\\.")}\\b`);
          return re.test(text) ? "A" : "F";
        }
      }
    } catch { /* fall through */ }
  }

  // Greetings: warm reply with a follow-up offer = A. Cold/terse = B.
  if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thanks?|bye)\b/i.test(q.trim())) {
    if (/help|task|on it|what can|good\s+(?:morning|afternoon|evening)|how can/i.test(text)) return "A";
    return "B";
  }

  // Refusal-without-trying when the task has a clear answer → C
  if (/i don'?t (?:know|recognise|have)|i can'?t (?:find|locate|list|provide|extract)|need more|could you|evidence (?:does not contain|doesn'?t contain)|i'?m sorry/i.test(text)
      && !/I don't have specific knowledge of/i.test(text)) {
    if (/what is|summarise|find|list|compare|analyse|show/i.test(q)) return "C";
  }
  // Cited and substantial — A
  if (/\[\d+\]|\[vault:|\[github:|\[fs:/i.test(text) && text.length > 200) return "A";
  // Substantial and structured — B+
  if (text.length > 300 && /\n/.test(text)) return "B+";
  // Decent
  if (text.length > 120) return "B";
  // Short answer (not arithmetic, not greeting) — could be terse-and-correct or just stub.
  if (text.length > 20) return "B-";
  return "C";
}

function gradeTime(elapsedSec, targetSec) {
  // 0 penalty within target; -1 tier per ~50% over target.
  if (elapsedSec <= targetSec) return 0;
  const over = elapsedSec - targetSec;
  const ratio = over / targetSec;
  return -Math.floor(ratio / 0.5);
}

function finalGrade(content, timePenalty) {
  const i = tierIdx(content);
  return tierFromIdx(i + timePenalty);
}

async function runOne(spec) {
  const t0 = Date.now();
  const post = await postChat(spec.q);
  let text = post.text;
  let elapsed;
  let answerSrc = "inline";
  if (post.kind === "task" && post.jobId) {
    const j = await pollJob(post.jobId);
    elapsed = j.startedAt && j.finishedAt
      ? (new Date(j.finishedAt) - new Date(j.startedAt)) / 1000
      : (Date.now() - t0) / 1000;
    text = j.result?.answer ?? text ?? "";
    answerSrc = "job";
    spec._jobId = post.jobId;
    spec._skill = j.result?.skillUsed ?? "(none)";
    spec._skillScore = j.result?.skillScore ?? "(none)";
    spec._steps = j.result?.plan?.steps?.length ?? 0;
    spec._runs = (j.result?.runs ?? []).map(r => `${r.step?.tool}=${r.ok ? "ok" : "fail"}/${r.durationMs ?? 0}ms`).join(", ");
  } else {
    elapsed = (Date.now() - t0) / 1000;
  }
  const contentGrade = gradeContent(text ?? "", spec.q);
  const timePenalty = gradeTime(elapsed, spec.targetSec);
  const finalG = finalGrade(contentGrade, timePenalty);
  return {
    id: spec.id, q: spec.q, tier: spec.tier,
    elapsed: Math.round(elapsed * 10) / 10,
    targetSec: spec.targetSec,
    contentGrade, timePenalty, finalG,
    text: (text ?? "").slice(0, 600),
    answerSrc,
    jobId: spec._jobId,
    skill: spec._skill,
    skillScore: spec._skillScore,
    steps: spec._steps,
    runs: spec._runs,
  };
}

async function main() {
  console.log(`# Test harness run :: ${TAG} :: ${new Date().toISOString()}`);
  console.log(`Server:        ${BASE}`);
  const h = await (await fetch(`${BASE}/api/health`)).json();
  console.log(`Model:         ${h.model}`);
  console.log(`OpenRouter:    ${h.openrouter?.enabled ? `enabled (${h.openrouter.model ?? "default"})` : "disabled"}`);
  console.log("");
  const results = [];
  for (const spec of QUERIES) {
    process.stderr.write(`▶ ${spec.id} (${spec.q.slice(0, 40)}…)\n`);
    try {
      const r = await runOne(spec);
      results.push(r);
      process.stderr.write(`  ${r.elapsed}s :: ${r.contentGrade} ${r.timePenalty<0?`(time ${r.timePenalty})`:""} → ${r.finalG}\n`);
    } catch (e) {
      results.push({ id: spec.id, q: spec.q, tier: spec.tier, elapsed: -1, contentGrade: "F", timePenalty: 0, finalG: "F", text: String(e?.message ?? e) });
      process.stderr.write(`  ERROR: ${e?.message ?? e}\n`);
    }
  }
  console.log("| id | tier | target | elapsed | content | time | FINAL |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of results) {
    console.log(`| ${r.id} | ${r.tier} | ${r.targetSec}s | ${r.elapsed}s | ${r.contentGrade} | ${r.timePenalty} | **${r.finalG}** |`);
  }
  // Score summary: how many at-or-above B (idx of B = 9)
  const aboveB = results.filter(r => tierIdx(r.finalG) > tierIdx("B")).length;
  const atB = results.filter(r => tierIdx(r.finalG) === tierIdx("B")).length;
  const below = results.length - aboveB - atB;
  console.log("");
  console.log(`Summary: ${aboveB} strictly above B · ${atB} at B · ${below} below B / total ${results.length}`);
  console.log("");
  console.log("## Outputs");
  for (const r of results) {
    console.log(`\n### ${r.id} — ${r.q}`);
    console.log(`grade: **${r.finalG}** (content ${r.contentGrade}, time penalty ${r.timePenalty}) — ${r.elapsed}s vs ${r.targetSec}s target`);
    if (r.skill && r.skill !== "(none)") console.log(`skill: ${r.skill} (score ${r.skillScore})`);
    if (r.steps !== undefined && r.steps > 0) console.log(`plan: ${r.steps} step(s) — ${r.runs}`);
    console.log("");
    console.log("```");
    console.log(r.text);
    console.log("```");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
