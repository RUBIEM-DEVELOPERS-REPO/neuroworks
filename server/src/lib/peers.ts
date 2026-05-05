import { config } from "../config.js";
import { listJobs } from "./jobs.js";

export type PeerInfo = {
  url: string;
  name?: string;
  model?: string;
  ok: boolean;
  ready?: boolean;
  inflightJobs?: number;
  error?: string;
  rttMs?: number;
};

// One round-trip to /api/health on every configured peer. Bounded at 2s each
// so a dead peer never freezes the dashboard.
export async function pollPeers(): Promise<PeerInfo[]> {
  const peers = config.peers;
  if (peers.length === 0) return [];
  return Promise.all(peers.map(async (url) => {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/api/health`, { signal: ctrl.signal });
      const rttMs = Date.now() - t0;
      if (!res.ok) return { url, ok: false, error: `HTTP ${res.status}`, rttMs };
      const body = await res.json() as { name?: string; model?: string; ready?: boolean; inflightJobs?: number };
      return { url, name: body.name, model: body.model, ok: true, ready: body.ready, inflightJobs: body.inflightJobs, rttMs };
    } catch (e: any) {
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
