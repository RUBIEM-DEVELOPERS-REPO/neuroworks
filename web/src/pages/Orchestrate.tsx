import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { Loader2, GitBranch, Play, CheckCircle, XCircle, Clock, ArrowRight, Layers, Sparkles } from "lucide-react";

export function Orchestrate() {
  const [objective, setObjective] = useState("");
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<any>(null);

  const loadRuns = () => {
    api.listOrchestrations().then((r: any) => setRuns(r.runs ?? [])).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(loadRuns, []);

  const startRun = async () => {
    if (!objective.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await api.startOrchestration(objective.trim());
      setResult(r);
      loadRuns();
      setObjective("");
    } catch (e: any) {
      setResult({ error: e?.message ?? "Failed to start" });
    } finally {
      setRunning(false);
    }
  };

  const loadRun = async (id: string) => {
    const r = await api.getOrchestration(id);
    setSelectedRun(r.run);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "done": return <CheckCircle className="w-4 h-4 text-leaf-400" />;
      case "failed": return <XCircle className="w-4 h-4 text-coral-400" />;
      case "running": return <Loader2 className="w-4 h-4 animate-spin text-violet-400" />;
      default: return <Clock className="w-4 h-4 text-cream-300/50" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <GitBranch className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Multi-Agent Orchestrator</h1>
      </div>
      <p className="text-sm text-cream-300/60">
        Decompose complex objectives into parallel sub-tasks executed by independent agents, then synthesize the results into a coherent answer.
      </p>

      {/* New run form */}
      <div className="bg-ink-900 rounded-lg border p-4">
        <label className="text-sm font-medium mb-2 block">Objective</label>
        <textarea
          value={objective}
          onChange={e => setObjective(e.target.value)}
          rows={3}
          placeholder="e.g. Research the Zimbabwe FinTech landscape and produce a market entry brief covering competitors, regulations, and customer segments."
          className="w-full text-sm border rounded px-3 py-2 bg-ink-900"
        />
        <button
          onClick={startRun}
          disabled={running || !objective.trim()}
          className="mt-3 flex items-center gap-2 px-4 py-2 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? "Decomposing & Executing…" : "Run Orchestration"}
        </button>
      </div>

      {/* Result from latest run */}
      {result && result.id && (
        <div className="bg-leaf-500/10 rounded-lg border border-leaf-500/30 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-leaf-300  mb-2">
            <Sparkles className="w-4 h-4" />
            Orchestration complete: {result.label}
          </div>
          <div className="flex gap-4 text-xs text-cream-300/60 mb-3">
            <span>Status: {result.status}</span>
            <span>Sub-tasks: {result.subTasks?.length ?? 0}</span>
          </div>
          <button onClick={() => loadRun(result.id)} className="text-sm text-violet-400 hover:underline">
            View details →
          </button>
        </div>
      )}

      {result?.error && (
        <div className="bg-coral-500/10 rounded-lg border border-coral-500/30 p-4 text-sm text-coral-400">
          {result.error}
        </div>
      )}

      {/* Selected run detail */}
      {selectedRun && (
        <div className="bg-ink-900 rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Layers className="w-5 h-5" />
              {selectedRun.label}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded ${selectedRun.status === "completed" ? "bg-leaf-500/15 text-leaf-300" : selectedRun.status === "failed" ? "bg-coral-500/15 text-coral-300" : "bg-violet-500/15 text-violet-300"}`}>
              {selectedRun.status}
            </span>
          </div>

          {selectedRun.decomposition && (
            <div className="text-sm text-cream-300/70  bg-ink-950 rounded p-3">
              {selectedRun.decomposition}
            </div>
          )}

          {/* Sub-task chain */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Sub-tasks</h3>
            {selectedRun.subTasks?.map((st: any, i: number) => (
              <div key={st.id ?? i} className="border rounded p-3">
                <div className="flex items-center gap-2">
                  {statusIcon(st.status)}
                  <span className="text-sm font-medium">{st.label}</span>
                  <span className="text-xs text-cream-300/50">({st.personaName ?? "Assistant"})</span>
                  {st.elapsedMs && <span className="text-xs text-cream-300/50 ml-auto">{(st.elapsedMs / 1000).toFixed(1)}s</span>}
                </div>
                {st.status === "done" && st.output && (
                  <div className="mt-2 text-xs text-cream-300/70  bg-ink-950 rounded p-2 max-h-24 overflow-y-auto">
                    {st.output.slice(0, 500)}{st.output.length > 500 ? "…" : ""}
                  </div>
                )}
                {st.status === "failed" && st.error && (
                  <div className="mt-2 text-xs text-coral-400">{st.error}</div>
                )}
              </div>
            ))}
          </div>

          {/* Handoff chain visualization */}
          {selectedRun.subTasks && selectedRun.subTasks.length > 1 && (
            <div className="flex items-center gap-1 text-xs text-cream-300/50 flex-wrap">
              {selectedRun.subTasks.map((st: any, i: number) => (
                <span key={st.id ?? i} className="flex items-center gap-1">
                  <span className={`px-1.5 py-0.5 rounded ${st.status === "done" ? "bg-leaf-500/15 text-leaf-300" : st.status === "failed" ? "bg-coral-500/15 text-coral-300" : "bg-ink-800"}`}>
                    {st.label}
                  </span>
                  {i < selectedRun.subTasks.length - 1 && <ArrowRight className="w-3 h-3" />}
                </span>
              ))}
            </div>
          )}

          {/* Final report */}
          {selectedRun.finalReport && (
            <div>
              <h3 className="text-sm font-medium mb-2">Synthesized Result</h3>
              <div className="text-sm whitespace-pre-wrap bg-ink-950 rounded p-3 max-h-96 overflow-y-auto">
                {selectedRun.finalReport}
              </div>
            </div>
          )}

          {selectedRun.elapsedMs && (
            <div className="text-xs text-cream-300/50">Completed in {(selectedRun.elapsedMs / 1000).toFixed(1)}s</div>
          )}
        </div>
      )}

      {/* Recent runs */}
      <div className="bg-ink-900 rounded-lg border p-4">
        <h2 className="font-semibold mb-3">Recent Orchestrations</h2>
        {loading ? (
          <div className="flex items-center justify-center h-16"><Loader2 className="animate-spin w-5 h-5" /></div>
        ) : runs.length === 0 ? (
          <p className="text-sm text-cream-300/60">No orchestrations yet.</p>
        ) : (
          <div className="space-y-1">
            {runs.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between p-2 hover:bg-ink-800/40 dark:hover:bg-ink-800/50 rounded cursor-pointer" onClick={() => loadRun(r.id)}>
                <div className="flex items-center gap-2">
                  {statusIcon(r.status)}
                  <span className="text-sm">{r.label}</span>
                  <span className="text-xs text-cream-300/50">{r.doneCount}/{r.subTaskCount} sub-tasks</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-cream-300/50">
                  {r.elapsedMs && <span>{(r.elapsedMs / 1000).toFixed(0)}s</span>}
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
