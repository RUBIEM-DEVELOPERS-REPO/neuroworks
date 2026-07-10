import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { llmHealth } from "../lib/llm.js";
import { latestRun } from "../lib/github.js";
import { vaultCommitStats } from "../lib/commit-queue.js";
import { pushOnly, clearStaleVaultLock, pullFromOrigin, getVaultPullStatus } from "../lib/vault.js";
import { localInflightCount } from "../lib/peers.js";
import { jobQueueStatus } from "../lib/jobs.js";
import { jobStoreStats } from "../lib/job-store.js";
import { listGovernance } from "../lib/governance.js";
import { listConnectors } from "../lib/connectors.js";
import { listConnections } from "../lib/integrations.js";
import { listProviders } from "../lib/model-providers.js";

export const statusRouter = Router();

// Granular LLM-stack snapshot. The Admin page can hit this to render side-by-
// side Ollama + OpenRouter rows without parsing the catch-all /api/status
// response. Also exposes which backend handles a default /balanced call so
// the customer sees at a glance which path their work is running on.
statusRouter.get("/llm", async (_req, res) => {
  try {
    res.json(await llmHealth());
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Vault sync observability — surfaced in Admin so the user can see when the
// last commit landed, how many writes are queued, and how many enqueue calls
// coalesced into single commits (i.e. the speedup from the queue).
statusRouter.get("/vault", (_req, res) => {
  res.json({ ...vaultCommitStats(), pull: getVaultPullStatus() });
});

// Manual pull from origin — picks up Obsidian edits made on another machine
// (or via Obsidian's git plugin) without waiting for the next scheduler tick.
// Skipped automatically if there are local uncommitted changes; the response
// carries `reason` in that case so the UI can show why.
statusRouter.post("/vault/pull", async (_req, res) => {
  try {
    const r = await pullFromOrigin();
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Retry the push manually. Useful when the last commit landed locally but
// pushing to origin failed (large pack history, network, auth) — clicking
// "Retry push" in Admin nudges git without restarting the server. Bypasses
// the commit queue because there's nothing new to commit; we just want to
// reach origin with the local HEAD.
statusRouter.post("/vault/retry-push", async (_req, res) => {
  try {
    const r = await pushOnly();
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// Manual lock clear — used by Admin when the auto-sweep didn't catch a stale
// lock. The endpoint runs the same heuristic the queue runs (age threshold),
// so it only deletes truly stale files. To force-delete regardless of age,
// the user can pass ?force=1.
statusRouter.post("/vault/clear-lock", (req, res) => {
  if (req.query.force === "1") {
    // Force path — bypass age check by re-running with the age threshold
    // temporarily lowered to 0. Done by setting the env locally for the call.
    const prev = process.env.NEUROWORKS_STALE_LOCK_AGE_MS;
    process.env.NEUROWORKS_STALE_LOCK_AGE_MS = "0";
    const r = clearStaleVaultLock();
    process.env.NEUROWORKS_STALE_LOCK_AGE_MS = prev;
    return res.json({ ...r, forced: true });
  }
  res.json(clearStaleVaultLock());
});

// Unified status endpoint. The Admin / Dashboard pages previously had
// to call both /api/health (for identity + capability flags) AND
// /api/status (for runtime state) to get a complete picture. /health is
// preserved for peer probes (fast, no external calls), but /status now
// returns everything /health does plus the runtime detail — so the web
// UI can hit a single endpoint.
//
// Sub-routes (/status/llm, /status/vault, etc.) stay focused for finer
// queries; the catch-all keeps the convenience-flavoured "everything"
// view callers expect.
statusRouter.get("/", async (_req, res) => {
  const metaPath = join(config.vaultPath, "_clawbot", "_meta", "last-run.json");
  let lastDigest: any = null;
  if (existsSync(metaPath)) {
    try { lastDigest = JSON.parse(readFileSync(metaPath, "utf8")); } catch {}
  }
  const llm = await llmHealth();
  const ollama = llm.ollama;
  let lastWorkflow: any = null;
  if (config.ready) {
    try {
      const run = await latestRun(config.githubOwner, "clawbot", "daily-digest.yml");
      if (run) {
        lastWorkflow = {
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          createdAt: run.created_at,
          htmlUrl: run.html_url,
        };
      }
    } catch (e: any) { lastWorkflow = { error: e.message }; }
  } else {
    lastWorkflow = { error: `degraded: missing env ${config.missing.join(", ")}` };
  }
  res.json({
    // Identity + capability — same shape /api/health returns. Mirrored
    // here so the UI doesn't need a second round-trip just for the
    // version/openrouter flags.
    name: config.name,
    role: config.role,
    version: "0.1.0",
    model: config.ollamaModel,
    openrouter: config.openrouterEnabled
      ? { enabled: true, model: config.openrouterModel }
      : { enabled: false },
    port: config.port,
    inflightJobs: localInflightCount(),
    jobQueue: jobQueueStatus(),
    peers: config.peers,
    // Runtime state — what /status carried previously.
    ready: config.ready,
    missing: config.missing,
    vaultPath: config.vaultPath,
    vaultRepo: config.vaultRepo,
    githubOwner: config.githubOwner,
    lastDigest,
    lastWorkflow,
    ollama,
    llm,
    // Operational stats added in this consolidation pass — saves the
    // Admin page extra calls to /status/vault + a future /jobs/store.
    vaultCommits: vaultCommitStats(),
    jobStore: jobStoreStats(),
    // Org status summary for the Dashboard's "Mission Control" panel.
    // /api/governance, /api/connectors, and /api/models are all
    // superadmin-gated at the router level (they carry secrets/config a
    // regular viewer shouldn't see) — but a NAME/COUNT-only summary is safe
    // for anyone who can see the dashboard, so it's projected here instead
    // of proxying those gated routes to the browser. Every list function
    // used below already returns a "Public" type with secrets stripped.
    orgStatus: (() => {
      const policies = listGovernance().filter(p => !p.reference);
      const connectorNames = listConnectors().map(c => c.label);
      const connectionNames = listConnections().map(c => c.providerName);
      const cloudProviderActive = listProviders().some(p => p.active);
      // "cloud-assisted" once ANY cloud LLM path can be reached — OpenRouter
      // (config-level toggle) or an activated Models-page provider (e.g. the
      // Claude Fable 5 / Anthropic swap). Neither active = every plan/direct/
      // synth call stays on the local Ollama model, so data never leaves the
      // machine for inference.
      const computeMode: "local-only" | "cloud-assisted" = (config.openrouterEnabled || cloudProviderActive) ? "cloud-assisted" : "local-only";
      return {
        activePolicyCount: policies.length,
        activePolicies: policies.map(p => p.name),
        connectedSystemCount: connectorNames.length + connectionNames.length,
        connectedSystems: [...connectorNames, ...connectionNames],
        computeMode,
        // Operational signal, not a legal certification — flags whether task
        // content is reachable by a third-party cloud LLM at all, which is
        // the practical question for Zimbabwe's Data Protection Act (Ch.
        // 11:12) when handling personal data. "local-only" means inference
        // never leaves the machine; "cloud-assisted" means it can, and the
        // operator should confirm a data-sharing agreement covers that.
        dataResidency: computeMode === "local-only" ? "local" : "mixed",
      };
    })(),
  });
});
