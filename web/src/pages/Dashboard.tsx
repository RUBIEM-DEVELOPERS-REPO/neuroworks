import { useEffect, useState } from "react";
import { marked } from "marked";
import { api } from "../lib/api";
import { Card, StatusDot, Button } from "../components/Card";

export function Dashboard() {
  const [status, setStatus] = useState<any>(null);
  const [digest, setDigest] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [s, d] = await Promise.all([api.status(), api.brainLatestDigest().catch(() => ({ content: "" }))]);
      setStatus(s);
      setDigest(d.content);
    } catch (e: any) { setErr(e.message); }
  }

  useEffect(() => { load(); }, []);

  async function runDigest() {
    setBusy(true);
    try { await api.triggerDigest(7); setTimeout(load, 2500); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (err) return <div className="text-red-400 text-sm">Error: {err}</div>;
  if (!status) return <div className="text-slate-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-1">Live state of the second brain and clawbot.</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card title="Vault">
          <div className="text-xs text-slate-400 font-mono break-all">{status.vaultPath}</div>
          <div className="mt-2 text-xs text-slate-500">{status.vaultRepo}</div>
        </Card>
        <Card title="Ollama">
          <StatusDot ok={status.ollama.ok} label={status.ollama.ok ? `${status.ollama.model} ready` : `${status.ollama.error}`} />
        </Card>
        <Card title="Last workflow run">
          {status.lastWorkflow?.error && <span className="text-xs text-red-400">{status.lastWorkflow.error}</span>}
          {status.lastWorkflow && !status.lastWorkflow.error && (
            <>
              <StatusDot
                ok={status.lastWorkflow.conclusion === "success"}
                label={`${status.lastWorkflow.conclusion ?? status.lastWorkflow.status}`}
              />
              <div className="text-xs text-slate-500 mt-1">{new Date(status.lastWorkflow.createdAt).toLocaleString()}</div>
              {status.lastWorkflow.htmlUrl && <a href={status.lastWorkflow.htmlUrl} target="_blank" className="text-xs text-neuro-400 hover:text-neuro-500">view on GitHub →</a>}
            </>
          )}
        </Card>
      </div>

      <Card
        title="Latest digest"
        action={<Button onClick={runDigest} disabled={busy}>{busy ? "Triggering…" : "Run digest"}</Button>}
      >
        {digest
          ? <div className="prose-vault max-h-[55vh] overflow-auto" dangerouslySetInnerHTML={{ __html: marked.parse(digest) as string }} />
          : <div className="text-sm text-slate-500">No digest yet. Click "Run digest" to trigger one.</div>}
      </Card>
    </div>
  );
}
