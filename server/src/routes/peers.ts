import { Router } from "express";
import { config } from "../config.js";
import { pollPeers, localInflightCount } from "../lib/peers.js";
import { registerPeer, deregisterPeer, listAllPeers, autodiscoverLocalPeers } from "../lib/peer-registry.js";
import { ensureWorker, workerStatus, shutdownManagedWorker } from "../lib/worker-manager.js";
import { newJob, runJob, listJobs } from "../lib/jobs.js";
import { planAndExecute } from "../lib/agent.js";
import { ollamaGenerate } from "../lib/ollama.js";
import { personaSystemSuffix, addPersona, deletePersona, loadPersonas, type Persona } from "../lib/personas.js";
import { loadJobsInWindow } from "../lib/job-store.js";

export const peersRouter = Router();

// Strip bulky text bodies off a run result before shipping back across
// the peer wire — but preserve everything the primary's UI needs to render
// the run AS IF it had executed locally. Without this, delegated work
// looks degraded on the primary's Tasks / Results pages.
function compactRunResult(result: any, tool?: string): any {
  if (!result || typeof result !== "object") return result;
  if (tool === "vault.search") {
    return { matches: Array.isArray(result.matches) ? result.matches.slice(0, 8) : [] };
  }
  if (tool === "vault.read") {
    return { hasContent: typeof result.content === "string" && result.content.length > 0, contentChars: result.content?.length ?? 0 };
  }
  if (tool === "research.deep") {
    return {
      query: result.query,
      vaultHits: Array.isArray(result.vaultHits) ? result.vaultHits.slice(0, 8) : [],
      webSources: Array.isArray(result.webSources)
        ? result.webSources.map((w: any) => ({ url: w.url, title: w.title, ok: w.ok, error: w.error, usedBrowser: w.usedBrowser })).slice(0, 8)
        : [],
      captured: result.captured,
    };
  }
  if (tool === "research.multiperspective") {
    return {
      topic: result.topic,
      perspectives: result.perspectives,
      vaultHits: Array.isArray(result.vaultHits) ? result.vaultHits.slice(0, 8) : [],
      perspectiveResults: Array.isArray(result.perspectiveResults)
        ? result.perspectiveResults.map((p: any) => ({
            name: p.name,
            query: p.query,
            sources: Array.isArray(p.sources)
              ? p.sources.map((s: any) => ({ url: s.url, title: s.title, ok: s.ok, error: s.error, usedBrowser: s.usedBrowser }))
              : [],
          }))
        : [],
      sourceCount: result.sourceCount,
      captured: result.captured,
    };
  }
  if (tool === "web.search") {
    return {
      query: result.query,
      engine: result.engine,
      tried: result.tried,
      results: Array.isArray(result.results)
        ? result.results.slice(0, 10).map((r: any) => ({ title: r.title, url: r.url, snippet: r.snippet?.slice(0, 240) }))
        : [],
    };
  }
  if (tool === "web.fetch" || tool === "web.scrape") {
    // Keep status + title + a short text excerpt so the UI can show "X chars
    // fetched" plus a preview, and so curation can root via vault refs in
    // the body. Full body stays on the peer.
    return {
      status: result.status,
      contentType: result.contentType,
      title: result.title,
      usedBrowser: result.usedBrowser,
      textPreview: typeof result.text === "string" ? result.text.slice(0, 800) : undefined,
      textChars: typeof result.text === "string" ? result.text.length : 0,
    };
  }
  if (tool === "github.list_repos") {
    return { count: Array.isArray(result.repos) ? result.repos.length : 0 };
  }
  if (tool === "github.read_repo") {
    return {
      readmeChars: typeof result.readme === "string" ? result.readme.length : 0,
      commits: Array.isArray(result.commits) ? result.commits.slice(0, 10).map((c: any) => ({ sha: c.sha?.slice?.(0, 7), message: c.commit?.message?.split("\n")[0]?.slice(0, 160) })) : [],
      prs: Array.isArray(result.prs) ? result.prs.slice(0, 10).map((p: any) => ({ number: p.number, title: p.title, state: p.state })) : [],
      issues: Array.isArray(result.issues) ? result.issues.slice(0, 10).map((i: any) => ({ number: i.number, title: i.title, state: i.state })) : [],
    };
  }
  if (tool === "github.get_file") {
    return { size: result.size, contentChars: typeof result.content === "string" ? result.content.length : 0 };
  }
  if (tool === "quality.check") {
    return {
      pass: result.pass,
      score: result.score,
      factuality_risk: result.factuality_risk,
      citation_coverage: result.citation_coverage,
      persona_fit: result.persona_fit,
      issues: Array.isArray(result.issues) ? result.issues.slice(0, 8) : [],
    };
  }
  if (tool === "security.scan") {
    return {
      pass: result.pass,
      kind: result.kind,
      findings: Array.isArray(result.findings) ? result.findings.slice(0, 12) : [],
    };
  }
  if (tool === "peer.review") {
    return {
      verdict: result.verdict,
      issues: Array.isArray(result.issues) ? result.issues.slice(0, 8) : [],
      confidence: result.confidence,
      reviewer: result.reviewer ?? result.peer,
    };
  }
  if (tool === "ollama.generate") {
    return { chars: typeof result.text === "string" ? result.text.length : 0, model: result.model, preview: typeof result.text === "string" ? result.text.slice(0, 240) : undefined };
  }
  return result;
}

