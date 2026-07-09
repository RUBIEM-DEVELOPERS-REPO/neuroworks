import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, HandHelping } from "lucide-react";
import { api, type WaitingTask } from "../lib/api";
import { Card, SkeletonList } from "../components/Card";
import { ResultPanel } from "../components/ResultPanel";

type EtaStats = { byType: Record<string, { medianMs: number; count: number }>; globalMedianMs: number; count: number };

export function Tasks() {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("focus");
  const [jobs, setJobs] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | "running" | "succeeded" | "failed">("all");
  const [eta, setEta] = useState<EtaStats | null>(null);
  const [now, setNow] = useState(Date.now());
  const [waiting, setWaiting] = useState<WaitingTask[]>([]);

  async function load() {
    try { const r = await api.listJobs(); setJobs(r.jobs); } catch {} finally { setLoaded(true); }
  }
  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i); }, []);
  // ETA history refreshes lazily — it barely changes between polls.
  useEffect(() => { api.taskEtaStats().then(setEta).catch(() => {}); const i = setInterval(() => api.taskEtaStats().then(setEta).catch(() => {}), 30000); return () => clearInterval(i); }, []);
  // Waiting-on-you queue — tasks paused on a structured human ask. Polled at a
  // relaxed cadence; answering one triggers an immediate refresh.
  const loadWaiting = () => api.tasksWaiting().then(r => setWaiting(r.waiting)).catch(() => {});
  useEffect(() => { loadWaiting(); const i = setInterval(loadWaiting, 10000); return () => clearInterval(i); }, []);

  const filtered = useMemo(() => filter === "all" ? jobs : jobs.filter(j => j.status === filter), [jobs, filter]);
  const focused = focusId ? jobs.find(j => j.id === focusId) : null;
  const runningJobs = useMemo(() => jobs.filter(j => j.status === "running" || j.status === "pending"), [jobs]);

  // Tick a 1s clock ONLY while something is running, so the elapsed time and
  // ETA countdown update live without re-polling the server.
  useEffect(() => {
    if (runningJobs.length === 0) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [runningJobs.length]);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-cream-50">Tasks</h1>
          <p className="text-sm text-cream-300/70 mt-1">Everything the workforce is doing, live.</p>
        </div>
        <div className="flex gap-1">
          {(["all", "running", "succeeded", "failed"] as const).map(f => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs ${filter === f ? "bg-ink-800 text-cream-50 border border-ink-700" : "text-cream-300 hover:text-cream-100"}`}>
              {f}
              <span className="ml-1.5 opacity-60 font-mono">{f === "all" ? jobs.length : jobs.filter(j => j.status === f).length}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Waiting on you — tasks the agents paused because only the operator can
          supply the next piece (info, approval, an offline action). Answering
          resumes the loop automatically as a continuation task. */}
      {waiting.length > 0 && <WaitingOnYouPanel waiting={waiting} onResumed={(newJobId) => { loadWaiting(); load(); params.set("focus", newJobId); setParams(params); }} />}

      {/* Live activity strip — only when something's actively running. The */}
      {/* row shows the customer's view of WHAT is happening, in plain English. */}
      {runningJobs.length > 0 && <LiveActivityStrip jobs={runningJobs} eta={eta} now={now} />}

      <div className="grid grid-cols-5 gap-5">
        <div className="col-span-2 space-y-2">
          {!loaded && <Card><SkeletonList rows={6} /></Card>}
          {loaded && filtered.length === 0 && <Card><div className="text-sm text-cream-300/60 text-center py-8">No tasks {filter !== "all" && `with status "${filter}"`}.</div></Card>}
          {filtered.map((j, i) => <div key={j.id} className={`nw-fade-up nw-delay-${Math.min(7, i + 1)}`}><TaskRow job={j} focused={focusId === j.id} eta={eta} now={now} onClick={() => { params.set("focus", j.id); setParams(params); }} /></div>)}
        </div>

        <div className="col-span-3">
          {focused ? <ResultPanel job={focused} /> : (
            <Card><div className="text-sm text-cream-300/60 text-center py-8">Pick a task to inspect it.</div></Card>
          )}
        </div>
      </div>
    </div>
  );
}

// "Waiting on you" — each paused task renders its structured ask as real
// inputs. approval → an Approve button (records "Approved"); everything else →
// a text box. Submitting resumes the loop server-side (continuation job) and
// focuses it so the operator watches the task pick back up.
function WaitingOnYouPanel({ waiting, onResumed }: { waiting: WaitingTask[]; onResumed: (newJobId: string) => void }) {
  return (
    <div className="space-y-3">
      {waiting.map(w => <WaitingCard key={w.id} w={w} onResumed={onResumed} />)}
    </div>
  );
}

function WaitingCard({ w, onResumed }: { w: WaitingTask; onResumed: (newJobId: string) => void }) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const waitedMin = Math.max(0, Math.round((Date.now() - new Date(w.waitingSince).getTime()) / 60000));
  const waitedLabel = waitedMin < 60 ? `${waitedMin}m` : waitedMin < 60 * 24 ? `${Math.round(waitedMin / 60)}h` : `${Math.round(waitedMin / 1440)}d`;
  const answered = w.items.filter((_, i) => (values[i] ?? "").trim().length > 0).length;

  const submit = async () => {
    const responses = w.items
      .map((it, i) => ({ prompt: it.prompt, response: (values[i] ?? "").trim() }))
      .filter(r => r.response.length > 0);
    if (responses.length === 0) { setError("Answer at least one item first."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.submitHumanInput(w.id, responses);
      onResumed(r.jobId);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <HandHelping className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-cream-50 truncate">Waiting on you — {w.title}</div>
            <div className="text-xs text-cream-300/60">
              {w.persona ? `${w.persona} · ` : ""}paused {waitedLabel} ago{w.reason ? ` · ${w.reason}` : ""}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || answered === 0}
          className="shrink-0 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 px-3 py-1.5 text-xs font-semibold text-ink-900"
        >
          {submitting ? "Resuming…" : `Send & continue${answered > 0 ? ` (${answered}/${w.items.length})` : ""}`}
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {w.items.map((it, i) => (
          <div key={i}>
            <div className="text-xs text-cream-200 mb-1">
              {i + 1}. {it.prompt}
              {it.type !== "answer" && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-400/80">{it.type}</span>}
            </div>
            {it.type === "approval" ? (
              <button
                type="button"
                onClick={() => setValues(v => ({ ...v, [i]: v[i] ? "" : "Approved" }))}
                className={`rounded-md px-3 py-1 text-xs border ${values[i] ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-300" : "border-cream-100/20 text-cream-300 hover:text-cream-100"}`}
              >
                {values[i] ? "✓ Approved" : "Approve"}
              </button>
            ) : (
              <textarea
                value={values[i] ?? ""}
                onChange={e => setValues(v => ({ ...v, [i]: e.target.value }))}
                rows={values[i] && values[i].length > 120 ? 3 : 1}
                placeholder={it.type === "upload" ? "Paste the content here (or a vault/file path)" : it.type === "action" ? "What was done / the outcome" : "Your answer"}
                className="w-full rounded-md bg-ink-900/70 border border-cream-100/10 focus:border-amber-500/50 outline-none px-3 py-1.5 text-xs text-cream-100 placeholder:text-cream-300/40 resize-y"
              />
            )}
          </div>
        ))}
      </div>
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}

