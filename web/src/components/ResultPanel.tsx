import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { marked } from "marked";
import { api } from "../lib/api";
import { Card } from "./Card";

export function ResultPanel({ job }: { job: any }) {
  if (!job) return null;
  if (job.status === "awaiting-approval") {
    return <Card title="Awaiting approval"><div className="text-sm text-cream-300">Open the Approvals page to approve or reject this task.</div></Card>;
  }
  if (job.status === "running" || job.status === "pending") {
    return <Card title={job.status === "pending" ? "Queued" : "Running"}>
      <div className="bg-ink-950 border border-ink-800 rounded-md p-3 max-h-72 overflow-auto scrollbar-thin">
        <pre className="text-[11px] font-mono text-cream-200 whitespace-pre-wrap">{(job.log ?? []).join("\n")}</pre>
      </div>
    </Card>;
  }
  if (job.status === "failed" || job.status === "rejected") {
    return <Card title={job.status === "rejected" ? "Rejected" : "Failed"}>
      <pre className="text-[11px] font-mono text-coral-400 whitespace-pre-wrap mb-2">{job.error}</pre>
      <details>
        <summary className="text-xs text-cream-300 cursor-pointer hover:text-cream-100">Log</summary>
        <pre className="text-[11px] font-mono text-cream-300 mt-2 bg-ink-950 border border-ink-800 rounded p-3 overflow-auto scrollbar-thin">{(job.log ?? []).join("\n")}</pre>
      </details>
    </Card>;
  }

  // Succeeded — render per template
  switch (job.template) {
    case "search-brain":   return <SearchBrainResult job={job} />;
    case "summarize-repo": return <SummarizeRepoResult job={job} />;
    case "add-note":       return <AddNoteResult job={job} />;
    case "run-digest":     return <RunDigestResult job={job} />;
    case "sync-downloads": return <SyncDownloadsResult job={job} />;
    case "publish-folder": return <PublishFolderResult job={job} />;
    case "general-task":   return <GeneralTaskResult job={job} />;
    default:               return <GenericResult job={job} />;
  }
}

function MetaRow({ job }: { job: any }) {
  const dur = job.finishedAt ? Math.max(1, Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)) : null;
  return (
    <div className="flex items-center gap-3 text-[11px] text-cream-300/60 mb-3 pb-3 border-b border-ink-800">
      <span className="text-leaf-400">●</span>
      <span>completed</span>
      <span>·</span>
      <span>{new Date(job.startedAt).toLocaleString()}</span>
      {dur && <><span>·</span><span>{dur}s</span></>}
      {job.rebased && <><span>·</span><span className="text-flame-400">rebased</span></>}
      {job.result?.pushed === false && <><span>·</span><span className="text-flame-400" title={String(job.result?.error ?? "")}>local-only (push failed)</span></>}
    </div>
  );
}

