import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card, Button } from "../components/Card";

export function Tasks() {
  const [run, setRun] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [lookback, setLookback] = useState(7);

  async function load() {
    try { const r = await api.latestWorkflow(); setRun(r.run); } catch {}
  }
  useEffect(() => { load(); }, []);

  async function trigger() {
    setBusy(true); setMsg("");
    try {
      await api.triggerDigest(lookback);
      setMsg(`workflow_dispatch sent (lookback=${lookback}d)`);
      setTimeout(load, 3000);
    } catch (e: any) { setMsg(`error: ${e.message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Tasks</h1>
        <p className="text-sm text-slate-400 mt-1">Trigger clawbot workflows.</p>
      </div>

      <Card title="Daily digest">
        <p className="text-sm text-slate-400 mb-3">Scans every owned/collab repo, writes <code className="text-pulse-400 font-mono">_clawbot/YYYY-MM-DD.md</code> + per-repo snapshots, pushes to vault repo.</p>
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400">Lookback</label>
          <input type="number" min={1} max={90} value={lookback} onChange={e => setLookback(Number(e.target.value))}
            className="bg-ink-800 border border-ink-700 rounded px-2 py-1 text-xs w-16" />
          <Button onClick={trigger} disabled={busy}>{busy ? "Sending…" : "Run now"}</Button>
          {msg && <span className="text-xs text-slate-400">{msg}</span>}
        </div>
      </Card>

      <Card title="Latest run">
        {!run && <div className="text-xs text-slate-500">No runs yet.</div>}
        {run && (
          <div className="text-sm space-y-1">
            <div><span className="text-slate-500 text-xs">id</span> <span className="font-mono text-slate-300 text-xs">{run.id}</span></div>
            <div><span className="text-slate-500 text-xs">status</span> <span className="text-slate-200">{run.status} · {run.conclusion ?? "—"}</span></div>
            <div><span className="text-slate-500 text-xs">created</span> <span className="text-slate-300 text-xs">{new Date(run.created_at).toLocaleString()}</span></div>
            <a href={run.html_url} target="_blank" className="text-xs text-neuro-400 hover:text-neuro-500">view on GitHub →</a>
          </div>
        )}
      </Card>
    </div>
  );
}
