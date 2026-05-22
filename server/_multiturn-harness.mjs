// Multi-turn chat continuity harness. Tests that the chat handler uses
// recent turns as context (pronoun resolution, topic continuation,
// implicit affirmations, explicit resets, reference-by-position).
//
// Each probe runs FOR REAL through /api/chat:
//   Turn 1: send the first user message, get assistant response.
//   Turn 2+: send the growing [user, assistant, user, ...] array; the
//            chat handler builds enriched context from the slice.
//   Grader checks ONLY the final turn's response.
//
// Strict rubric — same time + content grading as prior harnesses.

import { setTimeout as sleep } from "node:timers/promises";

const TAG = process.argv[2] ?? "mt";
const BASE = "http://127.0.0.1:7471";

const TIERS = ["F", "F+", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const tIdx = (g) => TIERS.indexOf(g);
const tFromIdx = (i) => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))];

function timePenalty(elapsedSec, targetSec) {
  if (!targetSec || elapsedSec <= targetSec) return 0;
  const over = elapsedSec - targetSec;
  return -Math.floor(over / (targetSec * 0.5));
}

async function postJson(path, body, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Origin": "http://127.0.0.1:7470" },
        body: JSON.stringify(body ?? {}),
      });
      const j = await r.json().catch(() => null);
      return { status: r.status, body: j };
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(2000);
    }
  }
  throw last;
}

async function getJson(path) {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, body: r.ok ? await r.json() : null };
}

