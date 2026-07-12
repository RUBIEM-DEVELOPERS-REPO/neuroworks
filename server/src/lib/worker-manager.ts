// Worker auto-spawn manager. The goal is "the user never sees 'no worker
// peer is reachable'" — when the primary needs a worker and none is around,
// we spawn `pnpm secondary` as a child process and return as soon as it
// announces itself on /api/peers/self.
//
// Design notes:
//   • Idempotent: concurrent ensureWorker() calls share one spawn promise.
//   • Pool-based: holds up to NEUROWORKS_MAX_WORKERS (default 3). The primary
//     can scale UP under load via ensureExtraWorker(); each additional
//     worker gets its own port allocated sequentially from the base port.
//   • External peers (registered via env or API) are untouched — the pool
//     only tracks workers WE spawned.
//   • Cross-platform: uses `pnpm` (or `pnpm.cmd` on Windows). Spawns the
//     server dev script directly (`pnpm -F neuroworks-server dev`) with
//     NEUROWORKS_PORT set per-worker so each binds its own port. We do NOT use
//     the root `secondary` script — it hardcodes NEUROWORKS_PORT=7473, which
//     would make every extra worker collide on 7473 (EADDRINUSE) and cap the
//     pool at one agent.
//   • Lifecycle: spawned children are killed on graceful shutdown via
//     shutdownManagedWorker(). The `detached: false` + ref-counted handle
//     means a Ctrl+C on the primary tears every worker down with it.

