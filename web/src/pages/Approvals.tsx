import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card } from "../components/Card";

export function Approvals() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  async function load() {
    try { const r = await api.listJobs(); setJobs(r.jobs.filter(j => j.status === "awaiting-approval")); }
    catch {}
  }
  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i); }, []);

  async function approve(id: string) {
    setBusy(id); setErr("");
    try { await api.approveJob(id); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }
  async function reject(id: string) {
    setBusy(id); setErr("");
    try { await api.rejectJob(id); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Approvals</h1>
        <p className="text-sm text-cream-300/70 mt-1">Tasks that write to GitHub or your vault wait here for your sign-off.</p>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-cream-300/40 text-4xl mb-3">✓</div>
            <div className="text-sm text-cream-200">Nothing waiting for approval.</div>
            <div className="text-xs text-cream-300/50 mt-1">Tasks with destructive scope (publishing folders, writing to vault) will queue here.</div>
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {jobs.map(j => (
            <li key={j.id}>
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-cream-50">{j.title ?? j.kind}</div>
                    <div className="text-xs text-cream-300/60 mt-0.5">{new Date(j.startedAt).toLocaleString()}</div>
                    {j.inputs && Object.keys(j.inputs).length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] font-mono">
                        {Object.entries(j.inputs).map(([k, v]) => (
                          <div key={k}><span className="text-cream-300/50">{k}:</span> <span className="text-cream-200 break-all">{String(v)}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => reject(j.id)} disabled={busy === j.id} className="px-3 py-1.5 rounded-md text-xs text-cream-300 hover:text-cream-100 border border-ink-700 disabled:opacity-50">Reject</button>
                    <button onClick={() => approve(j.id)} disabled={busy === j.id} className="px-3 py-1.5 rounded-md text-xs bg-leaf-500 hover:bg-leaf-400 text-ink-950 font-medium disabled:opacity-50">{busy === j.id ? "…" : "Approve"}</button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {err && <div className="text-xs text-coral-400">{err}</div>}
    </div>
  );
}