async function pollJob(id, maxMs = 600_000) {
  const start = Date.now();
  let consecutive404 = 0;
  while (Date.now() - start < maxMs) {
    let r;
    try { r = await getJson(`/api/tasks/jobs/${id}`); }
    catch { await sleep(2000); continue; }
    if (r.status === 404) {
      consecutive404++;
      if (consecutive404 >= 3) throw new Error(`job ${id} not found`);
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

// Send a single chat turn and return the final assistant text.
// Handles both inline ({kind: "message", text}) and async ({kind: "task", jobId}) shapes.
async function chatTurn(messages) {
  const post = await postJson("/api/chat", { messages });
  if (post.body?.kind === "message") {
    return { text: post.body.text ?? "", source: "inline" };
  }
  if (post.body?.kind === "task" && post.body?.jobId) {
    const j = await pollJob(post.body.jobId, 600_000);
    if (j.status !== "succeeded") return { text: j.result?.answer ?? post.body.text ?? "", source: "task-failed", status: j.status };
    return { text: j.result?.answer ?? "", source: "task" };
  }
  return { text: JSON.stringify(post.body).slice(0, 400), source: "unexpected" };
}

// ─────────────────────────────────────────────────────────────────────
// 8 multi-turn probes
// ─────────────────────────────────────────────────────────────────────
const PROBES = [
  {
    id: "shorten-pronoun",
    targetSec: 90,
    desc: "Turn 1: explain RAG. Turn 2: 'shorten it' — should produce a shorter RAG explanation.",
    turns: [
      { role: "user", content: "explain RAG retrieval augmented generation" },
      { role: "user", content: "shorten it" }, // injected after assistant reply
    ],
    grade: (final, history) => {
      const turn1 = history.find(m => m.role === "assistant")?.content ?? "";
      const stillAboutRAG = /retriev|RAG|augment|vector|embed/i.test(final);
      const isShorter = final.length > 30 && final.length < Math.max(200, turn1.length * 0.75);
      const hasNumbers = /\d/.test(final);
      if (stillAboutRAG && isShorter) return "A";
      if (stillAboutRAG && final.length < turn1.length) return "B+";
      if (stillAboutRAG) return "B";
      return "C";
    },
  },
  {
    id: "what-about-shift",
    targetSec: 60,
    desc: "Turn 1: capital of France. Turn 2: 'what about Germany' — should answer Berlin.",
    turns: [
      { role: "user", content: "what is the capital of France" },
      { role: "user", content: "what about Germany" },
    ],
    grade: (final) => {
      const hasBerlin = /\bberlin\b/i.test(final);
      const hasParis = /\bparis\b/i.test(final);
      if (hasBerlin && !hasParis) return "A";
      if (hasBerlin) return "B+";
      if (final.length > 40) return "B";
      return "C";
    },
  },
  {
    id: "pronoun-it-summary",
    targetSec: 90,
    desc: "Turn 1: what is HTTP/2. Turn 2: 'summarise it in one sentence'.",
    turns: [
      { role: "user", content: "what is HTTP/2" },
      { role: "user", content: "summarise it in one sentence" },
    ],
    grade: (final) => {
      const aboutHTTP2 = /\bhttp\W?2\b/i.test(final) || /protocol|multiplex|binary/i.test(final);
      const isOneSentence = (final.match(/[.!?](?:\s|$)/g) ?? []).length <= 2 && final.length < 350;
      if (aboutHTTP2 && isOneSentence) return "A";
      if (aboutHTTP2) return "B+";
      return "C";
    },
  },
  {
    id: "explicit-switch",
    targetSec: 60,
    desc: "Turn 1: tell me about Python. Turn 2: 'new task: what is Rust' — should switch topic.",
    turns: [
      { role: "user", content: "tell me about Python in two sentences" },
      { role: "user", content: "new task: what is Rust" },
    ],
    grade: (final) => {
      const aboutRust = /\brust\b/i.test(final);
      const aboutPython = /\bpython\b/i.test(final);
      if (aboutRust && !aboutPython) return "A";
      if (aboutRust) return "B+";
      return "C";
    },
  },
  {
    id: "bare-yes-with-context",
    targetSec: 60,
    desc: "Turn 1: 'should I research X' (clawbot offers). Turn 2: 'yes' — should ack and act on prior offer.",
    turns: [
      { role: "user", content: "I'm thinking about researching the LK-99 superconductor saga — should I" },
      { role: "user", content: "yes" },
    ],
    grade: (final) => {
      // Bare "yes" with prior context — the right behaviour is to STAY
      // ENGAGED with the thread topic. Acceptable shapes:
      //   (a) kick off the action (A)
      //   (b) reference the thread topic + offer next-step options or
      //       ask an engaged follow-up question (A — agent is keeping
      //       the conversation alive instead of refusing)
      //   (c) generic refusal "I don't have a pending suggestion" (C —
      //       wrong; prior context exists)
      const tookAction = /research|investigat|on it|i'?ll\s|plan|let me|starting|kicking off|here'?s/i.test(final);
      // Thread topic anchors. LK-99 / superconductor are the topic from
      // Turn 1; ANY reference here means the agent kept context.
      const refsThreadTopic = /LK[\s-]?99|superconductor|saga/i.test(final);
      const engaged = /\?/.test(final) || /\b(?:dive|explore|drill|investigate|cover|focus|expand|continue)\b/i.test(final);
      const genericRefusal = /don'?t have a pending suggestion/i.test(final);
      if (genericRefusal) return "C";
      if (tookAction) return "A";
      if (refsThreadTopic && engaged) return "A"; // engaged with the topic
      if (refsThreadTopic) return "B+";
      if (final.length > 30 && final.length < 300) return "B";
      return "C";
    },
  },
  {
    id: "affirmation-cold",
    targetSec: 5,
    desc: "Cold 'yes' with NO prior context — should ask for clarification, not act.",
    turns: [
      { role: "user", content: "yes" },
    ],
    grade: (final) => {
      // The right behaviour: cold "yes" without thread should ask what
      // to do. The detectAmbiguity helper returns a tailored question.
      const asksClarifying = /don'?t have a pending|what would you like|task or a question|drop me a task/i.test(final);
      if (asksClarifying) return "A";
      if (final.length > 0 && final.length < 200) return "B";
      return "C";
    },
  },
  {
    id: "continue-cold",
    targetSec: 5,
    desc: "Cold 'continue' with NO prior context — should ask 'from where'.",
    turns: [
      { role: "user", content: "continue" },
    ],
    grade: (final) => {
      const asksWhere = /continue from where|previous thread|don'?t see a previous|share the topic|pick up/i.test(final);
      if (asksWhere) return "A";
      if (final.length > 20 && final.length < 200) return "B";
      return "C";
    },
  },
  {
    id: "qa-then-bullet",
    targetSec: 120,
    desc: "Turn 1: explain transformers (model arch). Turn 2: 'give me 3 key components' — should produce 3 bullets about transformers.",
    turns: [
      { role: "user", content: "explain transformer neural networks" },
      { role: "user", content: "give me 3 key components" },
    ],
    grade: (final) => {
      const bullets = (final.match(/(?:^|\n)\s*(?:[1-9]\.|\d\)|[-*•])\s+/g) ?? []).length;
      const aboutTransformers = /attention|encoder|decoder|self[\s-]?attention|transformer|embedding|softmax|head/i.test(final);
      if (bullets >= 3 && aboutTransformers) return "A";
      if (bullets >= 3 || aboutTransformers) return "B+";
      return "C";
    },
  },
];

async function runProbe(probe) {
  const totalStart = Date.now();
  const history = [];
  let final = null;
  let finalTurnElapsed = 0;
  // Run each user turn in sequence, accumulating assistant replies between them.
  for (let i = 0; i < probe.turns.length; i++) {
    const userTurn = probe.turns[i];
    history.push(userTurn);
    const turnStart = Date.now();
    const r = await chatTurn(history);
    const turnElapsed = (Date.now() - turnStart) / 1000;
    final = r;
    if (i === probe.turns.length - 1) finalTurnElapsed = turnElapsed;
    // Only append assistant reply if there's another user turn to come.
    if (i < probe.turns.length - 1) {
      history.push({ role: "assistant", content: r.text });
    }
  }
  const totalElapsed = (Date.now() - totalStart) / 1000;
  // Grade time on FINAL TURN ONLY — Turn 1 setup is not what we're grading.
  const contentGrade = probe.grade(final.text, history);
  const penalty = timePenalty(finalTurnElapsed, probe.targetSec);
  const finalG = tFromIdx(tIdx(contentGrade) + penalty);
  return {
    id: probe.id, desc: probe.desc,
    elapsed: Math.round(finalTurnElapsed * 10) / 10,
    totalElapsed: Math.round(totalElapsed * 10) / 10,
    target: probe.targetSec,
    contentGrade, penalty, finalG,
    finalText: final.text.slice(0, 600),
    source: final.source,
    history: history.map(h => `${h.role}: ${h.content.slice(0, 150)}`),
  };
}

async function main() {
  console.log(`# Multi-turn Continuity Harness :: ${TAG} :: ${new Date().toISOString()}`);
  const h = await getJson("/api/health");
  console.log(`Server: ${BASE}`);
  console.log(`Model: ${h.body?.model}`);
  console.log(`OpenRouter: ${h.body?.openrouter?.enabled ? `enabled (${h.body.openrouter.model})` : "disabled"}`);
  console.log();

  const results = [];
  for (const probe of PROBES) {
    process.stderr.write(`▶ ${probe.id}\n`);
    try {
      const r = await runProbe(probe);
      results.push(r);
      const marker = tIdx(r.finalG) > tIdx("B") ? "✓" : (tIdx(r.finalG) >= tIdx("B") ? "○" : "✗");
      process.stderr.write(`  ${marker} ${r.elapsed}s :: ${r.contentGrade}${r.penalty ? `(${r.penalty})` : ""} → ${r.finalG}\n`);
    } catch (e) {
      results.push({ id: probe.id, desc: probe.desc, elapsed: -1, target: probe.targetSec, contentGrade: "F", penalty: 0, finalG: "F", finalText: String(e?.message ?? e), source: "error", history: [] });
      process.stderr.write(`  ✗ ERROR: ${e?.message ?? e}\n`);
    }
  }

  console.log(`## Scorecard\n`);
  console.log(`| probe | target | turn-2 | total | content | time | FINAL | description |`);
  console.log(`|---|---|---|---|---|---|---|---|`);
  for (const r of results) {
    console.log(`| ${r.id} | ${r.target}s | ${r.elapsed}s | ${r.totalElapsed ?? "—"}s | ${r.contentGrade} | ${r.penalty} | **${r.finalG}** | ${r.desc} |`);
  }
  const above = results.filter(r => tIdx(r.finalG) > tIdx("B")).length;
  const at = results.filter(r => tIdx(r.finalG) === tIdx("B")).length;
  const below = results.length - above - at;
  console.log(`\n**Summary:** ${above} above B · ${at} at B · ${below} below B / ${results.length}`);

  console.log(`\n## Outputs\n`);
  for (const r of results) {
    console.log(`\n### ${r.id} — ${r.finalG}`);
    console.log(`*${r.desc}*\n`);
    console.log(`**Conversation:**`);
    for (const turn of r.history) console.log(`- ${turn}`);
    console.log(`\n**Final assistant response (source: ${r.source}):**`);
    console.log("```");
    console.log(r.finalText);
    console.log("```");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