import { spawn, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { pollPeers } from "./peers.js";
import { registerPeer } from "./peer-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Walk up to the clawbot repo root — package.json lives there.
const REPO_ROOT = resolve(__dirname, "../../../");
// The server package dir (server/). We spawn workers by running THIS package's
// own `dev` script from here, so there's no workspace filter to misfire and the
// worker honours the NEUROWORKS_PORT we pass in its env.
const SERVER_DIR = resolve(__dirname, "../../");

// Use the base ChildProcess type rather than ChildProcessWithoutNullStreams.
// We pass stdio: ["ignore", "pipe", "pipe"] which makes stdin null — so the
// "without null streams" variant doesn't match. We only read stdout/stderr,
// never write to stdin, so the looser type is what we actually want.
type WorkerHandle = {
  child: ChildProcess;
  port: number;
  url: string;
  startedAt: number;
  // Resolved once /api/peers/self responds — that's when we consider the
  // worker "ready".
  readyPromise: Promise<{ url: string }>;
};

// Pool of managed workers keyed by port. We allow up to MAX_WORKERS
// simultaneous workers, allocated sequentially from BASE_PORT.
const workers = new Map<number, WorkerHandle>();
// Spawn-in-flight promises keyed by port so concurrent callers asking for
// the SAME port coalesce, AND a caller asking for "next available" doesn't
// race with another caller asking for the same.
const pendingByPort = new Map<number, Promise<WorkerHandle>>();
let extraSpawnInFlight: Promise<WorkerHandle | null> | null = null;

// Base port for the first managed worker matches the `pnpm secondary`
// default. Subsequent workers get BASE_PORT+1, +2, … up to MAX_WORKERS.
const BASE_PORT = Number(process.env.NEUROWORKS_WORKER_PORT ?? "7473");
const MAX_WORKERS = Math.max(1, Math.min(6, Number(process.env.NEUROWORKS_MAX_WORKERS ?? "3")));
const READY_TIMEOUT_MS = 30_000;

export function workerStatus() {
  if (workers.size === 0) return { running: false, managed: false, count: 0, workers: [] as any[] };
  return {
    running: true,
    managed: true,
    count: workers.size,
    cap: MAX_WORKERS,
    workers: [...workers.values()].map(w => ({
      url: w.url,
      port: w.port,
      pid: w.child.pid,
      uptimeMs: Date.now() - w.startedAt,
    })),
  };
}

export function managedWorkerCount(): number {
  // Count only live children. A worker whose process has exited but hasn't
  // been removed yet shouldn't count toward the cap.
  let n = 0;
  for (const w of workers.values()) if (!w.child.killed) n++;
  return n;
}

export function getManagedWorkerUrls(): string[] {
  return [...workers.values()].filter(w => !w.child.killed).map(w => w.url);
}

// Ensure AT LEAST ONE worker peer exists. Returns the first managed worker's
// URL. If a peer is already reachable (managed by us OR external), returns
// the first one. If nothing is reachable, spawns and waits up to
// READY_TIMEOUT_MS.
//
// This is the existing entry point used at startup — kept for back-compat.
// For scaling under load, use ensureExtraWorker() which targets the pool cap.
export async function ensureWorker(opts: { waitForReady?: boolean } = {}): Promise<{ url: string; spawned: boolean }> {
  // Already running and last poll says it's alive? Just return.
  for (const w of workers.values()) {
    if (!w.child.killed) return { url: w.url, spawned: false };
  }
  // Maybe an external peer is already there (env-seeded via
  // NEUROWORKS_PEERS or registered at runtime).
  const peers = await pollPeers();
  const alive = peers.find(p => p.ok && p.ready);
  if (alive) return { url: alive.url, spawned: false };

  // Race guard: probe BASE_PORT directly for a live secondary the
  // user might have started manually (`pnpm secondary`) but that
  // hasn't been registered as a peer yet. autodiscoverLocalPeers
  // would catch this on the next 60s tick, but the boot-time
  // auto-spawn fires at 5s — without this probe, we'd race the
  // manual secondary and end up with two workers on the same port.
  // The probe times out fast (1.5s) so unreachable ports don't stall
  // the spawn we'd actually want to do.
  try {
    const probeUrl = `http://127.0.0.1:${BASE_PORT}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    try {
      const r = await fetch(`${probeUrl}/api/peers/self`, { signal: ctrl.signal });
      if (r.ok) {
        // A worker (manually started or surviving from a previous run)
        // is already there. Register it so the primary discovers it
        // properly, then return without spawning.
        try { registerPeer(probeUrl, "registered", "discovered on BASE_PORT before spawn"); } catch { /* tolerate */ }
        console.log(`  ⓦ skipping worker spawn — already alive at ${probeUrl}`);
        return { url: probeUrl, spawned: false };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch { /* port silent or refused — spawn path runs */ }

  // Spawn the first worker on BASE_PORT, coalescing concurrent callers.
  const handle = await spawnOnPort(BASE_PORT);
  if (opts.waitForReady !== false) {
    await handle.readyPromise;
  }
  return { url: handle.url, spawned: true };
}

// Eager pool warm-up: bring the managed pool up to `target` workers (capped at
// MAX_WORKERS), so multiple agents are ready BEFORE load arrives instead of the
// pool lazily growing to 1. This is what makes "parallel agent use" real — with
// >1 worker, pickExecutor / pickPeerByRole least-load concurrent tasks across
// the whole pool instead of funnelling everything to a single worker (or the
// primary). Workers share the host's Ollama, so the win is largest on
// OpenRouter-routed and I/O-bound steps; local-LLM generation still serialises.
//
// Sequential spawn (not Promise.all) so the children don't all boot + warm their
// model in the same instant and spike the box. Best-effort: a worker that fails
// to come up is logged and skipped; the ones that did start still serve.
// Count managed workers whose HTTP port is actually SERVING right now — the
// honest "reachable neuro" number. managedWorkerCount() counts live child
// processes, but a child can be up while its port isn't accepting yet (still
// warming its model) or has silently wedged. The pool target must be measured
// against reachability, not process liveness, or a flaky worker leaves the
// fleet permanently one short (the "shows 3 of 4" bug, 2026-07-13).
async function reachableWorkerCount(): Promise<number> {
  const ports = [...workers.values()].filter(w => !w.child.killed).map(w => w.port);
  const results = await Promise.all(ports.map(p => isPortServing(p).catch(() => false)));
  return results.filter(Boolean).length;
}

export async function ensurePool(target: number): Promise<{ running: number }> {
  const want = Math.max(1, Math.min(MAX_WORKERS, Math.floor(target)));
  // First make sure at least one exists (also adopts a manually-started or
  // surviving secondary on BASE_PORT instead of double-spawning).
  try { await ensureWorker({ waitForReady: false }); }
  catch (e: any) { console.warn(`  ⚠ pool: first worker spawn failed: ${e?.message ?? e}`); }
  while (managedWorkerCount() < want) {
    const before = managedWorkerCount();
    const r = await ensureExtraWorker({ reason: `eager pool warm-up → target ${want}`, waitForReady: false }).catch(() => null);
    if (!r || managedWorkerCount() <= before) break; // at cap, or spawn didn't add — stop
  }
  // RECONCILE: the spawn loop counts processes, but a freshly-spawned worker
  // isn't reachable until it has bound its port and warmed its model (~45s).
  // FIRST give the workers we already spawned time to become reachable —
  // measuring immediately returns 0 and would trigger a storm of unnecessary
  // extra spawns (the 9-workers-for-a-target-of-4 bug, 2026-07-13). Only after
  // a warm-up grace window do we top up a GENUINE shortfall (a worker that
  // spawned but never came up), bounded so an un-spawnable slot can't loop.
  const WARMUP_DEADLINE = Date.now() + 90_000;
  while (Date.now() < WARMUP_DEADLINE) {
    if (await reachableWorkerCount() >= want) return { running: want };
    await new Promise(r => setTimeout(r, 3_000));
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const reachable = await reachableWorkerCount();
    if (reachable >= want) break;
    console.log(`  ⓦ pool reconcile: ${reachable}/${want} reachable after warm-up — topping up (attempt ${attempt + 1}/2)`);
    const r = await ensureExtraWorker({ reason: `pool reconcile → ${want}`, waitForReady: true }).catch(() => null);
    if (!r) break; // at MAX_WORKERS cap — nothing more we can do
  }
  return { running: await reachableWorkerCount() };
}

// Scale UP: ensure one MORE managed worker exists, up to MAX_WORKERS.
// Returns the new worker's URL, or null if we're already at the cap.
// Caller typically fires this fire-and-forget (`void ensureExtraWorker()`)
// from chat.ts when the chosen peer is overloaded; the current task still
// goes to the existing peer, but the next concurrent task hits the new one.
//
// Concurrent callers coalesce onto a single in-flight spawn so a burst of
// requests doesn't trigger N spawns when we only wanted one more worker.
export async function ensureExtraWorker(opts: { reason?: string; waitForReady?: boolean } = {}): Promise<{ url: string; spawned: boolean } | null> {
  if (managedWorkerCount() >= MAX_WORKERS) {
    return null;
  }
  if (extraSpawnInFlight) {
    const handle = await extraSpawnInFlight;
    if (!handle) return null;
    if (opts.waitForReady !== false) {
      try { await handle.readyPromise; } catch { /* tolerate */ }
    }
    return { url: handle.url, spawned: false };
  }
  extraSpawnInFlight = (async () => {
    // Find the lowest port in [BASE_PORT, …) that's neither tracked in our pool
    // NOR already serving (an adopted/external/leftover worker). Probing avoids
    // the EADDRINUSE crash that killed extra workers when a port was taken by
    // something we didn't spawn.
    const usedPorts = new Set([...workers.values()].filter(w => !w.child.killed).map(w => w.port));
    let nextPort: number | null = null;
    for (let p = BASE_PORT; p < BASE_PORT + MAX_WORKERS + 4; p++) {
      if (usedPorts.has(p)) continue;
      if (await isPortServing(p)) continue; // something already there — don't collide
      nextPort = p; break;
    }
    if (nextPort === null) return null;
    console.log(`  ⓦ scaling up: spawning extra worker on port ${nextPort}${opts.reason ? ` (${opts.reason})` : ""}`);
    return await spawnOnPort(nextPort);
  })();
  extraSpawnInFlight.finally(() => { extraSpawnInFlight = null; }).catch(() => {});
  const handle = await extraSpawnInFlight;
  if (!handle) return null;
  if (opts.waitForReady !== false) {
    try { await handle.readyPromise; } catch { /* tolerate — caller can still poll the registry */ }
  }
  return { url: handle.url, spawned: true };
}

// Spawn on a specific port. Concurrent callers asking for the same port
// share one in-flight spawn.
async function spawnOnPort(port: number): Promise<WorkerHandle> {
  const existing = workers.get(port);
  if (existing && !existing.child.killed) return existing;
  let pending = pendingByPort.get(port);
  if (!pending) {
    pending = (async () => {
      const handle = await spawnWorker(port);
      workers.set(port, handle);
      // Pre-register so pollPeers picks it up immediately, even before the
      // periodic auto-discovery scan would have noticed.
      registerPeer(handle.url, "managed", `managed worker (pid ${handle.child.pid}, port ${port})`);
      return handle;
    })();
    pendingByPort.set(port, pending);
    pending.finally(() => { pendingByPort.delete(port); }).catch(() => {});
  }
  return pending;
}

function spawnWorker(port: number): Promise<WorkerHandle> {
  const url = `http://127.0.0.1:${port}`;
  // On Windows pnpm is `pnpm.cmd`. spawn() can't find .cmd files on PATH
  // without `shell: true` — using shell is fine here because the args come
  // from us, not user input.
  const cmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  // Distinguish each worker's name in logs so the user can tell them apart
  // when the pool is >1 (e.g. "managed-worker-7473" vs "managed-worker-7474").
  const env = {
    ...process.env,
    NEUROWORKS_NAME: `managed-worker-${port}`,
    NEUROWORKS_ROLE: "persona-shifter",
    NEUROWORKS_PORT: String(port),
    NEUROWORKS_PEERS: `http://127.0.0.1:${config.port}`,
    NEUROWORKS_SUBAGENT_BUDGET: process.env.NEUROWORKS_WORKER_SUBAGENT_BUDGET ?? "4",
    NEUROWORKS_IO_BUDGET: process.env.NEUROWORKS_WORKER_IO_BUDGET ?? "8",
    // Prevent the child from itself trying to spawn another worker — that
    // would chain infinitely. Children are leaves.
    NEUROWORKS_AUTO_SPAWN_WORKER: "0",
    // Parent-death watchdog: the worker self-terminates if THIS primary
    // process disappears without a graceful shutdown (crash, OOM, SIGKILL).
    // Graceful shutdown already reaps children via shutdownManagedWorker();
    // this covers the ungraceful case so a dead primary never leaves a fleet
    // of orphaned workers holding ports (observed 2026-07-13 after a forced
    // primary kill left 9 parentless workers listening).
    NEUROWORKS_PARENT_PID: String(process.pid),
  };
  console.log(`  ⓦ spawning managed worker on port ${port}…`);
  // Run the server package's OWN `dev` script from the server dir. We avoid the
  // root `secondary` script (it hardcodes `cross-env NEUROWORKS_PORT=7473`, so
  // every extra worker collided on 7473 → EADDRINUSE, capping the pool at one)
  // AND avoid a `-F` workspace filter (it threw ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT
  // when spawned directly). Running `pnpm run dev` in SERVER_DIR honours the
  // NEUROWORKS_PORT we set in env.
  const child = spawn(cmd, ["run", "dev"], {
    cwd: SERVER_DIR,
    env,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const prefix = `[worker:${port}] `;
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(prefixLines(chunk.toString(), prefix));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(prefixLines(chunk.toString(), prefix));
  });
  child.on("exit", (code, signal) => {
    const handle = workers.get(port);
    if (handle?.child === child) {
      console.warn(`  ⚠ managed worker on port ${port} exited (code=${code} signal=${signal}) — pool size now ${workers.size - 1}`);
      workers.delete(port);
    }
  });

  const readyPromise = waitForWorkerReady(url, READY_TIMEOUT_MS);
  // Mark the promise handled so a slow/failed boot doesn't surface as an
  // unhandledRejection when the caller used waitForReady:false (eager pool).
  // Awaiters can still attach their own .then/.catch.
  void readyPromise.catch(() => { /* handled — registry/health drives recovery */ });
  return Promise.resolve({
    child,
    port,
    url,
    startedAt: Date.now(),
    readyPromise,
  });
}

function prefixLines(s: string, prefix: string): string {
  return s.replace(/^/gm, prefix);
}

// Quick "is anything already listening + healthy here?" probe so we never try
// to bind a port an external/leftover worker owns. Fast timeout — a refused
// connection resolves immediately; we only wait on a silent port.
async function isPortServing(port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1200);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal });
      return r.ok;
    } finally { clearTimeout(t); }
  } catch { return false; }
}

async function waitForWorkerReady(url: string, timeoutMs: number): Promise<{ url: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      try {
        const r = await fetch(`${url}/api/peers/self`, { signal: ctrl.signal });
        if (r.ok) {
          console.log(`  ✓ managed worker ready at ${url}`);
          return { url };
        }
      } finally { clearTimeout(t); }
    } catch { /* still booting */ }
    await new Promise(r => setTimeout(r, 800));
  }
  throw new Error(`managed worker did not become ready within ${timeoutMs}ms`);
}

// Called by the primary's SIGTERM/SIGINT handler so children don't linger
// after the primary exits. Tears down EVERY worker in the pool.
export async function shutdownManagedWorker(): Promise<void> {
  if (workers.size === 0) return;
  const handles = [...workers.values()];
  workers.clear();
  for (const handle of handles) {
    try {
      if (process.platform === "win32") {
        const { execFileSync } = await import("node:child_process");
        try { execFileSync("taskkill", ["/pid", String(handle.child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* tolerate */ }
      } else {
        try { handle.child.kill("SIGTERM"); } catch { /* tolerate */ }
      }
    } catch { /* swallow */ }
  }
}
