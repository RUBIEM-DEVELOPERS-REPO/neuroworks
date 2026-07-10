import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { marked } from "marked";
import { api } from "../lib/api";

// Customer-facing result document. The Tasks page shows technical detail
// (steps, models, durations); this page is the polished read — title, the
// answer rendered as a real document, sources, and a collapsible "how
// clawbot arrived at this" trace for transparency.
export function Results() {
  const { jobId } = useParams();
  const [job, setJob] = useState<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: any;
    async function tick() {
      try {
        const j = await api.getJob(jobId!);
        if (!alive) return;
        setJob(j);
        if (j.status === "succeeded" || j.status === "failed" || j.status === "rejected") return;
      } catch (e: any) { if (alive) setErr(e.message); }
      timer = setTimeout(tick, 2000);
    }
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [jobId]);

  if (!jobId) return <div className="text-sm text-cream-300/60">Missing job id.</div>;
  if (err) return <div className="text-sm text-coral-400">{err}</div>;
  if (!job) return <div className="text-sm text-cream-300/60">Loading…</div>;

  const r = job.result ?? {};
  const isPending = job.status === "running" || job.status === "pending";
  const isFailed = job.status === "failed" || job.status === "rejected";
  const answer = r.answer ?? r.partialAnswer ?? "";
  const persona = job.inputs?.activePersona ?? r.activePersona;
  const personaName = (persona && (persona.name ?? persona.id)) ?? "Neuro";
  const startedAt = job.startedAt ? new Date(job.startedAt) : null;
  const finishedAt = job.finishedAt ? new Date(job.finishedAt) : null;
  const durationSec = startedAt && finishedAt
    ? Math.max(1, Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000))
    : null;

  return (
    <article className="max-w-5xl mx-auto -my-2 pb-16">
      <header className="border-b border-ink-800 pb-6 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Link to="/tasks" className="text-[11px] text-cream-300/60 hover:text-cream-300 uppercase tracking-wider">← Tasks</Link>
          <span className="text-cream-300/30">/</span>
          <span className="text-[11px] text-cream-300/60 uppercase tracking-wider font-mono">{job.id.slice(0, 8)}</span>
        </div>
        <h1 className="font-display text-4xl text-cream-50 leading-tight">{cleanTitle(job.title) || "Result"}</h1>
        <Meta job={job} personaName={personaName} durationSec={durationSec} startedAt={startedAt} />
        {isPending && <PendingBadge job={job} />}
        {isFailed && <FailedBadge job={job} />}
      </header>

      {answer ? (
        <PolishedAnswer markdown={answer} />
      ) : !isPending ? (
        <EmptyAnswer job={job} />
      ) : null}

      {!isPending && (
        <>
          <Outcomes runs={r.runs ?? []} curation={r.curation} />
          <Sources runs={r.runs ?? []} />
          <QASummary review={r.review} quality={r.quality} security={r.security} curation={r.curation} />
          {/* Technical detail — hidden behind a single expand so the
              customer-facing view is the answer + outcomes + sources, not
              a wall of timing bars and tool names. Power users still get
              everything one click away. */}
          <HowThisWasDone job={job} />
        </>
      )}
    </article>
  );
}

// Outcomes — the most important "what actually changed" section. Walks the
// runs and surfaces every tangible artifact the agent produced: vault notes
// captured, files modified, issues opened, downloads written. This is the
// answer to "did it work?" — separate from the prose answer (which is the
// answer to "what's the story?").
function Outcomes({ runs, curation }: { runs: any[]; curation?: any }) {
  const items = useMemo(() => extractOutcomes(runs, curation), [runs, curation]);
  const [vaultStats, setVaultStats] = useState<any>(null);
  const hasVaultWrite = items.some(it => it.kind === "write" || it.kind === "capture");
  useEffect(() => {
    if (!hasVaultWrite) return;
    api.vaultStats().then(setVaultStats).catch(() => {});
  }, [hasVaultWrite]);
  if (items.length === 0) return null;
  const lc = vaultStats?.lastCommit;
  const pushPending = lc && lc.ok === true && lc.pushed === false;
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl text-cream-50 mb-3">Outcomes</h2>
      {pushPending && (
        <div className="mb-3 text-[11px] text-flame-400 bg-flame-500/10 border border-flame-500/30 rounded-md px-3 py-2 flex items-center gap-2 flex-wrap">
          <span>⚠ Saved locally — origin push hasn't completed yet.</span>
          <Link to="/admin" className="underline hover:text-flame-300">Retry on Admin →</Link>
        </div>
      )}
      <ul className="space-y-3">
        {items.map((it, i) => <OutcomeCard key={i} item={it} pushPending={pushPending} />)}
      </ul>
    </section>
  );
}

