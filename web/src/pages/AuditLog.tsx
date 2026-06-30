import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { Loader2, ScrollText, Search, Filter, AlertTriangle, Info, AlertCircle } from "lucide-react";

export function AuditLog() {
  const [events, setEvents] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");

  const load = () => {
    setLoading(true);
    api.queryAudit({ limit: 100, level: level || undefined, actor: actor || undefined, action: action || undefined })
      .then(r => { setEvents(r.events); setTotal(r.total); })
      .catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const levelIcon = (lvl: string) => {
    switch (lvl) {
      case "error": return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "warn": return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default: return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScrollText className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Mission Audit Log</h1>
        <span className="text-sm text-gray-500 ml-auto">{total} events</span>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Level</label>
          <select value={level} onChange={e => setLevel(e.target.value)} className="text-sm border rounded px-2 py-1 bg-white dark:bg-gray-800">
            <option value="">All</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Actor</label>
          <input value={actor} onChange={e => setActor(e.target.value)} placeholder="Filter by actor..." className="text-sm border rounded px-2 py-1 bg-white dark:bg-gray-800 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Action</label>
          <input value={action} onChange={e => setAction(e.target.value)} placeholder="Filter by action..." className="text-sm border rounded px-2 py-1 bg-white dark:bg-gray-800 w-40" />
        </div>
        <button onClick={load} className="flex items-center gap-2 text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">
          <Search className="w-4 h-4" /> Search
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="animate-spin w-6 h-6" /></div>
      ) : events.length === 0 ? (
        <p className="text-sm text-gray-500">No audit events found.</p>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg border overflow-hidden">
          <div className="divide-y">
            {events.map((e: any) => (
              <div key={e.id} className="p-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <div className="mt-0.5">{levelIcon(e.level)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{e.actor}</span>
                    <span className="text-xs text-gray-400">{e.ts ? new Date(e.ts).toLocaleString() : ""}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${e.result === "success" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : e.result === "failure" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"}`}>
                      {e.result}
                    </span>
                  </div>
                  <div className="text-sm mt-0.5">
                    <span className="font-medium">{e.action}</span>
                    <span className="text-gray-500"> on </span>
                    <span>{e.target}</span>
                  </div>
                  {e.detail && <div className="text-xs text-gray-500 mt-0.5 truncate">{e.detail}</div>}
                  {e.jobId && <div className="text-xs text-gray-400 mt-0.5 font-mono">job: {e.jobId}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
