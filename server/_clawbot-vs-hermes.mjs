// Head-to-head: clawbot vs Hermes on an identical task set.
//
// FAIRNESS: both agents are pinned to the SAME model — openai/gpt-oss-20b:free
// via OpenRouter — so this measures the AGENT SCAFFOLDING (planner/synth/skills
// vs Hermes's tool-calling loop), not the model. Hermes's configured default
// (anthropic/claude-opus-4.6) is broken on its key, so we force the free model.
//
// clawbot: POST /api/chat (its real pipeline), poll the job for result.answer.
// hermes : `hermes -z "<task>" -m openai/gpt-oss-20b:free --provider openrouter`.
//
// Grading: keyword-coverage per task (any-of groups) + a length-sanity floor.
// We also record latency and completion. Output: a markdown scorecard.

import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";

const BASE = "http://127.0.0.1:7471";
const HERMES = "C:/Users/Arthur Magaya/AppData/Local/hermes/hermes-agent/venv/Scripts/hermes.exe";
const HERMES_ARGS_MODEL = ["-m", "openai/gpt-oss-20b:free", "--provider", "openrouter"];
const HERMES_TIMEOUT_MS = 200_000;
const NEUROWORKS_POLL_MS = 150_000;

// Each task: a prompt + coverage groups (each group = array of accepted
// substrings; a group is "covered" if ANY of its substrings appears) + minLen.
const TASKS = [
  { id: "math", prompt: "What is 17 * 23? Reply with the number and one sentence explaining it.",
    groups: [["391"]], minLen: 5 },
  { id: "idempotency", prompt: "In 3 sentences, explain what idempotency means in API design and why it matters for payment endpoints.",
    groups: [["idempoten"], ["same", "once", "retry", "duplicate", "repeat"], ["payment", "charge", "transaction"]], minLen: 120 },
  { id: "owasp", prompt: "List 4 common web application security vulnerabilities, each with a one-line mitigation.",
    groups: [["injection", "sql"], ["xss", "cross-site script"], ["auth", "access control", "broken access"], ["mitigat", "prevent", "use ", "sanitiz", "validat"]], minLen: 150 },
  { id: "apology", prompt: "Write a short, professional apology email (3-4 sentences) to a client for a delayed invoice, offering a clear next step.",
    groups: [["apolog", "sorry"], ["invoice"], ["delay"], ["next", "will ", "by ", "resolve", "send"]], minLen: 150 },
  { id: "rest-vs-graphql", prompt: "In 4 bullet points, compare REST and GraphQL for a public API.",
    groups: [["rest"], ["graphql"], ["over-fetch", "overfetch", "single endpoint", "multiple endpoint", "schema", "flexib"], ["•", "-", "*", "1."]], minLen: 150 },
];

function score(text, task) {
  const t = (text || "").toLowerCase();
  let covered = 0;
  const missing = [];
  for (const group of task.groups) {
    if (group.some(s => t.includes(s.toLowerCase()))) covered++;
    else missing.push(group[0]);
  }
  const coverage = covered / task.groups.length;
  const lenOk = (text || "").trim().length >= task.minLen;
  const pass = coverage >= 0.6 && lenOk;
  return { coverage, covered, total: task.groups.length, lenOk, pass, missing, chars: (text || "").trim().length };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runClawbot(prompt) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }], persona: "clawbot" }),
    });
    const j = await r.json();
    if (j.kind === "message") return { text: String(j.text ?? ""), ms: Date.now() - t0, ok: true };
    const jobId = j.jobId;
    if (!jobId) return { text: "", ms: Date.now() - t0, ok: false, note: `no jobId (kind=${j.kind})` };
    // poll
    const deadline = Date.now() + NEUROWORKS_POLL_MS;
    while (Date.now() < deadline) {
      await sleep(2500);
      const jr = await fetch(`${BASE}/api/templates/jobs/${jobId}`).then(x => x.json()).catch(() => null);
      if (!jr) continue;
      if (jr.status === "succeeded") return { text: String(jr.result?.answer ?? ""), ms: Date.now() - t0, ok: true };
      if (jr.status === "failed" || jr.status === "rejected") return { text: String(jr.result?.answer ?? jr.error ?? ""), ms: Date.now() - t0, ok: false, note: jr.status };
    }
    return { text: "", ms: Date.now() - t0, ok: false, note: "poll timeout" };
  } catch (e) {
    return { text: "", ms: Date.now() - t0, ok: false, note: String(e?.message ?? e) };
  }
}

