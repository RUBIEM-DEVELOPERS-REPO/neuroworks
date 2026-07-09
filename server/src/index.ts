import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config, validateConfig } from "./config.js";
import { statusRouter } from "./routes/status.js";
import { reposRouter } from "./routes/repos.js";
import { brainRouter } from "./routes/brain.js";
import { tasksRouter } from "./routes/tasks.js";
import { templatesRouter } from "./routes/templates.js";
import { chatRouter } from "./routes/chat.js";
import { personasRouter } from "./routes/personas.js";
import { peersRouter } from "./routes/peers.js";
import { localInflightCount } from "./lib/peers.js";
import { modelsRouter } from "./routes/models.js";
import { ollamaGenerate } from "./lib/ollama.js";
import { shutdownCommitQueue } from "./lib/commit-queue.js";
import { startVaultWatcher, stopVaultWatcher, startVaultPullScheduler, stopVaultPullScheduler, getVaultHealth } from "./lib/vault.js";
import { buildIndex, loadPersistedIndex } from "./lib/vault-index.js";
import { autodiscoverLocalPeers } from "./lib/peer-registry.js";
import { ensurePool, shutdownManagedWorker } from "./lib/worker-manager.js";
import { loadPersonas } from "./lib/personas.js";
import { ensureAllPersonasHaveTemplates } from "./lib/persona-templates.js";
import { startReflectionScheduler, stopReflectionScheduler } from "./lib/reflection.js";
import { abortInflightJobs } from "./lib/jobs.js";
import { reflectionRouter } from "./routes/reflection.js";
import { skillsRouter } from "./routes/skills.js";
import { uploadsRouter } from "./routes/uploads.js";
import { teamRouter } from "./routes/team.js";
import { teamsRouter } from "./routes/teams.js";
import { handoffRouter } from "./routes/handoff.js";
import { workforceRouter } from "./routes/workforce.js";
import { schedulesRouter } from "./routes/schedules.js";
import { startScheduleScheduler, stopScheduleScheduler } from "./lib/schedules.js";
import { governanceRouter } from "./routes/governance.js";
import { emailRouter } from "./routes/email.js";
import { externalAgentsRouter } from "./routes/external-agents.js";
import { feedbackRouter } from "./routes/feedback.js";
import { exportsRouter } from "./routes/exports.js";
import { calendarRouter } from "./routes/calendar.js";
import { dataSourcesRouter } from "./routes/data-sources.js";
import { terminalRouter } from "./routes/terminal.js";
import { sttRouter } from "./routes/stt.js";
import { integrationsRouter } from "./routes/integrations.js";
import { presetsRouter } from "./routes/presets.js";
import { connectorsRouter } from "./routes/connectors.js";
import { seedAiiAWebsiteConnector } from "./lib/connectors.js";
import { paymentsRouter } from "./routes/payments.js";
import { executorRouter } from "./routes/executor.js";
import { primitivesRouter } from "./routes/primitives.js";
import { usersRouter } from "./routes/users.js";
import { authRouter } from "./routes/auth.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { departmentsRouter } from "./routes/departments.js";
import { knowledgePacksRouter } from "./routes/knowledge-packs.js";
import { datasetsRouter } from "./routes/datasets.js";
import { dispatchRouter, dispatchKeysRouter } from "./routes/dispatch.js";
import { omnisignalRouter } from "./routes/omnisignal.js";
import { publicFinanceRouter } from "./routes/public-finance.js";
import { qualityRouter } from "./routes/quality.js";
import { costRouter } from "./routes/cost.js";
import { auditRouter } from "./routes/audit.js";
import { skillForgeRouter } from "./routes/skill-forge.js";
import { orchestratorRouter } from "./routes/orchestrator.js";
import { requireLayer } from "./lib/access.js";
import { startEmailBridge, stopEmailBridge } from "./lib/email.js";
import { originGuard } from "./lib/origin-guard.js";

