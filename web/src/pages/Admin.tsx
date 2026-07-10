import { useEffect, useState } from "react";
import { api, type User, type UserRole, type WorkMode } from "../lib/api";
import { Card, StatusDot, Button, showToast } from "../components/Card";

export function Admin() {
  const [status, setStatus] = useState<any>(null);
  const [peers, setPeers] = useState<{ self: any; peers: any[]; registry?: any[] } | null>(null);
  // External (CLI) agents like Hermes — rendered in the Workforce card alongside
  // clawbot peers so the operator manages one workforce, not two surfaces.
  const [externalAgents, setExternalAgents] = useState<any[]>([]);
  const [vaultStats, setVaultStats] = useState<any>(null);
  const [llm, setLlm] = useState<{ ollama: { ok: boolean; model: string; error?: string }; openrouter: { enabled: boolean; ok: boolean; model: string; error?: string }; primary: "ollama" | "openrouter" } | null>(null);
  useEffect(() => { api.status().then(setStatus); }, []);
  useEffect(() => {
    let alive = true;
    async function tick() {
      try { const r = await api.peers(); if (alive) setPeers(r); } catch {}
      try { const ext = await api.externalAgents(); if (alive) setExternalAgents(ext.agents ?? []); } catch {}
      try { const v = await api.vaultStats(); if (alive) setVaultStats(v); } catch {}
      try { const l = await api.llmStatus(); if (alive) setLlm(l); } catch {}
    }
    tick();
    const i = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Admin</h1>
        <p className="text-sm text-cream-300/70 mt-1">Workforce health, agents, and integrations.</p>
      </div>

      {/* Organization management — sign-up approvals, live sessions, headcount. */}
      <OrgManagement />

      {!status ? <Card><div className="text-sm text-cream-300/60">Loading…</div></Card> : (
        <>
          {!status.ready && (
            <div className="bg-flame-500/10 border border-flame-500/30 rounded-xl p-4">
              <div className="text-sm font-medium text-flame-400">Degraded mode</div>
              <div className="text-xs text-flame-300/80 mt-1">Missing env: <span className="font-mono">{status.missing.join(", ")}</span>. Set in <span className="font-mono">clawbot/.env</span> and restart.</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Card title="Vault">
              <div className="space-y-1.5 text-sm">
                <div className="text-cream-300/70">Local path</div>
                <div className="font-mono text-xs text-cream-100 break-all">{status.vaultPath}</div>
                <div className="text-cream-300/70 mt-3">GitHub repo</div>
                <div className="font-mono text-xs text-cream-100">{status.vaultRepo}</div>
              </div>
            </Card>
            <Card title="LLM backends">
              <LLMBackendBlock llm={llm} fallbackOllama={status.ollama} />
            </Card>
            <Card title="Cloud worker (Neuro)" className="col-span-2">
              {status.lastWorkflow?.error && <div className="text-xs text-coral-400">{status.lastWorkflow.error}</div>}
              {status.lastWorkflow && !status.lastWorkflow.error && (
                <div className="text-sm space-y-1">
                  <StatusDot ok={status.lastWorkflow.conclusion === "success"} label={`Last run: ${status.lastWorkflow.conclusion ?? status.lastWorkflow.status}`} />
                  <div className="text-xs text-cream-300/60">{new Date(status.lastWorkflow.createdAt).toLocaleString()}</div>
                  <a href={status.lastWorkflow.htmlUrl} target="_blank" className="text-xs text-violet-400 hover:text-violet-500">view on GitHub →</a>
                </div>
              )}
              {status.lastDigest && (
                <div className="mt-3 pt-3 border-t border-ink-800 text-xs text-cream-300/70">
                  Last digest: <span className="text-cream-100">{status.lastDigest.reposScanned} repos · {status.lastDigest.totalCommits} commits · {status.lastDigest.totalPrs} PRs · {status.lastDigest.totalIssues} issues</span>
                </div>
              )}
            </Card>
          </div>

          <Card title="Vault sync">
            <VaultSyncBlock stats={vaultStats} vaultPath={status.vaultPath} />
          </Card>

          <Card title="Workforce">
            {!peers ? (
              <div className="text-sm text-cream-300/60">Loading workforce…</div>
            ) : (
              <div className="space-y-3">
                <ClawbotRow bot={{ ...peers.self, ok: true }} isSelf />
                {peers.peers.length > 0 && peers.peers.map((p, i) => <ClawbotRow key={i} bot={p} />)}
                {externalAgents.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-ink-800 space-y-2">
                    <div className="text-[11px] uppercase tracking-wider text-cream-300/50 px-1">External agents</div>
                    {externalAgents.map((a, i) => <ExternalAgentRow key={`ext-${i}`} agent={a} />)}
                  </div>
                )}
                <WorkerControls
                  hasActive={peers.peers.some(p => p.ok && p.ready)}
                  registry={peers.registry ?? []}
                  onChanged={async () => {
                    try { const r = await api.peers(); setPeers(r); } catch {}
                  }}
                />
              </div>
            )}
            <div className="text-[11px] text-cream-300/50 mt-4 leading-relaxed">
              <div className="text-cream-200 font-medium not-italic mb-1">How the workforce splits</div>
              <p className="italic">
                The <span className="font-mono not-italic">persona-shifter</span> peer is the worker — by default <span className="text-cream-100 not-italic">every</span> ad-hoc chat task is delegated to it (planning, research, synthesis). The primary Neuro then acts as the editor: it scores the peer's output for quality, scans for secrets, and only captures answers that are rooted in real context (vault notes, URLs, GitHub refs) to your second brain at <span className="font-mono not-italic">0-Inbox/</span>. Set <span className="font-mono not-italic">NEUROWORKS_DELEGATE_ALL=0</span> in <span className="font-mono not-italic">clawbot/.env</span> to revert to the older "delegate only on overload" routing.
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// Renders the two LLM backends side-by-side so the customer can see at a
// glance which path is hot. Primary tag flags which backend handles a default
// /balanced call — the most common dispatch shape. When OR is disabled the
// row still renders, just dimmed with a "set OPENROUTER_API_KEY" nudge.
function LLMBackendBlock({ llm, fallbackOllama }: { llm: { ollama: { ok: boolean; model: string; error?: string }; openrouter: { enabled: boolean; ok: boolean; model: string; error?: string }; primary: "ollama" | "openrouter" } | null; fallbackOllama: { ok: boolean; model: string; error?: string } }) {
  const ollama = llm?.ollama ?? fallbackOllama;
  const or = llm?.openrouter;
  const primary = llm?.primary ?? "ollama";
  return (
    <div className="space-y-3 text-sm">
      <div className={`flex items-start gap-3 p-3 rounded-md border ${primary === "ollama" ? "border-violet-500/40 bg-violet-500/5" : "border-ink-800"}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-cream-50">Ollama</span>
            <span className="text-[10px] text-cream-300/50">local · free</span>
            {primary === "ollama" && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">primary</span>}
          </div>
          <div className="mt-1">
            <StatusDot ok={ollama.ok} label={ollama.ok ? `${ollama.model} ready` : (ollama.error ?? "unreachable")} />
          </div>
        </div>
      </div>
      <div className={`flex items-start gap-3 p-3 rounded-md border ${primary === "openrouter" ? "border-violet-500/40 bg-violet-500/5" : or?.enabled ? "border-ink-800" : "border-ink-800/60 opacity-70"}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-cream-50">OpenRouter</span>
            <span className="text-[10px] text-cream-300/50">cloud · fast</span>
            {primary === "openrouter" && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300">primary</span>}
          </div>
          {or?.enabled ? (
            <div className="mt-1">
              <StatusDot ok={or.ok} label={or.ok ? `${or.model} ready` : (or.error ?? "unreachable")} />
            </div>
          ) : (
            <div className="text-[11px] text-cream-300/50 mt-1">
              Off — set <span className="font-mono">OPENROUTER_API_KEY</span> in <span className="font-mono">.env</span> to route slow profiles to a cloud model and reclaim seconds per call.
            </div>
          )}
        </div>
      </div>
      <div className="text-[11px] text-cream-300/50">
        Used by Engineering and Knowledge agents. Profiles are picked per step (planning, synthesis, triage, extraction). Each backend can run any profile.
      </div>
    </div>
  );
}

function VaultSyncBlock({ stats, vaultPath }: { stats: any; vaultPath?: string }) {
  const [retry, setRetry] = useState<{ state: "idle" | "running" | "ok" | "fail"; info?: string }>({ state: "idle" });
  if (!stats) return <div className="text-sm text-cream-300/60">Loading vault stats…</div>;
  const lc = stats.lastCommit;
  const ago = lc?.at ? Math.round((Date.now() - lc.at) / 1000) : null;
  const agoLabel = ago == null ? "never" : ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.round(ago / 60)}m ago` : `${Math.round(ago / 3600)}h ago`;
  const ok = lc?.ok === true;
  const pushed = lc?.pushed === true;
  const pushFailed = ok && !pushed;
  async function doRetry() {
    setRetry({ state: "running" });
    try {
      const r = await api.vaultRetryPush();
      if (r.pushed) setRetry({ state: "ok", info: r.aheadBy != null ? `synced (was ${r.aheadBy} ahead)` : "synced" });
      else setRetry({ state: "fail", info: r.error ?? "push failed" });
    } catch (e: any) { setRetry({ state: "fail", info: e?.message ?? String(e) }); }
  }
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Last commit" value={agoLabel} tone={ok ? "ok" : "default"} />
        <Stat label="Pushed" value={pushed ? "yes" : ok ? "local only" : "—"} tone={pushed ? "ok" : ok ? "warn" : "default"} />
        <Stat label="Pending writes" value={stats.pendingWrites} tone={stats.pendingWrites > 0 ? "warn" : "default"} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total commits" value={stats.totalCommits} />
        <Stat label="Writes coalesced" value={stats.coalescedSavings} />
        <Stat label="Debounce" value={`${stats.debounceMs}ms`} />
      </div>
      {pushFailed && (
        <div className="text-xs bg-flame-500/10 border border-flame-500/30 rounded-md px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="font-medium text-flame-400">Origin push pending</span>
            <span className="text-cream-300/60">Commits are local; origin/main hasn't been updated.</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={doRetry}
              disabled={retry.state === "running"}
              className="text-xs px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
            >
              {retry.state === "running" ? "Retrying…" : "Retry push"}
            </button>
            {retry.state === "ok" && <span className="text-[11px] text-leaf-400">✓ {retry.info}</span>}
            {retry.state === "fail" && <span className="text-[11px] text-coral-400 font-mono break-all">{retry.info}</span>}
          </div>
        </div>
      )}
      {lc?.error && !pushFailed && (
        <div className="text-xs text-flame-400 bg-flame-500/10 border border-flame-500/30 rounded-md px-3 py-2">
          <div className="font-medium mb-1">Last sync issue</div>
          <div className="font-mono break-all">{lc.error}</div>
        </div>
      )}
      {lc?.message && (
        <div className="text-[11px] text-cream-300/50 font-mono break-all">
          last: {lc.message}
        </div>
      )}
      {vaultPath && (
        <div className="text-[11px] text-cream-300/40 font-mono break-all">vault: {vaultPath}</div>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: any; tone?: "default" | "ok" | "warn" }) {
  const color = tone === "warn" ? "text-flame-400" : tone === "ok" ? "text-leaf-400" : "text-cream-50";
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-cream-300/50">{label}</div>
      <div className={`font-display text-lg ${color}`}>{value ?? "—"}</div>
    </div>
  );
}

// Worker management — find / add / remove peer clawbots without restarting.
// Shows different empty-states depending on whether the registry has any
// known peers at all (truly empty) vs has peers it can't reach (booted but
// dropped). Both cases get a "Find workers" scan and a manual "Add by URL".
function WorkerControls({ hasActive, registry, onChanged }: { hasActive: boolean; registry: any[]; onChanged: () => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [scan, setScan] = useState<{ state: "idle" | "running" | "done"; found?: number; tried?: number }>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [worker, setWorker] = useState<any>(null);
  const [workerBusy, setWorkerBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    async function tick() { try { const w = await api.workerStatus(); if (alive) setWorker(w); } catch {} }
    tick();
    const i = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(i); };
  }, []);
  async function startWorker() {
    setWorkerBusy(true); setErr(null);
    try { await api.startWorker(); await onChanged(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setWorkerBusy(false); }
  }
  async function stopWorker() {
    setWorkerBusy(true); setErr(null);
    try { await api.stopWorker(); await onChanged(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setWorkerBusy(false); }
  }

  const dropped = registry.filter(r => r.dropped);
  const knownButUnreachable = registry.filter(r => !r.dropped && r.consecutiveFails > 0);

  async function find() {
    setScan({ state: "running" });
    try {
      const r = await api.discoverPeers();
      setScan({ state: "done", found: r.found, tried: r.tried });
      await onChanged();
    } catch (e: any) { setErr(e?.message ?? String(e)); setScan({ state: "idle" }); }
  }
  async function add() {
    if (!url.trim()) return;
    setBusy(true); setErr(null);
    try { await api.registerPeer(url.trim()); setUrl(""); await onChanged(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }
  async function remove(u: string) {
    try { await api.deregisterPeer(u); await onChanged(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  return (
    <div className="space-y-2.5">
      {worker?.running && worker?.managed && (
        <div className="text-[11px] text-leaf-400 bg-leaf-500/10 border border-leaf-500/30 rounded-md px-3 py-2 flex items-center gap-2 flex-wrap">
          <span>✓ Managed worker running</span>
          <span className="text-cream-300/60 font-mono">pid {worker.pid} · {worker.url}</span>
          {worker.uptimeMs && <span className="text-cream-300/50">· up {Math.round(worker.uptimeMs / 1000)}s</span>}
          <button
            type="button"
            onClick={stopWorker}
            disabled={workerBusy}
            className="ml-auto text-[11px] text-cream-300/70 hover:text-coral-400 disabled:opacity-40"
          >
            {workerBusy ? "stopping…" : "stop"}
          </button>
        </div>
      )}
      {!hasActive && !worker?.running && (
        <div className="border border-dashed border-flame-500/30 bg-flame-500/5 rounded-lg p-3 text-xs">
          <div className="font-medium text-flame-400 mb-1">No worker peer reachable</div>
          <div className="text-cream-300/80 leading-relaxed">
            The primary will spawn one automatically on the next task, but you can start it now to get parallel sub-agents + the curation gate immediately.
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <button
              type="button"
              onClick={startWorker}
              disabled={workerBusy}
              className="text-xs px-3 py-1.5 rounded-md bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-40"
            >
              {workerBusy ? "Starting…" : "Start managed worker"}
            </button>
            <span className="text-[11px] text-cream-300/50">or run <span className="font-mono">pnpm secondary</span> in a separate terminal</span>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={find}
          disabled={scan.state === "running"}
          className="text-xs px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
        >
          {scan.state === "running" ? "Scanning…" : "Find workers"}
        </button>
        <span className="text-[11px] text-cream-300/50">Scans 127.0.0.1:7471–7475 for Neuro peers</span>
        {scan.state === "done" && scan.found! > 0 && (
          <span className="text-[11px] text-leaf-400">✓ found {scan.found} of {scan.tried}</span>
        )}
        {scan.state === "done" && scan.found === 0 && (
          <span className="text-[11px] text-cream-300/50">no peers responded (tried {scan.tried})</span>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") void add(); }}
          placeholder="http://127.0.0.1:7473 or remote URL"
          className="flex-1 min-w-[200px] bg-ink-950 border border-ink-800 focus:border-violet-500/60 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none placeholder:text-cream-300/30"
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || !url.trim()}
          className="text-xs px-3 py-1.5 rounded-md bg-ink-800 border border-ink-700 hover:border-violet-500/40 text-cream-100 disabled:opacity-40"
        >
          Register peer
        </button>
      </div>
      {err && <div className="text-[11px] text-coral-400">{err}</div>}
      {(dropped.length > 0 || knownButUnreachable.length > 0) && (
        <details className="text-[11px]">
          <summary className="text-cream-300/60 cursor-pointer hover:text-cream-100">Registry ({registry.length} known)</summary>
          <ul className="mt-2 space-y-1">
            {registry.map(r => (
              <li key={r.url} className="flex items-center gap-2 flex-wrap">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.dropped ? "bg-coral-500" : r.consecutiveFails > 0 ? "bg-flame-500" : "bg-leaf-500"}`} />
                <span className="font-mono text-cream-200 truncate">{r.url}</span>
                <span className="text-cream-300/50">{r.dropped ? "dropped" : r.consecutiveFails > 0 ? `failing (${r.consecutiveFails})` : "ok"}</span>
                <span className="text-cream-300/40 italic">{r.source}</span>
                {r.note && <span className="text-cream-300/40 truncate">— {r.note}</span>}
                <button type="button" onClick={() => remove(r.url)} className="ml-auto text-cream-300/50 hover:text-coral-400">remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ClawbotRow({ bot, isSelf = false }: { bot: any; isSelf?: boolean }) {
  const busy = (bot.inflightJobs ?? 0) > 0;
  const dead = bot.ok === false;
  const role = (bot.role ?? "primary").toLowerCase();
  const roleColor = role === "persona-shifter" ? "text-flame-400 bg-flame-500/10 border-flame-500/30"
    : role === "general" ? "text-leaf-400 bg-leaf-500/10 border-leaf-500/30"
    : "text-violet-300 bg-violet-500/10 border-violet-500/30";
  return (
    <div className={`flex items-start gap-4 p-3 rounded-lg border ${dead ? "border-coral-500/30 bg-coral-500/5" : "border-ink-800 bg-ink-950"}`}>
      <div className="w-10 h-10 rounded-lg bg-flame-500/15 grid place-items-center text-flame-400 text-xl flex-shrink-0">⌬</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-cream-50">{bot.name ?? "Neuro"}</span>
          <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${roleColor}`}>{role}</span>
          {isSelf && <span className="text-[10px] uppercase tracking-wider text-cream-300/40">this server</span>}
        </div>
        <div className="text-[11px] text-cream-300/70 mt-1 font-mono break-all">
          {bot.url ? `${bot.url} · ` : ""}{bot.model ?? "unknown model"}{bot.rttMs != null && !isSelf ? ` · ${bot.rttMs}ms` : ""}
        </div>
        <div className="text-[11px] text-cream-300/50 mt-1">
          {dead ? <span className="text-coral-400">offline{bot.error ? ` — ${bot.error}` : ""}</span>
            : busy ? `${bot.inflightJobs} task${bot.inflightJobs === 1 ? "" : "s"} in flight`
            : "idle"}
        </div>
      </div>
      <StatusDot ok={!dead && bot.ready !== false} label={dead ? "offline" : busy ? "busy" : "idle"} />
    </div>
  );
}

// External-agent row — mirrors ClawbotRow shape so the two read as one
// workforce, but the metadata differs: external CLI agents don't expose an
// inflight count (spawned per task), so we surface recent throughput as the
// heartbeat instead, and we surface the install path + install-state badge
// in place of the "this server" tag.
function ExternalAgentRow({ agent }: { agent: any }) {
  const r = agent.recentJobs ?? { last1h: 0, last24h: 0, total: 0, succeeded: 0, failed: 0 };
  const installed = !!agent.installed;
  const live = r.last1h > 0;
  return (
    <div className={`flex items-start gap-4 p-3 rounded-lg border ${!installed ? "border-coral-500/30 bg-coral-500/5" : "border-ink-800 bg-ink-950"}`}>
      <div className="w-10 h-10 rounded-lg bg-violet-500/15 grid place-items-center text-violet-300 text-xl flex-shrink-0">◈</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-cream-50">{agent.name}</span>
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border text-violet-300 bg-violet-500/10 border-violet-500/30">{agent.kind}</span>
          <span className="text-[10px] uppercase tracking-wider text-cream-300/40">external</span>
        </div>
        <div className="text-[11px] text-cream-300/70 mt-1 font-mono break-all">
          {installed ? (agent.binPath ?? "installed") : "not installed"}
        </div>
        <div className="text-[11px] text-cream-300/50 mt-1">
          {!installed ? <span className="text-coral-400">install Hermes Agent (Nous Research) to enable</span>
            : `${r.total} run${r.total === 1 ? "" : "s"} tracked · ${r.succeeded} succeeded · ${r.failed} failed${r.last1h ? ` · ${r.last1h} in last hour` : ""}`}
        </div>
      </div>
      <StatusDot ok={installed} label={!installed ? "offline" : live ? "busy" : "idle"} />
    </div>
  );
}

// ── Organization management ────────────────────────────────────────────────
// The org-admin half of the Admin page: approve/reject self-signups (setting
// the access layer + department at approval time), see who's signed in and
// revoke sessions, and the headline headcount numbers. All backed by the
// admin-gated /api/users/* org-management endpoints.

function OrgManagement() {
  const [pending, setPending] = useState<User[]>([]);
  const [sessions, setSessions] = useState<{ id: string; name?: string; email?: string; role?: UserRole; createdAt: string; lastSeenAt: string }[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [denied, setDenied] = useState(false);

  async function refresh() {
    try {
      const [p, se, ov] = await Promise.all([api.listPendingUsers(), api.listSessions(), api.orgOverview()]);
      setPending(p.pending); setSessions(se.sessions); setOverview(ov);
    } catch (e: any) {
      if (e?.status === 403) setDenied(true);
    }
  }
  useEffect(() => { refresh(); const i = setInterval(refresh, 8000); return () => clearInterval(i); }, []);

  if (denied) return null; // staff who somehow reach /admin see nothing here

  return (
    <div className="space-y-4">
      {overview && (
        <Card title="Organization">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <OrgStat label="People" value={overview.total} />
            <OrgStat label="Pending approval" value={overview.pending} tone={overview.pending > 0 ? "warn" : "default"} />
            <OrgStat label="Signed in now" value={sessions.length} />
            <OrgStat label="Disabled" value={overview.disabled} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-cream-300/60">
            <span>Layers: <span className="text-cream-200">{overview.byLayer.superadmin} super · {overview.byLayer.admin} admin · {overview.byLayer.staff} staff</span></span>
            <span>Work modes: <span className="text-cream-200">{overview.byWorkMode.agent} agent · {overview.byWorkMode.hybrid} hybrid · {overview.byWorkMode.human + overview.byWorkMode.unset} human</span></span>
            <span>Departments: <span className="text-cream-200">{overview.byDepartment.slice(0, 5).map((d: any) => `${d.department} (${d.count})`).join(" · ")}</span></span>
          </div>
        </Card>
      )}

      {pending.length > 0 && (
        <Card title={`Pending sign-ups (${pending.length})`}>
          <div className="space-y-2">
            {pending.map(u => <PendingRow key={u.id} u={u} onDone={refresh} />)}
          </div>
        </Card>
      )}

      <Card title={`Active sessions (${sessions.length})`}>
        {sessions.length === 0 ? (
          <div className="text-sm text-cream-300/60">Nobody is signed in right now.</div>
        ) : (
          <div className="space-y-1.5">
            {sessions.map(se => (
              <div key={se.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg bg-ink-950/50 border border-ink-800 text-[12px]">
                <span className="w-1.5 h-1.5 rounded-full bg-leaf-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-cream-100">{se.name ?? se.email ?? se.id}</span>
                  <span className="text-cream-300/40 ml-2">{se.role ?? ""}</span>
                </div>
                <span className="text-cream-300/40 shrink-0">active {relAgo(se.lastSeenAt)}</span>
                <button type="button" onClick={async () => { try { await api.revokeSession(se.id); showToast("Session revoked", "success"); refresh(); } catch (e: any) { showToast(e?.message ?? String(e), "error"); } }}
                  className="text-[11px] text-cream-300/50 hover:text-coral-400 shrink-0">Revoke</button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function relAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function OrgStat({ label, value, tone = "default" }: { label: string; value: any; tone?: "default" | "warn" }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === "warn" ? "border-amber-400/30 bg-amber-400/10" : "border-ink-800 bg-ink-950/50"}`}>
      <div className="text-[10px] uppercase tracking-wider text-cream-300/50">{label}</div>
      <div className={`text-lg font-semibold ${tone === "warn" ? "text-amber-300" : "text-cream-100"}`}>{value}</div>
    </div>
  );
}

// One pending sign-up: the approver sets the access layer, department, and
// work mode right on the card, then Approve activates in one click.
function PendingRow({ u, onDone }: { u: User; onDone: () => void }) {
  const [role, setRole] = useState<UserRole>("staff");
  const [department, setDepartment] = useState(u.department ?? "");
  const [workMode, setWorkMode] = useState<WorkMode>("human");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  async function approve() {
    setBusy("approve");
    try {
      await api.approveUser(u.id, { role, department: department.trim() || undefined, workMode });
      showToast(`${u.name} approved as ${role}`, "success");
      onDone();
    } catch (e: any) { showToast(e?.message ?? String(e), "error"); }
    finally { setBusy(null); }
  }
  async function reject() {
    if (!confirm(`Reject and delete the sign-up from ${u.name} (${u.email})?`)) return;
    setBusy("reject");
    try { await api.rejectUser(u.id); showToast("Sign-up rejected", "success"); onDone(); }
    catch (e: any) { showToast(e?.message ?? String(e), "error"); }
    finally { setBusy(null); }
  }

  const SEL = "bg-ink-950 border border-ink-800 text-[11px] text-cream-200 rounded px-1.5 py-1";
  return (
    <div className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-3 py-2.5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <div className="text-sm text-cream-100">{u.name}</div>
          <div className="text-[11px] text-cream-300/50">{u.email} · requested {relAgo(u.createdAt)}</div>
        </div>
        <select value={role} onChange={e => setRole(e.target.value as UserRole)} className={SEL} title="Access layer">
          <option value="staff">staff</option>
          <option value="admin">admin</option>
          <option value="superadmin">super admin</option>
        </select>
        <input value={department} onChange={e => setDepartment(e.target.value)} placeholder="Department" className={`${SEL} w-32`} />
        <select value={workMode} onChange={e => setWorkMode(e.target.value as WorkMode)} className={SEL} title="Work mode">
          <option value="human">human</option>
          <option value="hybrid">hybrid</option>
          <option value="agent">agent</option>
        </select>
        <Button onClick={approve} disabled={busy !== null}>{busy === "approve" ? "Approving…" : "Approve"}</Button>
        <button type="button" onClick={reject} disabled={busy !== null} className="text-[11px] text-cream-300/50 hover:text-coral-400">Reject</button>
      </div>
    </div>
  );
}

