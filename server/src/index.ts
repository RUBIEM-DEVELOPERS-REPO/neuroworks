import express from "express";
import { config } from "./config.js";
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
import { autodiscoverLocalPeers } from "./lib/peer-registry.js";
import { ensureWorker, shutdownManagedWorker } from "./lib/worker-manager.js";
import { loadPersonas } from "./lib/personas.js";
import { ensureAllPersonasHaveTemplates } from "./lib/persona-templates.js";
import { startReflectionScheduler, stopReflectionScheduler } from "./lib/reflection.js";
import { reflectionRouter } from "./routes/reflection.js";
import { skillsRouter } from "./routes/skills.js";
import { uploadsRouter } from "./routes/uploads.js";
import { teamRouter } from "./routes/team.js";
import { originGuard } from "./lib/origin-guard.js";

const app = express();
// JSON body, but also accept text/plain (navigator.sendBeacon defaults to
// it when given a plain JSON Blob) so the chat unmount-save reaches us.
// 25 MB limit accommodates base64-encoded document uploads (a 15 MB PDF
// base64-encodes to ~20 MB). Most uploads are <2 MB; the cap exists to
// stop accidental DOS via giant payloads, not to be aspirationally generous.
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
app.use("/api/models", modelsRouter);
app.use("/api/reflection", reflectionRouter);
app.use("/api/skills", skillsRouter);
app.use("/api/uploads", uploadsRouter);
app.use("/api/team", teamRouter);

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

app.listen(config.port, "127.0.0.1", () => {
  console.log(`\n  ▶ neuroworks server: http://127.0.0.1:${config.port}`);
  console.log(`    web ui will open at: http://127.0.0.1:7470`);
  console.log(`    vault:  ${config.vaultPath}`);
  console.log(`    ollama: ${config.ollamaHost} (${config.ollamaModel})\n`);

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

  // Auto-spawn a managed worker if we are the primary (CLAWBOT_ROLE) and
  // no external peer is reachable within the grace period. The user gets
  // parallel sub-agents + the curation gate "for free" — they never have
  // to know `pnpm secondary` exists. Disable with CLAWBOT_AUTO_SPAWN_WORKER=0.
  if (process.env.CLAWBOT_AUTO_SPAWN_WORKER !== "0" && config.role === "primary") {
    setTimeout(() => {
      void ensureWorker({ waitForReady: false }).catch(e =>
        console.warn(`  ⚠ worker auto-spawn failed: ${e?.message ?? e}`)
      );
    }, 5_000);
  }

  // Watch the vault for external edits so the search cache busts when
  // the user edits notes in Obsidian directly. Default-on; opt out via
  // CLAWBOT_VAULT_WATCH=0 if you're on a filesystem where the recursive
  // watcher misbehaves. Fall-back behaviour is the 60s search cache TTL.
  startVaultWatcher();

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
  console.log(`\n  ⏻ received ${signal} — flushing pending vault writes…`);
  try { await shutdownCommitQueue(); console.log("  ✓ vault flush complete"); }
  catch (e: any) { console.warn(`  ⚠ vault flush failed: ${e?.message ?? e}`); }
  try { await shutdownManagedWorker(); }
  catch (e: any) { console.warn(`  ⚠ worker shutdown failed: ${e?.message ?? e}`); }
  try { stopReflectionScheduler(); }
  catch { /* never block shutdown on a scheduler stop */ }
  try { stopVaultWatcher(); }
  catch { /* never block shutdown on a watcher close */ }
  try { stopVaultPullScheduler(); }
  catch { /* never block shutdown on a scheduler stop */ }
  process.exit(0);
}
process.on("SIGTERM", () => void gracefulExit("SIGTERM"));
process.on("SIGINT", () => void gracefulExit("SIGINT"));