// Fail-fast: refuse to boot on a fatal misconfiguration (bad port, SERVE_WEB
// without a build, missing required env in production). No-op warnings locally.
validateConfig();

const app = express();
// Stripe webhook needs the RAW request body to verify the signature — mount a
// raw parser for that ONE path BEFORE the JSON parser (body-parser sets
// req._body once read, so the JSON parser below then skips it).
app.use("/api/payments/webhook", express.raw({ type: "*/*", limit: "2mb" }));
// Paynow posts its result webhook as application/x-www-form-urlencoded — the
// JSON parser leaves req.body empty there, which made the SHA-512 hash check
// reject EVERY legitimate status update. Mount a urlencoded parser for that
// one path (found in the security/bug sweep, 2026-07-04).
app.use("/api/payments/paynow/result", express.urlencoded({ extended: false, limit: "64kb" }));
// JSON body, but also accept text/plain (navigator.sendBeacon defaults to
// it when given a plain JSON Blob) so the chat unmount-save reaches us.
// 25 MB limit accommodates base64-encoded document uploads (a 15 MB PDF
// base64-encodes to ~20 MB). Most uploads are <2 MB; the cap exists to
// stop accidental DOS via giant payloads, not to be aspirationally generous.
// Machine-to-machine endpoints (external dispatch + Finance System ingest) take
// small JSON only — reject oversized bodies BEFORE the 25MB parser buffers them.
// The 25MB limit exists for base64 document uploads on the browser API, not here.
const MACHINE_BODY_LIMIT = Number(process.env.NW_MACHINE_BODY_LIMIT_BYTES ?? "262144") || 262144; // 256KB
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/v1/") && !req.path.startsWith("/api/public/")) return next();
  const len = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(len) && len > MACHINE_BODY_LIMIT) {
    return res.status(413).json({ error: "payload_too_large", message: `Body exceeds ${MACHINE_BODY_LIMIT} bytes for this endpoint.` });
  }
  next();
});
app.use(express.json({ limit: "25mb", type: ["application/json", "text/plain"] }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:7470");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));
// Host + Origin allow-list check. Defends against DNS rebinding (Host
// header carries the attacker's domain, not 127.0.0.1:7471) and cross-
// origin browser POSTs (Origin header reveals the source page). Loopback
// bind alone isn't enough — text/plain JSON POSTs skip CORS preflight.
// See origin-guard.ts for the threat model.
app.use(originGuard);

app.get("/api/health", (_req, res) => res.json({
  ok: true,
  name: config.name,
  role: config.role,
  version: "0.1.0",
  model: config.ollamaModel,
  // Surface OpenRouter capability so peers and the UI can tell whether this
  // clawbot has a cloud accelerator wired up. Just the on/off + default model —
  // health check itself stays at /api/status/llm.
  openrouter: config.openrouterEnabled ? { enabled: true, model: config.openrouterModel } : { enabled: false },
  port: config.port,
  ready: config.ready,
  missing: config.missing,
  inflightJobs: localInflightCount(),
  peers: config.peers,
  // Vault reachability — surfaced here so EVERY dashboard surface can show
  // "vault unreachable" without an extra round-trip. Banner-friendly shape.
  vault: getVaultHealth(),
}));
app.use("/api/status", statusRouter);
app.use("/api/repos", reposRouter);
app.use("/api/brain", brainRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/chat", chatRouter);
app.use("/api/personas", personasRouter);
app.use("/api/peers", peersRouter);
app.use("/api/models", requireLayer("superadmin"), modelsRouter); // provider API keys
app.use("/api/reflection", reflectionRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/team", teamRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/handoff", handoffRouter);
app.use("/api/workforce", workforceRouter);
app.use("/api/schedules", schedulesRouter);
app.use("/api/governance", requireLayer("superadmin"), governanceRouter);
app.use("/api/email", emailRouter);
app.use("/api/external-agents", externalAgentsRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/exports", exportsRouter);
app.use("/api/calendar", calendarRouter);
app.use("/api/data-sources", dataSourcesRouter);
app.use("/api/terminal", requireLayer("superadmin"), terminalRouter); // shell access
app.use("/api/stt", sttRouter);
app.use("/api/integrations", requireLayer("superadmin"), integrationsRouter); // service secrets
app.use("/api/presets", presetsRouter);
app.use("/api/connectors", requireLayer("superadmin"), connectorsRouter); // connector credentials
app.use("/api/payments", paymentsRouter);
app.use("/api/executor", executorRouter);
app.use("/api/primitives", primitivesRouter);
app.use("/api/users", requireLayer("admin"), usersRouter); // directory admin (salary redaction inside)
app.use("/api/auth", authRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/knowledge-packs", knowledgePacksRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/omnisignal", omnisignalRouter);
// External agent-dispatch surface (API-key auth; originGuard exempts /api/v1/).
app.use("/api/v1/dispatch", dispatchRouter);
// Operator-only API-key management (stays behind originGuard).
app.use("/api/dispatch-keys", dispatchKeysRouter);
// Public Finance System ingest/read surface (server-to-server; origin-guard
// exempts /api/public/, writes optionally gated by FINANCE_SYNC_TOKEN).
app.use("/api/public", publicFinanceRouter);
app.use("/api/quality", qualityRouter);
app.use("/api/cost", requireLayer("superadmin"), costRouter); // money
app.use("/api/audit", auditRouter);
app.use("/api/skill-forge", skillForgeRouter);
app.use("/api/orchestrate", orchestratorRouter);

// ── Production SPA serving ─────────────────────────────────────────────
// When SERVE_WEB=1 (the container), THIS server serves the built, minified
// web/dist directly — no Vite dev server in production. Mounted AFTER every
// /api route so it can never shadow an API path. Static assets are served with
// long-lived immutable caching (Vite fingerprints filenames); index.html is
// always revalidated so a new deploy is picked up. Unknown non-/api GETs fall
// through to index.html for client-side routing (history fallback). An
// unmatched /api path still 404s as JSON rather than returning the SPA shell.
if (config.serveWeb && existsSync(config.webDistPath)) {
  const indexHtml = resolve(config.webDistPath, "index.html");
  app.use(express.static(config.webDistPath, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("index.html")) res.setHeader("Cache-Control", "no-cache");
      else if (/[.-][a-f0-9]{8,}\.\w+$/i.test(filePath)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next(); // let the API 404 handler own it
    if (req.method !== "GET") return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });
  console.log(`  ⓘ serving built web SPA from ${config.webDistPath}`);
}

// Unmatched /api/* → stable JSON 404 (not Express's default HTML page) so API
// and dispatch clients always get a parseable body. Mounted after every router
// and the SPA fallback, so it only catches genuinely unknown API paths.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "not_found", message: `No API route for ${req.method} ${req.originalUrl ?? req.url}`, path: req.originalUrl ?? req.url });
});

// Global error handler — every route mounts before this so any throw bubbles
// up here. We log the request method+url for debugability and return a
// stable JSON shape the web client already knows how to render. Stack traces
// stay server-side; only the message goes to the customer.
app.use((err: any, req: any, res: any, _next: any) => {
  const stamp = new Date().toISOString();
  console.error(`[${stamp}] [express-error] ${req.method} ${req.originalUrl ?? req.url}`);
  console.error(err?.stack ?? err);
  if (res.headersSent) return;
  res.status(500).json({
    error: err?.message ?? String(err),
    path: req.originalUrl ?? req.url,
    when: stamp,
  });
});

// Process-level safety nets — async work fired with `void` (job runners,
// scheduler ticks) can produce unhandled rejections that crash the server
// silently. We log them but DON'T exit; one bad task shouldn't take the
// fleet down. Same for uncaughtException — log and keep running.
process.on("unhandledRejection", (reason: any) => {
  console.error(`[unhandled-rejection] ${reason?.stack ?? reason}`);
});
process.on("uncaughtException", (err: any) => {
  console.error(`[uncaught-exception] ${err?.stack ?? err}`);
});

const server = app.listen(config.port, config.bindHost, () => {
  console.log(`\n  ▶ neuroworks server: http://${config.bindHost}:${config.port}`);
  console.log(`    web ui will open at: http://127.0.0.1:7470`);
  console.log(`    vault:  ${config.vaultPath}`);
    console.log(`    ollama: ${config.ollamaHost} (${config.ollamaModel})\n`);

  // Seed built-in connectors so they appear in the UI + agent tool catalog
  // without manual setup. Idempotent — skips if already seeded.
  try { const s = seedAiiAWebsiteConnector(); if (s) console.log(`  ✓ seeded connector "${s.label}" (${s.endpoints?.length ?? 0} endpoints)`); }
  catch (e: any) { console.warn(`  ⚠ connector seeding failed: ${e?.message ?? e}`); }

  // Re-apply a UI-added active model provider (BYO API key) to the runtime
  // router so it survives restarts without editing .env.
  import("./lib/model-providers.js").then(m => { try { m.loadAndApplyActiveProvider(); } catch { /* tolerate */ } }).catch(() => {});

  // Pre-warm the default model so the first user task doesn't pay model-load
  // tax (5-8s on cold cache). Fire-and-forget — server is already accepting
  // requests; we just want the model resident in Ollama's memory by the time
  // someone clicks Send. Skipped if CLAWBOT_NO_WARMUP=1.
  //
  // We now warm every UNIQUE model the profile router could pick — default +
  // any profile-specific env pin. Triage on qwen3.5:0.8b + synthesis on
  // qwen2.5:3b means two cold-load hits on the first ad-hoc task; warming
  // both at boot eliminates both.
  if (process.env.CLAWBOT_NO_WARMUP !== "1") {
    const toWarm = new Set<string>([config.ollamaModel]);
    for (const envKey of ["OLLAMA_TRIAGE_MODEL", "OLLAMA_PLAN_MODEL", "OLLAMA_SYNTH_MODEL", "OLLAMA_EXTRACT_MODEL", "OLLAMA_BALANCED_MODEL"]) {
      const v = process.env[envKey]?.trim();
      if (v) toWarm.add(v);
    }
    for (const model of toWarm) {
      const t0 = Date.now();
      ollamaGenerate("ok", "Reply with a single word.", { model })
        .then(() => console.log(`  ✓ warmed ${model} in ${Math.round((Date.now() - t0) / 1000)}s`))
        .catch((e: any) => console.warn(`  ⚠ warm-up failed for ${model}: ${e?.message ?? e}`));
    }
    // Pre-warm OpenRouter too if configured. First OR request pays a DNS+TLS
    // round-trip (~500-1000ms) — warming it knocks that off the first user
    // task. We hit the cheap default model; a tiny 5-token prompt is
    // sufficient to establish the TLS session.
    if (config.openrouterEnabled) {
      const t0 = Date.now();
      void import("./lib/openrouter.js").then(m =>
        m.openrouterGenerate("ok", "Reply with a single word.", { model: config.openrouterModel, maxTokens: 4 })
          .then(() => console.log(`  ✓ warmed OpenRouter (${config.openrouterModel}) in ${Math.round((Date.now() - t0) / 1000)}s`))
          .catch((e: any) => console.warn(`  ⚠ OpenRouter warm-up failed: ${e?.message ?? e}`))
      );
    }
  }

  // Scan localhost for other clawbot instances. Saves the user from having
  // to set CLAWBOT_PEERS just to wire the primary ↔ secondary loop together.
  // Disabled with CLAWBOT_NO_AUTODISCOVER=1.
  if (process.env.CLAWBOT_NO_AUTODISCOVER !== "1") {
    autodiscoverLocalPeers()
      .then(r => { if (r.found > 0) console.log(`  ✓ auto-discovered ${r.found} peer${r.found === 1 ? "" : "s"} on localhost`); })
      .catch(() => { /* swallow */ });
    // Re-scan every 60s so a secondary started AFTER the primary still gets
    // picked up automatically. Cheap (5 ports, 1.2s timeout, parallel).
    setInterval(() => { void autodiscoverLocalPeers().catch(() => {}); }, 60_000).unref();
  }

  // Backfill starter templates for any persona that's missing them — covers
  // built-ins that were seeded before the refresher landed AND custom
  // personas created when the curated table didn't yet have an entry.
  try {
    const store = loadPersonas();
    const filled = ensureAllPersonasHaveTemplates(store.personas);
    for (const f of filled) {
      const verb = f.refreshed ? "refreshed" : "generated";
      console.log(`  ⓘ ${verb} ${f.added} starter template${f.added === 1 ? "" : "s"} for persona "${f.personaId}"`);
    }
  } catch (e: any) {
    console.warn(`  ⚠ persona template backfill failed: ${e?.message ?? e}`);
  }

  // Auto-spawn a managed worker POOL if we are the primary. With >1 worker,
  // concurrent tasks fan out across the pool (least-loaded routing) instead of
  // funnelling to a single agent — the "only one agent working" fix. Pool size
  // is CLAWBOT_POOL_WORKERS (default 2; capped at CLAWBOT_MAX_WORKERS). Set
  // CLAWBOT_AUTO_SPAWN_WORKER=0 to disable spawning entirely, or
  // CLAWBOT_POOL_WORKERS=1 to keep a single worker. The user gets parallel
  // sub-agents + the curation gate "for free" — no need to know `pnpm secondary`.
  if (process.env.CLAWBOT_AUTO_SPAWN_WORKER !== "0" && config.role === "primary") {
    const poolTarget = Math.max(1, Number(process.env.CLAWBOT_POOL_WORKERS ?? "2") || 2);
    setTimeout(() => {
      void ensurePool(poolTarget)
        .then(r => console.log(`  ⓦ worker pool warm — ${r.running} managed worker(s) ready (target ${poolTarget})`))
        .catch(e => console.warn(`  ⚠ worker pool warm-up failed: ${e?.message ?? e}`));
    }, 5_000);
  }

  // Watch the vault for external edits so the search cache busts when
  // the user edits notes in Obsidian directly. Default-on; opt out via
  // CLAWBOT_VAULT_WATCH=0 if you're on a filesystem where the recursive
  // watcher misbehaves. Fall-back behaviour is the 60s search cache TTL.
  startVaultWatcher();

  // Warm the MiniSearch index at boot so the first vault.search hits a
  // populated index instead of returning zero matches while the build
  // races a 60s lazy timer. Fire-and-forget — the build is idempotent
  // and the search code falls back to grep if the index isn't ready yet.
  // Primary-only because workers proxy vault search through the primary.
  if (config.role === "primary") {
    // Instant readiness: load the persisted snapshot first (serves queries
    // immediately), then kick a background rebuild to fold in any edits made
    // while the server was down. Cold (no snapshot) falls straight to build.
    const warm = loadPersistedIndex();
    void buildIndex(config.vaultPath).catch(e =>
      console.warn(`  ⚠ vault index warm-up failed (non-fatal): ${e?.message ?? e}`)
    );
    console.log(warm ? `  ⓘ vault index ready from snapshot — refreshing in background...` : `  ⓘ vault index warming...`);
  }

  // Periodic git pull from origin so Obsidian edits made on another machine
  // (or via Obsidian's git plugin) sync into the local vault that clawbot
  // reads. Default every 5m; opt out with CLAWBOT_VAULT_PULL=0.
  startVaultPullScheduler();

  // Nightly self-reflection. Only the primary runs the scheduler — secondary
  // clawbots are workers and the reflection covers the whole fleet from the
  // primary's job list anyway. Disable with CLAWBOT_REFLECTION=0.
  if (process.env.CLAWBOT_REFLECTION !== "0" && config.role === "primary") {
    startReflectionScheduler();
    console.log(`  ⓘ nightly reflection scheduler armed (hour=${process.env.CLAWBOT_REFLECTION_HOUR ?? "2"})`);
  }

  // User-defined schedules — fires template runs on a friendly day-of-week +
  // time-of-day cadence. Primary-only so the same schedule doesn't run on
  // every worker. Disable with CLAWBOT_SCHEDULES=0.
  if (process.env.CLAWBOT_SCHEDULES !== "0" && config.role === "primary") {
    startScheduleScheduler();
    console.log(`  ⓘ schedule tick armed (30s interval)`);
  }

  // Email bridge — inbound IMAP poll + outbound SMTP so users can drive
  // clawbot over email. Primary-only (one poller for the fleet). No-ops with
  // a log when CLAWBOT_EMAIL_USER / CLAWBOT_EMAIL_APP_PASSWORD aren't set.
  if (config.role === "primary") {
    void startEmailBridge().catch(e =>
      console.warn(`  ⚠ email bridge start failed: ${e?.message ?? e}`)
    );
  }
});

// Graceful shutdown — flush any pending vault commits before exit so a Ctrl+C
// doesn't strand the last batch of writes. The commit queue is debounced; a
// kill mid-debounce would otherwise lose the commit (file is on disk but
// uncommitted). Each handler is idempotent: signals fire once and we tear
// down cleanly.
let shuttingDown = false;
async function gracefulExit(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ⏻ received ${signal} — draining connections + flushing pending vault writes…`);
  // Hard-exit safety net: if any teardown step wedges (a hung socket, a stuck
  // flush), don't hang the container forever — force exit after a bounded grace
  // period so the orchestrator's SIGKILL never has to.
  const graceMs = Number(process.env.NEUROWORKS_SHUTDOWN_GRACE_MS ?? "12000") || 12000;
  const hardKill = setTimeout(() => {
    console.warn(`  ⚠ shutdown grace (${graceMs}ms) elapsed — forcing exit`);
    process.exit(1);
  }, graceMs);
  hardKill.unref();
  // Stop accepting new connections immediately so nothing new starts mid-drain.
  try { server.close(); } catch { /* server may not be listening yet */ }
  // Mark every in-flight job as failed BEFORE we let the process exit.
  // Without this, a tsx-watch reload (very common in dev) would leave
  // pending/running jobs in indeterminate state — the in-memory map dies
  // with the process, the client sees a 404, and the reflection never
  // records the abort. Persisting the abort to the JSONL store keeps the
  // journal honest and lets the client surface a clear "server restarted"
  // message rather than a generic "job not found".
  try {
    const { aborted } = abortInflightJobs(`aborted: server received ${signal}`);
    if (aborted > 0) console.log(`  ⚠ aborted ${aborted} in-flight job(s)`);
  } catch (e: any) { console.warn(`  ⚠ job abort failed: ${e?.message ?? e}`); }
  try { await shutdownCommitQueue(); console.log("  ✓ vault flush complete"); }
  catch (e: any) { console.warn(`  ⚠ vault flush failed: ${e?.message ?? e}`); }
  try { await shutdownManagedWorker(); }
  catch (e: any) { console.warn(`  ⚠ worker shutdown failed: ${e?.message ?? e}`); }
  try { stopReflectionScheduler(); }
  catch { /* never block shutdown on a scheduler stop */ }
  try { stopScheduleScheduler(); }
  catch { /* never block shutdown on a scheduler stop */ }
  try { stopEmailBridge(); }
  catch { /* never block shutdown on the email bridge */ }
  try { stopVaultWatcher(); }
  catch { /* never block shutdown on a watcher close */ }
  try { stopVaultPullScheduler(); }
  catch { /* never block shutdown on a scheduler stop */ }
  process.exit(0);
}
process.on("SIGTERM", () => void gracefulExit("SIGTERM"));
process.on("SIGINT", () => void gracefulExit("SIGINT"));
