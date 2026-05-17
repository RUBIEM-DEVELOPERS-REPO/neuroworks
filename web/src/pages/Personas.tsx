import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Card, Button } from "../components/Card";

type Persona = {
  id: string; name: string; role: string; description: string; jobDescription: string;
  tone?: string; responsibilities: string[]; createdAt: string;
};

export function Personas() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  // Per-persona template metadata: count + a transient "just refreshed" toast.
  const [templateCounts, setTemplateCounts] = useState<Record<string, number>>({});
  const [refreshState, setRefreshState] = useState<Record<string, { state: "idle" | "running" | "ok" | "fail"; info?: string }>>({});

  // Form state
  const [name, setName] = useState("");
  const [jd, setJd] = useState("");
  const [tone, setTone] = useState("");
  const [preview, setPreview] = useState<{ role: string; description: string; tone: string; responsibilities: string[] } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewTimer = useRef<any>(null);

  async function load() {
    try {
      const r = await api.listPersonas();
      setPersonas(r.personas);
      setActiveId(r.activeId);
      // Fetch template counts for every persona in parallel.
      const counts: Record<string, number> = {};
      await Promise.all(r.personas.map(async (p: Persona) => {
        try { const t = await api.listPersonaTemplates(p.id); counts[p.id] = t.templates.length; }
        catch { counts[p.id] = 0; }
      }));
      setTemplateCounts(counts);
    }
    catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function refreshTemplates(personaId: string) {
    setRefreshState(s => ({ ...s, [personaId]: { state: "running" } }));
    try {
      const r = await api.refreshPersonaTemplates(personaId);
      setRefreshState(s => ({ ...s, [personaId]: { state: "ok", info: `+${r.added} new · ${r.kept} kept · ${r.removed} removed` } }));
      setTemplateCounts(c => ({ ...c, [personaId]: r.ids.length }));
      setTimeout(() => setRefreshState(s => {
        const next = { ...s };
        if (next[personaId]?.state === "ok") delete next[personaId];
        return next;
      }), 3500);
    } catch (e: any) {
      setRefreshState(s => ({ ...s, [personaId]: { state: "fail", info: e?.message ?? String(e) } }));
    }
  }

  // Debounced LLM preview when JD changes
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    if (jd.trim().length < 30) { setPreview(null); return; }
    previewTimer.current = setTimeout(async () => {
      setPreviewBusy(true);
      try { setPreview(await api.previewPersona(jd)); }
      catch { setPreview(null); }
      finally { setPreviewBusy(false); }
    }, 800);
  }, [jd]);

  async function create() {
    if (!name.trim() || !jd.trim()) { setErr("name and job description are required"); return; }
    setCreating(true); setErr("");
    try {
      await api.createPersona({ name: name.trim(), jobDescription: jd, tone: tone || preview?.tone, role: preview?.role, description: preview?.description, responsibilities: preview?.responsibilities });
      setName(""); setJd(""); setTone(""); setPreview(null);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setCreating(false); }
  }

  async function activate(id: string | "default") { try { await api.activatePersona(id); await load(); } catch (e: any) { setErr(e.message); } }
  async function deactivate() { try { await api.deactivatePersona(); await load(); } catch (e: any) { setErr(e.message); } }
  async function remove(id: string) { try { await api.deletePersona(id); await load(); } catch (e: any) { setErr(e.message); } }

  function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setJd(String(reader.result ?? ""));
    reader.readAsText(f);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Personas</h1>
        <p className="text-sm text-cream-300/70 mt-1">Upload a job description and clawbot adopts that role — plans, replies, and tool choices all framed by the persona.</p>
      </div>

      {err && <div className="text-coral-400 text-sm">{err}</div>}

      <Card title="Create from job description">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-cream-300 mb-1.5 uppercase tracking-wider">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Marketing Specialist" className="w-full bg-ink-800 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
          </div>
          <div>
            <label className="block text-xs text-cream-300 mb-1.5 uppercase tracking-wider flex items-center justify-between">
              Job description <input type="file" accept=".txt,.md,.json" onChange={uploadFile} className="text-[10px] text-cream-300" />
            </label>
            <textarea value={jd} onChange={e => setJd(e.target.value)} rows={9} placeholder="Paste a JD or upload a .txt / .md file. Clawbot extracts role, tone, and key responsibilities automatically." className="w-full bg-ink-800 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
          </div>
          <div>
            <label className="block text-xs text-cream-300 mb-1.5 uppercase tracking-wider">Tone (optional)</label>
            <input value={tone} onChange={e => setTone(e.target.value)} placeholder="e.g. concise · warm · formal" className="w-full bg-ink-800 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
          </div>

          {previewBusy && <div className="text-xs text-cream-300/60">Extracting role / tone / responsibilities…</div>}
          {preview && (
            <div className="bg-ink-950 border border-violet-500/30 rounded-md p-3 text-xs space-y-1.5">
              <div className="text-cream-300/60 uppercase tracking-wider text-[10px]">Auto-extracted from JD</div>
              <div><span className="text-cream-300/60">Role:</span> <span className="text-cream-100">{preview.role}</span></div>
              <div><span className="text-cream-300/60">Tone:</span> <span className="text-cream-100">{preview.tone}</span></div>
              {preview.description && <div><span className="text-cream-300/60">Summary:</span> <span className="text-cream-200">{preview.description}</span></div>}
              {preview.responsibilities.length > 0 && (
                <div>
                  <span className="text-cream-300/60">Responsibilities:</span>
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {preview.responsibilities.map((r, i) => <li key={i} className="text-cream-200">{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={create} disabled={creating || !name.trim() || !jd.trim()}>{creating ? "Saving…" : "Save persona"}</Button>
          </div>
        </div>
      </Card>

      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl text-cream-50">Available personas</h2>
        {activeId && <Button variant="subtle" onClick={deactivate}>Switch to default (no persona)</Button>}
      </div>

      {personas.length === 0 ? (
        <Card><div className="text-sm text-cream-300/60 text-center py-6">No personas yet. Create one above.</div></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {personas.map(p => (
            <Card key={p.id} className={p.id === activeId ? "border-violet-500/60" : ""}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-display text-lg text-cream-50">{p.name}</div>
                  <div className="text-xs text-cream-300/70 mt-0.5">{p.role}</div>
                </div>
                {p.id === activeId && <span className="text-[10px] uppercase tracking-wider bg-violet-500/20 text-violet-300 px-2 py-1 rounded-full border border-violet-500/30">active</span>}
              </div>
              {p.description && <div className="text-xs text-cream-300/80 mt-2">{p.description}</div>}
              {p.tone && <div className="text-[10px] text-cream-300/50 mt-1">tone: {p.tone}</div>}
              {p.responsibilities.length > 0 && (
                <details className="mt-2">
                  <summary className="text-[11px] text-cream-300 cursor-pointer hover:text-cream-100">Responsibilities ({p.responsibilities.length})</summary>
                  <ul className="list-disc pl-5 mt-1 text-[11px] text-cream-200 space-y-0.5">
                    {p.responsibilities.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </details>
              )}
              <div className="mt-3 pt-3 border-t border-ink-800 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] text-cream-300/60">
                    {templateCounts[p.id] != null ? (
                      <>{templateCounts[p.id]} starter template{templateCounts[p.id] === 1 ? "" : "s"}</>
                    ) : (
                      "templates: —"
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => refreshTemplates(p.id)}
                      disabled={refreshState[p.id]?.state === "running"}
                      className="text-[11px] text-cream-300 hover:text-violet-300 disabled:opacity-40"
                      title="Regenerate starter templates from this persona's responsibilities. Keeps run history on unchanged ones."
                    >
                      {refreshState[p.id]?.state === "running" ? "Refreshing…" : "Refresh templates"}
                    </button>
                  </div>
                </div>
                {refreshState[p.id]?.state === "ok" && (
                  <div className="text-[11px] text-leaf-400">✓ {refreshState[p.id]?.info}</div>
                )}
                {refreshState[p.id]?.state === "fail" && (
                  <div className="text-[11px] text-coral-400">{refreshState[p.id]?.info}</div>
                )}
                <div className="flex items-center justify-between">
                  <button type="button" onClick={() => remove(p.id)} className="text-xs text-cream-300/50 hover:text-coral-400">Delete</button>
                  {p.id !== activeId && <Button variant="subtle" onClick={() => activate(p.id)}>Activate</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