// Stable type key matching the server's jobTypeKey() so a running job looks up
// the right historical median (strip any "prefix:" from kind; prefer template).
function jobTypeKey(job: any): string {
  const raw = (job.template && String(job.template).trim()) ? String(job.template) : String(job.kind ?? "");
  return raw.replace(/^[^:]+:/, "") || "task";
}

// mm:ss for anything ≥ a minute, else "45s". Compact for chips/rows.
function fmtDur(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m${s ? ` ${s}s` : ""}`;
}

type EtaInfo = { elapsedSec: number; expectedSec: number | null; remainingSec: number | null; overrun: boolean; pct: number | null; label: string };

// Compute a live ETA for a running job from elapsed time + the historical
// median for its type. Falls back to the global median when the type has too
// few samples, and to elapsed-only when there's no history at all. `stepPct`
// (from the plan's completed steps) is preferred for the bar when available —
// it reflects real progress — with time used as the fallback signal.
function computeEta(job: any, eta: EtaStats | null, now: number, stepPct: number | null): EtaInfo {
  const startedMs = job.startedAt ? new Date(job.startedAt).getTime() : now;
  const elapsedSec = Math.max(0, (now - startedMs) / 1000);
  const typeStat = eta?.byType?.[jobTypeKey(job)];
  // Trust a per-type median once it has ≥2 samples; otherwise use the global.
  const expectedMs = typeStat && typeStat.count >= 2 ? typeStat.medianMs
    : (eta?.globalMedianMs && eta.globalMedianMs > 0 ? eta.globalMedianMs : null);
  const expectedSec = expectedMs != null ? expectedMs / 1000 : null;
  const remainingSec = expectedSec != null ? Math.max(0, expectedSec - elapsedSec) : null;
  const overrun = expectedSec != null && elapsedSec > expectedSec + 1;
  const timePct = expectedSec != null ? Math.min(99, Math.round((elapsedSec / expectedSec) * 100)) : null;
  const pct = stepPct != null ? stepPct : timePct;
  let label: string;
  if (expectedSec == null) label = `running ${fmtDur(elapsedSec)}`;
  else if (overrun) label = `running ${fmtDur(elapsedSec)} · a bit longer than usual`;
  else label = `${fmtDur(elapsedSec)} elapsed · ~${fmtDur(remainingSec!)} left`;
  return { elapsedSec, expectedSec, remainingSec, overrun, pct, label };
}

// Plain-English phase label. Translates the agent's internal phase/state
// into something a customer would say if they were doing the work themselves.
function friendlyPhase(job: any): string {
  if (job.status === "succeeded") return "Done";
  if (job.status === "failed") {
    // Classify the failure shape from the error text so the user sees what
    // KIND of problem it was (transient vs auth vs vault-unreachable vs
    // unsupported) rather than the cryptic "Hit a snag". The full error
    // stays below in the technical view; this label scopes the retry choice.
    const e = String(job.error ?? "").toLowerCase();
    const hasPartial = typeof job.result?.answer === "string" && job.result.answer.trim().length > 0;
    if (hasPartial) return "Finished with partial results";
    if (!e) return "Couldn't complete this task";
    if (/vault.*unreach|vaultpath|mkdir.*enoent|d:\\\\main brain/.test(e)) return "Couldn't reach your vault";
    if (/\b(?:401|403|unauthori[sz]ed|forbidden|api key|missing.*token)\b/.test(e)) return "Authorisation problem";
    if (/\b(?:econnreset|etimedout|enotfound|eai_again|fetch failed|socket hang up|timeout)\b/.test(e)) return "Network hiccup, retry";
    if (/\b(?:429|rate.?limit|too many requests)\b/.test(e)) return "Rate-limited";
    if (/cannot read properties of undefined/.test(e)) return "Internal error, retry";
    if (/no such tool|invalid tool|unknown tool/.test(e)) return "Couldn't route this, try rephrasing";
    return "Couldn't complete this task";
  }
  if (job.status === "rejected") return "Rejected";
  if (job.status === "awaiting-approval") return "Waiting for your approval";
  if (job.status === "waiting_on_human") return "Paused — needs something from you (see the amber card above)";
  if (job.status !== "running" && job.status !== "pending") return job.status;
  const r = job.result ?? {};
  const phase = r.phase as string | undefined;
  const totalSteps = r.plan?.steps?.length ?? 0;
  const runs: any[] = r.runs ?? [];
  const doneCount = runs.filter((x: any) => x?.ok === true).length;
  const inflightCount = runs.filter((x: any) => x && x.startedAt && x.ok === false && !x.error).length;
  if (phase === "planning") return "Working out a plan";
  if (phase === "executing") {
    if (inflightCount > 1) return `${inflightCount} sub-agents working in parallel`;
    if (totalSteps > 0) return `On step ${doneCount + 1} of ${totalSteps}`;
    return "Working on it";
  }
  if (phase === "synthesizing") return "Drafting your answer";
  if (phase === "reviewing") return "Reviewing the draft";
  if (phase === "answering") return "Answering directly";
  return "Working on it";
}

// What kind of work is this? Used in the list row + activity strip so the
// user sees "Research" / "Chat task" / "Daily digest" instead of the raw
// `kind` ("insights:general-task").
function friendlyKind(job: any): string {
  const t = String(job.template ?? job.kind ?? "");
  if (t.startsWith("custom-")) return "Saved template";
  if (t === "general-task" || t.endsWith(":general-task")) return "Chat task";
  if (t === "peer:delegate") return "Delegated work";
  if (t === "summarize-repo" || t.endsWith(":summarize-repo")) return "Project summary";
  if (t === "search-brain" || t.endsWith(":search-brain")) return "Vault search";
  if (t === "add-note" || t.endsWith(":add-note")) return "Note capture";
  if (t === "run-digest" || t.endsWith(":run-digest")) return "Daily digest";
  if (t === "sync-downloads" || t.endsWith(":sync-downloads")) return "Downloads sync";
  if (t === "publish-folder" || t.endsWith(":publish-folder")) return "Folder publish";
  if (t === "browse-vault" || t.endsWith(":browse-vault")) return "Vault browse";
  return t || "Task";
}

function friendlyTitle(job: any): string {
  const t = (job.title ?? "").replace(/^Ad-hoc:\s*/i, "").trim();
  return t || friendlyKind(job);
}

// Compact horizontal strip at the top of the page showing every running
// task with its live phase + step count. Lets a customer glance at the page
// and immediately know "the workforce is doing X right now". Each card
// links to the detail panel below.
function LiveActivityStrip({ jobs, eta, now }: { jobs: any[]; eta: EtaStats | null; now: number }) {
  const [, setParams] = useSearchParams();
  return (
    <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
        <span className="text-[10px] uppercase tracking-wider text-violet-300/80">Working now</span>
        <span className="text-[11px] text-cream-300/60">{jobs.length} active task{jobs.length === 1 ? "" : "s"}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {jobs.map(j => {
          const r = j.result ?? {};
          const totalSteps = r.plan?.steps?.length ?? 0;
          const runs: any[] = r.runs ?? [];
          const doneCount = runs.filter((x: any) => x?.ok === true).length;
          const stepPct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : null;
          const peerName = r.peer?.name ?? r.delegatedPeer?.name ?? null;
          const info = computeEta(j, eta, now, stepPct);
          return (
            <button
              key={j.id}
              type="button"
              onClick={() => { const p = new URLSearchParams(); p.set("focus", j.id); setParams(p); }}
              className="text-left bg-ink-900 border border-ink-800 hover:border-violet-500/40 rounded-lg p-3 transition-colors"
            >
              <div className="text-sm text-cream-50 truncate">{friendlyTitle(j)}</div>
              <div className="text-[11px] text-cream-300/70 mt-1">{friendlyPhase(j)}</div>
              {info.pct != null && (
                <div className="mt-2 h-1 bg-ink-800 rounded-full overflow-hidden">
                  <div className={`h-full transition-all ${info.overrun ? "bg-amber-500/80" : "bg-gradient-to-r from-violet-500 to-leaf-500"}`} style={{ width: `${info.pct}%` }} />
                </div>
              )}
              <div className={`mt-1.5 text-[10px] ${info.overrun ? "text-amber-300/90" : "text-violet-300/80"}`}>{info.label}</div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-cream-300/50 flex-wrap">
                <span>{friendlyKind(j)}</span>
                {peerName && <><span>·</span><span>on {peerName}</span></>}
                {totalSteps > 0 && <><span>·</span><span>{doneCount}/{totalSteps} done</span></>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TaskRow({ job, focused, eta, now, onClick }: { job: any; focused: boolean; eta: EtaStats | null; now: number; onClick: () => void }) {
  const isRunning = job.status === "running" || job.status === "pending";
  const r = job.result ?? {};
  const runs: any[] = r.runs ?? [];
  const totalSteps = r.plan?.steps?.length ?? 0;
  const doneCount = runs.filter((x: any) => x?.ok === true).length;
  const startedAt = new Date(job.startedAt);
  const dur = job.finishedAt && job.startedAt
    ? Math.max(1, Math.round((new Date(job.finishedAt).getTime() - startedAt.getTime()) / 1000))
    : null;
  const stepPct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : null;
  const info = isRunning ? computeEta(job, eta, now, stepPct) : null;
  const peerName = r.peer?.name ?? r.delegatedPeer?.name ?? null;
  const isGeneral = job.template === "general-task" || (job.template ?? "").startsWith("custom-") || job.template === "peer:delegate";
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left bg-ink-900 border rounded-xl p-4 transition-colors ${focused ? "border-violet-500/60" : "border-ink-800 hover:border-ink-700"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
            job.status === "succeeded" ? "bg-leaf-500" :
            job.status === "failed" || job.status === "rejected" ? "bg-coral-500" :
            job.status === "waiting_on_human" ? "bg-amber-400" :
            isRunning ? "bg-violet-500 animate-pulse" : "bg-cream-300/30"
          }`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-cream-50 font-medium truncate">{friendlyTitle(job)}</div>
            <div className="text-[11px] text-cream-300/70 mt-0.5">{friendlyPhase(job)}</div>
            {info && (
              <div className="mt-1.5">
                {info.pct != null && (
                  <div className="h-1 bg-ink-800 rounded-full overflow-hidden mb-1">
                    <div className={`h-full transition-all ${info.overrun ? "bg-amber-500/80" : "bg-gradient-to-r from-violet-500 to-leaf-500"}`} style={{ width: `${info.pct}%` }} />
                  </div>
                )}
                <div className={`text-[10px] ${info.overrun ? "text-amber-300/90" : "text-violet-300/80"}`}>{info.label}</div>
              </div>
            )}
            <div className="flex items-center gap-2 mt-1 text-[10px] text-cream-300/50 flex-wrap">
              <span>{friendlyKind(job)}</span>
              {peerName && <><span>·</span><span>on {peerName}</span></>}
              {dur != null && <><span>·</span><span>{dur >= 60 ? `${Math.round(dur / 60)}m ${dur % 60}s` : `${dur}s`}</span></>}
              {totalSteps > 0 && isRunning && <><span>·</span><span>{doneCount}/{totalSteps}</span></>}
            </div>
          </div>
        </div>
        {!isRunning && isGeneral && job.status === "succeeded" && (
          <Link to={`/results/${job.id}`} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-500 shrink-0 mt-0.5">
            Report <ArrowRight size={11} />
          </Link>
        )}
      </div>
    </button>
  );
}
