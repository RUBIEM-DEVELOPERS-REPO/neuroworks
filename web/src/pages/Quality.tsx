import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { Loader2, ThumbsUp, ThumbsDown, TrendingUp, TrendingDown, AlertTriangle, BarChart3 } from "lucide-react";

export function Quality() {
  const [summary, setSummary] = useState<any>(null);
  const [flags, setFlags] = useState<any[]>([]);
  const [lowQuality, setLowQuality] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getQualitySummary(),
      api.getQualityFlags(),
      api.getLowQualityRuns(0.5, 2),
    ]).then(([s, f, lq]) => {
      setSummary(s);
      setFlags(f.flags);
      setLowQuality(lq.runs);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin w-6 h-6" /></div>;

  const satisfactionPct = summary ? Math.round(summary.rate * 100) : 0;
  const trendIcon = satisfactionPct >= 80 ? <TrendingUp className="w-5 h-5 text-green-500" /> : <TrendingDown className="w-5 h-5 text-red-500" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Quality Dashboard</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="text-sm text-gray-500">Total Flags</div>
          <div className="text-2xl font-bold">{summary?.totalFlags ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <ThumbsUp className="w-4 h-4 text-green-500" /> Upvotes
          </div>
          <div className="text-2xl font-bold text-green-600">{summary?.upvotes ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <ThumbsDown className="w-4 h-4 text-red-500" /> Downvotes
          </div>
          <div className="text-2xl font-bold text-red-600">{summary?.downvotes ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            {trendIcon} Satisfaction
          </div>
          <div className="text-2xl font-bold">{satisfactionPct}%</div>
        </div>
      </div>

      {/* Top categories */}
      {summary?.topCategories?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
          <h2 className="font-semibold mb-3">Top Issue Categories</h2>
          <div className="space-y-2">
            {summary.topCategories.map((c: any) => (
              <div key={c.category} className="flex items-center justify-between">
                <span className="capitalize">{c.category}</span>
                <span className="text-sm text-gray-500">{c.count} flags</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low quality runs */}
      {lowQuality.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h2 className="font-semibold text-red-700 dark:text-red-400">Runs Needing Attention</h2>
          </div>
          <div className="space-y-2">
            {lowQuality.map((r: any) => (
              <div key={r.task} className="flex items-center justify-between">
                <span>{r.task}</span>
                <span className="text-sm text-red-500">{Math.round(r.rate * 100)}% satisfaction ({r.count} flags)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent flags */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border p-4">
        <h2 className="font-semibold mb-3">Recent Feedback</h2>
        {flags.length === 0 ? (
          <p className="text-sm text-gray-500">No feedback recorded yet. Flag outputs as good/bad from the results page.</p>
        ) : (
          <div className="space-y-2">
            {flags.slice(0, 20).map((f: any) => (
              <div key={`${f.jobId}-${f.ts}`} className="flex items-start gap-3 p-2 border-b last:border-0">
                {f.rating === "up" ? (
                  <ThumbsUp className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                ) : (
                  <ThumbsDown className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{f.persona || "Unknown persona"}</div>
                  {f.note && <div className="text-xs text-gray-500 truncate">{f.note}</div>}
                  <div className="text-xs text-gray-400">{new Date(f.ts).toLocaleString()}</div>
                </div>
                {f.category && <span className="text-xs capitalize px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700">{f.category}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
