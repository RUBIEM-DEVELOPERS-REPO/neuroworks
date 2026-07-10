import { useState, useEffect, useRef } from "react";
import { api, type TimeAnalysis, type WorkforceCost } from "../lib/api";
import { Loader2, DollarSign, Cpu, BarChart3, TrendingUp, Calendar, Users, Hourglass, Upload } from "lucide-react";

export function Cost() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [workforce, setWorkforce] = useState<WorkforceCost | null>(null);
  const [timeA, setTimeA] = useState<TimeAnalysis | null>(null);

  const loadSide = () => {
    api.workforceCost(30).then(setWorkforce).catch(() => {});
    api.timeAnalysis(30).then(setTimeA).catch(() => {});
  };
  useEffect(() => {
    api.getCostSummary().then(setSummary).catch(() => {}).finally(() => setLoading(false));
    loadSide();
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin w-6 h-6" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="w-6 h-6" />
        <h1 className="text-2xl font-bold">Cost Monitoring</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="text-sm text-cream-300/60">Total Cost</div>
          <div className="text-2xl font-bold">${(summary?.totalCostUsd ?? 0).toFixed(4)}</div>
        </div>
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="text-sm text-cream-300/60">LLM Calls</div>
          <div className="text-2xl font-bold">{summary?.callCount ?? 0}</div>
        </div>
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-cream-300/60">
            <Cpu className="w-4 h-4" /> Input Tokens
          </div>
          <div className="text-2xl font-bold">{(summary?.totalInputTokens ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-cream-300/60">
            <TrendingUp className="w-4 h-4" /> Output Tokens
          </div>
          <div className="text-2xl font-bold">{(summary?.totalOutputTokens ?? 0).toLocaleString()}</div>
        </div>
      </div>

      {/* Human vs agent — the total cost of work over the last 30 days. Agent
          spend is metered in USD; human spend is logged hours × salary-derived
          rate in ZAR. Shown side by side, not converted — the point is the
          shape of the split, not a currency roundtrip. */}
      {workforce && (
        <div className="bg-ink-900 rounded-lg border p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <h2 className="font-semibold flex items-center gap-2"><Users className="w-4 h-4" /> Humans vs Agents — last {workforce.days} days</h2>
            <TimesheetUpload onDone={loadSide} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 p-3">
              <div className="text-xs text-violet-300/80">Agent cost</div>
              <div className="text-xl font-bold">${workforce.agent.costUsd.toFixed(2)}</div>
              <div className="text-xs text-cream-300/50">{workforce.agent.calls} model calls</div>
            </div>
            <div className="rounded-lg bg-leaf-500/10 border border-leaf-500/20 p-3">
              <div className="text-xs text-leaf-400/90">Human cost</div>
              <div className="text-xl font-bold">R{workforce.human.costZar.toLocaleString()}</div>
              <div className="text-xs text-cream-300/50">{workforce.human.totalHours}h logged{workforce.human.unpricedHours > 0 ? ` · ${workforce.human.unpricedHours}h unpriced (set salaries on the Users page)` : ""}</div>
            </div>
            <div className="rounded-lg bg-ink-950/60 border border-ink-800 p-3">
              <div className="text-xs text-cream-300/60">Hourly basis</div>
              <div className="text-xl font-bold">{workforce.human.workHoursPerMonth}h</div>
              <div className="text-xs text-cream-300/50">standard month (salary ÷ hours = rate)</div>
            </div>
          </div>
          {workforce.human.byUser.length > 0 ? (
            <div className="space-y-1">
              {workforce.human.byUser.map(u => (
                <div key={u.email} className="flex items-center justify-between text-sm border-b border-ink-800 last:border-0 py-1">
                  <div className="min-w-0">
                    <span className="text-cream-100">{u.name ?? u.email}</span>
                    {u.workMode && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-ink-800 text-cream-300/70">{u.workMode}</span>}
                  </div>
                  <div className="flex gap-4 text-xs text-cream-300/60 shrink-0">
                    <span>{u.hours}h</span>
                    <span>{u.costZar !== undefined ? `R${u.costZar.toLocaleString()}` : "no salary set"}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-cream-300/50">
              No human work logged yet. Upload a timesheet CSV (email, date, hours) or point a company-system
              connector at <span className="font-mono">POST /api/cost/human-work</span>.
            </div>
          )}
        </div>
      )}

      {/* Where time goes — the waste detector. Decomposes the window into agent
          runtime vs waiting-on-human vs logged human work, names the biggest
          sinks on each side, and gives a plain-language verdict. */}
      {timeA && timeA.totals.totalMs > 0 && (
        <div className="bg-ink-900 rounded-lg border p-4">
          <h2 className="font-semibold mb-1 flex items-center gap-2"><Hourglass className="w-4 h-4" /> Where time goes — last {timeA.days} days</h2>
          <p className="text-xs text-cream-300/60 mb-3">{timeA.verdict}</p>
          <div className="h-3 rounded-full overflow-hidden flex mb-2 bg-ink-950">
            <div className="bg-violet-500" style={{ width: `${timeA.totals.pct.agent}%` }} title={`Agent runtime ${timeA.totals.pct.agent}%`} />
            <div className="bg-amber-500" style={{ width: `${timeA.totals.pct.humanWait}%` }} title={`Waiting on humans ${timeA.totals.pct.humanWait}%`} />
            <div className="bg-leaf-500" style={{ width: `${timeA.totals.pct.humanWork}%` }} title={`Human work ${timeA.totals.pct.humanWork}%`} />
          </div>
          <div className="flex gap-4 text-xs text-cream-300/60 mb-4 flex-wrap">
            <span><span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1" />Agent runtime {timeA.totals.pct.agent}% ({fmtMs(timeA.totals.agentMs)})</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />Waiting on humans {timeA.totals.pct.humanWait}% ({fmtMs(timeA.totals.humanWaitMs + timeA.totals.openWaitMs)})</span>
            <span><span className="inline-block w-2 h-2 rounded-full bg-leaf-500 mr-1" />Human work {timeA.totals.pct.humanWork}% ({timeA.humanWorkHours}h)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {timeA.slowestAgentTypes.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-cream-200 mb-1.5">Slowest agent task types</div>
                {timeA.slowestAgentTypes.slice(0, 5).map(t => (
                  <div key={t.type} className="flex justify-between text-xs text-cream-300/60 py-0.5">
                    <span className="font-mono truncate">{t.type}</span><span className="shrink-0 ml-2">{fmtMs(t.ms)}</span>
                  </div>
                ))}
              </div>
            )}
            {timeA.longestWaits.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-cream-200 mb-1.5">Longest waits on a human</div>
                {timeA.longestWaits.slice(0, 5).map((w, i) => (
                  <div key={i} className="flex justify-between text-xs text-cream-300/60 py-0.5">
                    <span className="truncate">{w.open ? "⏳ " : ""}{w.title}</span><span className="shrink-0 ml-2">{fmtMs(w.waitMs)}{w.open ? " · still waiting" : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {summary?.byModel?.length > 0 && (
        <div className="bg-ink-900 rounded-lg border p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Cost by Model</h2>
          <div className="space-y-2">
            {summary.byModel.map((m: any) => (
              <div key={m.model} className="flex items-center justify-between">
                <span className="text-sm font-mono">{m.model}</span>
                <div className="flex gap-4 text-sm text-cream-300/60">
                  <span>${m.costUsd.toFixed(4)}</span>
                  <span>{m.calls} calls</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary?.byDay?.length > 0 && (
        <div className="bg-ink-900 rounded-lg border p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Calendar className="w-4 h-4" /> Cost by Day</h2>
          <div className="space-y-1">
            {summary.byDay.slice(-14).map((d: any) => (
              <div key={d.date} className="flex items-center justify-between text-sm">
                <span>{d.date}</span>
                <div className="flex gap-4 text-cream-300/60">
                  <span>${d.costUsd.toFixed(4)}</span>
                  <span>{d.calls} calls</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary?.recentCalls?.length > 0 && (
        <RecentCallsBlock summary={summary} />
      )}
    </div>
  );
}

function RecentCallsBlock({ summary }: { summary: any }) {
  return (
    <div className="bg-ink-900 rounded-lg border p-4">
      <h2 className="font-semibold mb-3">Recent Calls</h2>
      <div className="space-y-1 text-sm">
        {summary.recentCalls.slice(0, 20).map((c: any) => (
          <div key={`${c.jobId}-${c.ts}`} className="flex items-center justify-between border-b last:border-0 py-1">
            <div className="flex-1 min-w-0">
              <span className="font-mono text-xs truncate block">{c.model}</span>
              <span className="text-xs text-cream-300/50">{c.profile}</span>
            </div>
            <div className="flex gap-3 shrink-0 text-xs text-cream-300/60">
              <span title={`${c.inputTokens} in / ${c.outputTokens} out`}>⬆{c.inputTokens} ⬇{c.outputTokens}</span>
              <span>${c.costUsd.toFixed(6)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// "2h 15m" / "45m" / "30s" — coarse on purpose; this page is about proportions.
function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? ` ${m % 60}m` : ""}`;
}

// Timesheet CSV upload — the "uploads by users" path for human-work signals.
// Reads the file client-side and POSTs the raw CSV; the server parses loosely
// (email/date/hours headers) and reports per-row errors.
function TimesheetUpload({ onDone }: { onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      const csv = await f.text();
      const r = await api.addHumanWork({ csv, source: "upload" });
      setMsg(`${r.added} row${r.added === 1 ? "" : "s"} added${r.errors.length ? ` · ${r.errors.length} skipped` : ""}`);
      onDone();
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-[11px] text-cream-300/60">{msg}</span>}
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-xs rounded-lg border border-cream-100/15 hover:border-cream-100/30 px-3 py-1.5 text-cream-200 disabled:opacity-50"
        title="CSV with email, date (YYYY-MM-DD) and hours columns"
      >
        <Upload className="w-3.5 h-3.5" /> {busy ? "Uploading…" : "Upload timesheet CSV"}
      </button>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Timesheet CSV file" title="Timesheet CSV file" onChange={e => onFile(e.target.files?.[0])} />
    </div>
  );
}
