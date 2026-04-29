import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Card } from "../components/Card";

export function Tasks() {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("focus");
  const [jobs, setJobs] = useState<any[]>([]);
  const [filter, setFilter] = useState<"all" | "running" | "succeeded" | "failed">("all");

  async function load() {
    try { const r = await api.listJobs(); setJobs(r.jobs); } catch {}
  }
  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i); }, []);

  const filtered = useMemo(() => filter === "all" ? jobs : jobs.filter(j => j.status === filter), [jobs, filter]);
  const focused = focusId ? jobs.find(j => j.id === focusId) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-3xl text-cream-50">Tasks</h1>
          <p className="text-sm text-cream-300/70 mt-1">Everything you've delegated to the workforce.</p>
        </div>
        <div className="flex gap-1">
          {(["all", "running", "succeeded", "failed"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs ${filter === f ? "bg-ink-800 text-cream-50 border border-ink-700" : "text-cream-300 hover:text-cream-100"}`}>
              {f}
              <span className="ml-1.5 opacity-60 font-mono">{f === "all" ? jobs.length : jobs.filter(j => j.status === f).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-2">
          {filtered.length === 0 && <Card><div className="text-sm text-cream-300/60 text-center py-8">No tasks {filter !== "all" && `with status "${filter}"`}.</div></Card>}
          {filtered.map(j => (
            <button key={j.id} onClick={() => { params.set("focus", j.id); setParams(params); }}
              className={`w-full text-left bg-ink-900 border rounded-xl p-4 transition-colors ${focusId === j.id ? "border-violet-500/60" : "border-ink-800 hover:border-ink-700"}`}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${j.status === "succeeded" ? "bg-leaf-500" : j.status === "failed" ? "bg-coral-500" : j.status === "running" ? "bg-flame-400 animate-pulse" : "bg-cream-300/30"}`} />
                  <div className="min-w-0">
                    <div className="text-sm text-cream-50 font-medium truncate">{j.title ?? j.kind}</div>
                    <div className="text-[11px] text-cream-300/50 mt-0.5">{j.kind}</div>
                  </div>
                </div>
                <div className="text-[11px] text-cream-300/50 font-mono shrink-0">{new Date(j.startedAt).toLocaleString()}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="col-span-1">
          {focused ? (
            <Card title={focused.title ?? focused.kind}>
              <div className="text-xs text-cream-300/70 mb-3">
                <div>Status: <span className={focused.status === "succeeded" ? "text-leaf-400" : focused.status === "failed" ? "text-coral-400" : "text-flame-400"}>{focused.status}</span></div>
                <div>Started: {new Date(focused.startedAt).toLocaleString()}</div>
                {focused.finishedAt && <div>Finished: {new Date(focused.finishedAt).toLocaleString()}</div>}
              </div>
              <div className="bg-ink-950 border border-ink-800 rounded-md p-3 max-h-72 overflow-auto scrollbar-thin">
                <pre className="text-[11px] font-mono text-cream-200 whitespace-pre-wrap">{focused.log.join("\n")}</pre>
              </div>
              {focused.error && <div className="text-xs text-coral-400 mt-3">{focused.error}</div>}
              {focused.result && (
                <details className="mt-3">
                  <summary className="text-xs text-cream-300 cursor-pointer hover:text-cream-100">Result</summary>
                  <pre className="text-[11px] font-mono text-cream-200 mt-2 bg-ink-950 border border-ink-800 rounded p-3 overflow-auto scrollbar-thin">{JSON.stringify(focused.result, null, 2)}</pre>
                </details>
              )}
            </Card>
          ) : (
            <Card><div className="text-sm text-cream-300/60 text-center py-8">Pick a task to inspect it.</div></Card>
          )}
        </div>
      </div>
    </div>
  );
}
