// Runtime peer registry. The env-seeded list (NEUROWORKS_PEERS) is the starting
// point, but peers can be added or dropped at runtime — by the Admin UI, by
// auto-discovery scanning common local ports, or by a peer announcing itself.
//
// Each peer also carries a transient health-history so we can quietly drop
// peers that have been unreachable for a while AND auto-rejoin them when they
// come back, without making the user re-register manually.

import { config } from "../config.js";

// "managed" = a worker THIS primary spawned (worker-manager.ts). We know it's
// ours and know it takes ~50s to warm its model — so it is exempt from the
// consecutive-fail auto-drop (a warming worker fails health probes, and once
// dropped it left the probe set and never rejoined → the "shows 3 of 4
// neuros" bug, 2026-07-13). Managed peers stay probed forever; they rejoin the
// instant they answer, and a truly-dead one just shows down without polluting
// the active set's drop logic.
export type PeerSource = "env" | "discovered" | "registered" | "managed";

type Entry = {
  url: string;
  source: PeerSource;
  // Consecutive failed pollPeers attempts. Reset to 0 on success.
  consecutiveFails: number;
  // If the entry was auto-dropped (too many fails), we stop polling it but
  // keep the URL so a manual re-add or successful re-probe puts it back.
  dropped: boolean;
  // Note about why this peer was added (e.g. "scanned 127.0.0.1:7473").
  note?: string;
};

const registry = new Map<string, Entry>();

function normalize(url: string): string {
  return url.replace(/\/+$/, "").trim();
}

function init() {
  for (const u of config.peers) {
    const k = normalize(u);
    if (!k) continue;
    if (!registry.has(k)) {
      registry.set(k, { url: k, source: "env", consecutiveFails: 0, dropped: false, note: "from NEUROWORKS_PEERS" });
    }
  }
}
init();

// Threshold for auto-drop. Each pollPeers call ticks consecutiveFails for any
// peer that errors; we drop the peer once it crosses this. They auto-rejoin
// when probePeerOnce() comes back ok.
const DROP_AFTER_CONSECUTIVE_FAILS = 6;  // ~24s at the default 4s poll cadence

export function listActivePeers(): string[] {
  const out: string[] = [];
  for (const e of registry.values()) if (!e.dropped) out.push(e.url);
  return out;
}

// Full registry including dropped peers — used by the Admin UI to show
// "peers we've heard of but can't currently reach".
export function listAllPeers(): { url: string; source: PeerSource; dropped: boolean; consecutiveFails: number; note?: string }[] {
  return [...registry.values()].map(e => ({ ...e }));
}

export function registerPeer(url: string, source: PeerSource = "registered", note?: string): { added: boolean; url: string } {
  const k = normalize(url);
  if (!k) return { added: false, url: k };
  // Treat http:// missing as a hint — caller usually passes "127.0.0.1:7473".
  const withScheme = k.startsWith("http") ? k : `http://${k}`;
  const final = normalize(withScheme);
  const existing = registry.get(final);
  if (existing) {
    // Re-registration revives a dropped peer. Don't downgrade the source.
    existing.dropped = false;
    existing.consecutiveFails = 0;
    if (note) existing.note = note;
    return { added: false, url: final };
  }
  registry.set(final, { url: final, source, consecutiveFails: 0, dropped: false, note });
  return { added: true, url: final };
}

export function deregisterPeer(url: string): boolean {
  const k = normalize(url);
  return registry.delete(k);
}

// Called by pollPeers after each round-trip — feeds the auto-drop logic.
export function noteHealthResult(url: string, ok: boolean) {
  const e = registry.get(normalize(url));
  if (!e) return;
  if (ok) {
    e.consecutiveFails = 0;
    if (e.dropped) e.dropped = false; // auto-rejoin
  } else {
    e.consecutiveFails++;
    // Managed workers are never hard-dropped — they're ours and may just be
    // warming (a fresh worker fails probes for ~50s). Staying in the active
    // set means pollPeers keeps probing, so it rejoins the moment it answers.
    if (e.source !== "managed" && e.consecutiveFails >= DROP_AFTER_CONSECUTIVE_FAILS) e.dropped = true;
  }
}

// Scan likely local ports for other clawbot instances. Probes /api/peers/self;
// any peer responding with `{ name, role }` gets auto-registered.
//
// We exclude our own port. The scan is concurrent + bounded — even if every
// port times out, it never takes longer than the 1.2s timeout.
const COMMON_LOCAL_PORTS = [7471, 7472, 7473, 7474, 7475];

export async function autodiscoverLocalPeers(): Promise<{ found: number; tried: number }> {
  const own = config.port;
  const ports = COMMON_LOCAL_PORTS.filter(p => p !== own);
  let found = 0;
  await Promise.all(ports.map(async (p) => {
    const url = `http://127.0.0.1:${p}`;
    const k = normalize(url);
    // Skip if already known and not dropped — pollPeers will keep it warm.
    if (registry.has(k) && !registry.get(k)!.dropped) return;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1200);
      try {
        const r = await fetch(`${url}/api/peers/self`, { signal: ctrl.signal });
        if (!r.ok) return;
        const body = await r.json() as { name?: string; role?: string };
        registerPeer(url, "discovered", `auto-discovered ${body.role ?? "peer"}${body.name ? ` (${body.name})` : ""}`);
        found++;
      } finally { clearTimeout(t); }
    } catch { /* port closed or not a clawbot */ }
  }));
  return { found, tried: ports.length };
}