// Self-introspection: who am I, what model, how busy. Other clawbots poll this
// to make delegation decisions, and the UI uses it for the topbar peer roll-call.
peersRouter.get("/self", (_req, res) => {
  res.json({
    name: config.name,
    role: config.role,
    model: config.ollamaModel,
    port: config.port,
    ready: config.ready,
    inflightJobs: localInflightCount(),
    peers: config.peers,
  });
});

// Peer-aware reflection window. The primary fans out to every peer's
// /api/peers/jobs?since=<iso>&until=<iso> when it runs the daily
// reflection, merges results by id, and aggregates the whole fleet's
// activity — not just its own. Returns the same slim PersistedJob shape
// the local job-store writes, plus any in-memory jobs not yet flushed.
//
// Default window: last 24 hours, capped at 7 days to keep the response
// bounded if a misconfigured caller asks for "everything".
peersRouter.get("/jobs", (req, res) => {
  const now = Date.now();
  const sinceParam = String(req.query.since ?? "").trim();
  const untilParam = String(req.query.until ?? "").trim();
  const sinceMs = sinceParam ? new Date(sinceParam).getTime() : now - 24 * 3600_000;
  const untilMs = untilParam ? new Date(untilParam).getTime() : now;
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs) || untilMs <= sinceMs) {
    res.status(400).json({ error: "bad_window", message: "since/until must be parseable ISO timestamps with since < until" });
    return;
  }
  const MAX_RANGE_MS = 7 * 24 * 3600_000;
  if (untilMs - sinceMs > MAX_RANGE_MS) {
    res.status(400).json({ error: "window_too_wide", message: "window must be 7 days or less" });
    return;
  }
  const persisted = loadJobsInWindow(sinceMs, untilMs);
  const persistedIds = new Set(persisted.map(p => p.id));
  // In-memory jobs that haven't flushed yet (still running, or just
  // completed this same second). Slim them to the same shape.
  const inMemory = listJobs()
    .filter(j => {
      const t = j.startedAt ? new Date(j.startedAt).getTime() : 0;
      return t >= sinceMs && t < untilMs && !persistedIds.has(j.id);
    })
    .map(j => {
      const r: any = j.result ?? {};
      const inputs: any = j.inputs ?? {};
      return {
        id: j.id,
        kind: j.kind,
        status: j.status,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        template: j.template,
        title: j.title,
        error: j.error,
        retryOf: inputs.retryOf,
        persona: r.activePersona?.name,
        peer: r.peer?.name,
        runs: Array.isArray(r.runs)
          ? r.runs.map((run: any) => ({
              tool: run?.step?.tool ?? "unknown",
              durationMs: typeof run?.durationMs === "number" ? run.durationMs : 0,
              ok: run?.ok === true,
              error: run?.error,
            }))
          : undefined,
        skillUsed: r.skillUsed,
        skillScore: typeof r.skillScore === "number" ? r.skillScore : undefined,
      };
    });
  res.json({
    peer: config.name,
    role: config.role,
    since: new Date(sinceMs).toISOString(),
    until: new Date(untilMs).toISOString(),
    jobs: [...persisted, ...inMemory],
  });
});

// Roll-call across all configured peers. Returns one entry per peer with health
// + busy state so the UI can render "primary (busy) · secondary (idle)". Also
// returns the registry view so the Admin UI can show dropped/recently-failing
// peers alongside the active ones.
peersRouter.get("/", async (_req, res) => {
  const self = {
    url: `http://127.0.0.1:${config.port}`,
    name: config.name,
    role: config.role,
    model: config.ollamaModel,
    ok: true,
    ready: config.ready,
    inflightJobs: localInflightCount(),
    rttMs: 0,
  };
  const peers = await pollPeers();
  res.json({ self, peers, registry: listAllPeers() });
});

