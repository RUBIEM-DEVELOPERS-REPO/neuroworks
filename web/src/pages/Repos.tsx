import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Card } from "../components/Card";

export function Repos() {
  const [repos, setRepos] = useState<any[] | null>(null);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    api.listRepos().then(r => setRepos(r.repos)).catch(e => setErr(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = filter.toLowerCase();
    return repos.filter(r => !q || r.full.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q));
  }, [repos, filter]);

  if (err) return <div className="text-red-400 text-sm">Error: {err}</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Repositories</h1>
          <p className="text-sm text-slate-400 mt-1">{repos ? `${repos.length} repos visible to clawbot` : "Loading…"}</p>
        </div>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="filter…"
          className="bg-ink-900 border border-ink-700 rounded-md px-3 py-1.5 text-sm w-64 focus:outline-none focus:border-neuro-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {filtered.map(r => (
          <Link key={r.full} to={`/repos/${r.owner}/${r.name}`} className="block">
            <Card className="hover:border-neuro-500 transition-colors">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-medium text-slate-100 truncate">{r.name}</div>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
                  {r.private && <span className="text-slate-500">private</span>}
                  {r.hasSummary && <span className="text-pulse-400">summary</span>}
                </div>
              </div>
              <div className="text-xs text-slate-500">{r.owner}</div>
              {r.description && <div className="text-xs text-slate-400 mt-2 line-clamp-2">{r.description}</div>}
              <div className="text-[10px] text-slate-600 mt-2">last push {r.pushedAt ? new Date(r.pushedAt).toLocaleDateString() : "—"} · {r.language ?? "—"}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
