import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { Loader2, DollarSign, Cpu, BarChart3, TrendingUp, Calendar } from "lucide-react";

export function Cost() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getCostSummary().then(setSummary).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin w-6 h-6" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Cost Monitoring</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="text-sm text-gray-500">Total Cost</div>
          <div className="text-2xl font-bold">${(summary?.totalCostUsd ?? 0).toFixed(4)}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="text-sm text-gray-500">LLM Calls</div>
          <div className="text-2xl font-bold">{summary?.callCount ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Cpu className="w-4 h-4" /> Input Tokens
          </div>
          <div className="text-2xl font-bold">{(summary?.totalInputTokens ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <TrendingUp className="w-4 h-4" /> Output Tokens
          </div>
          <div className="text-2xl font-bold">{(summary?.totalOutputTokens ?? 0).toLocaleString()}</div>
        </div>
      </div>

      {summary?.byModel?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Cost by Model</h2>
          <div className="space-y-2">
            {summary.byModel.map((m: any) => (
              <div key={m.model} className="flex items-center justify-between">
                <span className="text-sm font-mono">{m.model}</span>
                <div className="flex gap-4 text-sm text-gray-500">
                  <span>${m.costUsd.toFixed(4)}</span>
                  <span>{m.calls} calls</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary?.byDay?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" /> Cost by Day</h2>
          <div className="space-y-1">
            {summary.byDay.slice(-14).map((d: any) => (
              <div key={d.date} className="flex items-center justify-between text-sm">
                <span>{d.date}</span>
                <div className="flex gap-4 text-gray-500">
                  <span>${d.costUsd.toFixed(4)}</span>
                  <span>{d.calls} calls</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary?.recentCalls?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <h2 className="font-semibold mb-3">Recent Calls</h2>
          <div className="space-y-1 text-sm">
            {summary.recentCalls.slice(0, 20).map((c: any) => (
              <div key={`${c.jobId}-${c.ts}`} className="flex items-center justify-between border-b last:border-0 py-1">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs truncate block">{c.model}</span>
                  <span className="text-xs text-gray-400">{c.profile}</span>
                </div>
                <div className="flex gap-3 shrink-0 text-xs text-gray-500">
                  <span title={`${c.inputTokens} in / ${c.outputTokens} out`}>⬆{c.inputTokens} ⬇{c.outputTokens}</span>
                  <span>${c.costUsd.toFixed(6)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
