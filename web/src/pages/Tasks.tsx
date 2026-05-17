import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { Card } from "../components/Card";
import { ResultPanel } from "../components/ResultPanel";

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
  const runningJobs = useMemo(() => jobs.filter(j => j.status === "running" || j.status === "pending"), [jobs]);

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-cream-50">Tasks</h1>
          <p className="text-sm text-cream-300/70 mt-1">Everything the workforce is doing — live.</p>
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

      {/* Live activity strip — only when something's actively running. The */}
      {/* row shows the customer's view of WHAT is happening, in plain English. */}
      {runningJobs.length > 0 && <LiveActivityStrip jobs={runningJobs} />}

      <div className="grid grid-cols-5 gap-5">
        <div className="col-span-2 space-y-2">
          {filtered.length === 0 && <Card><div className="text-sm text-cream-300/60 text-center py-8">No tasks {filter !== "all" && `with status "${filter}"`}.</div></Card>}
          {filtered.map(j => <TaskRow key={j.id} job={j} focused={focusId === j.id} onClick={() => { params.set("focus", j.id); setParams(params); }} />)}
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

// Plain-English phase label. Translates the agent's internal phase/state
// into something a customer would say if they were doing the work themselves.
function friendlyPhase(job: any): string {
  if (job.status === "succeeded") return "Done";
  if (job.status === "failed") return "Hit a snag";
  if (job.status === "rejected") return "Rejected";
  if (job.status === "awaiting-approval") return "Waiting for your approval";
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
function LiveActivityStrip({ jobs }: { jobs: any[] }) {
  const [, setParams] = useSearchParams();
  return (
    <div className="bg-violet-500/5 border border-violet-500/30 rounded-xl p-4">
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
          const pct = totalSteps > 0 ? Math.round((doneCount / totalSteps) * 100) : null;
          const peerName = r.peer?.name ?? r.delegatedPeer?.name ?? null;
          return (
            <button
              key={j.id}
              type="button"
              onClick={() => { const p = new URLSearchParams(); p.set("focus", j.id); setParams(p); }}
              className="text-left bg-ink-900 border border-ink-800 hover:border-violet-500/40 rounded-lg p-3 transition-colors"
            >
              <div className="text-sm text-cream-50 truncate">{friendlyTitle(j)}</div>
              <div className="text-[11px] text-cream-300/70 mt-1">{friendlyPhase(j)}</div>
              {pct != null && (
                <div className="mt-2 h-1 bg-ink-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-leaf-500 transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="flex items-center gap-2 mt-1.5 text-[10px] text-cream-300/50 flex-wrap">
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

function TaskRow({ job, focused, onClick }: { job: any; focused: boolean; onClick: () => void }) {
  const isRunning = job.status === "running" || job.status === "pending";
  const r = job.result ?? {};
  const runs: any[] = r.runs ?? [];
  const totalSteps = r.plan?.steps?.length ?? 0;
  const doneCount = runs.filter((x: any) => x?.ok === true).length;
  const startedAt = new Date(job.startedAt);
  const dur = job.finishedAt && job.startedAt
    ? Math.max(1, Math.round((new Date(job.finishedAt).getTime() - startedAt.getTime()) / 1000))
    : null;
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
            isRunning ? "bg-violet-500 animate-pulse" : "bg-cream-300/30"
          }`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-cream-50 font-medium truncate">{friendlyTitle(job)}</div>
            <div className="text-[11px] text-cream-300/70 mt-0.5">{friendlyPhase(job)}</div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-cream-300/50 flex-wrap">
              <span>{friendlyKind(job)}</span>
              {peerName && <><span>·</span><span>on {peerName}</span></>}
              {dur != null && <><span>·</span><span>{dur >= 60 ? `${Math.round(dur / 60)}m ${dur % 60}s` : `${dur}s`}</span></>}
              {totalSteps > 0 && isRunning && <><span>·</span><span>{doneCount}/{totalSteps}</span></>}
            </div>
          </div>
        </div>
        {!isRunning && isGeneral && job.status === "succeeded" && (
          <Link to={`/results/${job.id}`} onClick={e => e.stopPropagation()} className="text-[11px] text-violet-400 hover:text-violet-500 shrink-0 mt-0.5">Report →</Link>
        )}
      </div>
    </button>
  );
}
