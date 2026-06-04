// Team page.
//
// Pick a SHARED brief (the team's mission), then assign one or more
// employees to it. Each employee gets the same brief PLUS a slot for
// per-role instructions ("Sam: scope the engineering", "Casey: draft
// the customer note"). Click Dispatch and every employee fires off in
// parallel through /api/team — they spawn jobs, run through the same
// plan-execute-synth pipeline that single-employee chat uses, and we
// poll each one live below.
//
// Multi-clawbot: when CLAWBOT_DELEGATE_ALL is on (the default), each
// team job goes through the same peer-routing pipeline as chat does,
// so a 5-employee team-task naturally fans out across whatever peer
// workers are available (primary + secondary + auto-spawned extras).

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { marked } from "marked";
import { Paperclip, X, RotateCcw, ArrowRight, Plus } from "lucide-react";
import { api } from "../lib/api";
import { Card, Button } from "../components/Card";

type Persona = {
  id: string;
  name: string;
  role: string;
  description?: string;
};

type Assignment = {
  uid: string; // local-only row id
  personaId: string;
  perRole: string; // extra instructions just for this employee
};

type DispatchResult = {
  taskIndex: number;
  persona: { id: string; name: string; role: string } | null;
  personaAutoRouted: boolean;
  jobId: string;
  route: "primary" | "auto" | "explicit" | "active";
};

type PendingAttachment = {
  contextId: string;
  filename: string;
  bytes: number;
  chars: number;
};

const STORAGE_KEY = "neuroworks.team.brief";

