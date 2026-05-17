import { config } from "../config.js";
import { listJobs } from "./jobs.js";
import { listActivePeers, noteHealthResult } from "./peer-registry.js";

export type PeerInfo = {
  url: string;
  name?: string;
  role?: string;
  model?: string;
  ok: boolean;
  ready?: boolean;
  inflightJobs?: number;
  error?: string;
  rttMs?: number;
};

// One round-trip to /api/health on every reachable peer. Bounded at 2s each
// so a dead peer never freezes the dashboard. The peer list is pulled from
// the runtime registry (env-seeded + auto-discovered + manually registered),
// not directly from config.peers — so adds/drops apply without restart.
// Each result feeds the registry's consecutive-fails counter for auto-drop.
export async function pollPeers(): Promise<PeerInfo[]> {
  const peers = listActivePeers();
  if (peers.length === 0) return [];
  return Promise.all(peers.map(async (url) => {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/api/health`, { signal: ctrl.signal });
      const rttMs = Date.now() - t0;
      if (!res.ok) { noteHealthResult(url, false); return { url, ok: false, error: `HTTP ${res.status}`, rttMs }; }
      const body = await res.json() as { name?: string; role?: string; model?: string; ready?: boolean; inflightJobs?: number };
      noteHealthResult(url, true);
      return { url, name: body.name, role: body.role, model: body.model, ok: true, ready: body.ready, inflightJobs: body.inflightJobs, rttMs };
    } catch (e: any) {
      noteHealthResult(url, false);
      return { url, ok: false, error: String(e?.message ?? e), rttMs: Date.now() - t0 };
    } finally {
      clearTimeout(timer);
    }
  }));
}

// Used by the busy-check that decides whether to delegate. "Busy" means at
// least one general-task / custom-* job is still running locally.
export function localInflightCount(): number {
  return listJobs().filter(j => j.status === "running" || j.status === "pending").length;
}

// Pick the peer with the lowest inflight count. Returns null if no peer is
// reachable+ready, or every peer is at least as busy as we are.
export async function pickLightestIdlePeer(localInflight = localInflightCount()): Promise<PeerInfo | null> {
  const all = await pollPeers();
  const candidates = all.filter(p => p.ok && p.ready);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.inflightJobs ?? 0) - (b.inflightJobs ?? 0));
  const best = candidates[0];
  if ((best.inflightJobs ?? 0) >= localInflight) return null;
  return best;
}

// Pick the LIGHTEST reachable peer matching a given role — not just the first
// one. Critical when multiple peers share a role (e.g. two persona-shifters):
// the legacy "first match" picker meant only one peer ever got work and the
// rest sat idle. Sorting by inflightJobs distributes across the role pool so
// every available worker actually executes tasks.
export async function pickPeerByRole(role: string): Promise<PeerInfo | null> {
  const all = await pollPeers();
  const matches = all.filter(p => p.ok && p.ready && (p.role ?? "").toLowerCase() === role.toLowerCase());
  if (matches.length === 0) return null;
  matches.sort((a, b) => (a.inflightJobs ?? 0) - (b.inflightJobs ?? 0));
  return matches[0];
}

// Decide where a new task should run — peer OR local — based on real-time
// load on every available executor including this clawbot. Returns the
// picked peer (delegate) or null (run locally because local is at least as
// idle as the lightest peer). The `preferRole` arg lets the caller bias
// toward a specific role (e.g. "persona-shifter") while still falling back
// to ANY idle peer if the preferred role pool is fully saturated.
//
// Tie-breaker: when peer.inflight === localInflight, we prefer LOCAL. Less
// network hop, lower latency, and the primary already has the customer's
// context loaded. Only a strictly lighter peer wins.
//
// Returns a structured snapshot so the caller can log the decision verbatim:
//   { decision: "peer" | "local", peer?, localInflight, peerInflight?, reason }
export type RoutingDecision = {
  decision: "peer" | "local";
  peer?: PeerInfo;
  localInflight: number;
  peerInflight?: number;
  candidates: { url: string; role?: string; inflight: number; ok: boolean; ready: boolean }[];
  reason: string;
};

export async function pickExecutor(opts: { preferRole?: string; localInflight?: number } = {}): Promise<RoutingDecision> {
  const localInflight = opts.localInflight ?? localInflightCount();
  const all = await pollPeers();
  const live = all.filter(p => p.ok && p.ready);
  const candidates = all.map(p => ({
    url: p.url, role: p.role, inflight: p.inflightJobs ?? 0,
    ok: p.ok, ready: p.ready ?? false,
  }));
  if (live.length === 0) {
    return { decision: "local", localInflight, candidates, reason: "no reachable peers — running locally" };
  }
  // First pass: prefer the requested role pool. Pick lightest within it.
  let pool = opts.preferRole
    ? live.filter(p => (p.role ?? "").toLowerCase() === opts.preferRole!.toLowerCase())
    : live;
  // If the preferred role pool is empty OR fully saturated (every member at
  // or above local inflight), fall back to ANY live peer so work still moves.
  if (pool.length === 0) pool = live;
  pool = [...pool].sort((a, b) => (a.inflightJobs ?? 0) - (b.inflightJobs ?? 0));
  const lightestPeer = pool[0];
  const peerInflight = lightestPeer.inflightJobs ?? 0;
  if (peerInflight < localInflight) {
    return {
      decision: "peer",
      peer: lightestPeer,
      localInflight,
      peerInflight,
      candidates,
      reason: `peer ${lightestPeer.name ?? lightestPeer.url} has ${peerInflight} inflight vs local ${localInflight} — peer wins`,
    };
  }
  // Peer is equal or busier than local. Run locally — no network hop, lower
  // latency, primary already has the customer's context loaded.
  return {
    decision: "local",
    localInflight,
    peerInflight,
    candidates,
    reason: `local has ${localInflight} inflight vs lightest peer ${peerInflight} — local wins`,
  };
}

// Per-poll snapshot forwarded to the caller while the peer is still working.
// Lets the primary mirror the worker's intermediate state (plan, in-flight
// step runs, log lines) into its own job so the UI shows live progress
// instead of a frozen "running" badge for minutes at a time.
export type PeerProgress = {
  status: string;
  newLogLines: string[];
  plan?: any;
  runs?: any[];
  phase?: string;
  partialAnswer?: string;
};

// Send a task to a SPECIFIC peer (the caller already picked it, e.g. by role).
// Returns the peer's final answer and surfaces which peer answered + total
// elapsed time so the caller can show provenance in the UI. Used by the chat
// router after it picks a persona-shifter peer — we don't want to re-pick
// because the lightest-load criterion may have shifted by the time we delegate.
//
// The optional onProgress callback fires on each poll once we've seen new
// state from the worker. The caller (chat router) uses it to forward the
// worker's log lines and result-shape into the primary's own job — that's
// what makes the UI's progress bar tick during delegation.
// `personaSnapshot` is the full persona object — sent so the worker can adopt
// a CUSTOM employee the customer created on the primary without needing it
// pre-installed in the worker's own personas.json. The worker registers it
// ephemerally for the run and drops it after. `persona` is the legacy id-only
// fallback used by code that doesn't have the full object handy.
export async function delegateToPeer(peer: PeerInfo, args: {
  task: string;
  persona?: string;
  personaSnapshot?: any;
  onProgress?: (snap: PeerProgress) => void;
}): Promise<any> {
  const base = peer.url.replace(/\/+$/, "");
  const t0 = Date.now();
  const startRes = await fetch(`${base}/api/peers/delegate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: args.task,
      persona: args.persona,
      personaSnapshot: args.personaSnapshot,
    }),
  });
  if (!startRes.ok) {
    let body = "";
    try { body = (await startRes.text()).slice(0, 400); } catch { /* ignore */ }
    throw new Error(`peer delegate HTTP ${startRes.status}${body ? ` — ${body}` : ""}`);
  }
  const { jobId } = await startRes.json() as { jobId: string };

  // Peer delegation timeout. 5 min was too tight — qwen2.5:3b on the worker
  // routinely takes 4 minutes JUST to plan a multi-perspective task, leaving
  // no time for the actual work. Bumped to 12 min default, tunable via env
  // so customers running larger local models can shorten it.
  const DELEGATE_TIMEOUT_MS = Number(process.env.CLAWBOT_PEER_DELEGATE_TIMEOUT_MS ?? (12 * 60_000));
  const deadline = Date.now() + DELEGATE_TIMEOUT_MS;
  let attempt = 0;
  // Track how many log lines we've already forwarded so each poll only emits
  // the *delta*. Without this we'd resend the whole worker log every 1-3s.
  let forwardedLogCount = 0;
  while (Date.now() < deadline) {
    attempt++;
    await new Promise(r => setTimeout(r, attempt < 10 ? 1000 : 3000));
    const r = await fetch(`${base}/api/templates/jobs/${jobId}`);
    if (!r.ok) continue;
    const j = await r.json() as any;

    // Forward intermediate progress to the caller every poll, even while the
    // worker is still running. The primary's job thus mirrors the worker's
    // plan / step runs / log lines as they appear.
    if (args.onProgress) {
      const allLog: string[] = Array.isArray(j.log) ? j.log : [];
      const newLines = allLog.slice(forwardedLogCount);
      forwardedLogCount = allLog.length;
      try {
        args.onProgress({
          status: j.status,
          newLogLines: newLines,
          plan: j.result?.plan,
          runs: j.result?.runs,
          phase: j.result?.phase,
          partialAnswer: j.result?.partialAnswer,
        });
      } catch { /* consumer error — don't kill the poll loop */ }
    }

    if (j.status === "succeeded" || j.status === "failed" || j.status === "rejected") {
      return {
        peer: { url: peer.url, name: peer.name, model: peer.model },
        jobId,
        status: j.status,
        answer: j.result?.answer,
        plan: j.result?.plan,
        runs: j.result?.runs,
        // Forward sub-agent telemetry so the primary's Results page can
        // render the spin-up panel for delegated work too. Without this
        // the secondary's wave timings vanish and the user can't tell
        // delegated execution from local.
        budgets: j.result?.budgets,
        subagentTimings: j.result?.subagentTimings,
        review: j.result?.review,
        quality: j.result?.quality,
        security: j.result?.security,
        error: j.error,
        elapsedMs: Date.now() - t0,
      };
    }
  }
  throw new Error(`peer delegation timed out after ${Math.round(DELEGATE_TIMEOUT_MS / 60_000)}min (peer=${peer.url}, jobId=${jobId})`);
}

