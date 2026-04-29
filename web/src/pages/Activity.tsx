import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { Card } from "../components/Card";

export function Activity() {
  const [jobs, setJobs] = useState<any[]>([]);
  useEffect(() => {
    const tick = () => api.listJobs().then(r => setJobs(r.jobs)).catch(() => {});
    tick(); const i = setInterval(tick, 3000); return () => clearInterval(i);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Activity</h1>
        <p className="text-sm text-cream-300/70 mt-1">Audit trail of every action your workforce has taken.</p>
      </div>

      {jobs.length === 0 ? (
        <Card><div className="text-sm text-cream-300/60 text-center py-8">No activity yet.</div></Card>
      ) : (
        <Card>
          <ul className="relative">
            <div className="absolute left-2 top-2 bottom-2 w-px bg-ink-700" />
            {jobs.map(j => (
              <li key={j.id} className="relative pl-8 py-3 border-b border-ink-800 last:border-0">
                <span className={`absolute left-0.5 top-4 w-3.5 h-3.5 rounded-full border-2 border-ink-900 ${j.status === "succeeded" ? "bg-leaf-500" : j.status === "failed" ? "bg-coral-500" : j.status === "running" ? "bg-flame-400" : "bg-cream-300/30"}`} />
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-cream-50">{j.title ?? j.kind}</div>
                    <div className="text-[11px] text-cream-300/50 mt-0.5 font-mono">{new Date(j.startedAt).toLocaleString()} · {j.status}</div>
                  </div>
                  <Link to={`/tasks?focus=${j.id}`} className="text-xs text-violet-400 hover:text-violet-500 shrink-0">view</Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
