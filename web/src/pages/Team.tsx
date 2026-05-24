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

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, brief); } catch {} }, [brief]);

  useEffect(() => {
    api.listPersonas()
      .then(r => setPersonas((r.personas ?? []) as Persona[]))
      .catch(e => setErr(e?.message ?? String(e)));
  }, []);

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
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl text-cream-50">Team</h1>
        <p className="text-xs text-cream-300/60 mt-1">
          Dispatch the same task to multiple employees in parallel — they spawn sub-agents and a peer worker takes the load if the primary is busy.
          Each employee returns their slice; the Tasks page shows every job live.
        </p>
      </div>

      {err && (
        <div className="bg-coral-500/10 border border-coral-500/30 text-coral-300 text-sm rounded-md px-3 py-2">{err}</div>
      )}

      <Card title="Team brief">
        <p className="text-xs text-cream-300/60 mb-2">The shared mission every employee will see.</p>
        <textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          rows={4}
          placeholder="E.g. — We're launching pricing tier v2 on Sep 14. Draft the launch story, plan the on-call swap for the rollout, and check the contract changes."
          className="w-full bg-ink-900 border border-ink-800 focus:border-violet-500/60 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none placeholder:text-cream-300/40"
          style={{ minHeight: 80 }}
        />

        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1">Shared context (attached to every employee)</div>
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {pendingAttachments.map(a => (
                <span key={a.contextId} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-leaf-500/10 border border-leaf-500/30 rounded-lg text-[11px]" title={`${a.chars} chars · ${(a.bytes / 1024).toFixed(1)} KB`}>
                  <span aria-hidden>📎</span>
                  <span className="text-cream-100 max-w-[200px] truncate">{a.filename}</span>
                  <span className="text-cream-300/50 text-[10px]">{a.chars > 0 ? `${a.chars.toLocaleString()} chars` : "binary"}</span>
                  <button type="button" onClick={() => removeAttachment(a.contextId)} className="text-cream-300/60 hover:text-coral-400 text-sm leading-none ml-1" aria-label={`Remove ${a.filename}`}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFile} />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadState.status === "uploading"} className="bg-ink-900 hover:bg-ink-850 border border-ink-800 hover:border-violet-500/40 text-cream-100 px-3 py-1.5 rounded-lg text-xs disabled:opacity-40">
              📎 Attach a document
            </button>
            {uploadState.status === "uploading" && <span className="text-[11px] text-violet-300">Uploading {uploadState.filename}…</span>}
            {uploadState.status === "error" && <span className="text-[11px] text-coral-400">Upload failed: {uploadState.error}</span>}
            <span className="text-[10px] text-cream-300/40">(context-only · ttl 1h)</span>
          </div>
        </div>
      </Card>

      <Card title="Assigned employees" action={<AddEmployee personas={personas} onAdd={addAssignment} assigned={new Set(assignments.map(a => a.personaId))} />}>
        {assignments.length === 0 ? (
          <p className="text-sm text-cream-300/60">
            No one assigned yet. Pick at least one employee above — or leave empty to dispatch the brief through the auto-router.
          </p>
        ) : (
          <ul className="space-y-3">
            {assignments.map(a => {
              const p = personas.find(x => x.id === a.personaId);
              return (
                <li key={a.uid} className="bg-ink-900 border border-ink-800 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm text-cream-50 font-medium truncate">{p?.name ?? a.personaId}</div>
                      <div className="text-[11px] text-cream-300/60 truncate">{p?.role ?? "(unknown role)"}</div>
                    </div>
                    <button type="button" onClick={() => removeAssignment(a.uid)} className="text-cream-300/60 hover:text-coral-400 text-sm" aria-label="Remove">✕</button>
                  </div>
                  <textarea
                    value={a.perRole}
                    onChange={e => updatePerRole(a.uid, e.target.value)}
                    rows={2}
                    placeholder={`Per-role instruction for ${p?.name ?? "this employee"} (optional — leave blank to let them pick the slice their role would own).`}
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
          {dispatching ? "Dispatching…" : `Dispatch to team${assignments.length > 0 ? ` (${assignments.length})` : ""}`}
        </Button>
        {dispatched.length > 0 && (
          <Button onClick={reset} variant="ghost">Clear results</Button>
        )}
        <Link to="/tasks" className="text-xs text-cream-300/70 hover:text-cream-50">View all tasks →</Link>
      </div>

      {dispatched.length > 0 && (
        <Card title={`Live results (${dispatched.length})`}>
          <p className="text-xs text-cream-300/60 mb-3">
            Each employee runs as a separate job — they may land on the primary, a peer worker, or an auto-spawned extra worker.
            Click a row to open the full result.
          </p>
          <div className="space-y-3">
            {dispatched.map(d => {
              const job = jobs[d.jobId];
              const status = job?.status ?? "pending";
              const answer = job?.result?.answer ?? "";
              return (
                <div key={d.jobId || d.taskIndex} className="bg-ink-900 border border-ink-800 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <div className="text-sm text-cream-50 truncate">
                        <span className="font-medium">{d.persona?.name ?? "Generalist"}</span>
                        <span className="text-cream-300/60 text-[11px] ml-2">{d.persona?.role ?? "primary"}</span>
                        {d.personaAutoRouted && <span className="ml-2 text-[10px] text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded">auto-routed</span>}
                      </div>
                      <div className="text-[10px] text-cream-300/40 font-mono">
                        {d.jobId.slice(0, 8)} · route={d.route}
                      </div>
                    </div>
                    <StatusPill status={status} />
                  </div>
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
                  {job && d.jobId && (
                    <div className="mt-2 text-right">
                      <Link to={`/results/${d.jobId}`} className="text-[11px] text-violet-400 hover:text-violet-300">Full result →</Link>
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
        className="bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white px-3 py-1 rounded text-xs"
      >
        + Add
      </button>
    </div>
  );
}
