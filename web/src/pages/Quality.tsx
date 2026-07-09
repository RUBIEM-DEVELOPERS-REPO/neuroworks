import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { Loader2, ThumbsUp, ThumbsDown, TrendingUp, TrendingDown, AlertTriangle, BarChart3 } from "lucide-react";

const LANG_LABEL: Record<string, string> = { en: "English", sn: "chiShona", nd: "isiNdebele" };

export function Quality() {
  const [summary, setSummary] = useState<any>(null);
  const [flags, setFlags] = useState<any[]>([]);
  const [lowQuality, setLowQuality] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [langFilter, setLangFilter] = useState("");

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
  const trendIcon = satisfactionPct >= 80 ? <TrendingUp className="w-5 h-5 text-leaf-400" /> : <TrendingDown className="w-5 h-5 text-coral-400" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Quality Dashboard</h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="text-sm text-cream-300/60">Total Flags</div>
          <div className="text-2xl font-bold">{summary?.totalFlags ?? 0}</div>
        </div>
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-cream-300/60">
            <ThumbsUp className="w-4 h-4 text-leaf-400" /> Upvotes
          </div>
          <div className="text-2xl font-bold text-leaf-400">{summary?.upvotes ?? 0}</div>
        </div>
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-cream-300/60">
            <ThumbsDown className="w-4 h-4 text-coral-400" /> Downvotes
          </div>
          <div className="text-2xl font-bold text-coral-400">{summary?.downvotes ?? 0}</div>
        </div>
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-cream-300/60">
            {trendIcon} Satisfaction
          </div>
          <div className="text-2xl font-bold">{satisfactionPct}%</div>
        </div>
      </div>

      {/* Top categories */}
      {summary?.topCategories?.length > 0 && (
        <div className="bg-ink-900 rounded-lg border p-4">
          <h2 className="font-semibold mb-3">Top Issue Categories</h2>
          <div className="space-y-2">
            {summary.topCategories.map((c: any) => (
              <div key={c.category} className="flex items-center justify-between">
                <span className="capitalize">{c.category}</span>
                <span className="text-sm text-cream-300/60">{c.count} flags</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Low quality runs */}
      {lowQuality.length > 0 && (
        <div className="bg-coral-500/10 rounded-lg border border-coral-500/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-coral-400" />
            <h2 className="font-semibold text-coral-300 ">Runs Needing Attention</h2>
          </div>
          <div className="space-y-2">
            {lowQuality.map((r: any) => (
              <div key={r.task} className="flex items-center justify-between">
                <span>{r.task}</span>
                <span className="text-sm text-coral-400">{Math.round(r.rate * 100)}% satisfaction ({r.count} flags)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent flags */}
      <div className="bg-ink-900 rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Recent Feedback</h2>
          {flags.some((f: any) => f.language) && (
            <select value={langFilter} onChange={e => setLangFilter(e.target.value)} title="Filter recent feedback by language" className="bg-ink-950 border border-ink-800 text-xs text-cream-200 rounded px-2 py-1">
              <option value="">All languages</option>
              <option value="en">English</option>
              <option value="sn">chiShona</option>
              <option value="nd">isiNdebele</option>
            </select>
          )}
        </div>
        {flags.length === 0 ? (
          <p className="text-sm text-cream-300/60">No feedback recorded yet. Flag outputs as good/bad from the results page.</p>
        ) : (
          <div className="space-y-2">
            {flags.filter((f: any) => !langFilter || f.language === langFilter).slice(0, 20).map((f: any) => (
              <div key={`${f.jobId}-${f.ts}`} className="flex items-start gap-3 p-2 border-b last:border-0">
                {f.rating === "up" ? (
                  <ThumbsUp className="w-4 h-4 text-leaf-400 mt-0.5 shrink-0" />
                ) : (
                  <ThumbsDown className="w-4 h-4 text-coral-400 mt-0.5 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{f.persona || "Unknown persona"}</div>
                  {f.note && <div className="text-xs text-cream-300/60 truncate">{f.note}</div>}
                  <div className="text-xs text-cream-300/50">{new Date(f.ts).toLocaleString()}</div>
                </div>
                {f.language && <span className="text-xs px-2 py-0.5 rounded bg-violet-500/15 text-violet-300">{LANG_LABEL[f.language] ?? f.language}</span>}
                {f.category && <span className="text-xs capitalize px-2 py-0.5 rounded bg-ink-800">{f.category}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
