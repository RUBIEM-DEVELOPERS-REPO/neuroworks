import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Card } from "../components/Card";

export function Approvals() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  async function load() {
    try { const r = await api.listJobs(); setJobs(r.jobs.filter(j => j.status === "awaiting-approval")); }
    catch {}
  }
  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i); }, []);

  async function approve(id: string) {
    setBusy(id); setErr("");
    try { await api.approveJob(id); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }
  async function reject(id: string) {
    setBusy(id); setErr("");
    try { await api.rejectJob(id); await load(); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Approvals</h1>
        <p className="text-sm text-cream-300/70 mt-1">Tasks that write to GitHub or your vault wait here for your sign-off.</p>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-cream-300/40 text-4xl mb-3">✓</div>
            <div className="text-sm text-cream-200">Nothing waiting for approval.</div>
            <div className="text-xs text-cream-300/50 mt-1">Tasks with destructive scope (publishing folders, writing to vault) will queue here.</div>
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {jobs.map(j => {
            const planSteps = j.plan?.steps as { tool: string; label?: string; rationale?: string }[] | undefined;
            const hasPlan = Array.isArray(planSteps) && planSteps.length > 0;
            const effects = describeEffects(j);
            return (
              <li key={j.id}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-cream-50">{j.title ?? j.kind}</div>
                      <div className="text-xs text-cream-300/60 mt-0.5">{new Date(j.startedAt).toLocaleString()}</div>
                      {hasPlan ? (
                        <div className="mt-3 rounded-md border border-violet-500/30 bg-violet-500/5 p-3 text-xs">
                          <div className="text-[10px] uppercase tracking-wider text-violet-300/70 mb-2">Proposed plan — {planSteps!.length} step{planSteps!.length === 1 ? "" : "s"}</div>
                          <ol className="space-y-1.5">
                            {planSteps!.map((s, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-violet-400/70 font-mono shrink-0">{i + 1}.</span>
                                <span className="min-w-0">
                                  <span className="font-mono text-violet-200">{s.tool}</span>
                                  {s.label && s.label !== s.tool && <span className="text-cream-200"> — {s.label}</span>}
                                  {s.rationale && <span className="block text-cream-300/50 text-[11px]">{s.rationale}</span>}
                                </span>
                              </li>
                            ))}
                          </ol>
                          <div className="text-[10px] text-cream-300/40 mt-2 pt-2 border-t border-violet-500/15">Approving runs these steps as-is, then synthesises the answer.</div>
                        </div>
                      ) : (
                      <div className={`mt-3 rounded-md border p-3 text-xs ${effects.severity === "high" ? "bg-flame-500/5 border-flame-500/30" : "bg-ink-950 border-ink-800"}`}>
                        <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-1.5">If you approve, clawbot will:</div>
                        <ul className="space-y-1 text-cream-200">
                          {effects.bullets.map((b, i) => <li key={i}>· {b}</li>)}
                        </ul>
                        {effects.severity === "high" && (
                          <div className="text-[10px] text-flame-400 mt-2 pt-2 border-t border-flame-500/20">⚠ This action is hard to reverse — double-check the inputs.</div>
                        )}
                      </div>
                      )}
                      {j.inputs && Object.keys(j.inputs).length > 0 && (
                        <details className="mt-2">
                          <summary className="text-[11px] text-cream-300/60 cursor-pointer hover:text-cream-100">Raw inputs</summary>
                          <div className="mt-1.5 grid grid-cols-2 gap-1 text-[11px] font-mono">
                            {Object.entries(j.inputs).map(([k, v]) => (
                              <div key={k}><span className="text-cream-300/50">{k}:</span> <span className="text-cream-200 break-all">{String(v)}</span></div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => reject(j.id)} disabled={busy === j.id} className="px-3 py-1.5 rounded-md text-xs text-cream-300 hover:text-cream-100 border border-ink-700 disabled:opacity-50">Reject</button>
                      <button onClick={() => approve(j.id)} disabled={busy === j.id} className="px-3 py-1.5 rounded-md text-xs bg-leaf-500 hover:bg-leaf-400 text-ink-950 font-medium disabled:opacity-50">{busy === j.id ? "…" : "Approve"}</button>
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {err && <div className="text-xs text-coral-400">{err}</div>}
    </div>
  );
}

// Plain-English preview of what an awaiting-approval job will actually do.
// Severity gates the warning band: "high" for hard-to-reverse external writes,
// "medium" for vault-only writes, "low" for everything else.
function describeEffects(job: any): { bullets: string[]; severity: "high" | "medium" | "low" } {
  const inputs = job.inputs ?? {};
  const tpl = job.template as string | undefined;
  switch (tpl) {
    case "publish-folder": {
      const path = String(inputs.path ?? "(missing path)");
      const isPublic = Boolean(inputs.public);
      const repoName = String(inputs.name ?? "").trim() || "(auto-named from folder)";
      return {
        severity: "high",
        bullets: [
          `Create a ${isPublic ? "public" : "private"} GitHub repo named ${repoName}`,
          `Initialize git in ${path} (if not already a repo)`,
          `Push the folder contents to the new remote`,
        ],
      };
    }
    case "general-task": {
      const task = String(inputs.task ?? "").slice(0, 200);
      return {
        severity: "medium",
        bullets: [
          `Plan tool steps for: "${task}"`,
          `Execute the plan against the vault, GitHub, and local LLM`,
          `Save the successful plan as a reusable template`,
        ],
      };
    }
    case "add-note": {
      return {
        severity: "low",
        bullets: [
          `Write a new note to 0-Inbox/ titled "${String(inputs.title ?? "")}"`,
          `Commit and push the vault repo`,
        ],
      };
    }
    case "summarize-repo": {
      return {
        severity: "low",
        bullets: [
          `Fetch ${String(inputs.repo ?? "")} from GitHub and summarize via Ollama`,
          `Write the summary to _clawbot/summaries/ in the vault and push`,
        ],
      };
    }
    case "run-digest": {
      return {
        severity: "low",
        bullets: [
          `Trigger the daily-digest GitHub Actions workflow (lookback ${String(inputs.lookbackDays ?? 7)}d)`,
        ],
      };
    }
    case "sync-downloads": {
      return {
        severity: "medium",
        bullets: [
          `Mirror new files from ${String(inputs.source || "~/Downloads")} into the vault`,
          `Source files are not moved or deleted — only copies are made`,
          `Commit and push the vault`,
        ],
      };
    }
    default: {
      return {
        severity: "medium",
        bullets: [
          `Run template "${tpl ?? "unknown"}" with the inputs shown below`,
        ],
      };
    }
  }
}
