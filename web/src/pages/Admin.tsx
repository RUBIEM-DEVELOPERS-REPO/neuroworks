import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, StatusDot } from "../components/Card";

export function Admin() {
  const [status, setStatus] = useState<any>(null);
  useEffect(() => { api.status().then(setStatus); }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Admin</h1>
        <p className="text-sm text-cream-300/70 mt-1">Workforce health, agents, and integrations.</p>
      </div>

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
            <Card title="Ollama (local LLM)">
              <StatusDot ok={status.ollama.ok} label={status.ollama.ok ? `${status.ollama.model} ready` : status.ollama.error} />
              <div className="text-xs text-cream-300/60 mt-2">Used by Engineering and Knowledge agents for summaries and intent matching.</div>
            </Card>
            <Card title="Cloud worker (clawbot)" className="col-span-2">
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

          <Card title="Agents">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-flame-500/15 grid place-items-center text-flame-400 text-xl">⌬</div>
              <div className="flex-1">
                <div className="text-sm font-medium text-cream-50">clawbot</div>
                <div className="text-xs text-cream-300/70 mt-0.5">Engineering + Knowledge worker. Reads GitHub, writes to vault, runs LLM summaries via Ollama.</div>
              </div>
              <StatusDot ok={status.ready} label={status.ready ? "active" : "degraded"} />
            </div>
            <div className="text-xs text-cream-300/40 mt-4 italic">More agents (Finance, Marketing, HR) coming as the workforce grows.</div>
          </Card>
        </>
      )}
    </div>
  );
}
