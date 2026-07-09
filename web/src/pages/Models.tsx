import { useEffect, useState } from "react";
import {
  Cpu, Download, Trash2, Loader2, CheckCircle2, Cloud, Plus, Star, Zap,
} from "lucide-react";
import { api } from "../lib/api";
import { Card, showToast } from "../components/Card";

export function Models() {
  const [installed, setInstalled] = useState<{ name: string }[]>([]);
  const [def, setDef] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.listModels().then(r => { setInstalled(r.models); setDef(r.default); }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="nw-eyebrow">Models</div>
        <h1 className="text-2xl font-semibold tracking-tight text-cream-50 flex items-center gap-2">
          <Cpu className="w-6 h-6 text-violet-400" /> Models
        </h1>
        <p className="text-sm text-cream-300/70 mt-1 max-w-3xl">
          Pull local Ollama models, set the default, and plug in cloud model APIs you already
          use (OpenAI, OpenRouter, Groq, Together, or any OpenAI-compatible endpoint).
        </p>
      </div>

      <InstalledModels installed={installed} def={def} loading={loading} onChange={load} />
      <Catalog installedNames={new Set(installed.map(m => m.name))} onChange={load} />
      <Providers />
    </div>
  );
}

function InstalledModels({ installed, def, loading, onChange }: { installed: { name: string }[]; def: string; loading: boolean; onChange: () => void }) {
  async function setDefault(name: string) {
    try { await api.setDefaultModel(name); showToast(`Default model → ${name}`, "success"); onChange(); }
    catch (e: any) { showToast(e?.message ?? "Failed", "error"); }
  }
  async function del(name: string) {
    if (!confirm(`Delete local model "${name}"? You can re-pull it later.`)) return;
    try { await api.deleteModel(name); showToast(`Removed ${name}`, "success"); onChange(); }
    catch (e: any) { showToast(e?.message ?? "Delete failed", "error"); }
  }
  return (
    <Card title="Installed (Ollama)">
      {loading ? (
        <div className="flex items-center gap-2 text-cream-300/60 text-sm"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      ) : installed.length === 0 ? (
        <div className="text-sm text-cream-300/60">No local models yet. Pull one from the catalog below.</div>
      ) : (
        <ul className="space-y-1.5">
          {installed.map(m => (
            <li key={m.name} className="flex items-center gap-2 group">
              <span className={`text-sm font-mono ${m.name === def ? "text-violet-300" : "text-cream-200"}`}>{m.name}</span>
              {m.name === def && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 inline-flex items-center gap-1"><Star size={9} /> default</span>}
              <span className="flex-1" />
              {m.name !== def && (
                <button type="button" onClick={() => setDefault(m.name)} className="opacity-0 group-hover:opacity-100 text-xs text-cream-300/60 hover:text-violet-300">set default</button>
              )}
              <button type="button" aria-label={`Delete ${m.name}`} title="Delete model" onClick={() => del(m.name)} className="opacity-0 group-hover:opacity-100 text-cream-300/40 hover:text-coral-400 p-1"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Catalog({ installedNames, onChange }: { installedNames: Set<string>; onChange: () => void }) {
  const [catalog, setCatalog] = useState<{ name: string; size: string; blurb: string; installed: boolean }[]>([]);
  const [custom, setCustom] = useState("");
  const [pulling, setPulling] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  const load = () => api.modelCatalog().then(r => setCatalog(r.catalog)).catch(() => {});
  useEffect(() => { load(); }, [installedNames.size]);

  // Pull is a POST that streams SSE — consume the body stream directly.
  async function pull(name: string) {
    if (pulling) return;
    setPulling(name); setProgress("starting…");
    try {
      const resp = await fetch("/api/models/pull", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!resp.body) throw new Error("no stream");
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const f of frames) {
          const ev = /event: (\w+)/.exec(f)?.[1];
          const data = /data: (.*)/.exec(f)?.[1];
          if (!data) continue;
          const obj = JSON.parse(data);
          if (ev === "error") throw new Error(obj.error);
          if (ev === "progress") {
            const pct = obj.total ? ` ${Math.round((obj.completed / obj.total) * 100)}%` : "";
            setProgress(`${obj.status ?? ""}${pct}`);
          }
          if (ev === "done") setProgress("done");
        }
      }
      showToast(`Pulled ${name}`, "success");
      load(); onChange();
    } catch (e: any) {
      showToast(e?.message ?? "Pull failed", "error");
    } finally {
      setPulling(null); setProgress("");
    }
  }

  const inputCls = "flex-1 bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500 text-cream-100 placeholder:text-cream-300/30";

  return (
    <Card title="Pull a model">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {catalog.map(m => (
          <div key={m.name} className="flex items-start gap-3 p-3 rounded-lg bg-ink-800/50 border border-ink-700">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-cream-100">{m.name}</span>
                <span className="text-[10px] text-cream-300/50">{m.size}</span>
              </div>
              <div className="text-[11px] text-cream-300/60 mt-0.5">{m.blurb}</div>
              {pulling === m.name && <div className="text-[11px] text-violet-300 mt-1">{progress}</div>}
            </div>
            {m.installed || installedNames.has(m.name) ? (
              <span className="text-[11px] text-leaf-400 inline-flex items-center gap-1 shrink-0"><CheckCircle2 size={12} /> installed</span>
            ) : (
              <button type="button" onClick={() => pull(m.name)} disabled={pulling !== null} className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40 inline-flex items-center gap-1.5">
                {pulling === m.name ? <Loader2 className="animate-spin" size={12} /> : <Download size={12} />} Pull
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-ink-800">
        <input className={inputCls} placeholder="or pull any model by name, e.g. llama3.2:1b" value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => e.key === "Enter" && custom.trim() && pull(custom.trim())} />
        <button type="button" onClick={() => custom.trim() && pull(custom.trim())} disabled={pulling !== null || !custom.trim()} className="text-sm px-3 py-2 rounded-md bg-ink-800 border border-ink-700 text-cream-100 hover:border-violet-500/40 disabled:opacity-40 inline-flex items-center gap-1.5"><Download size={14} /> Pull</button>
      </div>
    </Card>
  );
}

function Providers() {
  const [providers, setProviders] = useState<any[]>([]);
  const [kinds, setKinds] = useState<Record<string, { label: string; baseUrl: string; modelHint: string }>>({});
  const [form, setForm] = useState({ kind: "openai", label: "", baseUrl: "", model: "", apiKey: "" });
  const [busy, setBusy] = useState(false);

  const load = () => api.listModelProviders().then(r => { setProviders(r.providers); setKinds(r.kinds); }).catch(() => {});
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.apiKey.trim() || !form.model.trim()) { showToast("Model and API key are required", "error"); return; }
    setBusy(true);
    try {
      await api.addModelProvider({ kind: form.kind, model: form.model.trim(), apiKey: form.apiKey.trim(), label: form.label.trim() || undefined, baseUrl: form.baseUrl.trim() || undefined });
      showToast("Provider added & activated", "success");
      setForm({ kind: form.kind, label: "", baseUrl: "", model: "", apiKey: "" });
      load();
    } catch (e: any) { showToast(e?.message ?? "Failed", "error"); }
    finally { setBusy(false); }
  }
  async function activate(id: string) { try { await api.activateModelProvider(id); showToast("Activated", "success"); load(); } catch (e: any) { showToast(e?.message ?? "Failed", "error"); } }
  async function remove(id: string) { if (!confirm("Remove this provider?")) return; try { await api.removeModelProvider(id); showToast("Removed", "success"); load(); } catch (e: any) { showToast(e?.message ?? "Failed", "error"); } }

  const inputCls = "w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500 text-cream-100 placeholder:text-cream-300/30";
  const hint = kinds[form.kind];

  return (
    <Card title="Cloud model APIs (bring your own)">
      <p className="text-xs text-cream-300/60 mb-3">Plug in a model API you already pay for. Stored encrypted; applied to the router immediately and on restart. Routed via the OpenAI-compatible chat API.</p>

      {providers.length > 0 && (
        <ul className="space-y-1.5 mb-4">
          {providers.map(p => (
            <li key={p.id} className="flex items-center gap-2 text-sm group">
              <Cloud size={14} className="text-violet-400 shrink-0" />
              <span className="text-cream-100">{p.label}</span>
              <span className="text-cream-300/50 font-mono text-xs">{p.model}</span>
              <span className="text-cream-300/30 text-[11px]">{p.keyPrefix}</span>
              {p.active && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-leaf-500/15 text-leaf-300 inline-flex items-center gap-1"><Zap size={9} /> active</span>}
              <span className="flex-1" />
              {!p.active && <button type="button" onClick={() => activate(p.id)} className="opacity-0 group-hover:opacity-100 text-xs text-cream-300/60 hover:text-violet-300">activate</button>}
              <button type="button" aria-label="Remove provider" title="Remove provider" onClick={() => remove(p.id)} className="opacity-0 group-hover:opacity-100 text-cream-300/40 hover:text-coral-400 p-1"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <div>
          <label className="text-[11px] text-cream-300/60 mb-1 block">Provider</label>
          <select aria-label="Provider kind" className={inputCls} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value, baseUrl: "" })}>
            {Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-cream-300/60 mb-1 block">Model</label>
          <input className={inputCls} placeholder={hint?.modelHint || "model name"} value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} />
        </div>
        {form.kind === "custom" && (
          <div className="md:col-span-2">
            <label className="text-[11px] text-cream-300/60 mb-1 block">Base URL (OpenAI-compatible)</label>
            <input className={inputCls} placeholder="https://your-endpoint/v1" value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} />
          </div>
        )}
        <div className="md:col-span-2">
          <label className="text-[11px] text-cream-300/60 mb-1 block">API key</label>
          <input type="password" className={inputCls} placeholder="sk-… (stored encrypted)" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} />
        </div>
      </div>
      <div className="flex justify-end mt-3">
        <button type="button" onClick={add} disabled={busy} className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-40">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />} Add provider
        </button>
      </div>
    </Card>
  );
}
