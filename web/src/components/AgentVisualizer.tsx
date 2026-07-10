import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Peer = {
  url?: string;
  name?: string;
  model?: string;
  ok?: boolean;
  ready?: boolean;
  inflightJobs?: number;
};

type RunningJob = {
  id: string;
  title: string;
  status: string;
  template?: string;
  result?: any;
};

// Live picture of every clawbot the system knows about and the sub-agents
// they're spinning up to complete the user's tasks. Refreshes every 2s.
//
// Visual model:
//   primary clawbot  ←─ (peer)  secondary clawbot
//        │ wave 1: 3 sub-agents (running)
//        │ wave 2: 1 sub-agent  (queued)
//
// Each sub-agent appears as an animated dot the moment a step starts; the
// connection line pulses while in-flight, settles green on success, red on
// failure. The waves are the user-facing answer to "what tasks are needed
// to achieve the goal" — every step is one task.
export function AgentVisualizer() {
  const [self, setSelf] = useState<Peer | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [running, setRunning] = useState<RunningJob[]>([]);
  const [err, setErr] = useState("");

  async function tick() {
    try {
      const [p, j] = await Promise.all([
        api.peers().catch(() => ({ self: null, peers: [] })),
        api.listJobs().catch(() => ({ jobs: [] as any[] })),
      ]);
      setSelf(p.self);
      setPeers(p.peers ?? []);
      setRunning((j.jobs ?? []).filter((x: any) => x.status === "running" || x.status === "pending").slice(0, 3));
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { tick(); const i = setInterval(tick, 2000); return () => clearInterval(i); }, []);

  const allBots: Peer[] = [
    ...(self ? [{ ...self, ok: true }] : []),
    ...peers,
  ];

  return (
    <div className="bg-ink-900 border border-ink-800 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div className="text-xs uppercase tracking-[0.25em] text-cream-300/60">Workforce</div>
        <div className="text-[11px] text-cream-300/50">{allBots.length} {allBots.length === 1 ? "neuro" : "neuros"} · {running.length} active {running.length === 1 ? "task" : "tasks"}</div>
      </div>

      {/* Clawbot row */}
      <div className="flex flex-wrap gap-3 mb-5">
        {allBots.map((b, i) => <BotChip key={i} bot={b} />)}
        {allBots.length === 1 && (
          <div className="border border-dashed border-ink-700 rounded-lg px-4 py-3 text-xs text-cream-300/40 self-center">
            + add a peer via <span className="font-mono text-cream-300/60">NEUROWORKS_PEERS</span>
          </div>
        )}
      </div>

      {/* Active job → wave timeline */}
      {running.length === 0 && (
        <div className="text-sm text-cream-300/60 italic">No tasks running. Delegate something above and you'll see the sub-agents spin up here.</div>
      )}
      {running.map(job => <JobWaves key={job.id} job={job} />)}
      {err && <div className="text-coral-400 text-xs mt-2">{err}</div>}
    </div>
  );
}

function BotChip({ bot }: { bot: Peer }) {
  const busy = (bot.inflightJobs ?? 0) > 0;
  const dead = bot.ok === false;
  const ring = dead ? "border-coral-500/40" : busy ? "border-violet-500/60" : "border-leaf-500/40";
  const dot = dead ? "bg-coral-500" : busy ? "bg-violet-500 animate-pulse" : "bg-leaf-500";
  return (
    <div className={`flex items-center gap-3 bg-ink-950 border ${ring} rounded-lg px-3.5 py-2.5`}>
      <div className={`relative ${busy && !dead ? "nw-avatar-active" : ""}`}>
        {/* Stylized clawbot mark — small triangle stack */}
        <svg width="28" height="28" viewBox="0 0 28 28" className="block">
          <polygon points="14,4 24,22 4,22" fill="#c9a227" />
          <polygon points="14,8 22,21 6,21" fill="#7c3aed" opacity="0.85" />
          <polygon points="14,13 19,20 9,20" fill="#fb7185" />
        </svg>
        <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${dot} ring-2 ring-ink-950`} />
      </div>
      <div className="leading-tight">
        <div className="text-sm text-cream-100 font-medium">{bot.name ?? "Neuro"}</div>
        <div className="text-[10px] text-cream-300/60 font-mono">{bot.model ?? "?"} · {dead ? "offline" : busy ? `${bot.inflightJobs} task${bot.inflightJobs === 1 ? "" : "s"}` : "idle"}</div>
      </div>
    </div>
  );
}

function JobWaves({ job }: { job: RunningJob }) {
  const r = job.result ?? {};
  const steps: any[] = r.plan?.steps ?? [];
  const runs: any[] = r.runs ?? [];
  const waves: number[][] = (r.plan?.waves && r.plan.waves.length > 0)
    ? r.plan.waves
    : steps.map((_, i) => [i]);

  return (
    <div className="border-t border-ink-800 pt-4 mt-1">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-cream-100 truncate">{job.title || "Active task"}</div>
        <div className="text-[10px] uppercase tracking-wider text-cream-300/50">{r.phase ?? job.status}</div>
      </div>

      {steps.length === 0 && (
        <div className="text-xs text-cream-300/50 italic">Working out a plan…</div>
      )}

      {waves.length > 0 && (
        <div className="space-y-3">
          {waves.map((ids, w) => {
            const isParallel = ids.length > 1;
            const inflight = ids.some(i => runs[i]?.startedAt && !runs[i]?.ok && !runs[i]?.error);
            return (
              <div key={w} className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${inflight ? "bg-violet-500/20 text-violet-300" : "bg-ink-800 text-cream-300/60"}`}>
                    W{w + 1}
                  </div>
                </div>
                <div className={`flex-1 ${isParallel ? "border-l-2 border-violet-500/30 pl-3" : ""}`}>
                  {isParallel && (
                    <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1.5">
                      {ids.length} sub-agents working together
                    </div>
                  )}
                  <div className="space-y-1.5">
                    {ids.map(i => {
                      const s = steps[i];
                      const run = runs[i];
                      const inf = run?.startedAt && !run?.ok && !run?.error;
                      const done = run?.ok;
                      const failed = run?.error;
                      const dot = done ? "bg-leaf-500" : failed ? "bg-coral-500" : inf ? "bg-violet-500 animate-pulse" : "bg-cream-300/30";
                      return (
                        <div key={i} className="flex items-center gap-2.5">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
                          <span className="text-xs text-cream-200 truncate flex-1">{s?.label ?? s?.tool ?? "step"}</span>
                          {done && run?.modelUsed && <span className="text-[10px] text-violet-400/70 font-mono" title="Model used">{run.modelUsed}</span>}
                          {done && run?.durationMs != null && <span className="text-[10px] text-cream-300/40 font-mono">{(run.durationMs / 1000).toFixed(1)}s</span>}
                          {inf && <span className="text-[10px] text-violet-400">working…</span>}
                          {failed && <span className="text-[10px] text-coral-400">failed</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