// Deep, expandable outcome card. The headline (icon + label + detail + link)
// is always visible; clicking expands a per-outcome detail panel showing
// every source the underlying tool touched and any artifact bodies. The aim
// is to make Results the canonical "what happened" record so the user never
// has to switch back to Tasks to dig into a sub-agent's work.
function OutcomeCard({ item, pushPending }: { item: Outcome; pushPending: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!item.expanded;
  return (
    <li className={`rounded-lg border ${item.kind === "error" ? "border-coral-500/30 bg-coral-500/5" : "border-ink-800 bg-ink-900"}`}>
      <div className="flex items-start gap-3 p-3">
        <span className="text-lg flex-shrink-0">{item.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-cream-100">{item.label}</span>
            {item.tag && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-cream-300/20 text-cream-300/60">{item.tag}</span>}
            {typeof item.durationMs === "number" && item.durationMs > 0 && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-cream-300/10 text-cream-300/50 font-mono">{formatDuration(item.durationMs)}</span>
            )}
            {pushPending && (item.kind === "write" || item.kind === "capture") && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-flame-500/40 text-flame-400 bg-flame-500/10">local only</span>
            )}
          </div>
          {item.detail && <div className="text-[12px] text-cream-300/70 mt-0.5">{item.detail}</div>}
          {Array.isArray(item.topLinks) && item.topLinks.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {item.topLinks.map((l, j) => (
                <li key={j} className="text-[11px]">
                  {l.external
                    ? <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-500 break-all">→ {l.label}</a>
                    : <Link to={l.href} className="text-violet-400 hover:text-violet-500 font-mono break-all">→ {l.label}</Link>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            {item.link && (
              <Link to={item.link} className="font-mono text-[11px] text-violet-400 hover:text-violet-500">{item.linkLabel ?? item.link}</Link>
            )}
            {item.externalUrl && (
              <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-violet-400 hover:text-violet-500 break-all">{item.linkLabel ?? item.externalUrl} ↗</a>
            )}
            {hasDetail && (
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="text-[11px] text-cream-300/60 hover:text-cream-100 ml-auto"
              >
                {open ? "▾ hide detail" : "▸ show detail"}
              </button>
            )}
          </div>
        </div>
      </div>
      {open && hasDetail && (
        <div className="border-t border-ink-800 px-4 py-3 bg-ink-950/50">
          <OutcomeDetail kind={item.expanded!.kind} payload={item.expanded!.payload} />
        </div>
      )}
    </li>
  );
}

// Renders the detail body for one expanded outcome. Each tool has a dedicated
// renderer so we can show exactly the shape that matters (perspectives for
// multiperspective, source list for research.deep, match list for
// vault.search, repo overview for github, etc.).
function OutcomeDetail({ kind, payload }: { kind: string; payload: any }) {
  if (kind === "multiperspective") {
    const perspectives = payload.perspectiveResults ?? [];
    return (
      <div className="space-y-4">
        {perspectives.map((p: any, i: number) => (
          <div key={i} className="border-l-2 border-violet-500/30 pl-3">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-300">{p.name}</span>
              <span className="text-[11px] text-cream-300/60 font-mono truncate">query: "{p.query}"</span>
            </div>
            {Array.isArray(p.sources) && p.sources.length > 0 ? (
              <ul className="space-y-1">
                {p.sources.map((s: any, j: number) => (
                  <li key={j} className="text-[12px] flex items-start gap-2">
                    <span className={`mt-1 inline-block w-1 h-1 rounded-full flex-shrink-0 ${s.ok === false ? "bg-coral-500" : "bg-leaf-500"}`} />
                    <div className="min-w-0">
                      {s.ok === false ? (
                        <>
                          <span className="text-coral-400">{s.title || s.url}</span>
                          <div className="text-[11px] text-cream-300/50 font-mono break-all">{s.url}</div>
                          {s.error && <div className="text-[11px] text-coral-400/70 mt-0.5">{s.error}</div>}
                        </>
                      ) : (
                        <>
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-500">{s.title || s.url}</a>
                          <div className="text-[11px] text-cream-300/50 font-mono break-all">{s.url}</div>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[11px] text-cream-300/40 italic">no reachable sources for this perspective</div>
            )}
          </div>
        ))}
        {Array.isArray(payload.vaultHits) && payload.vaultHits.length > 0 && (
          <div className="border-l-2 border-leaf-500/30 pl-3">
            <div className="text-[10px] uppercase tracking-wider text-leaf-400 mb-1.5">Vault context ({payload.vaultHits.length})</div>
            <ul className="space-y-0.5">
              {payload.vaultHits.slice(0, 8).map((h: any, i: number) => (
                <li key={i} className="text-[12px]">
                  <Link to={`/knowledge/${h.path}`} className="text-violet-400 hover:text-violet-500 font-mono">{h.path}:{h.line}</Link>
                  <span className="text-cream-300/60 ml-2">{h.preview}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (kind === "research.deep") {
    return (
      <div className="space-y-3">
        {Array.isArray(payload.webSources) && payload.webSources.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-cream-300/60 mb-1.5">Web sources fetched ({payload.webSources.length})</div>
            <ul className="space-y-1">
              {payload.webSources.map((w: any, i: number) => (
                <li key={i} className="text-[12px] flex items-start gap-2">
                  <span className={`mt-1 inline-block w-1 h-1 rounded-full flex-shrink-0 ${w.ok === false ? "bg-coral-500" : "bg-leaf-500"}`} />
                  <div className="min-w-0">
                    <a href={w.url} target="_blank" rel="noopener noreferrer" className={`${w.ok === false ? "text-coral-400" : "text-violet-400 hover:text-violet-500"}`}>{w.title || w.url}</a>
                    <div className="text-[11px] text-cream-300/50 font-mono break-all">{w.url}</div>
                    {w.error && <div className="text-[11px] text-coral-400/70 mt-0.5">{w.error}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(payload.vaultHits) && payload.vaultHits.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-cream-300/60 mb-1.5">Vault hits ({payload.vaultHits.length})</div>
            <ul className="space-y-0.5">
              {payload.vaultHits.map((h: any, i: number) => (
                <li key={i} className="text-[12px]">
                  <Link to={`/knowledge/${h.path}`} className="text-violet-400 hover:text-violet-500 font-mono">{h.path}:{h.line}</Link>
                  <span className="text-cream-300/60 ml-2">{h.preview}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (kind === "vault.search") {
    return (
      <ul className="space-y-1.5">
        {(payload.matches ?? []).map((m: any, i: number) => (
          <li key={i} className="text-[12px]">
            <Link to={`/knowledge/${m.path}`} className="text-violet-400 hover:text-violet-500 font-mono">{m.path}:{m.line}</Link>
            <div className="text-cream-300/70">{m.preview}</div>
          </li>
        ))}
      </ul>
    );
  }
  if (kind === "github.read_repo") {
    return (
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div><span className="text-cream-300/50">Commits:</span> <span className="text-cream-100">{(payload.commits ?? []).length}</span></div>
        <div><span className="text-cream-300/50">Open PRs:</span> <span className="text-cream-100">{(payload.prs ?? []).length}</span></div>
        <div><span className="text-cream-300/50">Open issues:</span> <span className="text-cream-100">{(payload.issues ?? []).length}</span></div>
        <div><span className="text-cream-300/50">README size:</span> <span className="text-cream-100">{payload.readme ? `${payload.readme.length.toLocaleString()} chars` : "none"}</span></div>
      </div>
    );
  }
  if (kind === "web.search") {
    return (
      <ul className="space-y-1">
        {(payload.results ?? []).map((w: any, i: number) => (
          <li key={i} className="text-[12px]">
            <a href={w.url} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-500">{w.title}</a>
            <div className="text-[11px] text-cream-300/50 font-mono break-all">{w.url}</div>
            {w.snippet && <div className="text-[11px] text-cream-300/70 mt-0.5">{w.snippet}</div>}
          </li>
        ))}
      </ul>
    );
  }
  if (kind === "peer.delegate") {
    return (
      <div className="text-[12px] space-y-1">
        <div><span className="text-cream-300/50">Peer:</span> <span className="text-cream-100">{payload.peer?.name ?? payload.peer?.url}</span></div>
        {payload.peer?.model && <div><span className="text-cream-300/50">Model:</span> <span className="font-mono text-cream-100">{payload.peer.model}</span></div>}
        {payload.elapsedMs && <div><span className="text-cream-300/50">Round-trip:</span> <span className="text-cream-100">{(payload.elapsedMs / 1000).toFixed(1)}s</span></div>}
        {payload.jobId && <div><span className="text-cream-300/50">Peer jobId:</span> <span className="font-mono text-cream-100">{payload.jobId}</span></div>}
      </div>
    );
  }
  if (kind === "curation") {
    // Show why the primary decided to capture: per-axis quality numbers,
    // security findings, the rooting breakdown, and any quality issues
    // raised by the scorer.
    const q = payload.quality;
    const s = payload.security;
    const rooted = payload.rooted ?? {};
    return (
      <div className="space-y-3 text-[12px]">
        {q && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-cream-300/60 mb-1.5">Quality gate</div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Score" value={q.score != null ? Math.round(q.score * 100) + "%" : "n/a"} good={q.pass} />
              <Metric label="Factuality risk" value={Math.round((q.factuality_risk ?? 0) * 100) + "%"} good={(q.factuality_risk ?? 0) < 0.4} invert />
              <Metric label="Citation cov." value={Math.round((q.citation_coverage ?? 0) * 100) + "%"} good={(q.citation_coverage ?? 0) > 0.4} />
            </div>
            {Array.isArray(q.issues) && q.issues.length > 0 && (
              <ul className="list-disc pl-5 mt-2 text-cream-200 text-[12px] space-y-0.5">
                {q.issues.map((iss: string, i: number) => <li key={i}>{iss}</li>)}
              </ul>
            )}
          </div>
        )}
        {s && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-cream-300/60 mb-1.5">Security scan</div>
            {(s.findings ?? []).length === 0 ? (
              <div className="text-leaf-400">Clean — no findings.</div>
            ) : (
              <ul className="space-y-0.5">
                {(s.findings ?? []).slice(0, 8).map((f: any, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className={`mt-1 inline-block w-1 h-1 rounded-full flex-shrink-0 ${f.severity === "high" ? "bg-coral-500" : f.severity === "medium" ? "bg-flame-500" : "bg-cream-300/40"}`} />
                    <span><span className="font-mono text-cream-100">{f.type}</span> <span className="text-cream-300/60">· {f.reason}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-cream-300/60 mb-1.5">Context rooting</div>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Vault refs" value={rooted.vaultCitations ?? 0} good={(rooted.vaultCitations ?? 0) > 0} />
            <Metric label="Web sources" value={rooted.webSources ?? 0} good={(rooted.webSources ?? 0) > 0} />
            <Metric label="GitHub refs" value={rooted.githubRefs ?? 0} good={(rooted.githubRefs ?? 0) > 0} />
          </div>
          {Array.isArray(rooted.reasons) && rooted.reasons.length > 0 && (
            <ul className="list-disc pl-5 mt-2 text-cream-300/70 space-y-0.5">
              {rooted.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
        {!payload.captured && payload.reason && (
          <div className="text-flame-400 bg-flame-500/10 border border-flame-500/30 rounded-md px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider mr-2">Not captured</span>
            {payload.reason}
          </div>
        )}
      </div>
    );
  }
  // Generic fallback — show the raw shape so power users can debug.
  return (
    <pre className="text-[10px] font-mono text-cream-300/60 whitespace-pre-wrap max-h-48 overflow-auto scrollbar-thin">{JSON.stringify(payload, null, 2)}</pre>
  );
}

function Metric({ label, value, good, invert }: { label: string; value: any; good?: boolean; invert?: boolean }) {
  const tone = good == null ? "text-cream-100" : good ? "text-leaf-400" : invert ? "text-coral-400" : "text-flame-400";
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-cream-300/50">{label}</div>
      <div className={`font-display text-base ${tone}`}>{value}</div>
    </div>
  );
}

type Outcome = {
  kind: "write" | "capture" | "fetch" | "issue" | "promote" | "error" | "research" | "search" | "delegate";
  icon: string;
  label: string;
  detail?: string;
  link?: string;
  linkLabel?: string;
  externalUrl?: string;
  tag?: string;
  // Duration the sub-agent took to produce this outcome, in milliseconds.
  // Surfaced as a small badge so bosses can see WHERE the time went without
  // expanding "How this was done".
  durationMs?: number;
  // Up to 3 inline links to the most relevant artifacts (top vault matches,
  // top web sources) — gives the exec a one-glance preview of the evidence
  // without having to expand the card. Skipped on outcomes where headline +
  // detail + link already say everything (e.g. "Opened issue #42").
  topLinks?: { label: string; href: string; external?: boolean }[];
  // When present, the card becomes expandable — `OutcomeDetail` renders the
  // payload using the kind-specific renderer (perspective list, source list,
  // match list, etc.). Lets the Results page be the complete record without
  // forcing the user back to Tasks for tool-level depth.
  expanded?: { kind: string; payload: any };
};

// Format ms as a compact, exec-friendly duration. Sub-second → "ms",
// otherwise seconds with one decimal, otherwise minutes + seconds.
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${rem > 0 ? ` ${rem}s` : ""}`;
}

function extractOutcomes(runs: any[], curation?: any): Outcome[] {
  const out: Outcome[] = [];
  // The primary's curation capture lands first — it's the headline outcome
  // when a worker peer ran the task.
  if (curation?.captured && curation.path) {
    out.push({
      kind: "capture",
      icon: "📥",
      label: "Captured to vault",
      detail: `Quality ${curation.quality?.score != null ? Math.round(curation.quality.score * 100) + "%" : "n/a"} · ${curation.rooted?.vaultCitations ?? 0} vault refs, ${curation.rooted?.webSources ?? 0} web sources`,
      link: `/knowledge/${curation.path}`,
      linkLabel: curation.path,
      tag: "curated",
      expanded: { kind: "curation", payload: curation },
    });
  }
  for (const r of runs) {
    if (!r || !r.step) continue;
    const tool = r.step.tool;
    const args = r.step.args ?? {};
    const result = r.result ?? {};
    const durationMs = typeof r.durationMs === "number" ? r.durationMs : undefined;
    if (!r.ok) {
      out.push({
        kind: "error",
        icon: "✗",
        label: `${tool} failed`,
        detail: r.error?.slice(0, 200),
        durationMs,
      });
      continue;
    }
    if (tool === "vault.write" || tool === "vault.append") {
      const p = String(result.written ?? result.appended ?? args.path ?? "");
      if (p) out.push({
        kind: "write",
        icon: tool === "vault.append" ? "✎" : "📝",
        label: tool === "vault.append" ? "Appended to note" : "Wrote new note",
        link: `/knowledge/${p}`,
        linkLabel: p,
        durationMs,
      });
    } else if (tool === "vault.create_zettel") {
      const p = String(result.path ?? "");
      if (p) out.push({
        kind: "write",
        icon: "🗂",
        label: "Created zettel",
        detail: result.id ? `Zettel id ${result.id}` : undefined,
        link: `/knowledge/${p}`,
        linkLabel: p,
        tag: "permanent",
        durationMs,
      });
    } else if (tool === "research.deep") {
      const okSources = (result.webSources ?? []).filter((s: any) => s.ok !== false);
      const topLinks: Outcome["topLinks"] = [
        ...okSources.slice(0, 2).map((s: any) => ({
          label: (s.title || s.url || "source").slice(0, 90),
          href: String(s.url ?? ""),
          external: true,
        })),
        ...(result.vaultHits ?? []).slice(0, 1).map((h: any) => ({
          label: `${h.path}:${h.line}`,
          href: `/knowledge/${h.path}`,
          external: false,
        })),
      ].filter((l: any) => l.href);
      const headline = result.captured?.path
        ? {
            kind: "capture" as const,
            icon: "🔬",
            label: "Research note captured",
            detail: `${result.vaultHits?.length ?? 0} vault hits · ${okSources.length} web sources cited`,
            link: `/knowledge/${result.captured.path}`,
            linkLabel: result.captured.path,
            tag: "inbox",
          }
        : {
            kind: "research" as const,
            icon: "🔬",
            label: `Researched "${args.query ?? "topic"}"`,
            detail: `${result.vaultHits?.length ?? 0} vault hits · ${okSources.length} web sources cited`,
          };
      out.push({ ...headline, durationMs, topLinks, expanded: { kind: "research.deep", payload: result } });
    } else if (tool === "research.multiperspective") {
      const persStr = Array.isArray(result.perspectives) ? result.perspectives.join(", ") : "";
      const headline = result.captured?.path
        ? {
            kind: "capture" as const,
            icon: "🧭",
            label: "Multi-perspective report captured",
            detail: `${(result.perspectives ?? []).length} perspective${(result.perspectives ?? []).length === 1 ? "" : "s"} (${persStr}) · ${result.sourceCount ?? 0} cited source${result.sourceCount === 1 ? "" : "s"}`,
            link: `/knowledge/${result.captured.path}`,
            linkLabel: result.captured.path,
            tag: "research",
          }
        : {
            kind: "research" as const,
            icon: "🧭",
            label: `Multi-perspective: "${args.topic ?? "topic"}"`,
            detail: `${persStr} · ${result.sourceCount ?? 0} sources`,
            tag: "research",
          };
      out.push({ ...headline, durationMs, expanded: { kind: "multiperspective", payload: result } });
    } else if (tool === "vault.search") {
      const matches = result.matches ?? [];
      const n = matches.length;
      const topLinks: Outcome["topLinks"] = matches.slice(0, 3).map((m: any) => ({
        label: `${m.path}:${m.line}`,
        href: `/knowledge/${m.path}`,
        external: false,
      }));
      out.push({
        kind: "search",
        icon: "🔎",
        label: `Searched vault: "${args.query ?? "?"}"`,
        detail: `${n} match${n === 1 ? "" : "es"}`,
        durationMs,
        topLinks,
        expanded: n > 0 ? { kind: "vault.search", payload: result } : undefined,
      });
    } else if (tool === "web.search") {
      const results = result.results ?? [];
      const n = results.length;
      const topLinks: Outcome["topLinks"] = results.slice(0, 3).map((s: any) => ({
        label: (s.title || s.url || "result").slice(0, 90),
        href: String(s.url ?? ""),
        external: true,
      })).filter((l: any) => l.href);
      out.push({
        kind: "search",
        icon: "🌐",
        label: `Searched the web: "${args.query ?? "?"}"`,
        detail: `${n} result${n === 1 ? "" : "s"}`,
        durationMs,
        topLinks,
        expanded: n > 0 ? { kind: "web.search", payload: result } : undefined,
      });
    } else if (tool === "github.read_repo") {
      out.push({
        kind: "fetch",
        icon: "🐙",
        label: `Read ${args.owner}/${args.name}`,
        detail: `${(result.commits ?? []).length} commits · ${(result.prs ?? []).length} PRs · ${(result.issues ?? []).length} open issues`,
        externalUrl: `https://github.com/${args.owner}/${args.name}`,
        linkLabel: `${args.owner}/${args.name}`,
        durationMs,
        expanded: { kind: "github.read_repo", payload: result },
      });
    } else if (tool === "github.get_file") {
      out.push({
        kind: "fetch",
        icon: "📄",
        label: `Fetched ${args.path} from ${args.name}`,
        detail: result.size != null ? `${result.size.toLocaleString()} bytes` : undefined,
        externalUrl: `https://github.com/${args.owner}/${args.name}/blob/HEAD/${args.path}`,
        linkLabel: `${args.owner}/${args.name}/${args.path}`,
        durationMs,
      });
    } else if (tool === "github.create_issue" && result.url) {
      out.push({
        kind: "issue",
        icon: "🐛",
        label: `Opened issue #${result.number}`,
        externalUrl: result.url,
        linkLabel: result.url,
        durationMs,
      });
    } else if (tool === "web.scrape" && args.screenshot && result.screenshotPath) {
      out.push({
        kind: "write",
        icon: "📸",
        label: "Screenshot saved",
        link: `/knowledge/${result.screenshotPath}`,
        linkLabel: String(result.screenshotPath),
        durationMs,
      });
    } else if (tool === "web.scrape" || tool === "web.fetch") {
      out.push({
        kind: "fetch",
        icon: "🌐",
        label: tool === "web.scrape" ? "Scraped a page" : "Fetched a page",
        detail: result.status ? `HTTP ${result.status} · ${(result.text?.length ?? 0).toLocaleString()} chars` : undefined,
        externalUrl: String(args.url ?? ""),
        linkLabel: String(args.url ?? ""),
        durationMs,
      });
    } else if (tool === "peer.delegate") {
      out.push({
        kind: "delegate",
        icon: "🤝",
        label: `Delegated to ${result.peer?.name ?? "peer"}`,
        detail: result.peer?.model ? `${result.peer.model}${result.elapsedMs ? ` · ${(result.elapsedMs / 1000).toFixed(1)}s` : ""}` : undefined,
        durationMs,
        expanded: { kind: "peer.delegate", payload: result },
      });
    } else if (tool === "peer.review" && result.verdict) {
      out.push({
        kind: "delegate",
        icon: "👀",
        label: `Peer review: ${result.verdict}`,
        detail: result.peer?.name ? `by ${result.peer.name}` : undefined,
        durationMs,
      });
    }
  }
  return out;
}

// Reports index — shows every completed general-task (and custom) job as a
// clickable card with the answer's first line as preview. The detail page is
// the polished read; this is the "table of contents".
export function ResultsIndex() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "captured" | "delegated">("all");

  useEffect(() => {
    let alive = true;
    async function tick() {
      try {
        const r = await api.listJobs();
        if (!alive) return;
        // Show only general-task + custom-* + delegated peer jobs that finished
        // — these are the ones with a polished answer. Other templates have
        // their own result panels and don't fit the report shape.
        const filtered = (r.jobs ?? [])
          .filter((j: any) => j.status === "succeeded" || j.status === "failed")
          .filter((j: any) => j.template === "general-task" || (j.template ?? "").startsWith("custom-") || j.template === "peer:delegate" || j.kind === "peer:delegate")
          .sort((a: any, b: any) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
        setJobs(filtered);
      } catch { /* swallow */ }
      finally { if (alive) setLoading(false); }
    }
    tick();
    const i = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  const visible = jobs.filter(j => {
    if (filter === "all") return true;
    if (filter === "captured") return j.result?.curation?.captured === true;
    if (filter === "delegated") return j.result?.delegated === true;
    return true;
  });

  // Friendlier counts so the customer can see "12 reports · 4 saved to your
  // vault · 3 done by an employee" at a glance.
  const counts = useMemo(() => ({
    all: jobs.length,
    saved: jobs.filter(j => j.result?.curation?.captured === true).length,
    employee: jobs.filter(j => j.result?.delegated === true).length,
  }), [jobs]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-cream-50">Reports</h1>
          <p className="text-sm text-cream-300/70 mt-1">Everything your employees have produced for you. Each report has the answer, the sources, and what was saved to your vault.</p>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          {([
            { id: "all" as const, label: `All (${counts.all})` },
            { id: "captured" as const, label: `Saved to vault (${counts.saved})` },
            { id: "delegated" as const, label: `Done by employee (${counts.employee})` },
          ]).map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-md border transition-colors ${filter === f.id ? "bg-violet-500/15 border-violet-500/40 text-violet-300" : "border-ink-800 text-cream-300/70 hover:border-ink-700 hover:text-cream-100"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="text-sm text-cream-300/60">Loading reports…</div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-cream-300/60 border border-dashed border-ink-700 rounded-lg p-8 text-center">
          <div className="text-2xl mb-3">📋</div>
          <div className="font-medium text-cream-200 mb-1">No reports yet</div>
          <div className="mb-4">Send a task in <Link to="/chat" className="text-violet-400 hover:text-violet-500">Chat</Link> and your employee's report will land here.</div>
          <Link to="/personas" className="text-[11px] text-cream-300 hover:text-cream-50 underline">Don't have an employee active? Hire one →</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map(j => <ReportCard key={j.id} job={j} />)}
        </ul>
      )}
    </div>
  );
}

function ReportCard({ job }: { job: any }) {
  const r = job.result ?? {};
  const title = cleanTitle(job.title) || job.template || "Report";
  const startedAt = job.startedAt ? new Date(job.startedAt) : null;
  const dur = job.finishedAt && job.startedAt
    ? Math.max(1, Math.round((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000))
    : null;
  const preview = typeof r.answer === "string"
    ? r.answer.replace(/^#+\s+.*$/m, "").replace(/[#*`>\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 220)
    : "";
  const captured = r.curation?.captured === true;
  const delegated = r.delegated === true;
  const failed = job.status === "failed";
  const employeeName = r.peer?.name || job.inputs?.activePersona?.name || r.activePersona?.name;
  return (
    <li>
      <Link to={`/results/${job.id}`} className={`block rounded-lg border transition-colors p-4 ${failed ? "border-coral-500/30 bg-coral-500/5 hover:border-coral-500/50" : "border-ink-800 bg-ink-900 hover:border-violet-500/40 hover:bg-ink-850"}`}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="font-display text-lg text-cream-50 truncate">{title}</h3>
              {failed && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-coral-500/40 text-coral-400 bg-coral-500/10">didn't finish</span>}
              {captured && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-leaf-500/40 text-leaf-400 bg-leaf-500/10">saved to vault</span>}
            </div>
            {preview && <p className="text-sm text-cream-300/80 line-clamp-2">{preview}</p>}
            <div className="flex items-center gap-3 text-[11px] text-cream-300/50 mt-2 flex-wrap">
              {employeeName && (
                <span>by <span className="text-cream-300/80">{employeeName}</span></span>
              )}
              {!employeeName && delegated && <span>by a worker</span>}
              {dur != null && <span>· took {dur >= 60 ? `${Math.round(dur / 60)} min${Math.round(dur / 60) !== 1 ? "s" : ""}` : `${dur}s`}</span>}
              {startedAt && <span>· {friendlyTimeAgo(startedAt)}</span>}
            </div>
          </div>
          <span className="text-violet-400 self-center text-lg flex-shrink-0">→</span>
        </div>
      </Link>
    </li>
  );
}

// Customer-friendly relative time. "2 minutes ago" reads better than a full
// ISO timestamp on a card the customer just opened.
function friendlyTimeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Meta({ job, personaName, durationSec, startedAt }: { job: any; personaName: string; durationSec: number | null; startedAt: Date | null }) {
  const r = job.result ?? {};
  const peerName = r.peer?.name;
  // Customer-friendly one-liner: "By Maya · Took 2 minutes · 3 hours ago".
  // Beats a 4-column grid of "Persona / Run on peer / Started / Duration"
  // with mono timestamps — that's an engineer's view, not a customer's.
  const bits: string[] = [];
  bits.push(`By **${personaName}**`);
  if (peerName && peerName !== personaName) bits.push(`on **${peerName}**`);
  if (durationSec != null) {
    bits.push(`took ${durationSec >= 60 ? `${Math.round(durationSec / 60)} min${Math.round(durationSec / 60) !== 1 ? "s" : ""}` : `${durationSec}s`}`);
  }
  if (startedAt) bits.push(friendlyTimeAgo(startedAt));
  return (
    <div className="mt-3 text-sm text-cream-300/80" dangerouslySetInnerHTML={{ __html: bits.join(" · ").replace(/\*\*(.+?)\*\*/g, "<span class='text-cream-100 font-medium'>$1</span>") }} />
  );
}

function PendingBadge({ job }: { job: any }) {
  const phase = job.result?.phase as string | undefined;
  const label = phase === "planning" ? "Working out a plan"
    : phase === "executing" ? "Running steps"
    : phase === "synthesizing" ? "Drafting the report"
    : phase === "reviewing" ? "Quality review"
    : "Working";
  return (
    <div className="mt-4 inline-flex items-center gap-2 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/30 rounded-full px-3 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />
      {label}…
    </div>
  );
}

function FailedBadge({ job }: { job: any }) {
  const label = job.status === "rejected" ? "Rejected" : "This task didn't finish";
  return (
    <div className="mt-4 inline-flex items-center gap-2 text-xs text-coral-400 bg-coral-500/10 border border-coral-500/30 rounded-full px-3 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-coral-500" />
      {label}{job.error ? ` — ${job.error.slice(0, 100)}` : ""}
    </div>
  );
}

function PolishedAnswer({ markdown }: { markdown: string }) {
  const html = useMemo(() => marked.parse(markdown, { gfm: true, breaks: false }) as string, [markdown]);
  return (
    <section className="prose-vault prose-result text-cream-100 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function EmptyAnswer({ job }: { job: any }) {
  return (
    <section className="text-sm text-cream-300/60 italic">
      No written answer was produced.{job.error ? ` Error: ${job.error}` : ""}
    </section>
  );
}

// Collapsible "How this was done" section. Wraps the technical sub-agent
// timings + the full process trace. Closed by default — customers come for
// the answer, not the plumbing. Power users get one click to expand.
function HowThisWasDone({ job }: { job: any }) {
  const [open, setOpen] = useState(false);
  const r = job.result ?? {};
  const stepCount = r.plan?.steps?.length ?? 0;
  const subagents = (r.subagentTimings ?? []).reduce((n: number, w: any) => n + (w.ioCount ?? 0) + (w.llmCount ?? 0), 0);
  const summary = stepCount === 0
    ? "Direct answer — no tools needed"
    : `${stepCount} step${stepCount === 1 ? "" : "s"}${subagents > stepCount ? ` · ${subagents} sub-agents` : ""}`;
  return (
    <section className="mt-12 border-t border-ink-800 pt-6">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 text-left text-sm text-cream-300/70 hover:text-cream-100"
      >
        <span className="flex items-center gap-2">
          <span className="text-cream-300/50">{open ? "▾" : "▸"}</span>
          How this was done
        </span>
        <span className="text-[11px] text-cream-300/50">{summary}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-6">
          <SubagentSpinup budgets={r.budgets} timings={r.subagentTimings} />
          <ProcessTrace job={job} />
        </div>
      )}
    </section>
  );
}

function Sources({ runs }: { runs: any[] }) {
  const sources = useMemo(() => extractSources(runs), [runs]);
  if (sources.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="font-display text-xl text-cream-50 mb-3">Sources</h2>
      <ol className="space-y-2.5 text-sm">
        {sources.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="text-[11px] text-cream-300/40 font-mono mt-1 w-5 flex-shrink-0">[{i + 1}]</span>
            <div className="min-w-0 flex-1">
              {s.kind === "vault" ? (
                <Link to={`/knowledge/${s.path}`} className="text-violet-400 hover:text-violet-500 font-mono text-xs break-all">{s.path}</Link>
              ) : s.kind === "url" ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-500 break-all">{s.title || s.url}</a>
              ) : s.kind === "repo" ? (
                <a href={`https://github.com/${s.owner}/${s.name}`} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-500 font-mono text-xs">{s.owner}/{s.name}{s.path ? ` · ${s.path}` : ""}</a>
              ) : (
                <span className="text-cream-200">{s.label}</span>
              )}
              {s.note && <div className="text-[11px] text-cream-300/60 mt-0.5">{s.note}</div>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function QASummary({ review, quality, security, curation }: { review: any; quality: any; security: any; curation?: any }) {
  if (!review && !quality && !security && !curation) return null;
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl text-cream-50 mb-3">Quality assurance</h2>
      {curation && <CurationCard curation={curation} />}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        {quality && (
          <div className={`rounded-lg border p-4 ${quality.pass ? "border-leaf-500/30 bg-leaf-500/5" : "border-flame-500/30 bg-flame-500/5"}`}>
            <div className="text-[10px] uppercase tracking-wider text-cream-300/60">Quality</div>
            <div className={`text-lg font-display mt-1 ${quality.pass ? "text-leaf-400" : "text-flame-400"}`}>{quality.pass ? "Passed" : "Needs work"}</div>
            {typeof quality.score === "number" && <div className="text-[11px] text-cream-300/60 mt-1">Score {Math.round(quality.score * 100)}%</div>}
          </div>
        )}
        {security && (
          <div className={`rounded-lg border p-4 ${security.pass ? "border-leaf-500/30 bg-leaf-500/5" : "border-coral-500/30 bg-coral-500/5"}`}>
            <div className="text-[10px] uppercase tracking-wider text-cream-300/60">Security</div>
            <div className={`text-lg font-display mt-1 ${security.pass ? "text-leaf-400" : "text-coral-400"}`}>{security.pass ? "Clean" : `${(security.findings ?? []).length} finding${(security.findings ?? []).length === 1 ? "" : "s"}`}</div>
            {!security.pass && <div className="text-[11px] text-cream-300/60 mt-1">{(security.findings ?? []).slice(0, 2).map((f: any) => f.type).join(", ")}</div>}
          </div>
        )}
        {review && (
          <div className={`rounded-lg border p-4 ${review.verdict === "good" ? "border-leaf-500/30 bg-leaf-500/5" : review.verdict === "bad" ? "border-coral-500/30 bg-coral-500/5" : "border-flame-500/30 bg-flame-500/5"}`}>
            <div className="text-[10px] uppercase tracking-wider text-cream-300/60">Peer review</div>
            <div className={`text-lg font-display mt-1 ${review.verdict === "good" ? "text-leaf-400" : review.verdict === "bad" ? "text-coral-400" : "text-flame-400"}`}>{review.verdict === "needs-work" ? "Needs work" : review.verdict?.[0]?.toUpperCase() + review.verdict?.slice(1)}</div>
            {review.reviewer?.name && <div className="text-[11px] text-cream-300/60 mt-1">by {review.reviewer.name}</div>}
          </div>
        )}
      </div>
      {Array.isArray(quality?.issues) && quality.issues.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs text-cream-300/60 cursor-pointer hover:text-cream-100">Quality notes ({quality.issues.length})</summary>
          <ul className="mt-2 space-y-1 text-[12px] text-cream-200 list-disc pl-5">
            {quality.issues.map((issue: string, i: number) => <li key={i}>{issue}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

// The primary clawbot's curation verdict on a persona-shifter peer's draft.
// Captured = the answer passed quality + security + context-rooting and was
// distilled into 0-Inbox/. Not captured = primary refused; the answer still
// exists but didn't earn a place in the second brain.
function CurationCard({ curation }: { curation: any }) {
  const captured = curation.captured === true;
  const rooted = curation.rooted ?? {};
  return (
    <div className={`rounded-lg border p-4 mb-4 ${captured ? "border-leaf-500/30 bg-leaf-500/5" : "border-ink-700 bg-ink-950"}`}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${captured ? "bg-leaf-500" : "bg-cream-300/40"}`} />
        <span className="text-[10px] uppercase tracking-wider text-cream-300/60">Primary curation</span>
        <span className={`text-sm font-display ${captured ? "text-leaf-400" : "text-cream-300"}`}>{captured ? "Captured to your second brain" : "Not captured"}</span>
        {captured && curation.path && (
          <Link to={`/knowledge/${curation.path}`} className="ml-auto text-[12px] text-violet-400 hover:text-violet-500 font-mono">{curation.path}</Link>
        )}
      </div>
      {!captured && curation.reason && (
        <div className="text-[12px] text-cream-300/80">{curation.reason}</div>
      )}
      {(rooted.vaultCitations != null || rooted.webSources != null || rooted.githubRefs != null) && (
        <div className="mt-2 flex items-center gap-4 text-[11px] text-cream-300/60 flex-wrap">
          <span>Context-rooting:</span>
          <span><span className="text-cream-100 font-mono">{rooted.vaultCitations ?? 0}</span> vault refs</span>
          <span><span className="text-cream-100 font-mono">{rooted.webSources ?? 0}</span> web sources</span>
          <span><span className="text-cream-100 font-mono">{rooted.githubRefs ?? 0}</span> GitHub refs</span>
        </div>
      )}
    </div>
  );
}

// Sub-agent spin-up panel. The agent loop runs steps in two lanes (LLM and
// I/O) — this surfaces the budgets it picked, the wave-by-wave timing, and
// the idle-peer bonus that boosted it. Helps the user understand WHY a run
// was fast (or wasn't).
function SubagentSpinup({ budgets, timings }: { budgets?: any; timings?: any[] }) {
  if (!budgets && (!Array.isArray(timings) || timings.length === 0)) return null;
  const totalMs = Array.isArray(timings) ? timings.reduce((a, t) => a + (t.elapsedMs ?? 0), 0) : 0;
  const parallel = Array.isArray(timings) && timings.some(t => (t.ioCount ?? 0) + (t.llmCount ?? 0) > 1);
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl text-cream-50 mb-3">Sub-agent spin-up</h2>
      <div className="rounded-lg border border-leaf-500/30 bg-leaf-500/5 p-4">
        <div className="flex items-center gap-3 flex-wrap text-sm">
          {budgets && (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-cream-300/50">I/O lane</div>
                <div className="font-display text-xl text-cream-50">{budgets.io}</div>
              </div>
              <div className="w-px h-8 bg-ink-700" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-cream-300/50">LLM lane</div>
                <div className="font-display text-xl text-cream-50">{budgets.llm}</div>
              </div>
              {budgets.idlePeers > 0 && (
                <>
                  <div className="w-px h-8 bg-ink-700" />
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-cream-300/50">Idle peers</div>
                    <div className="font-display text-xl text-leaf-400">+{budgets.idlePeers}</div>
                  </div>
                </>
              )}
            </>
          )}
          {totalMs > 0 && (
            <div className="ml-auto text-right">
              <div className="text-[10px] uppercase tracking-wider text-cream-300/50">Sub-agent time</div>
              <div className="font-display text-xl text-cream-50">{(totalMs / 1000).toFixed(1)}s</div>
            </div>
          )}
        </div>
        {parallel && Array.isArray(timings) && (
          <div className="mt-3 pt-3 border-t border-ink-800">
            <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-2">Per-wave timing</div>
            <ul className="space-y-1 text-[12px]">
              {timings.map((t: any, i: number) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="font-mono text-cream-300/60 w-12">W{t.wave}</span>
                  <div className="flex-1 h-1.5 bg-ink-800 rounded overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-leaf-500 to-violet-500" style={{ width: `${Math.min(100, (t.elapsedMs / Math.max(1, totalMs)) * 100)}%` }} />
                  </div>
                  <span className="font-mono text-cream-300/70 w-16 text-right">{(t.elapsedMs / 1000).toFixed(1)}s</span>
                  <span className="font-mono text-cream-300/40 w-24">{t.ioCount ?? 0} I/O · {t.llmCount ?? 0} LLM</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

function ProcessTrace({ job }: { job: any }) {
  const r = job.result ?? {};
  const steps: any[] = r.plan?.steps ?? [];
  const runs: any[] = r.runs ?? [];
  if (steps.length === 0) return null;
  return (
    <section className="mt-10">
      <details>
        <summary className="cursor-pointer text-sm text-cream-300/70 hover:text-cream-100">How Neuro arrived at this — {steps.length} {steps.length === 1 ? "step" : "steps"}</summary>
        <ol className="mt-3 space-y-2 text-sm pl-1">
          {steps.map((s, i) => {
            const run = runs[i];
            const dot = run?.ok ? "bg-leaf-500" : run?.error ? "bg-coral-500" : "bg-cream-300/30";
            return (
              <li key={i} className="flex items-start gap-3">
                <span className={`inline-block w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0 ${dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-cream-100">{s.label || s.tool}</div>
                  {s.rationale && <div className="text-[11px] text-cream-300/60 mt-0.5">{s.rationale}</div>}
                  <div className="flex gap-3 mt-1 text-[10px] text-cream-300/40 font-mono">
                    {run?.modelUsed && <span>{run.modelUsed}</span>}
                    {run?.durationMs != null && <span>{(run.durationMs / 1000).toFixed(1)}s</span>}
                    {run?.error && <span className="text-coral-400">error</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}

// Walk the executed runs and build a deduplicated source list. Pulls vault
// paths from search/read/list/write tools, URLs from fetch/scrape, and repo
// references from github tools.
function extractSources(runs: any[]): { kind: string; [k: string]: any }[] {
  const out: any[] = [];
  const seen = new Set<string>();
  const add = (key: string, src: any) => { if (seen.has(key)) return; seen.add(key); out.push(src); };

  for (const run of runs) {
    if (!run?.ok || !run?.step) continue;
    const tool = run.step.tool;
    const args = run.step.args ?? {};
    const result = run.result ?? {};
    if (tool === "vault.search" && Array.isArray(result.matches)) {
      for (const m of result.matches.slice(0, 5)) {
        if (m?.path) add(`vault:${m.path}`, { kind: "vault", path: m.path, note: m.preview ? `“${m.preview.slice(0, 90)}”` : undefined });
      }
    } else if ((tool === "vault.read" || tool === "vault.write" || tool === "vault.append" || tool === "vault.create_zettel") && (args.path || result.path || result.written)) {
      const p = String(result.path ?? result.written ?? args.path);
      add(`vault:${p}`, { kind: "vault", path: p });
    } else if (tool === "research.deep") {
      for (const h of (result.vaultHits ?? []).slice(0, 4)) {
        if (h?.path) add(`vault:${h.path}`, { kind: "vault", path: h.path });
      }
      for (const w of (result.webSources ?? []).slice(0, 6)) {
        if (w?.url) add(`url:${w.url}`, { kind: "url", url: w.url, title: w.title });
      }
      if (result.captured?.path) add(`vault:${result.captured.path}`, { kind: "vault", path: result.captured.path, note: "Captured by research.deep" });
    } else if (tool === "research.multiperspective") {
      for (const h of (result.vaultHits ?? []).slice(0, 4)) {
        if (h?.path) add(`vault:${h.path}`, { kind: "vault", path: h.path });
      }
      // Walk each perspective's sources so the user can see which framing
      // yielded which source — note added so the source list reads as
      // "[3] (recent) <title>" in spirit, even without dedicated rendering.
      for (const p of (result.perspectiveResults ?? [])) {
        for (const s of (p.sources ?? [])) {
          if (s?.url && s.ok !== false) add(`url:${s.url}`, { kind: "url", url: s.url, title: s.title, note: `from ${p.name} perspective` });
        }
      }
      if (result.captured?.path) add(`vault:${result.captured.path}`, { kind: "vault", path: result.captured.path, note: "Captured multi-perspective report" });
    } else if (tool === "web.fetch" || tool === "web.scrape") {
      const u = String(args.url ?? result.url ?? "");
      if (u) add(`url:${u}`, { kind: "url", url: u, title: result.title });
    } else if (tool === "web.search" && Array.isArray(result.results)) {
      for (const w of result.results.slice(0, 5)) if (w?.url) add(`url:${w.url}`, { kind: "url", url: w.url, title: w.title });
    } else if (tool === "github.read_repo" || tool === "github.get_file") {
      const owner = String(args.owner ?? "");
      const name = String(args.name ?? "");
      const path = args.path ? String(args.path) : undefined;
      if (owner && name) add(`gh:${owner}/${name}${path ?? ""}`, { kind: "repo", owner, name, path });
    }
  }
  return out;
}

function cleanTitle(t: any): string {
  if (typeof t !== "string") return "";
  return t.replace(/^Ad-hoc:\s*/i, "").trim();
}
