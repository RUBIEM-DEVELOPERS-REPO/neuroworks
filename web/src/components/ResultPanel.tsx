import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { marked } from "marked";
import { api } from "../lib/api";
import { Card } from "./Card";
import { TraceView } from "./TraceView";
import { LinkPreview } from "./LinkPreview";

export function ResultPanel({ job }: { job: any }) {
  if (!job) return null;
  if (job.status === "awaiting-approval") {
    return <Card title="Awaiting approval"><div className="text-sm text-cream-300">Open the Approvals page to approve or reject this task.</div></Card>;
  }
  if (job.status === "running" || job.status === "pending") {
    return <Card title={job.status === "pending" ? "Queued" : "Running"}>
      <div className="flex items-center gap-2 text-[11px] text-violet-300 mb-3">
        <span className="nw-thinking-dots text-violet-400"><span /><span /><span /></span>
        <span>{job.status === "pending" ? "Waiting for a free agent" : "Agent is thinking"}</span>
        <div className="flex-1 h-1 bg-ink-850 rounded nw-thinking-bar" />
      </div>
      <TraceView job={job} />
    </Card>;
  }
  if (job.status === "failed" || job.status === "rejected") {
    return <Card title={job.status === "rejected" ? "Rejected" : "Failed"}>
      <pre className="text-[11px] font-mono text-coral-400 whitespace-pre-wrap mb-2">{job.error}</pre>
      <TraceView job={job} />
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
  const isGeneralOrCustom = job.template === "general-task" || (job.template ?? "").startsWith("custom-");
  return (
    <div className="flex items-center gap-3 text-[11px] text-cream-300/60 mb-3 pb-3 border-b border-ink-800 flex-wrap">
      <span className="text-leaf-400">●</span>
      <span>completed</span>
      <span>·</span>
      <span>{new Date(job.startedAt).toLocaleString()}</span>
      {dur && <><span>·</span><span>{dur}s</span></>}
      {job.rebased && <><span>·</span><span className="text-flame-400">rebased</span></>}
      {job.result?.pushed === false && <><span>·</span><span className="text-flame-400" title={String(job.result?.error ?? "")}>local-only (push failed)</span></>}
      <FeedbackThumbs job={job} />
      {job.status === "succeeded" && typeof job.result?.answer === "string" && job.result.answer.trim().length > 0 && (
        <>
          <QualityFlagControl job={job} />
          <DownloadAnswerMenu job={job} />
        </>
      )}
      {isGeneralOrCustom && job.status === "succeeded" && (
        <Link to={`/results/${job.id}`} className="text-violet-400 hover:text-violet-500 underline">Open polished report →</Link>
      )}
    </div>
  );
}

// Download the job's answer markdown as PDF / Word / Markdown. Hits the
// /api/exports/* endpoints; the response is the file bytes, surfaced to the
// browser via a Blob URL so the file name + content-type come through clean.
function DownloadAnswerMenu({ job }: { job: any }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const filename = (job.title ?? job.template ?? "report").toLowerCase().replace(/[^a-z0-9.-]+/g, "-").slice(0, 60) || "report";
  async function download(format: "pdf" | "docx" | "markdown") {
    if (busy) return;
    setBusy(format);
    try {
      const r = await fetch(`/api/exports/${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markdown: job.result?.answer ?? "",
          title: job.title ?? undefined,
          filename: `${filename}.${format === "markdown" ? "md" : format}`,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${filename}.${format === "markdown" ? "md" : format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(a.href);
      setOpen(false);
    } catch { /* swallow — UI just stays open */ }
    finally { setBusy(null); }
  }
  return (
    <span className="ml-auto relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-cream-300/70 hover:text-cream-100 px-1.5 py-0.5 rounded hover:bg-ink-800 inline-flex items-center gap-1"
      >⬇ Download</button>
      {open && (
        <span className="absolute right-0 top-full mt-1 bg-ink-900 border border-ink-700 rounded shadow-lg overflow-hidden z-20 min-w-[160px] flex flex-col text-[11px]">
          {[{ k: "pdf", l: "PDF (.pdf)" }, { k: "docx", l: "Word (.docx)" }, { k: "markdown", l: "Markdown (.md)" }].map(o => (
            <button
              key={o.k}
              type="button"
              onClick={() => download(o.k as any)}
              disabled={!!busy}
              className="text-left px-3 py-2 text-cream-200 hover:bg-ink-800 disabled:opacity-50"
            >{busy === o.k ? "Preparing…" : o.l}</button>
          ))}
        </span>
      )}
    </span>
  );
}

// Operator outcome feedback. One click writes a JSONL row into the vault at
// `_neuroworks/feedback.jsonl`; the nightly reflection and any future grader
// calibration can use it as the human truth anchor (closes the 0.822 ↔ 0.824
// run-to-run grader-noise problem we measured — model graders need a fixed
// point to calibrate against, and that fixed point is human thumbs).
function FeedbackThumbs({ job }: { job: any }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);
  const nav = useNavigate();
  useEffect(() => {
    let alive = true;
    api.getFeedback(job.id).then(r => { if (alive) setRating(r.feedback?.rating ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [job.id]);
  async function send(next: "up" | "down") {
    if (busy) return;
    setBusy(true);
    try {
      await api.postFeedback({
        jobId: job.id,
        rating: next,
        note: note.trim() || undefined,
        persona: job.personaName,
        template: job.template,
        score: job.result?.quality?.score,
      });
      setRating(next);
      setNoteOpen(false);
      setNote("");
    } catch { /* swallow — UI will retry on next click */ }
    finally { setBusy(false); }
  }
  return (
    <span className="ml-auto flex items-center gap-1">
      <button
        type="button"
        onClick={() => send("up")}
        disabled={busy}
        className={`px-1.5 py-0.5 rounded ${rating === "up" ? "bg-leaf-500/20 text-leaf-300" : "hover:bg-ink-800 text-cream-300/70"}`}
        title="Good answer"
      >👍</button>
      <button
        type="button"
        onClick={() => { setNoteOpen(true); }}
        disabled={busy}
        className={`px-1.5 py-0.5 rounded ${rating === "down" ? "bg-coral-500/20 text-coral-300" : "hover:bg-ink-800 text-cream-300/70"}`}
        title="Mark as needs work"
      >👎</button>
      {noteOpen && (
        <span className="flex items-center gap-1 ml-1">
          <input
            autoFocus
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="why? (optional)"
            className="bg-ink-950 border border-ink-800 rounded px-1.5 py-0.5 text-[11px] text-cream-100 w-44"
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); send("down"); } if (e.key === "Escape") setNoteOpen(false); }}
          />
          <button type="button" onClick={() => send("down")} disabled={busy} className="px-1.5 py-0.5 rounded bg-coral-500/15 text-coral-300 hover:bg-coral-500/25">save</button>
        </span>
      )}
      {rating === "down" && !noteOpen && (
        <button
          type="button"
          onClick={async () => {
            if (retrying) return;
            setRetrying(true); setRetryErr(null);
            try {
              const r = await api.retryFromFeedback(job.id);
              nav(`/results/${r.newJobId}`);
            } catch (e: any) {
              setRetryErr(e?.message ?? String(e));
            } finally { setRetrying(false); }
          }}
          disabled={retrying}
          title="Relaunch the task with your feedback note as guidance"
          className="ml-1 px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50 inline-flex items-center gap-1"
        >↻ {retrying ? "Retrying…" : "Retry with this feedback"}</button>
      )}
      {retryErr && <span className="ml-1 text-coral-400" title={retryErr}>retry failed</span>}
    </span>
  );
}

// QA/review-facing flag — distinct from FeedbackThumbs above (which is the
// task-level "this specific run was wrong, retry with a note" loop).
// Quality flags feed the Quality Dashboard's trend/category rollups and
// (with `language` set) the native-speaker review process for Shona/Ndebele
// output: /api/quality/flag writes to _neuroworks/quality.jsonl, previously
// dead code with no caller anywhere in the web app.
const QUALITY_CATEGORIES = ["accuracy", "relevance", "tone", "completeness", "formatting", "localization", "other"] as const;
function QualityFlagControl({ job }: { job: any }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [rating, setRating] = useState<"up" | "down">("down");
  const [category, setCategory] = useState<(typeof QUALITY_CATEGORIES)[number]>("localization");
  const [language, setLanguage] = useState<"" | "en" | "sn" | "nd">("");
  const [note, setNote] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      await api.submitQualityFlag({
        jobId: job.id,
        rating,
        category,
        language: language || undefined,
        note: note.trim() || undefined,
        persona: job.personaName,
        template: job.template,
        score: job.result?.quality?.score,
      });
      setSent(true);
      setOpen(false);
    } catch { /* swallow — operator can retry */ }
    finally { setBusy(false); }
  }

  if (sent) return <span className="text-[11px] text-cream-300/50 inline-flex items-center gap-1">✓ flagged for review</span>;

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[11px] text-cream-300/70 hover:text-cream-100 px-1.5 py-0.5 rounded hover:bg-ink-800"
        title="Flag this output for QA review — e.g. local-language quality that needs a native-speaker pass"
      >🚩 Flag for review</button>
      {open && (
        <span className="absolute right-0 top-full mt-1 bg-ink-900 border border-ink-700 rounded shadow-lg z-20 min-w-[220px] p-2.5 flex flex-col gap-1.5 text-[11px]">
          <span className="flex items-center gap-1.5">
            <button type="button" onClick={() => setRating("down")} className={`flex-1 px-2 py-1 rounded ${rating === "down" ? "bg-coral-500/20 text-coral-300" : "bg-ink-800 text-cream-300/70"}`}>needs work</button>
            <button type="button" onClick={() => setRating("up")} className={`flex-1 px-2 py-1 rounded ${rating === "up" ? "bg-leaf-500/20 text-leaf-300" : "bg-ink-800 text-cream-300/70"}`}>good example</button>
          </span>
          <select value={category} onChange={e => setCategory(e.target.value as any)} title="Flag category" className="bg-ink-950 border border-ink-800 rounded px-1.5 py-1 text-cream-100">
            {QUALITY_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={language} onChange={e => setLanguage(e.target.value as any)} title="Language observed in this output" className="bg-ink-950 border border-ink-800 rounded px-1.5 py-1 text-cream-100">
            <option value="">language observed (optional)</option>
            <option value="en">English</option>
            <option value="sn">chiShona</option>
            <option value="nd">isiNdebele</option>
          </select>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="what's wrong / worth noting? (optional)"
            className="bg-ink-950 border border-ink-800 rounded px-1.5 py-1 text-cream-100 placeholder:text-cream-300/40"
            onKeyDown={e => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
          />
          <button type="button" onClick={submit} disabled={busy} className="px-2 py-1 rounded bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 disabled:opacity-50">
            {busy ? "Submitting…" : "Submit flag"}
          </button>
        </span>
      )}
    </span>
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
        <a href="https://github.com/RUBIEM-DEVELOPERS-REPO/neuroworks/actions" target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-violet-400 hover:text-violet-500 mt-2">View on GitHub Actions →</a>
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
              <div className="h-full bg-gradient-to-r from-violet-500 to-coral-500 dyn-width" style={{ "--dyn-w": `${Math.min(100, items.length / Math.max(1, r.totalFiles) * 100 * 4)}%` } as React.CSSProperties} />
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
      {!live && <TraceBlock job={job} />}
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
                    <div className="flex items-center gap-2 mb-1.5 px-2 py-1 bg-violet-500/8 border border-violet-500/20 rounded text-[10px] uppercase tracking-wider text-violet-300/80">
                      Sub-agents working together, {ids.length}
                    </div>
                  )}
                  <div className={isParallel ? "bg-violet-500/5 rounded px-3 py-2 space-y-2" : "space-y-2"}>
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
                              {isDone && run.modelUsed && <span className="text-[10px] text-violet-400/70 font-mono" title="Model used by the router">{run.modelUsed}</span>}
                              {isPending && <span className="text-[10px] text-cream-300/40">up next</span>}
                            </div>
                            {s.rationale && s.rationale !== label && <div className="text-xs text-cream-300/60 mt-0.5">{s.rationale}</div>}
                            {isFailed && <div className="text-xs text-coral-400 mt-1">✗ {run.error}</div>}
                            {isDone && <StepResultPreview tool={s.tool} result={run.result} />}
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
      {r.delegated && r.peer && (
        <div className="mt-3 mb-1 text-[11px] bg-violet-500/5 border border-violet-500/30 rounded-md px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wider text-violet-300/80">Delegated to</span>
          <span className="text-cream-100 font-medium">{r.peer.name ?? r.peer.url}</span>
          {r.peer.model && <span className="text-cream-300/60 font-mono">({r.peer.model})</span>}
          {r.elapsedMs && <span className="text-cream-300/50">· {(r.elapsedMs / 1000).toFixed(1)}s round-trip</span>}
        </div>
      )}
      {r.budgets && (
        <div className="mt-3 mb-1 text-[11px] bg-leaf-500/5 border border-leaf-500/30 rounded-md px-3 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-leaf-300/80">Sub-agent spin-up</span>
            <span className="text-cream-200">I/O lane <span className="font-mono text-cream-50">{r.budgets.io}</span></span>
            <span className="text-cream-300/40">·</span>
            <span className="text-cream-200">LLM lane <span className="font-mono text-cream-50">{r.budgets.llm}</span></span>
            {r.budgets.idlePeers > 0 && (
              <>
                <span className="text-cream-300/40">·</span>
                <span className="text-leaf-400">+{r.budgets.idlePeers} idle peer{r.budgets.idlePeers === 1 ? "" : "s"}</span>
              </>
            )}
            {Array.isArray(r.subagentTimings) && r.subagentTimings.length > 0 && (
              <span className="ml-auto text-cream-300/50 font-mono">{(r.subagentTimings.reduce((a: number, t: any) => a + t.elapsedMs, 0) / 1000).toFixed(1)}s total</span>
            )}
          </div>
          {Array.isArray(r.subagentTimings) && r.subagentTimings.some((t: any) => t.ioCount + t.llmCount > 1) && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[10px] text-cream-300/60">
              {r.subagentTimings.map((t: any, i: number) => (
                <span key={i} className="font-mono">
                  W{t.wave}: {(t.elapsedMs / 1000).toFixed(1)}s
                  <span className="text-cream-300/40"> ({t.ioCount}io+{t.llmCount}llm)</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {(r.answer || r.partialAnswer) && (
        <div className="mt-2 pt-3 border-t border-ink-800">
          <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1 flex items-center gap-2">
            <span>Answer</span>
            {!r.answer && r.partialAnswer && (
              <span className="inline-flex items-center gap-1 text-violet-400">
                <span className="inline-block w-1 h-1 rounded-full bg-violet-500 animate-pulse" />
                <span className="text-[9px] uppercase tracking-wider">streaming</span>
              </span>
            )}
          </div>
          <div className="prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(r.answer ?? r.partialAnswer ?? "") as string }} />
        </div>
      )}
      {(r.review || r.quality || r.security || r.curation) && (
        <div className="mt-3 pt-3 border-t border-ink-800 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-cream-300/50">QA gate</div>
          {r.quality && <QualityBlock quality={r.quality} />}
          {r.security && <SecurityBlock security={r.security} />}
          {r.review && <PeerReviewInner review={r.review} />}
          {r.curation && <CurationBlock curation={r.curation} />}
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

function PeerReviewInner({ review }: { review: any }) {
  const verdict = review.verdict as "good" | "needs-work" | "bad";
  // Grader pastel palette: pass is quiet (low chroma), fail asserts itself.
  // Static class strings so Tailwind's JIT picks them up.
  const palette = verdict === "good"
    ? { dot: "bg-leaf-500", border: "border-leaf-500/20", bg: "bg-ink-850", text: "text-leaf-400" }
    : verdict === "bad"
      ? { dot: "bg-coral-500", border: "border-coral-500/40", bg: "bg-coral-500/8", text: "text-coral-300" }
      : { dot: "bg-flame-500", border: "border-flame-500/40", bg: "bg-flame-500/8", text: "text-flame-300" };
  return (
    <div className={`rounded-md border ${palette.border} ${palette.bg} p-3`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${palette.dot}`} />
          <span className="text-[10px] uppercase tracking-wider text-cream-300/60">Peer review</span>
          <span className={`text-xs font-medium ${palette.text}`}>{verdict}</span>
          {typeof review.confidence === "number" && (
            <span className="text-[10px] text-cream-300/50">confidence {Math.round(review.confidence * 100)}%</span>
          )}
          {review.reviewer?.name && (
            <span className="text-[10px] text-cream-300/50 ml-auto">by {review.reviewer.name}{review.reviewer.model ? ` · ${review.reviewer.model}` : ""}</span>
          )}
        </div>
        {Array.isArray(review.issues) && review.issues.length > 0 && (
          <ul className="text-[11px] text-cream-200 space-y-0.5 list-disc pl-5">
            {review.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        )}
        {review.revised_answer && verdict !== "good" && (
          <details className="mt-2">
            <summary className="text-[11px] text-cream-300 cursor-pointer hover:text-cream-100">Reviewer's revised version (used as the final answer)</summary>
            <div className="text-xs text-cream-200 mt-2 prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(review.revised_answer) as string }} />
          </details>
        )}
    </div>
  );
}

function QualityBlock({ quality }: { quality: any }) {
  const pass = quality.pass === true;
  // Pass states recede to the surface; fail states assert with stronger fg.
  const palette = pass
    ? { dot: "bg-leaf-500", border: "border-leaf-500/20", bg: "bg-ink-850", text: "text-leaf-400" }
    : { dot: "bg-flame-500", border: "border-flame-500/40", bg: "bg-flame-500/8", text: "text-flame-300" };
  const fr = Math.round((quality.factuality_risk ?? 0) * 100);
  const cc = Math.round((quality.citation_coverage ?? 0) * 100);
  const pf = Math.round((quality.persona_fit ?? 0) * 100);
  return (
    <div className={`rounded-md border ${palette.border} ${palette.bg} p-3`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${palette.dot}`} />
        <span className="text-[10px] uppercase tracking-wider text-cream-300/60">Quality check</span>
        <span className={`text-xs font-medium ${palette.text}`}>{pass ? "passed" : "needs work"}</span>
        {typeof quality.score === "number" && <span className="text-[10px] text-cream-300/50">score {Math.round(quality.score * 100)}%</span>}
      </div>
      <div className="grid grid-cols-3 gap-3 text-[10px] mt-2">
        <Bar label="Factuality risk" value={fr} invert />
        <Bar label="Citation coverage" value={cc} />
        <Bar label="Persona fit" value={pf} />
      </div>
      {Array.isArray(quality.issues) && quality.issues.length > 0 && (
        <ul className="text-[11px] text-cream-200 space-y-0.5 list-disc pl-5 mt-2">
          {quality.issues.map((s: string, i: number) => <li key={i}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}

function SecurityBlock({ security }: { security: any }) {
  const findings: any[] = security.findings ?? [];
  const high = findings.filter(f => f.severity === "high").length;
  const medium = findings.filter(f => f.severity === "medium").length;
  const low = findings.filter(f => f.severity === "low").length;
  const pass = security.pass === true;
  const palette = pass
    ? { dot: "bg-leaf-500", border: "border-leaf-500/20", bg: "bg-ink-850", text: "text-leaf-400" }
    : { dot: "bg-coral-500", border: "border-coral-500/40", bg: "bg-coral-500/8", text: "text-coral-300" };
  return (
    <div className={`rounded-md border ${palette.border} ${palette.bg} p-3`}>
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${palette.dot}`} />
        <span className="text-[10px] uppercase tracking-wider text-cream-300/60">Security scan</span>
        <span className={`text-xs font-medium ${palette.text}`}>{pass ? "clean" : `${high} high · ${medium} medium · ${low} low`}</span>
      </div>
      {findings.length > 0 && (
        <ul className="text-[11px] text-cream-200 space-y-0.5 mt-1">
          {findings.slice(0, 6).map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className={`mt-1 inline-block w-1 h-1 rounded-full shrink-0 ${f.severity === "high" ? "bg-coral-500" : f.severity === "medium" ? "bg-flame-500" : "bg-cream-300/40"}`} />
              <span><span className="font-mono text-cream-100">{f.type}</span> · <span className="text-cream-300/70">{f.reason}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Surface a tight preview of what each sub-agent actually got — vault matches,
// web titles, github stuff — so the user can SEE the work landing, not just
// the green dot. Renders nothing when the result has no useful preview shape.
function StepResultPreview({ tool, result }: { tool: string; result: any }) {
  if (!result || typeof result !== "object") return null;
  if (tool === "vault.search") {
    const matches = Array.isArray(result.matches) ? result.matches : [];
    if (matches.length === 0) return <div className="text-[11px] text-cream-300/50 mt-1">no matches</div>;
    return (
      <ul className="mt-1.5 space-y-0.5 text-[11px]">
        {matches.slice(0, 3).map((m: any, i: number) => (
          <li key={i} className="flex items-baseline gap-2 min-w-0">
            <Link to={`/knowledge/${m.path}`} className="text-violet-400 hover:text-violet-500 font-mono truncate">{m.path}:{m.line}</Link>
            <span className="text-cream-300/60 truncate">{m.preview}</span>
          </li>
        ))}
        {matches.length > 3 && <li className="text-[10px] text-cream-300/40 italic">+{matches.length - 3} more</li>}
      </ul>
    );
  }
  if (tool === "vault.read" && typeof result.content === "string") {
    const len = result.content.length;
    return <div className="text-[11px] text-cream-300/50 mt-1">{len.toLocaleString()} chars read</div>;
  }
  if (tool === "vault.write" || tool === "vault.append") {
    const p = result.written ?? result.appended;
    if (!p) return null;
    return <Link to={`/knowledge/${p}`} className="inline-block mt-1 text-[11px] text-violet-400 hover:text-violet-500 font-mono">{p}</Link>;
  }
  if (tool === "vault.create_zettel" && result.path) {
    return <Link to={`/knowledge/${result.path}`} className="inline-block mt-1 text-[11px] text-violet-400 hover:text-violet-500 font-mono">{result.path}</Link>;
  }
  if (tool === "research.deep") {
    const vh = (result.vaultHits ?? []).length;
    const ws = (result.webSources ?? []).filter((s: any) => s.ok !== false).length;
    return (
      <div className="text-[11px] text-cream-300/60 mt-1 flex items-center gap-3 flex-wrap">
        <span>{vh} vault hit{vh === 1 ? "" : "s"} · {ws} web source{ws === 1 ? "" : "s"}</span>
        {result.captured?.path && <Link to={`/knowledge/${result.captured.path}`} className="font-mono text-violet-400 hover:text-violet-500">→ {result.captured.path}</Link>}
      </div>
    );
  }
  if (tool === "research.multiperspective") {
    const perspectives = result.perspectives ?? [];
    const sourceCount = result.sourceCount ?? 0;
    return (
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          {perspectives.map((p: string, i: number) => (
            <span key={i} className="px-1.5 py-0.5 rounded border border-violet-500/30 bg-violet-500/10 text-violet-300 uppercase tracking-wider text-[9px]">{p}</span>
          ))}
          <span className="text-cream-300/60">· {sourceCount} cited source{sourceCount === 1 ? "" : "s"}</span>
        </div>
        {result.captured?.path && <Link to={`/knowledge/${result.captured.path}`} className="font-mono text-[11px] text-violet-400 hover:text-violet-500">→ {result.captured.path}</Link>}
      </div>
    );
  }
  if (tool === "web.search" && Array.isArray(result.results)) {
    return (
      <ul className="mt-1.5 space-y-0.5 text-[11px]">
        {result.results.slice(0, 3).map((w: any, i: number) => (
          <li key={i} className="truncate"><LinkPreview href={w.url} className="text-violet-400 hover:text-violet-500">{w.title}</LinkPreview></li>
        ))}
        {result.results.length > 3 && <li className="text-[10px] text-cream-300/40 italic">+{result.results.length - 3} more</li>}
      </ul>
    );
  }
  if ((tool === "web.fetch" || tool === "web.scrape") && result.status) {
    return <div className="text-[11px] text-cream-300/50 mt-1">HTTP {result.status} · {(result.text?.length ?? 0).toLocaleString()} chars</div>;
  }
  if (tool === "github.list_repos" && Array.isArray(result.repos)) {
    return <div className="text-[11px] text-cream-300/50 mt-1">{result.repos.length} repos</div>;
  }
  if (tool === "github.read_repo") {
    return (
      <div className="text-[11px] text-cream-300/60 mt-1 flex items-center gap-3 flex-wrap">
        <span>{(result.commits ?? []).length} commits</span>
        <span>{(result.prs ?? []).length} PRs</span>
        <span>{(result.issues ?? []).length} issues</span>
        <span>{result.readme ? `README ${result.readme.length} chars` : "no README"}</span>
      </div>
    );
  }
  if (tool === "github.get_file" && result.size != null) {
    return <div className="text-[11px] text-cream-300/50 mt-1">{result.size.toLocaleString()} bytes</div>;
  }
  if (tool === "quality.check") {
    return (
      <div className="text-[11px] text-cream-300/60 mt-1 flex items-center gap-3 flex-wrap">
        <span>score {typeof result.score === "number" ? Math.round(result.score * 100) + "%" : "n/a"}</span>
        <span className={result.pass ? "text-leaf-400" : "text-flame-400"}>{result.pass ? "passed" : "flagged"}</span>
      </div>
    );
  }
  if (tool === "security.scan") {
    const high = (result.findings ?? []).filter((f: any) => f.severity === "high").length;
    return (
      <div className={`text-[11px] mt-1 ${high > 0 ? "text-coral-400" : "text-leaf-400"}`}>
        {high > 0 ? `${high} high-severity finding${high === 1 ? "" : "s"}` : "clean"}
      </div>
    );
  }
  if (tool === "ollama.generate" && typeof result.text === "string") {
    return <div className="text-[11px] text-cream-300/60 mt-1">{result.text.length.toLocaleString()} chars generated{result.model ? ` · ${result.model}` : ""}</div>;
  }
  if (tool === "peer.delegate" || tool === "peer.review") {
    if (result.peer?.name) return <div className="text-[11px] text-cream-300/60 mt-1">peer: {result.peer.name}{result.peer.model ? ` · ${result.peer.model}` : ""}{result.elapsedMs ? ` · ${(result.elapsedMs/1000).toFixed(1)}s` : ""}</div>;
  }
  return null;
}

function CurationBlock({ curation }: { curation: any }) {
  const captured = curation.captured === true;
  const palette = captured
    ? { dot: "bg-leaf-500", border: "border-leaf-500/20", bg: "bg-ink-850", text: "text-leaf-400" }
    : { dot: "bg-cream-300/40", border: "border-ink-700", bg: "bg-ink-950", text: "text-cream-300" };
  const rooted = curation.rooted ?? {};
  return (
    <div className={`rounded-md border ${palette.border} ${palette.bg} p-3`}>
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${palette.dot}`} />
        <span className="text-[10px] uppercase tracking-wider text-cream-300/60">Primary curation</span>
        <span className={`text-xs font-medium ${palette.text}`}>{captured ? "captured to vault" : "not captured"}</span>
        {captured && curation.path && (
          <Link to={`/knowledge/${curation.path}`} className="text-[11px] text-violet-400 hover:text-violet-500 font-mono ml-auto">{curation.path}</Link>
        )}
      </div>
      {!captured && curation.reason && (
        <div className="text-[11px] text-cream-300/70 mt-1">{curation.reason}</div>
      )}
      {(rooted.vaultCitations != null || rooted.webSources != null || rooted.githubRefs != null) && (
        <div className="flex items-center gap-3 text-[10px] text-cream-300/60 mt-2 flex-wrap">
          <span>Context-rooting:</span>
          <span><span className="text-cream-100">{rooted.vaultCitations ?? 0}</span> vault</span>
          <span><span className="text-cream-100">{rooted.webSources ?? 0}</span> web</span>
          <span><span className="text-cream-100">{rooted.githubRefs ?? 0}</span> github</span>
          {curation.answerChars != null && <span className="ml-auto text-cream-300/40">{curation.answerChars} chars</span>}
        </div>
      )}
    </div>
  );
}

function Bar({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? value < 40 : value > 60;
  const color = good ? "bg-leaf-500" : invert ? (value > 70 ? "bg-coral-500" : "bg-flame-500") : (value < 30 ? "bg-coral-500" : "bg-flame-500");
  return (
    <div>
      <div className="text-cream-300/60 mb-0.5">{label}</div>
      <div className="h-1 bg-ink-800 rounded overflow-hidden">
        <div className={`h-full dyn-width ${color}`} style={{ "--dyn-w": `${Math.max(2, Math.min(100, value))}%` } as React.CSSProperties} />
      </div>
      <div className="text-cream-300/40 mt-0.5 font-mono">{value}%{invert ? " ↓" : " ↑"}</div>
    </div>
  );
}

function GenericResult({ job }: { job: any }) {
  return (
    <Card title="Result">
      <MetaRow job={job} />
      <TraceBlock job={job} />
      <pre className="text-[11px] font-mono text-cream-200 bg-ink-950 border border-ink-800 rounded p-3 overflow-auto scrollbar-thin max-h-72 whitespace-pre-wrap">{JSON.stringify(job.result, null, 2)}</pre>
    </Card>
  );
}

// Per-tool trace — a horizontal Gantt of every step the planner ran. Catches
// long-tail outliers the textual run log buries (the 5 464 s quality.check
// hang in the 2026-05-29 reflection would have been one bar 30x longer than
// every other; instead it was buried in the JSON dump). Color buckets by
// tool family so the operator can read the shape at a glance: blue = LLM,
// teal = vault, violet = web/research, orange = peer.
function TraceBlock({ job }: { job: any }) {
  const runs: Array<{ step: { tool: string; label?: string }; ok: boolean; error?: string; durationMs: number; startedAt?: number }> = job.result?.runs ?? [];
  if (!runs.length) return null;
  const baseStart = Math.min(...runs.map(r => r.startedAt ?? 0).filter(n => n > 0));
  const ends = runs.map(r => (r.startedAt ?? baseStart) + (r.durationMs ?? 0));
  const total = Math.max(1, Math.max(...ends) - baseStart);
  function colorFor(tool: string): string {
    if (tool.startsWith("ollama.") || tool.includes("generate")) return "bg-violet-500/40 border-violet-500/60";
    if (tool.startsWith("vault.")) return "bg-leaf-500/40 border-leaf-500/60";
    if (tool.startsWith("web.") || tool.startsWith("research.")) return "bg-flame-400/40 border-flame-400/60";
    if (tool.startsWith("peer.") || tool.startsWith("quality.") || tool.startsWith("security.")) return "bg-coral-500/30 border-coral-500/60";
    return "bg-cream-300/30 border-cream-300/50";
  }
  const slowestMs = Math.max(...runs.map(r => r.durationMs ?? 0));
  return (
    <details className="mb-3 group" open={slowestMs > 30_000 || runs.some(r => !r.ok)}>
      <summary className="cursor-pointer text-[11px] text-cream-300/70 hover:text-cream-100 select-none flex items-center gap-2 mb-1">
        <span>Trace</span>
        <span className="text-cream-300/40">·</span>
        <span className="font-mono">{runs.length} step{runs.length === 1 ? "" : "s"} · {Math.round(total / 1000)}s total{slowestMs > 30_000 ? ` · slowest ${Math.round(slowestMs/1000)}s` : ""}</span>
      </summary>
      <div className="bg-ink-950 border border-ink-800 rounded p-3 space-y-1.5">
        {runs.slice(0, 32).map((r, i) => {
          const offset = ((r.startedAt ?? baseStart) - baseStart) / total * 100;
          const width = Math.max(0.5, (r.durationMs ?? 0) / total * 100);
          const label = r.step.label ?? r.step.tool;
          const tip = `${r.step.tool} · ${Math.round((r.durationMs ?? 0) / 100) / 10}s${r.ok ? "" : ` · ${r.error ?? "failed"}`}`;
          return (
            <div key={i} className={`flex items-center gap-2 text-[10px] nw-fade-up nw-delay-${Math.min(7, i + 1)}`}>
              <div className="w-32 truncate text-cream-300/70 font-mono shrink-0" title={r.step.tool}>{label}</div>
              <div className="flex-1 relative h-3 bg-ink-900 rounded">
                <div
                  className={`absolute h-full rounded border dyn-bar ${colorFor(r.step.tool)} ${r.ok ? "" : "ring-1 ring-coral-500"}`}
                  style={{ "--dyn-left": `${offset}%`, "--dyn-w": `${width}%` } as React.CSSProperties}
                  title={tip}
                />
              </div>
              <div className="w-12 text-right tabular-nums text-cream-300/60 shrink-0">{(r.durationMs ?? 0) >= 1000 ? `${Math.round((r.durationMs ?? 0) / 100) / 10}s` : `${r.durationMs ?? 0}ms`}</div>
            </div>
          );
        })}
        {runs.length > 32 && <div className="text-[10px] text-cream-300/50">+ {runs.length - 32} more steps not shown</div>}
      </div>
    </details>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: any; tone?: "default" | "ok" | "warn" }) {
  const color = tone === "warn" ? "text-coral-400" : tone === "ok" ? "text-leaf-400" : "text-cream-50";
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-md px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-cream-300/50">{label}</div>
      <div className={`text-xl font-semibold tracking-tight tabular-nums ${color}`}>{value ?? "—"}</div>
    </div>
  );
}
