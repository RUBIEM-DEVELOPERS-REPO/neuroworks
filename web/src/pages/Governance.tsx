import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { marked } from "marked";
import { Shield, Upload, Trash2, FileText, AlertTriangle, CheckCircle2, ChevronRight, Download, BookOpen, Brain, ThumbsUp, ThumbsDown, AlertOctagon, Info } from "lucide-react";
import { api, type GovernancePolicy, type ExtractedConstraint } from "../lib/api";
import { Card, Button } from "../components/Card";

export function Governance() {
  const [policies, setPolicies] = useState<GovernancePolicy[]>([]);
  const [prefixBytes, setPrefixBytes] = useState(0);
  const [prefixActive, setPrefixActive] = useState(false);
  const [err, setErr] = useState("");
  const [openPolicy, setOpenPolicy] = useState<{ name: string; body: string } | null>(null);
  const [constraints, setConstraints] = useState<ExtractedConstraint[]>([]);
  const [constraintsByPolicy, setConstraintsByPolicy] = useState<Record<string, ExtractedConstraint[]>>({});
  const [extracting, setExtracting] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [checkResult, setCheckResult] = useState<{ constrained: boolean; summary: string; violations: any[] } | null>(null);
  const [checking, setChecking] = useState(false);

  async function load() {
    try {
      const r = await api.listGovernance();
      setPolicies(r.policies);
      setPrefixBytes(r.prefixBytes);
      setPrefixActive(r.prefixActive);
      const cr = await api.getConstraints();
      setConstraints(cr.constraints);
      setConstraintsByPolicy(cr.byPolicy);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }
  useEffect(() => {
    load();
    const i = setInterval(load, 10_000);
    return () => clearInterval(i);
  }, []);

  async function viewPolicy(p: GovernancePolicy) {
    if (openPolicy?.name === p.name) { setOpenPolicy(null); return; }
    try {
      const r = await api.getGovernance(p.name);
      setOpenPolicy({ name: r.name, body: r.body });
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  async function remove(p: GovernancePolicy) {
    if (!confirm(`Delete policy "${p.name}"? It will no longer apply as a guardrail.`)) return;
    try { await api.deleteGovernance(p.name); if (openPolicy?.name === p.name) setOpenPolicy(null); await load(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  async function extract(p: GovernancePolicy) {
    setExtracting(p.name);
    try {
      const r = await api.extractConstraints(p.name);
      await load();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setExtracting(null); }
  }

  async function reviewConstraint(c: ExtractedConstraint, accept: boolean) {
    try {
      await api.updateConstraint(c.policyName, c.id, { reviewed: true, accepted: accept });
      await load();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  async function checkAction() {
    if (!action.trim()) return;
    setChecking(true); setCheckResult(null);
    try {
      const r = await api.checkAction(action);
      setCheckResult(r);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setChecking(false); }
  }

  const totalConstraints = constraints.length;
  const reviewedCount = constraints.filter(c => c.reviewed).length;
  const acceptedCount = constraints.filter(c => c.accepted).length;
  const hardCount = constraints.filter(c => c.severity === "hard").length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-cream-50">Governance</h1>
        <p className="text-sm text-cream-300/70 mt-1">
          Upload company policies, codes of conduct, data-handling rules, brand voice guides. Every file here becomes a guardrail prepended to Neuro's system prompt on every task.
        </p>
      </div>

      {err && (
        <div className="bg-coral-500/10 border border-coral-500/30 text-coral-300 text-sm rounded-md px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} /> {err}
        </div>
      )}

      <Card>
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${prefixActive ? "bg-leaf-500/10 border border-leaf-500/30 text-leaf-300" : "bg-ink-850 border border-ink-700 text-cream-300/70"}`}>
            <Shield size={14} />
            {prefixActive ? "Guardrails active" : "No guardrails set"}
          </div>
          <span className="text-xs text-cream-300/60">
            {policies.length} polic{policies.length === 1 ? "y" : "ies"}
            {prefixBytes > 0 && <> · {(prefixBytes / 1024).toFixed(1)} KB prefix</>}
            {totalConstraints > 0 && <> · {acceptedCount}/{totalConstraints} constraints active ({hardCount} hard)</>}
          </span>
          <div className="ml-auto">
            <PolicyUpload onUploaded={load} />
          </div>
        </div>
      </Card>

      {/* Constraint status summary */}
      {totalConstraints > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-3 text-center">
            <div className="font-display text-xl text-cream-50">{totalConstraints}</div>
            <div className="text-[10px] text-cream-300/60 mt-1">Constraints extracted</div>
          </div>
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-3 text-center">
            <div className="font-display text-xl text-violet-400">{reviewedCount}</div>
            <div className="text-[10px] text-cream-300/60 mt-1">Reviewed</div>
          </div>
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-3 text-center">
            <div className="font-display text-xl text-leaf-400">{acceptedCount}</div>
            <div className="text-[10px] text-cream-300/60 mt-1">Accepted</div>
          </div>
          <div className="bg-ink-900 border border-ink-800 rounded-xl p-3 text-center">
            <div className="font-display text-xl text-flame-400">{hardCount}</div>
            <div className="text-[10px] text-cream-300/60 mt-1">Hard (enforced)</div>
          </div>
        </div>
      )}

      <Card title="Active policies">
        {policies.length === 0 ? (
          <div className="text-sm text-cream-300/60">
            No policies uploaded yet. Upload a Markdown file and the agent will start honoring it.
          </div>
        ) : (
          <ul className="divide-y divide-ink-800">
            {policies.map(p => {
              const policyConstraints = constraintsByPolicy[p.name] ?? [];
              const pendingReview = policyConstraints.filter(c => !c.reviewed).length;
              return (
                <li key={p.name} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-3">
                    <FileText size={14} className="text-violet-400 mt-1 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => viewPolicy(p)}
                        className="inline-flex items-center gap-1 text-sm text-cream-50 font-medium hover:text-violet-400"
                      >
                        <ChevronRight size={12} className={`transition-transform ${openPolicy?.name === p.name ? "rotate-90" : ""}`} />
                        {p.name}
                        {p.reference && (
                          <span className="ml-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300">
                            <BookOpen size={9} /> reference
                          </span>
                        )}
                        {pendingReview > 0 && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-flame-500/15 text-flame-300">
                            <AlertOctagon size={9} /> {pendingReview} pending
                          </span>
                        )}
                      </button>
                      <div className="text-[11px] text-cream-300/60 mt-0.5">
                        {(p.bytes / 1024).toFixed(1)} KB
                        <Link to={`/knowledge/${p.path}`} className="ml-2 text-violet-400 hover:text-violet-500">view</Link>
                        <a href={api.governanceDownloadUrl(p.name)} download={`${p.name}.md`} className="ml-2 text-violet-400 hover:text-violet-500"><Download size={11} /> download</a>
                        {policyConstraints.length > 0 && (
                          <span className="ml-2 text-cream-300/50">{policyConstraints.filter(c => c.accepted).length}/{policyConstraints.length} constraints active</span>
                        )}
                      </div>

                      {/* Extract constraints button */}
                      {!p.reference && (
                        <div className="mt-2">
                          {policyConstraints.length === 0 ? (
                            <button
                              onClick={() => extract(p)}
                              disabled={extracting === p.name}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-300 hover:bg-violet-500/20 disabled:opacity-50"
                            >
                              <Brain size={11} /> {extracting === p.name ? "Extracting…" : "Extract constraints via AI"}
                            </button>
                          ) : (
                            <button
                              onClick={() => extract(p)}
                              disabled={extracting === p.name}
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-ink-800 border border-ink-700 text-cream-300/70 hover:text-cream-300 disabled:opacity-50"
                            >
                              <Brain size={11} /> Re-extract
                            </button>
                          )}
                        </div>
                      )}

                      {/* Constraints for this policy */}
                      {policyConstraints.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {policyConstraints.map(c => (
                            <div key={c.id} className={`flex items-start gap-2 p-2 rounded-md border text-xs ${
                              c.reviewed
                                ? c.accepted
                                  ? "bg-leaf-500/5 border-leaf-500/20"
                                  : "bg-ink-850 border-ink-700 opacity-60"
                                : "bg-flame-500/5 border-flame-500/20"
                            }`}>
                              <div className={`mt-0.5 shrink-0 ${c.severity === "hard" ? "text-flame-400" : "text-violet-400"}`}>
                                {c.severity === "hard" ? <AlertOctagon size={12} /> : <Info size={12} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-cream-100">{c.rule}</div>
                                <div className="flex items-center gap-2 mt-1 text-[10px] text-cream-300/50">
                                  <span className={`px-1 py-0.5 rounded ${c.severity === "hard" ? "bg-flame-500/10 text-flame-300" : "bg-violet-500/10 text-violet-300"}`}>
                                    {c.severity}
                                  </span>
                                  <span>{c.category}</span>
                                  {c.details && <span className="truncate" title={c.details}>{c.details}</span>}
                                </div>
                              </div>
                              {!c.reviewed && (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => reviewConstraint(c, true)}
                                    className="p-1 rounded hover:bg-leaf-500/20 text-cream-300/70 hover:text-leaf-400"
                                    title="Accept this constraint"
                                  >
                                    <ThumbsUp size={12} />
                                  </button>
                                  <button
                                    onClick={() => reviewConstraint(c, false)}
                                    className="p-1 rounded hover:bg-coral-500/20 text-cream-300/70 hover:text-coral-400"
                                    title="Reject this constraint"
                                  >
                                    <ThumbsDown size={12} />
                                  </button>
                                </div>
                              )}
                              {c.reviewed && c.accepted && (
                                <CheckCircle2 size={12} className="text-leaf-400 shrink-0 mt-0.5" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {openPolicy?.name === p.name && (
                        <div className="mt-3 bg-ink-950 border border-ink-800 rounded p-3 prose-vault text-sm" dangerouslySetInnerHTML={{ __html: marked.parse(openPolicy.body) as string }} />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      className="text-cream-300/70 hover:text-coral-400 p-1.5 rounded hover:bg-ink-800"
                      title="Delete this policy"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* HITL gate: test an action against active constraints */}
      {acceptedCount > 0 && (
        <Card title="Test action against constraints">
          <p className="text-xs text-cream-300/60 mb-3">Check whether a proposed agent action violates any active constraints.</p>
          <div className="flex items-center gap-2">
            <input
              value={action}
              onChange={e => setAction(e.target.value)}
              placeholder='e.g. "Export all customer email addresses to a CSV file"'
              className="flex-1 bg-ink-800 border border-ink-700 rounded-lg px-3 py-2 text-sm text-cream-100 placeholder:text-cream-300/40 outline-none focus:border-violet-500/60"
            />
            <button
              onClick={checkAction}
              disabled={checking || !action.trim()}
              className="bg-violet-500 hover:bg-violet-600 disabled:opacity-50 text-white text-xs font-medium px-4 py-2 rounded-lg"
            >
              {checking ? "Checking…" : "Check"}
            </button>
          </div>
          {checkResult && (
            <div className={`mt-3 text-xs p-3 rounded-md border ${checkResult.constrained ? "bg-flame-500/10 border-flame-500/30 text-flame-300" : "bg-leaf-500/10 border-leaf-500/20 text-leaf-300"}`}>
              <div className="flex items-start gap-2">
                {checkResult.constrained ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={14} className="shrink-0 mt-0.5" />}
                <div>
                  <div className="font-medium">{checkResult.summary}</div>
                  {checkResult.violations.map((v: any, i: number) => (
                    <div key={i} className="mt-1 text-cream-300/70">{v.reason}</div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function PolicyUpload({ onUploaded }: { onUploaded: () => Promise<void> }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ status: "idle" | "uploading" | "saved" | "error"; filename?: string; error?: string }>({ status: "idle" });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setState({ status: "error", filename: file.name, error: "Policy files capped at 5 MB" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".md")) {
      setState({ status: "error", filename: file.name, error: "Only .md policies accepted" });
      return;
    }
    setState({ status: "uploading", filename: file.name });
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
      }
      const contentBase64 = btoa(binary);
      await api.upload({ filename: file.name, contentBase64, target: "vault", mimeType: file.type || "text/markdown", vaultFolder: "_governance" });
      try { await api.invalidateGovernance(); } catch { }
      await onUploaded();
      setState({ status: "saved", filename: file.name });
      setTimeout(() => setState(s => s.status === "saved" ? { status: "idle" } : s), 4000);
    } catch (err: any) {
      setState({ status: "error", filename: file.name, error: err?.message ?? String(err) });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={fileInputRef} type="file" accept=".md,text/markdown" className="hidden" onChange={handleFile} aria-label="Upload a policy file" />
      <Button onClick={() => fileInputRef.current?.click()} disabled={state.status === "uploading"}>
        <span className="inline-flex items-center gap-1.5"><Upload size={14} /> Upload policy</span>
      </Button>
      {state.status === "uploading" && <span className="text-[11px] text-violet-300">Uploading {state.filename}...</span>}
      {state.status === "saved" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-leaf-400"><CheckCircle2 size={11} /> Uploaded</span>
      )}
      {state.status === "error" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-coral-400" title={state.error}>
          <AlertTriangle size={11} /> {state.error?.slice(0, 60)}
        </span>
      )}
    </div>
  );
}