// Add a peer at runtime. Body: { url } — accepts "127.0.0.1:7473" or
// "http://127.0.0.1:7473". A successful add is immediate; the next poll
// surfaces health. Re-registering a dropped peer revives it.
peersRouter.post("/register", (req, res) => {
  const url = String(req.body?.url ?? "").trim();
  if (!url) return res.status(400).json({ error: "url required" });
  const r = registerPeer(url, "registered", "added via API");
  res.json(r);
});

// Drop a peer from the runtime registry. Doesn't affect CLAWBOT_PEERS env —
// to permanently remove an env peer, edit .env and restart. Useful for
// removing a stale auto-discovered peer.
peersRouter.delete("/register", (req, res) => {
  const url = String(req.body?.url ?? req.query?.url ?? "").trim();
  if (!url) return res.status(400).json({ error: "url required" });
  const removed = deregisterPeer(url);
  res.json({ removed });
});

// Trigger an immediate auto-discovery scan. Used by the "Find workers" button
// on Admin — saves the user from having to know the secondary's port.
peersRouter.post("/discover", async (_req, res) => {
  try {
    const r = await autodiscoverLocalPeers();
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Inspect / start / stop the managed worker. The Admin UI uses these to
// show "managed worker · pid 1234 · up 3m" and to provide a manual
// start/stop affordance when auto-spawn is disabled.
peersRouter.get("/worker", (_req, res) => {
  res.json(workerStatus());
});

peersRouter.post("/worker/start", async (_req, res) => {
  try {
    const r = await ensureWorker({ waitForReady: true });
    res.json({ ...r, status: workerStatus() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

peersRouter.post("/worker/stop", async (_req, res) => {
  try {
    await shutdownManagedWorker();
    res.json({ stopped: true, status: workerStatus() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Receive a task from another clawbot. Runs it through the same general-task
// pipeline a chat message would, and returns the jobId so the caller can poll.
// Note: any provided persona is applied at the start of the run and reverted
// after — we do NOT durably mutate the peer's active persona.
peersRouter.post("/delegate", async (req, res) => {
  try {
    const task = String(req.body?.task ?? "").trim();
    if (!task) return res.status(400).json({ error: "task required" });
    const requestedPersona = req.body?.persona ? String(req.body.persona) : null;
    // Full persona snapshot — present when the customer hired a CUSTOM
    // employee on the primary that this worker doesn't have locally. We
    // register it ephemerally for the run and drop it after.
    const personaSnapshot: Persona | null = (req.body?.personaSnapshot && typeof req.body.personaSnapshot === "object")
      ? req.body.personaSnapshot as Persona
      : null;

    const job = newJob("peer:delegate");
    job.template = "general-task";
    job.title = `Delegated: ${task.slice(0, 60)}`;
    job.inputs = { task, save_as_template: false, delegated: true };
    job.requiresApproval = false;

    res.json({ jobId: job.id, accepted: true, peer: config.name });

    void runJob(job, async (push, progress) => {
    // PERSONA SCOPING — fixed in this iteration to be race-safe under
    // concurrent delegations.
    //
    // Old behaviour: this handler called setActivePersona(snapshot.id) to
    // mutate the worker's GLOBAL active persona, then restored "original"
    // in a finally. With multiple in-flight delegations on the same worker
    // (which the new pool allows), the finallys would step on each other —
    // delegation A's restore could overwrite delegation B's set.
    //
    // New behaviour: we DO NOT mutate global persona state. The persona for
    // THIS run is held in a local variable + passed to planAndExecute via
    // opts.personaSystemSuffix (which the synth uses). The ephemeral hire
    // is still registered via addPersona so the persona is discoverable in
    // /api/personas during execution, but global active stays untouched —
    // each concurrent run carries its own persona scope.
    //
    // Tracked across the run so the response payload can verify which
    // persona actually shaped the synth (lets the primary detect mismatches).
    let ephemeralPersonaId: string | null = null;
    let resolvedPersona: Persona | null = null;
    try {
      if (personaSnapshot && personaSnapshot.id) {
        // Hydrate the snapshot. If a persona with this id already exists on
        // the worker we leave it alone (user's local edit wins); otherwise
        // we add it and mark it for cleanup.
        const existing = loadPersonas().personas.find(p => p.id === personaSnapshot.id);
        if (!existing) {
          try { addPersona(personaSnapshot); ephemeralPersonaId = personaSnapshot.id; }
          catch (e: any) { push(`could not register ephemeral persona (${e.message ?? e}) — continuing with default`); }
        }
        resolvedPersona = personaSnapshot;
        push(`hired employee "${personaSnapshot.name}" (${personaSnapshot.role}) for this task — scoped to this run only`);
      } else if (requestedPersona) {
        // Caller named a persona without sending a snapshot. Look it up
        // in the worker's local store.
        const found = loadPersonas().personas.find(p => p.id === requestedPersona);
        if (found) {
          resolvedPersona = found;
          push(`scoping this run to persona "${found.name}" (${found.role})`);
        } else {
          push(`requested persona "${requestedPersona}" not found on this worker — falling back to default`);
        }
      }
      // Suffix is captured from THIS run's persona, not from global state.
      // Concurrent delegations with different personas no longer collide.
      const suffix = personaSystemSuffix(resolvedPersona);
      const r = await planAndExecute(task, push, (patch) => progress(patch as Record<string, unknown>), { personaSystemSuffix: suffix });
      return {
        answer: r.answer,
        plan: r.plan,
        // Include `result` so the requesting primary can curate the answer —
        // its context-rooting check reads vault.search matches and
        // research.deep webSources from the per-step results. We compact
        // bulky payloads to keep the JSON small.
        runs: r.runs.map(x => ({
          step: x.step,
          ok: x.ok,
          durationMs: x.durationMs,
          error: x.error,
          startedAt: x.startedAt,
          modelUsed: x.modelUsed,
          result: compactRunResult(x.result, x.step?.tool),
        })),
        delegatedFromPeer: true,
        // Verification trail — the primary's chat handler checks this matches
        // what it sent. Mismatch = persona-shifter bug; log and surface.
        personaIdUsed: resolvedPersona?.id ?? null,
        personaNameUsed: resolvedPersona?.name ?? null,
        budgets: r.budgets,
        subagentTimings: r.subagentTimings,
        skillUsed: r.skillUsed,
        skillScore: r.skillScore,
      };
    } finally {
      // Drop the ephemeral hire if we registered one so the worker's persona
      // store doesn't accumulate over time. NO setActivePersona restoration
      // — we never mutated it in the first place.
      if (ephemeralPersonaId) {
        try { deletePersona(ephemeralPersonaId); } catch { /* swallow — non-fatal */ }
      }
    }
  });
  } catch (e: any) {
    const message = e?.message ?? String(e);
    console.error("[peers/delegate] handler error:", message, e?.stack ?? "");
    if (!res.headersSent) return res.status(500).json({ error: message });
  }
});

// Critique an answer. The local LLM evaluates the draft against the original
// task and returns a structured verdict. Cheap (one ollama call) — meant to
// be invoked at the end of synthesis to catch hallucinations and tighten prose.
peersRouter.post("/review", async (req, res) => {
  const task = String(req.body?.task ?? "").trim();
  const answer = String(req.body?.answer ?? "").trim();
  if (!task || !answer) return res.status(400).json({ error: "task and answer are required" });

  const sys = `You are a critical reviewer for a fellow agent's answer. Evaluate the draft against the task on three axes:
1. Factual: are claims supported, or is something likely hallucinated?
2. Relevance: does the answer address the task directly?
3. Clarity: is it concise, well-structured, and free of filler?

Output ONLY a JSON object with this exact shape, no prose, no markdown fences:
{"verdict":"good"|"needs-work"|"bad","issues":["<short>",...],"revised_answer":"<your tightened version OR empty string if no revision needed>","confidence":<0..1 number>}

Be terse. "good" = ship it, "needs-work" = fixable issues, "bad" = misleading or off-task.`;
  let raw: string;
  try {
    raw = await ollamaGenerate(`Task: ${task}\n\nDraft answer:\n${answer}`, sys, { profile: "extraction" });
  } catch (e: any) {
    return res.status(503).json({ error: `local LLM unavailable: ${e?.message ?? e}` });
  }

  // Strip code fences and find the first balanced JSON object.
  const fence = raw.match(/```(?:json)?\s*([\s\S]+?)```/);
  const candidate = (fence ? fence[1] : raw).trim();
  const open = candidate.indexOf("{");
  if (open === -1) return res.json({ verdict: "needs-work", issues: ["reviewer returned no JSON"], revised_answer: "", confidence: 0, raw });
  let depth = 0;
  let parsed: any = null;
  for (let i = open; i < candidate.length; i++) {
    if (candidate[i] === "{") depth++;
    else if (candidate[i] === "}") { depth--; if (depth === 0) { try { parsed = JSON.parse(candidate.slice(open, i + 1)); } catch {} break; } }
  }
  if (!parsed) return res.json({ verdict: "needs-work", issues: ["reviewer JSON unparseable"], revised_answer: "", confidence: 0, raw });

  res.json({
    verdict: ["good", "needs-work", "bad"].includes(parsed.verdict) ? parsed.verdict : "needs-work",
    issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 8).map((s: any) => String(s).slice(0, 200)) : [],
    revised_answer: typeof parsed.revised_answer === "string" ? parsed.revised_answer.slice(0, 4000) : "",
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    reviewer: { name: config.name, model: config.ollamaModel },
  });
});