function runHermes(prompt) {
  return new Promise(resolve => {
    const t0 = Date.now();
    execFile(HERMES, ["-z", prompt, ...HERMES_ARGS_MODEL], { timeout: HERMES_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const ms = Date.now() - t0;
        const out = String(stdout ?? "").trim();
        const failMsg = /no final response was produced/i.test(out + stderr);
        if (failMsg || (!out && err)) {
          return resolve({ text: out, ms, ok: false, note: failMsg ? "no final response" : String(err?.message ?? "error").slice(0, 80) });
        }
        resolve({ text: out, ms, ok: true });
      });
  });
}

(async () => {
  console.log(`\n=== clawbot vs Hermes — same model (gpt-oss-20b:free) — ${new Date().toISOString()} ===\n`);
  const rows = [];
  for (const task of TASKS) {
    console.log(`\n--- TASK: ${task.id} ---`);
    process.stdout.write("  clawbot… ");
    const cb = await runClawbot(task.prompt);
    const cbs = score(cb.text, task);
    console.log(`${cb.ok ? "ok" : "FAIL"} ${(cb.ms / 1000).toFixed(1)}s · cov ${(cbs.coverage * 100).toFixed(0)}% · ${cbs.chars}c ${cbs.pass ? "PASS" : "fail"}${cb.note ? " (" + cb.note + ")" : ""}`);
    process.stdout.write("  hermes…  ");
    const hm = await runHermes(task.prompt);
    const hms = score(hm.text, task);
    console.log(`${hm.ok ? "ok" : "FAIL"} ${(hm.ms / 1000).toFixed(1)}s · cov ${(hms.coverage * 100).toFixed(0)}% · ${hms.chars}c ${hms.pass ? "PASS" : "fail"}${hm.note ? " (" + hm.note + ")" : ""}`);
    rows.push({ task: task.id, cb, cbs, hm, hms });
  }

  // Scorecard
  const agg = key => rows.reduce((a, r) => {
    a.pass += r[key + "s"].pass ? 1 : 0;
    a.cov += r[key + "s"].coverage;
    a.ms += r[key].ms;
    a.ok += r[key].ok ? 1 : 0;
    return a;
  }, { pass: 0, cov: 0, ms: 0, ok: 0 });
  const cbAgg = agg("cb"), hmAgg = agg("hm");
  const n = rows.length;

  let md = `# clawbot vs Hermes — scorecard\n\n`;
  md += `Run: ${new Date().toISOString()} · ${n} tasks · model pinned to **openai/gpt-oss-20b:free** (OpenRouter) for both.\n\n`;
  md += `| Metric | clawbot | Hermes |\n|---|---|---|\n`;
  md += `| Tasks passed | ${cbAgg.pass}/${n} | ${hmAgg.pass}/${n} |\n`;
  md += `| Completed (no error) | ${cbAgg.ok}/${n} | ${hmAgg.ok}/${n} |\n`;
  md += `| Avg coverage | ${(cbAgg.cov / n * 100).toFixed(0)}% | ${(hmAgg.cov / n * 100).toFixed(0)}% |\n`;
  md += `| Avg latency | ${(cbAgg.ms / n / 1000).toFixed(1)}s | ${(hmAgg.ms / n / 1000).toFixed(1)}s |\n\n`;
  md += `## Per-task\n\n| Task | clawbot pass / cov / s | Hermes pass / cov / s |\n|---|---|---|\n`;
  for (const r of rows) {
    md += `| ${r.task} | ${r.cbs.pass ? "✅" : "❌"} ${(r.cbs.coverage * 100).toFixed(0)}% ${(r.cb.ms / 1000).toFixed(0)}s | ${r.hms.pass ? "✅" : "❌"} ${(r.hms.coverage * 100).toFixed(0)}% ${(r.hm.ms / 1000).toFixed(0)}s |\n`;
  }
  md += `\n## Notes\n- Same model on both; differences reflect agent scaffolding + invocation model (warm server vs cold CLI), not model quality.\n`;
  md += `- Hermes pays a per-invocation cold-start (plugin discovery ~50s) that clawbot's persistent server avoids.\n`;

  const outPath = `_clawbot-vs-hermes-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  writeFileSync(outPath, md, "utf8");
  console.log(`\n${md}\n\nWritten: ${outPath}`);
})();
