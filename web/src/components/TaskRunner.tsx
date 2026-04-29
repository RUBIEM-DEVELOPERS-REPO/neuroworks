import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Template } from "../lib/api";
import { Button, RoleIcon } from "./Card";

export function TaskRunner({ template, onClose, prefill }: { template: Template; onClose: () => void; prefill?: Record<string, any> }) {
  const nav = useNavigate();
  const [inputs, setInputs] = useState<Record<string, any>>(() => {
    const init: Record<string, any> = {};
    for (const i of template.inputs) if (i.default !== undefined) init[i.name] = i.default;
    if (prefill) Object.assign(init, prefill);
    return init;
  });
  const [repos, setRepos] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (template.inputs.some(i => i.type === "repo-picker")) {
      api.listRepos().then(r => setRepos(r.repos)).catch(() => setRepos([]));
    }
  }, [template]);

  async function submit() {
    setBusy(true); setErr("");
    try {
      const r = await api.runTemplate(template.id, inputs);
      onClose();
      nav(r.requiresApproval ? "/approvals" : `/tasks?focus=${r.jobId}`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm grid place-items-center" onClick={onClose}>
      <div className="bg-ink-900 border border-ink-700 rounded-xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 p-5 border-b border-ink-800">
          <RoleIcon role={template.role} />
          <div className="flex-1">
            <div className="text-xs text-cream-300/60 uppercase tracking-wider">{template.role}</div>
            <div className="font-display text-xl text-cream-50 leading-tight mt-0.5">{template.title}</div>
            <div className="text-sm text-cream-300 mt-1">{template.description}</div>
          </div>
          <button onClick={onClose} className="text-cream-300/60 hover:text-cream-100 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {template.inputs.length === 0 && <div className="text-sm text-cream-300/70">No inputs needed. Click Delegate to run.</div>}
          {template.inputs.map(input => (
            <div key={input.name}>
              <label className="block text-xs text-cream-300 mb-1.5 uppercase tracking-wider">{input.label}{input.required && <span className="text-coral-400 ml-1">*</span>}</label>
              {input.type === "repo-picker" ? (
                <select
                  aria-label={input.label}
                  value={inputs[input.name] ?? ""}
                  onChange={e => setInputs(s => ({ ...s, [input.name]: e.target.value }))}
                  className="w-full bg-ink-800 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                >
                  <option value="">{repos === null ? "Loading…" : "Pick a project…"}</option>
                  {(repos ?? []).map(r => <option key={r.full} value={r.full}>{r.full}</option>)}
                </select>
              ) : input.type === "textarea" ? (
                <textarea
                  rows={5}
                  value={inputs[input.name] ?? ""}
                  onChange={e => setInputs(s => ({ ...s, [input.name]: e.target.value }))}
                  placeholder={input.placeholder}
                  className="w-full bg-ink-800 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                />
              ) : input.type === "boolean" ? (
                <label className="flex items-center gap-2 text-sm text-cream-200">
                  <input type="checkbox" checked={!!inputs[input.name]} onChange={e => setInputs(s => ({ ...s, [input.name]: e.target.checked }))} />
                  {input.label}
                </label>
              ) : (
                <input
                  type={input.type === "number" ? "number" : "text"}
                  value={inputs[input.name] ?? ""}
                  onChange={e => setInputs(s => ({ ...s, [input.name]: input.type === "number" ? Number(e.target.value) : e.target.value }))}
                  placeholder={input.placeholder}
                  className="w-full bg-ink-800 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
                />
              )}
            </div>
          ))}
          {template.requiresApproval && (
            <div className="text-xs text-flame-400 bg-flame-500/10 border border-flame-500/30 rounded-md px-3 py-2">⚠ This task writes to GitHub or your vault and will land in Approvals before running.</div>
          )}
          {err && <div className="text-xs text-coral-400">{err}</div>}
        </div>

        <div className="flex items-center justify-between p-5 border-t border-ink-800">
          <div className="text-xs text-cream-300/60">~{template.estimateSeconds}s · agent: {template.agent}</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Delegating…" : "Delegate"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