// Send a task to the lightest-loaded peer and poll its job until completion.
// Returns the peer's final answer and surfaces which peer answered + total
// elapsed time so the caller can show provenance in the UI.
export async function delegateToBestPeer(args: { task: string; persona?: string }): Promise<any> {
  const peer = await pickLightestIdlePeer();
  if (!peer) throw new Error("no idle peer available");
  const base = peer.url.replace(/\/+$/, "");
  const t0 = Date.now();
  const startRes = await fetch(`${base}/api/peers/delegate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: args.task, persona: args.persona }),
  });
  if (!startRes.ok) throw new Error(`peer delegate HTTP ${startRes.status}`);
  const { jobId } = await startRes.json() as { jobId: string };

  // Poll. Bound at 12 minutes — research/synthesis on a peer can be slow
  // (qwen2.5:3b can take 3-4 min just to plan a complex task), but not
  // infinite. Same env knob as the specific-peer delegate path.
  const DELEGATE_TIMEOUT_MS = Number(process.env.CLAWBOT_PEER_DELEGATE_TIMEOUT_MS ?? (12 * 60_000));
  const deadline = Date.now() + DELEGATE_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    await new Promise(r => setTimeout(r, attempt < 10 ? 1000 : 3000));
    const r = await fetch(`${base}/api/templates/jobs/${jobId}`);
    if (!r.ok) continue;
    const j = await r.json() as any;
    if (j.status === "succeeded" || j.status === "failed" || j.status === "rejected") {
      return {
        peer: { url: peer.url, name: peer.name, model: peer.model },
        jobId,
        status: j.status,
        answer: j.result?.answer,
        plan: j.result?.plan,
        runs: j.result?.runs,
        budgets: j.result?.budgets,
        subagentTimings: j.result?.subagentTimings,
        review: j.result?.review,
        quality: j.result?.quality,
        security: j.result?.security,
        error: j.error,
        elapsedMs: Date.now() - t0,
      };
    }
  }
  throw new Error(`peer delegation timed out after ${Math.round(DELEGATE_TIMEOUT_MS / 60_000)}min (peer=${peer.url}, jobId=${jobId})`);
}

// Send a task + draft answer to a peer for critique. Returns a structured
// verdict — the caller can decide whether to surface the revision or stick
// with the original. Falls back to self-review (calling our own /api/peers/review)
// when no peer is configured, so single-clawbot setups still get a critique.
// The reviewer field is tagged "self" in that case so the caller can present
// it honestly.
export async function reviewWithPeer(args: { task: string; answer: string }): Promise<any> {
  const peer = await pickLightestIdlePeer(0);
  const base = peer
    ? peer.url.replace(/\/+$/, "")
    : `http://127.0.0.1:${config.port}`;
  const t0 = Date.now();
  const r = await fetch(`${base}/api/peers/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error(`review HTTP ${r.status}`);
  const body = await r.json();
  const peerInfo = peer
    ? { url: peer.url, name: peer.name, model: peer.model }
    : { url: base, name: `${config.name} (self)`, model: config.ollamaModel };
  return { peer: peerInfo, elapsedMs: Date.now() - t0, ...body };
}
