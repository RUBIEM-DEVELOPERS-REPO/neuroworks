import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { marked } from "marked";
import { Shield, Upload, Trash2, FileText, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { api, type GovernancePolicy } from "../lib/api";
import { Card, Button } from "../components/Card";

export function Governance() {
  const [policies, setPolicies] = useState<GovernancePolicy[]>([]);
  const [prefixBytes, setPrefixBytes] = useState(0);
  const [prefixActive, setPrefixActive] = useState(false);
  const [err, setErr] = useState("");
  const [openPolicy, setOpenPolicy] = useState<{ name: string; body: string } | null>(null);

  async function load() {
    try {
      const r = await api.listGovernance();
      setPolicies(r.policies);
      setPrefixBytes(r.prefixBytes);
      setPrefixActive(r.prefixActive);
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
    if (!confirm(`Delete policy "${p.name}"? It will no longer apply as a guardrail. This cannot be undone (re-upload to restore).`)) return;
    try { await api.deleteGovernance(p.name); if (openPolicy?.name === p.name) setOpenPolicy(null); await load(); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-cream-50">Governance</h1>
        <p className="text-sm text-cream-300/70 mt-1">
          Upload company policies, codes of conduct, data-handling rules, brand voice guides. Every file here becomes a guardrail prepended to clawbot's system prompt on every task. The agent honors them as overrides when a user request conflicts.
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
            {policies.length} polic{policies.length === 1 ? "y" : "ies"} loaded
            {prefixBytes > 0 && <> · {(prefixBytes / 1024).toFixed(1)} KB of system-prompt prefix</>}
          </span>
          <div className="ml-auto">
            <PolicyUpload onUploaded={load} />
          </div>
        </div>
      </Card>

      <Card title="Active policies">
        {policies.length === 0 ? (
          <div className="text-sm text-cream-300/60">
            No policies uploaded yet. Upload a Markdown file (or convert one from <Link to="/knowledge" className="text-violet-400 hover:text-violet-500">Knowledge</Link>) and the agent will start honoring it on the next task.
          </div>
        ) : (
          <ul className="divide-y divide-ink-800">
            {policies.map(p => (
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
                    </button>
                    <div className="text-[11px] text-cream-300/60 mt-0.5">
                      {(p.bytes / 1024).toFixed(1)} KB · uploaded {new Date(p.lastModified).toLocaleString()}
                      <Link to={`/knowledge/${p.path}`} className="ml-2 text-violet-400 hover:text-violet-500">view in vault</Link>
                    </div>
                    {openPolicy?.name === p.name && (
                      <div className="mt-3 bg-ink-950 border border-ink-800 rounded p-3 prose-vault text-sm" dangerouslySetInnerHTML={{ __html: marked.parse(openPolicy.body) as string }} />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    className="text-cream-300/70 hover:text-coral-400 p-1.5 rounded hover:bg-ink-800"
                    title="Delete this policy"
                    aria-label={`Delete ${p.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
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
      setState({ status: "error", filename: file.name, error: "Policy files capped at 5 MB so the prefix fits in any planner context" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".md")) {
      setState({ status: "error", filename: file.name, error: "Only .md (Markdown) policies are accepted right now" });
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
      await api.upload({
        filename: file.name,
        contentBase64,
        target: "vault",
        mimeType: file.type || "text/markdown",
        vaultFolder: "_governance",
      });
      // Bust the governance cache so the next general-task sees the new
      // policy immediately. The 60s TTL would otherwise leave us serving
      // a stale prefix.
      try { await api.invalidateGovernance(); } catch { /* tolerate */ }
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