function SearchBrainResult({ job }: { job: any }) {
  const r = job.result ?? { results: [] };
  return (
    <Card title={`Search results · "${r.query}"`}>
      <MetaRow job={job} />
      {r.results.length === 0 ? (
        <div className="text-sm text-cream-300/60">No matches.</div>
      ) : (
        <ul className="space-y-2.5">
          {r.results.map((m: any, i: number) => (
            <li key={i}>
              <Link to={`/knowledge/${m.path}`} className="font-mono text-xs text-violet-400 hover:text-violet-500">{m.path}:{m.line}</Link>
              <div className="text-xs text-cream-200 mt-0.5">{m.preview}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SummarizeRepoResult({ job }: { job: any }) {
  const r = job.result ?? {};
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => { if (r.path) api.brainFile(r.path).then(d => setBody(d.content)).catch(() => setBody(null)); }, [r.path]);
  return (
    <Card title={`Project summary · ${job.inputs?.repo ?? ""}`}>
      <MetaRow job={job} />
      <div className="text-xs text-cream-300/60 mb-3">Saved to <Link to={`/knowledge/${r.path}`} className="text-violet-400 hover:text-violet-500 font-mono">{r.path}</Link></div>
      {body ? <div className="prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(body) as string }} /> : <div className="text-xs text-cream-300/60">Loading summary…</div>}
    </Card>
  );
}

function AddNoteResult({ job }: { job: any }) {
  const r = job.result ?? {};
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => { if (r.path) api.brainFile(r.path).then(d => setBody(d.content)).catch(() => setBody(null)); }, [r.path]);
  return (
    <Card title="Note captured">
      <MetaRow job={job} />
      <div className="text-xs text-cream-300/60 mb-3">Saved to <Link to={`/knowledge/${r.path}`} className="text-violet-400 hover:text-violet-500 font-mono">{r.path}</Link></div>
      {body && <div className="prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(body) as string }} />}
    </Card>
  );
}

function RunDigestResult({ job }: { job: any }) {
  const r = job.result ?? {};
  return (
    <Card title="Daily digest dispatched">
      <MetaRow job={job} />
      <div className="space-y-2 text-sm">
        <div>Lookback window: <span className="font-mono text-cream-100">{r.lookbackDays} days</span></div>
        <div className="text-cream-300/70">Workflow is running on GitHub Actions. Check the digest in <Link to="/knowledge/_clawbot" className="text-violet-400 hover:text-violet-500">Knowledge › _clawbot</Link> after the run finishes.</div>
        <a href="https://github.com/RUBIEM-DEVELOPERS-REPO/clawbot/actions" target="_blank" className="inline-block text-xs text-violet-400 hover:text-violet-500 mt-2">View on GitHub Actions →</a>
      </div>
    </Card>
  );
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function SyncDownloadsResult({ job }: { job: any }) {
  const r = job.result ?? { byCategory: {}, copiedThisRun: [], copyErrors: [] };
  const cats = Object.entries(r.byCategory ?? {}).sort((a: any, b: any) => b[1].length - a[1].length);
  return (
    <Card title="Downloads sync">
      <MetaRow job={job} />
      <div className="grid grid-cols-4 gap-3 mb-4">
        <Stat label="Total files" value={r.totalFiles} />
        <Stat label="Copied this run" value={(r.copiedThisRun ?? []).length} />
        <Stat label="Bytes copied" value={fmtBytes(r.bytesCopied ?? 0)} />
        <Stat label="Errors" value={(r.copyErrors ?? []).length} tone={(r.copyErrors ?? []).length > 0 ? "warn" : "ok"} />
      </div>
      <div className="text-[11px] text-cream-300/60 mb-3 font-mono">source: {r.source}</div>

      {(r.copiedThisRun ?? []).length > 0 && (
        <details className="mb-3" open>
          <summary className="text-xs text-cream-200 cursor-pointer">New / changed since last sync ({(r.copiedThisRun ?? []).length})</summary>
          <ul className="mt-2 max-h-48 overflow-auto scrollbar-thin">
            {(r.copiedThisRun ?? []).slice(0, 100).map((c: any, i: number) => (
              <li key={i} className="text-[11px] font-mono text-cream-300 py-0.5">{c.name} <span className="text-cream-300/50">· {fmtBytes(c.size)}</span></li>
            ))}
            {(r.copiedThisRun ?? []).length > 100 && <li className="text-[11px] text-cream-300/40 italic">…and {(r.copiedThisRun ?? []).length - 100} more</li>}
          </ul>
        </details>
      )}

      <div className="text-xs text-cream-200 mb-2">By category</div>
      <div className="space-y-1">
        {cats.map(([cat, items]: any) => (
          <div key={cat} className="flex items-center gap-3 text-xs">
            <span className="w-24 text-cream-300">{cat}</span>
            <div className="flex-1 h-1.5 bg-ink-800 rounded overflow-hidden">
              <div className="h-full bg-gradient-to-r from-violet-500 to-coral-500" style={{ width: `${Math.min(100, items.length / Math.max(1, r.totalFiles) * 100 * 4)}%` }} />
            </div>
            <span className="text-cream-300/60 font-mono w-12 text-right">{items.length}</span>
          </div>
        ))}
      </div>

      <Link to="/knowledge/_knowledge/downloads/inventory.md" className="inline-block text-xs text-violet-400 hover:text-violet-500 mt-4">Open inventory.md →</Link>
    </Card>
  );
}

function PublishFolderResult({ job }: { job: any }) {
  const r = job.result ?? {};
  return (
    <Card title="Folder published">
      <MetaRow job={job} />
      <div className="text-sm space-y-2">
        <div>Repository: <a href={`https://github.com/${r.repo}`} target="_blank" className="font-mono text-violet-400 hover:text-violet-500">{r.repo}</a></div>
        <div>Branch: <span className="font-mono text-cream-200">{r.branch}</span></div>
        <div>Visibility: <span className={r.public ? "text-flame-400" : "text-leaf-400"}>{r.public ? "public" : "private"}</span></div>
      </div>
    </Card>
  );
}

function GeneralTaskResult({ job, live = false }: { job: any; live?: boolean }) {
  const r = job.result ?? {};
  const phase = r.phase as string | undefined;
  const running = job.status === "running" || job.status === "pending";
  const steps: any[] = r.plan?.steps ?? [];
  const runs: any[] = r.runs ?? [];
  const totalSteps = steps.length;
  const doneCount = runs.filter(x => x?.ok === true).length;
  const inflightCount = runs.filter(x => x && x.startedAt && x.ok === false && !x.error).length;
  const title = running
    ? (phase === "planning"
        ? "Working out a plan…"
        : phase === "executing"
          ? (inflightCount > 1 ? `${inflightCount} sub-agents working in parallel` : "Working on the steps…")
          : phase === "synthesizing"
            ? "Writing your answer…"
            : phase === "answering"
              ? "Answering directly…"
              : "Working…")
    : (r.savedTemplateId ? "Done · saved as a shortcut" : "Done");

  // Group steps into "waves" so concurrent sub-agents render as a single row
  const waves: number[][] = (r.plan?.waves && r.plan.waves.length > 0)
    ? r.plan.waves
    : steps.map((_, i) => [i]);

  return (
    <Card title={title}>
      {!live && <MetaRow job={job} />}
      {r.plan?.summary && (
        <div className="text-sm text-cream-200 mb-3">
          <span className="text-[10px] uppercase tracking-wider text-cream-300/50 mr-2">Game plan</span>
          {r.plan.summary}
        </div>
      )}
      {totalSteps > 0 && (
        <>
          <div className="text-[11px] text-cream-300/60 mb-3">
            {running
              ? <>Tasks · <span className="text-cream-100">{doneCount}</span> of <span className="text-cream-100">{totalSteps}</span> done{inflightCount > 1 && <> · <span className="text-violet-400">{inflightCount} running together</span></>}</>
              : <>{totalSteps} {totalSteps === 1 ? "task" : "tasks"} completed</>}
          </div>
          <ol className="space-y-3 text-sm mb-4">
            {waves.map((ids, w) => {
              const isParallel = ids.length > 1;
              return (
                <li key={w}>
                  {isParallel && (
                    <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1.5 flex items-center gap-2">
                      <span className="inline-block w-1 h-3 bg-violet-500/70 rounded-sm" />
                      Sub-agents working together · {ids.length}
                    </div>
                  )}
                  <div className={isParallel ? "border-l-2 border-violet-500/30 pl-3 space-y-2" : "space-y-2"}>
                    {ids.map((i) => {
                      const s = steps[i];
                      if (!s) return null;
                      const run = runs[i];
                      const inflight = run?.startedAt && run.ok === false && !run.error;
                      const isDone = run?.ok === true;
                      const isFailed = !!run?.error;
                      const isPending = !inflight && !isDone && !isFailed;
                      const dot = isDone ? "bg-leaf-500" : isFailed ? "bg-coral-500" : inflight ? "bg-violet-500 animate-pulse" : "bg-cream-300/30";
                      const label = s.label || s.rationale || s.tool;
                      return (
                        <div key={i} className="flex items-start gap-3">
                          <span className={`inline-block w-2 h-2 rounded-full mt-2 flex-shrink-0 ${dot}`} />
                          <div className="flex-1 min-w-0 pb-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-cream-100">{label}</span>
                              {inflight && <span className="text-[10px] text-violet-400">working…</span>}
                              {isDone && run.durationMs != null && <span className="text-[10px] text-cream-300/40">{(run.durationMs / 1000).toFixed(1)}s</span>}
                              {isPending && <span className="text-[10px] text-cream-300/40">up next</span>}
                            </div>
                            {s.rationale && s.rationale !== label && <div className="text-xs text-cream-300/60 mt-0.5">{s.rationale}</div>}
                            {isFailed && <div className="text-xs text-coral-400 mt-1">✗ {run.error}</div>}
                            <details className="mt-1">
                              <summary className="text-[10px] text-cream-300/40 hover:text-cream-300/70 cursor-pointer select-none">technical detail</summary>
                              <div className="text-[11px] text-cream-300/60 font-mono mt-1 truncate">
                                {s.tool}({Object.entries(s.args ?? {}).map(([k, v]) => `${k}=${typeof v === "string" ? '"' + String(v).slice(0, 60) + '"' : JSON.stringify(v).slice(0, 60)}`).join(", ")})
                              </div>
                            </details>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {r.plan && totalSteps === 0 && phase === "answering" && (
        <div className="text-xs text-cream-300/60 italic">No tools needed for this — just answering directly.</div>
      )}
      {r.answer && (
        <div className="mt-2 pt-3 border-t border-ink-800">
          <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1">Answer</div>
          <div className="prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(r.answer) as string }} />
        </div>
      )}
      {r.savedTemplateId && (
        <div className="mt-3 text-xs text-leaf-400 bg-leaf-500/10 border border-leaf-500/30 rounded-md px-3 py-2">
          ✓ Saved as a one-click shortcut — find it in Templates › Custom.
        </div>
      )}
    </Card>
  );
}

function GenericResult({ job }: { job: any }) {
  return (
    <Card title="Result">
      <MetaRow job={job} />
      <pre className="text-[11px] font-mono text-cream-200 bg-ink-950 border border-ink-800 rounded p-3 overflow-auto scrollbar-thin max-h-72 whitespace-pre-wrap">{JSON.stringify(job.result, null, 2)}</pre>
    </Card>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: any; tone?: "default" | "ok" | "warn" }) {
  const color = tone === "warn" ? "text-coral-400" : tone === "ok" ? "text-leaf-400" : "text-cream-50";
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-md px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-cream-300/50">{label}</div>
      <div className={`font-display text-xl ${color}`}>{value ?? "—"}</div>
    </div>
  );
}