export function Team() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [brief, setBrief] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? ""; } catch { return ""; }
  });
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploadState, setUploadState] = useState<{ status: "idle" | "uploading" | "error"; filename?: string; error?: string }>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dispatch + live status
  const [dispatching, setDispatching] = useState(false);
  const [dispatched, setDispatched] = useState<DispatchResult[]>([]);
  const [jobs, setJobs] = useState<Record<string, any>>({});
  const [err, setErr] = useState("");
  // Per-row retry state. When a persona's job fails (or returns empty),
  // the row shows a Retry button; clicking it re-dispatches that ONE task
  // via /api/team and swaps the row's jobId so polling continues against
  // the new job. The original job is preserved in retryHistory so the
  // user can still inspect it on the Results page.
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [retryHistory, setRetryHistory] = useState<Record<string, string[]>>({});

  // Pre-organized teams + team templates (loaded from /api/teams).
  type PreorgTeam = { id: string; name: string; description: string; members: { personaId: string; role: string }[] };
  type TeamTpl = { id: string; name: string; description?: string; teamId?: string; tasks: { persona: string; content: string }[] };
  const [teams, setTeams] = useState<PreorgTeam[]>([]);
  const [teamTemplates, setTeamTemplates] = useState<TeamTpl[]>([]);
  const [pickTemplate, setPickTemplate] = useState("");

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, brief); } catch {} }, [brief]);

  useEffect(() => {
    api.listPersonas()
      .then(r => setPersonas((r.personas ?? []) as Persona[]))
      .catch(e => setErr(e?.message ?? String(e)));
    api.listTeams()
      .then(r => { setTeams(r.teams ?? []); setTeamTemplates(r.templates ?? []); })
      .catch(() => { /* teams are optional convenience — ignore load failures */ });
  }, []);

  // Load a pre-organized team's members into the assignment form so the user
  // can add a brief + per-role notes, then dispatch through the normal path.
  function loadTeam(teamId: string) {
    const t = teams.find(x => x.id === teamId);
    if (!t) return;
    setAssignments(t.members.map(m => ({
      uid: `${m.personaId}-${Math.random().toString(36).slice(2, 6)}`,
      personaId: m.personaId,
      perRole: "",
    })));
  }

  // One-click dispatch of a ready-made team template. The brief above is the
  // objective the server substitutes into the template's {{objective}} slots.
  async function dispatchTemplate(templateId: string) {
    if (dispatching || !templateId) return;
    if (!brief.trim()) {
      setErr("Type your objective in the Team brief below first — the template uses it as the input.");
      return;
    }
    setErr("");
    setDispatching(true);
    setJobs({});
    setDispatched([]);
    try {
      const r = await api.dispatchTeam({ templateId, objective: brief.trim() });
      setDispatched(r.tasks);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setDispatching(false);
    }
  }

  // Poll dispatched jobs every 2s until they all finish. Stops itself
  // when every job is in a terminal state.
  useEffect(() => {
    if (dispatched.length === 0) return;
    let alive = true;
    let timer: any;
    async function tick() {
      const ids = dispatched.map(d => d.jobId).filter(Boolean);
      const updates = await Promise.all(ids.map(id => api.getJob(id).catch(() => null)));
      if (!alive) return;
      setJobs(prev => {
        const next = { ...prev };
        for (let i = 0; i < ids.length; i++) {
          if (updates[i]) next[ids[i]] = updates[i];
        }
        return next;
      });
      const allDone = updates.every(j => j && (j.status === "succeeded" || j.status === "failed" || j.status === "rejected"));
      if (!allDone) timer = setTimeout(tick, 2000);
    }
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [dispatched]);

  function addAssignment(personaId: string) {
    if (!personaId) return;
    setAssignments(prev => prev.some(a => a.personaId === personaId)
      ? prev
      : [...prev, { uid: `${personaId}-${Math.random().toString(36).slice(2, 6)}`, personaId, perRole: "" }]);
  }

  function removeAssignment(uid: string) {
    setAssignments(prev => prev.filter(a => a.uid !== uid));
  }

  function updatePerRole(uid: string, text: string) {
    setAssignments(prev => prev.map(a => a.uid === uid ? { ...a, perRole: text } : a));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setUploadState({ status: "error", filename: file.name, error: "Too large (max 20 MB)" });
      return;
    }
    setUploadState({ status: "uploading", filename: file.name });
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
      }
      const contentBase64 = btoa(binary);
      const r = await api.upload({ filename: file.name, contentBase64, target: "context", mimeType: file.type || undefined });
      if (r.contextId) {
        setPendingAttachments(prev => [...prev, {
          contextId: r.contextId!,
          filename: r.filename ?? file.name,
          bytes: r.bytes ?? file.size,
          chars: r.extractedChars ?? 0,
        }]);
      }
      setUploadState({ status: "idle" });
    } catch (err: any) {
      setUploadState({ status: "error", filename: file.name, error: err?.message ?? String(err) });
    }
  }

  function removeAttachment(contextId: string) {
    setPendingAttachments(prev => prev.filter(a => a.contextId !== contextId));
  }

  async function dispatch() {
    if (dispatching) return;
    if (!brief.trim() && assignments.length === 0) {
      setErr("Add a team brief or at least one assigned employee.");
      return;
    }
    setErr("");
    setDispatching(true);
    setJobs({});
    setDispatched([]);
    try {
      // Construct each task: shared brief + per-role instructions stitched
      // together. The team endpoint takes one persona per task, so we
      // build N tasks from N assignments.
      const tasks = assignments.length > 0
        ? assignments.map(a => {
            const persona = personas.find(p => p.id === a.personaId);
            const personaTag = persona ? `[${persona.name} · ${persona.role}]` : `[${a.personaId}]`;
            const perRole = a.perRole.trim();
            const content = [
              `Team brief:\n${brief.trim() || "(no shared brief — work from the per-role instructions only)"}`,
              perRole ? `\nYour part as ${personaTag}:\n${perRole}` : `\nYour part as ${personaTag}: contribute the slice your role would naturally own.`,
            ].join("\n");
            return {
              persona: a.personaId,
              content,
              attachments: pendingAttachments.map(p => ({ contextId: p.contextId })),
            };
          })
        : [{
            content: brief.trim(),
            attachments: pendingAttachments.map(p => ({ contextId: p.contextId })),
          }];

      const r = await api.team(tasks);
      setDispatched(r.tasks);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setDispatching(false);
    }
  }

  function reset() {
    setDispatched([]);
    setJobs({});
    setErr("");
    setRetrying({});
    setRetryHistory({});
  }

  // Retry a single failed (or empty) team-task row. Re-dispatches just
  // that one task via /api/team, then swaps the row's jobId in-place so
  // the existing polling loop picks up the new job's status. Original
  // jobIds are preserved in retryHistory for audit.
  async function retryRow(rowIndex: number) {
    const d = dispatched[rowIndex];
    if (!d) return;
    const sourceTask = assignments.length > 0
      ? buildTaskFromAssignment(assignments.find(a => a.personaId === d.persona?.id))
      : null;
    if (!sourceTask) {
      setErr("Couldn't rebuild this task for retry — assignment may have been edited since dispatch.");
      return;
    }
    setRetrying(prev => ({ ...prev, [d.jobId]: true }));
    try {
      const r = await api.team([sourceTask]);
      const newDispatch = r.tasks?.[0];
      if (!newDispatch?.jobId) {
        setErr("Retry didn't return a new jobId — server may be overloaded. Try again in a moment.");
        return;
      }
      // Swap the row's jobId so the poller picks up the new one.
      setDispatched(prev => prev.map((p, i) => i === rowIndex ? { ...p, jobId: newDispatch.jobId } : p));
      setRetryHistory(prev => ({ ...prev, [newDispatch.jobId]: [...(prev[d.jobId] ?? []), d.jobId] }));
    } catch (e: any) {
      setErr(`Retry failed: ${e?.message ?? String(e)}`);
    } finally {
      setRetrying(prev => ({ ...prev, [d.jobId]: false }));
    }
  }

  // Rebuild a /api/team task payload from a single assignment — used by
  // retryRow so we re-send exactly the same content the original dispatch
  // sent.
  function buildTaskFromAssignment(a: Assignment | undefined) {
    if (!a) return null;
    const persona = personas.find(p => p.id === a.personaId);
    const personaTag = persona ? `[${persona.name} · ${persona.role}]` : `[${a.personaId}]`;
    const perRole = a.perRole.trim();
    const content = [
      `Team brief:\n${brief.trim() || "(no shared brief — work from the per-role instructions only)"}`,
      perRole ? `\nYour part as ${personaTag}:\n${perRole}` : `\nYour part as ${personaTag}: contribute the slice your role would naturally own.`,
    ].join("\n");
    return {
      persona: a.personaId,
      content,
      attachments: pendingAttachments.map(p => ({ contextId: p.contextId })),
    };
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-cream-50">Team</h1>
        <p className="text-xs text-cream-300/60 mt-1">
          Dispatch the same task to multiple employees in parallel. They spawn sub-agents and a peer worker takes the load if the primary is busy.
          Each employee returns their slice; the Tasks page shows every job live.
        </p>
      </div>

      {err && (
        <div className="bg-coral-500/10 border border-coral-500/30 text-coral-300 text-sm rounded-md px-3 py-2">{err}</div>
      )}

      {(teams.length > 0 || teamTemplates.length > 0) && (
        <Card title="Quick start: teams & templates">
          <p className="text-xs text-cream-300/60 mb-3">
            Load a <span className="text-cream-100">pre-organized team</span> to fill the employees below, or one-click a
            <span className="text-cream-100"> team template</span> (a ready-made brief) using your objective from “Team brief” as the input.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1">Pre-organized team</div>
              <select
                defaultValue=""
                onChange={e => { loadTeam(e.target.value); e.target.value = ""; }}
                aria-label="Load a pre-organized team into the form"
                className="w-full bg-ink-900 border border-ink-800 text-xs text-cream-100 rounded px-2 py-1.5 hover:border-violet-500/40 focus:outline-none focus:border-violet-500/60 cursor-pointer"
              >
                <option value="">— Load a team into the form —</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name} · {t.members.length} roles</option>
                ))}
              </select>
              <p className="text-[10px] text-cream-300/40 mt-1">Replaces the assigned employees below; you keep the brief.</p>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1">Team template (one-click brief)</div>
              <div className="flex items-center gap-2">
                <select
                  value={pickTemplate}
                  onChange={e => setPickTemplate(e.target.value)}
                  aria-label="Pick a team template to dispatch"
                  className="flex-1 bg-ink-900 border border-ink-800 text-xs text-cream-100 rounded px-2 py-1.5 hover:border-violet-500/40 focus:outline-none focus:border-violet-500/60 cursor-pointer"
                >
                  <option value="">— Pick a template —</option>
                  {teamTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} · {t.tasks.length} tasks</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => dispatchTemplate(pickTemplate)}
                  disabled={!pickTemplate || dispatching}
                  className="inline-flex items-center gap-1 bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white px-3 py-1.5 rounded text-xs whitespace-nowrap"
                >
                  <ArrowRight size={11} /> Dispatch
                </button>
              </div>
              <p className="text-[10px] text-cream-300/40 mt-1">Fans out as a parallel brief; uses the “Team brief” as the objective.</p>
            </div>
          </div>
        </Card>
      )}

      <Card title="1. Team brief">
        <p className="text-xs text-cream-300/60 mb-2">The shared mission every employee will see — and the objective for any template you dispatch above.</p>
        <textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          rows={4}
          placeholder="E.g. We're launching pricing tier v2 on Sep 14. Draft the launch story, plan the on-call swap for the rollout, and check the contract changes."
          className="w-full bg-ink-950 border border-ink-800 focus:border-violet-500/60 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none placeholder:text-cream-300/40 min-h-20"
        />

        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1">Shared context (attached to every employee)</div>
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {pendingAttachments.map(a => (
                <span key={a.contextId} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-leaf-500/10 border border-leaf-500/30 rounded-lg text-[11px]" title={`${a.chars} chars, ${(a.bytes / 1024).toFixed(1)} KB`}>
                  <Paperclip size={11} className="text-leaf-400" />
                  <span className="text-cream-100 max-w-[200px] truncate">{a.filename}</span>
                  <span className="text-cream-300/50 text-[10px]">{a.chars > 0 ? `${a.chars.toLocaleString()} chars` : "binary"}</span>
                  <button type="button" onClick={() => removeAttachment(a.contextId)} className="text-cream-300/60 hover:text-coral-400 ml-1" aria-label={`Remove ${a.filename}`}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFile} aria-label="Attach a document to share with every employee on this team task" />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadState.status === "uploading"} className="inline-flex items-center gap-1.5 bg-ink-950 hover:bg-ink-800 border border-ink-800 hover:border-violet-500/40 text-cream-100 px-3 py-1.5 rounded-lg text-xs disabled:opacity-40">
              <Paperclip size={12} /> Attach a document
            </button>
            {uploadState.status === "uploading" && <span className="text-[11px] text-violet-300">Uploading {uploadState.filename}...</span>}
            {uploadState.status === "error" && <span className="text-[11px] text-coral-400">Upload failed: {uploadState.error}</span>}
            <span className="text-[10px] text-cream-300/40">context-only, ttl 1h</span>
          </div>
        </div>
      </Card>

      <Card title="2. Assigned employees" action={<AddEmployee personas={personas} onAdd={addAssignment} assigned={new Set(assignments.map(a => a.personaId))} />}>
        {assignments.length === 0 ? (
          <p className="text-sm text-cream-300/60">
            No one assigned yet. Pick at least one employee above, or leave empty to dispatch the brief through the auto-router.
          </p>
        ) : (
          <ul className="divide-y divide-ink-800">
            {assignments.map((a, idx) => {
              const p = personas.find(x => x.id === a.personaId);
              return (
                <li key={a.uid} className={`py-3 ${idx === 0 ? "pt-0" : ""}`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm text-cream-50 font-medium truncate">{p?.name ?? a.personaId}</div>
                      <div className="text-[11px] text-cream-300/60 truncate">{p?.role ?? "unknown role"}</div>
                    </div>
                    <button type="button" onClick={() => removeAssignment(a.uid)} className="text-cream-300/60 hover:text-coral-400" aria-label="Remove">
                      <X size={14} />
                    </button>
                  </div>
                  <textarea
                    value={a.perRole}
                    onChange={e => updatePerRole(a.uid, e.target.value)}
                    rows={3}
                    placeholder={`Per-role instruction for ${p?.name ?? "this employee"}. Leave blank to let them pick the slice their role would own.`}
                    className="w-full bg-ink-950 border border-ink-800 focus:border-violet-500/60 rounded px-2.5 py-1.5 text-xs resize-y focus:outline-none placeholder:text-cream-300/40"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={dispatch} disabled={dispatching}>
          {dispatching ? "Dispatching..." : `3. Dispatch to team${assignments.length > 0 ? ` (${assignments.length})` : ""}`}
        </Button>
        {dispatched.length > 0 && (
          <Button onClick={reset} variant="ghost">Clear results</Button>
        )}
        <Link to="/tasks" className="inline-flex items-center gap-1 text-xs text-cream-300/70 hover:text-cream-50">
          View all tasks <ArrowRight size={11} />
        </Link>
      </div>

      {dispatched.length > 0 && (
        <Card title={`Live results (${dispatched.length})`}>
          <p className="text-xs text-cream-300/60 mb-3">
            Each employee runs as a separate job. They may land on the primary, a peer worker, or an auto-spawned extra worker.
            Click a row to open the full result.
          </p>
          <div className="divide-y divide-ink-800">
            {dispatched.map((d, rowIndex) => {
              const job = jobs[d.jobId];
              const status = job?.status ?? "pending";
              const answer = job?.result?.answer ?? "";
              const terminalFail = status === "failed" || status === "rejected";
              const completedButEmpty = status === "succeeded" && answer.length < 100;
              const canRetry = (terminalFail || completedButEmpty) && !retrying[d.jobId];
              const history = retryHistory[d.jobId] ?? [];
              const truncated = answer.length > 6000;
              return (
                <div key={d.jobId || d.taskIndex} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm text-cream-50 truncate">
                        <span className="font-medium">{d.persona?.name ?? "Generalist"}</span>
                        <span className="text-cream-300/60 text-[11px] ml-2">{d.persona?.role ?? "primary"}</span>
                        {d.personaAutoRouted && <span className="ml-2 text-[10px] text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded">auto-routed</span>}
                        {history.length > 0 && (
                          <span className="ml-2 text-[10px] text-flame-300 bg-flame-500/10 px-1.5 py-0.5 rounded" title={`Earlier attempts: ${history.map(h => h.slice(0, 8)).join(", ")}`}>
                            retry #{history.length}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-cream-300/40 font-mono">
                        {d.jobId.slice(0, 8)} · route={d.route}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusPill status={status} />
                      {retrying[d.jobId] && <span className="text-[10px] text-violet-300 animate-pulse">retrying...</span>}
                      {canRetry && (
                        <button
                          type="button"
                          onClick={() => retryRow(rowIndex)}
                          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-flame-500/40 text-flame-200 hover:bg-flame-500/10"
                          title={terminalFail ? "Job failed, re-dispatch the same task" : "Job returned an empty answer, re-dispatch the same task"}
                        >
                          <RotateCcw size={11} /> Retry
                        </button>
                      )}
                    </div>
                  </div>
                  {completedButEmpty && (
                    <div className="text-[11px] text-flame-300 bg-flame-500/10 border border-flame-500/30 rounded px-2 py-1 mb-2">
                      Returned an empty answer, likely an upstream LLM hiccup. Retry usually works.
                    </div>
                  )}
                  {job && Array.isArray(job.log) && job.log.length > 0 && (
                    <details className="mb-2">
                      <summary className="text-[11px] text-cream-300/70 cursor-pointer hover:text-cream-100">Activity ({job.log.length})</summary>
                      <pre className="text-[10px] text-cream-300/70 bg-ink-950 border border-ink-800 rounded p-2 mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {job.log.slice(-15).map((l: any) => (typeof l === "string" ? l : l?.message ?? JSON.stringify(l))).join("\n")}
                      </pre>
                    </details>
                  )}
                  {answer && (
                    <div className="bg-ink-950 border border-ink-800 rounded p-3 prose-vault text-sm text-cream-100" dangerouslySetInnerHTML={{ __html: marked.parse(answer.slice(0, 6000)) as string }} />
                  )}
                  {truncated && (
                    <div className="text-[11px] text-cream-300/50 mt-1">
                      Showing first 6,000 of {answer.length.toLocaleString()} chars. Open the full result for the rest.
                    </div>
                  )}
                  {job && d.jobId && (
                    <div className="mt-2 text-right">
                      <Link to={`/results/${d.jobId}`} className="inline-flex items-center gap-1 text-[11px] text-violet-400 hover:text-violet-300">
                        Full result <ArrowRight size={11} />
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isDone = status === "succeeded";
  const isFail = status === "failed" || status === "rejected";
  const isRun = status === "running";
  const palette = isDone
    ? "bg-leaf-500/15 text-leaf-300 border-leaf-500/30"
    : isFail
      ? "bg-coral-500/15 text-coral-300 border-coral-500/30"
      : isRun
        ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
        : "bg-ink-800 text-cream-300/70 border-ink-700";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${palette}`}>
      {status}
    </span>
  );
}

function AddEmployee({ personas, onAdd, assigned }: { personas: Persona[]; onAdd: (id: string) => void; assigned: Set<string> }) {
  const [pick, setPick] = useState("");
  const available = personas.filter(p => !assigned.has(p.id));
  return (
    <div className="flex items-center gap-2">
      <select
        value={pick}
        onChange={e => setPick(e.target.value)}
        aria-label="Pick an employee to add to the team"
        title="Pick an employee to add to the team"
        className="bg-ink-900 border border-ink-800 text-xs text-cream-100 rounded px-2 py-1 hover:border-violet-500/40 focus:outline-none focus:border-violet-500/60 cursor-pointer max-w-[260px]"
      >
        <option value="">— Pick an employee —</option>
        {available.map(p => (
          <option key={p.id} value={p.id}>{p.name} · {p.role}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => { if (pick) { onAdd(pick); setPick(""); } }}
        disabled={!pick}
        className="inline-flex items-center gap-1 bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white px-3 py-1 rounded text-xs"
      >
        <Plus size={11} /> Add
      </button>
    </div>
  );
}
