import { useEffect, useState } from "react";
import {
  Database, ShieldCheck, ScanEye, Gauge, UserCheck, GitMerge, PackageCheck,
  Loader2, Download, Trash2, FileSpreadsheet, Network, FileText, Hash, ChevronRight,
  Radar, Plus, X,
} from "lucide-react";
import { api, type Dataset } from "../lib/api";
import { Card, showToast } from "../components/Card";

// The ADRS stage map, in pipeline order. Mirrors the architecture diagram so
// the UI reads as the same system: ingest → normalize → hash → extract →
// score → HITL → golden record → publish.
const STAGES = [
  { icon: Database, label: "Normalization", note: "Standardise diverse inputs" },
  { icon: ShieldCheck, label: "Cryptographic Hashing", note: "Immutable batch barcodes" },
  { icon: ScanEye, label: "Extraction", note: "OCR + layout intelligence" },
  { icon: Gauge, label: "Confidence Scoring", note: "High-assurance scoring" },
  { icon: UserCheck, label: "HITL Validation", note: "Humans resolve low-confidence" },
  { icon: GitMerge, label: "Entity Resolution", note: "Merge into Golden Records" },
  { icon: PackageCheck, label: "Dataset Publishing", note: "Gated, audited release" },
];

export function DataPipeline() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.listDatasets().then(r => setDatasets(r.datasets)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div>
        <div className="nw-eyebrow">Intellinexus · intelligent data readiness — data validation layer (DPA)</div>
        <h1 className="text-2xl font-semibold tracking-tight text-cream-50">Data Pipeline</h1>
        <p className="text-sm text-cream-300/70 mt-1 max-w-3xl">
          The validation layer for agent data. Signal is normalized, cryptographically
          hashed, scored, human-validated, and resolved into golden records, then{" "}
          <span className="text-cream-100">installed into Knowledge Packs the agents load</span> —
          so agents work from validated, tamper-evident data, not raw input.
        </p>
      </div>

      <PipelineDiagram />

      <OmnisignalPanel onPublished={load} />

      <PublishForm onPublished={load} />

      <div>
        <h2 className="text-sm font-semibold text-cream-100 mb-3 flex items-center gap-2">
          <PackageCheck size={15} className="text-violet-400" /> Published datasets
          {datasets.length > 0 && <span className="text-cream-300/50 font-normal">· {datasets.length}</span>}
        </h2>
        {loading ? (
          <div className="flex items-center gap-2 text-cream-300/60 text-sm"><Loader2 className="animate-spin" size={16} /> Loading…</div>
        ) : datasets.length === 0 ? (
          <Card>
            <div className="text-sm text-cream-300/60">
              No datasets published yet. Use the form above (or have an agent call <span className="font-mono text-cream-200">data.publish</span>)
              to run the pipeline and publish your first dataset.
            </div>
          </Card>
        ) : (
          <div className="space-y-3">
            {datasets.map(d => <DatasetCard key={d.id} d={d} onChange={load} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineDiagram() {
  return (
    <Card title="Pipeline stages">
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1 scrollbar-thin">
        {STAGES.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center shrink-0">
              <div className="w-32 px-2 py-3 rounded-lg bg-ink-800/60 border border-ink-700 text-center">
                <Icon size={18} className="text-violet-400 mx-auto" />
                <div className="text-[11px] font-medium text-cream-100 mt-1.5 leading-tight">{s.label}</div>
                <div className="text-[10px] text-cream-300/50 mt-0.5 leading-tight">{s.note}</div>
              </div>
              {i < STAGES.length - 1 && <ChevronRight size={14} className="text-cream-300/30 shrink-0" />}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <span className="px-2 py-1 rounded-md bg-leaf-500/10 border border-leaf-500/30 text-leaf-300 inline-flex items-center gap-1"><FileSpreadsheet size={11} /> ML-ready CSV</span>
        <span className="px-2 py-1 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-300 inline-flex items-center gap-1"><Network size={11} /> Knowledge-graph JSONL</span>
        <span className="px-2 py-1 rounded-md bg-flame-500/10 border border-flame-500/30 text-flame-300 inline-flex items-center gap-1"><FileText size={11} /> RAG-ready chunks</span>
      </div>
    </Card>
  );
}

type OmniSpec = { kind: string; query?: string; urls?: string; sourceLabel?: string; path?: string };

// Omnisignal — gather raw signal from multiple sources, then run it through the
// ADRS pipeline in one shot. This is the acquisition front-end of the pipeline.
function OmnisignalPanel({ onPublished }: { onPublished: () => void }) {
  const [specs, setSpecs] = useState<OmniSpec[]>([]);
  const [draft, setDraft] = useState<OmniSpec>({ kind: "web_search", query: "" });
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [busy, setBusy] = useState<"acquire" | "publish" | null>(null);
  const [report, setReport] = useState<{ source: string; kind: string; count: number; error?: string }[] | null>(null);

  const inputCls = "w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500 text-cream-100 placeholder:text-cream-300/30";

  function addSpec() {
    const s: OmniSpec = { kind: draft.kind };
    if (draft.kind === "web_search" || draft.kind === "vault") { if (!draft.query?.trim()) { showToast("Enter a query", "error"); return; } s.query = draft.query.trim(); }
    if (draft.kind === "web_page") { if (!draft.urls?.trim()) { showToast("Enter URL(s)", "error"); return; } s.urls = draft.urls.trim(); }
    if (draft.kind === "db") { if (!draft.sourceLabel?.trim() || !draft.query?.trim()) { showToast("DB needs source label + query", "error"); return; } s.sourceLabel = draft.sourceLabel.trim(); s.query = draft.query.trim(); }
    if (draft.kind === "local_file") { if (!draft.path?.trim()) { showToast("Enter a file path", "error"); return; } s.path = draft.path.trim(); }
    setSpecs(prev => [...prev, s]);
    setDraft({ kind: draft.kind, query: "" });
  }

  // The wire shape: web_page urls is a comma/newline list → array.
  function toWire(): any[] {
    return specs.map(s => {
      const w: any = { kind: s.kind };
      if (s.query) w.query = s.query;
      if (s.sourceLabel) w.sourceLabel = s.sourceLabel;
      if (s.path) w.path = s.path;
      if (s.urls) w.urls = s.urls.split(/[\n,]+/).map(u => u.trim()).filter(Boolean);
      return w;
    });
  }

  async function doAcquire() {
    if (specs.length === 0) { showToast("Add at least one source", "error"); return; }
    setBusy("acquire"); setReport(null);
    try {
      const r = await api.omniAcquire(toWire());
      setReport(r.report);
      showToast(`Acquired ${r.total} records from ${r.report.length} source(s)`, "success");
    } catch (e: any) { showToast(e?.message ?? "Acquire failed", "error"); }
    finally { setBusy(null); }
  }

  async function doPublish() {
    if (!name.trim()) { showToast("Name the dataset", "error"); return; }
    if (specs.length === 0) { showToast("Add at least one source", "error"); return; }
    setBusy("publish"); setReport(null);
    try {
      const r = await api.omniPublish({ name: name.trim(), sources: toWire(), sector: sector.trim() || undefined });
      setReport(r.acquisition.report);
      if (r.published) {
        showToast(`Published "${r.published.manifest.name}" — ${r.published.manifest.recordCount} records`, "success");
        setSpecs([]); setName(""); setSector("");
        onPublished();
      } else {
        showToast(r.note ?? "Nothing published", "info");
      }
    } catch (e: any) { showToast(e?.message ?? "Publish failed", "error"); }
    finally { setBusy(null); }
  }

  return (
    <Card title="Omnisignal — acquire from sources">
      <p className="text-xs text-cream-300/60 mb-3">
        Gather raw signal from the web, your databases, local files, or the vault, then run it
        straight through the pipeline. This is the acquisition front-end of Intellinexus.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[160px,1fr,auto] gap-2 items-end">
        <div>
          <label className="text-[11px] text-cream-300/60 mb-1 block">Source kind</label>
          <select aria-label="Source kind" className={inputCls} value={draft.kind} onChange={e => setDraft({ kind: e.target.value, query: "" })}>
            <option value="web_search">Web search</option>
            <option value="web_page">Web page(s)</option>
            <option value="db">Company database</option>
            <option value="local_file">Local file</option>
            <option value="vault">Vault</option>
          </select>
        </div>
        <div className="space-y-2">
          {(draft.kind === "web_search" || draft.kind === "vault") && (
            <input className={inputCls} placeholder={draft.kind === "vault" ? "vault search query" : "search query"} value={draft.query ?? ""} onChange={e => setDraft({ ...draft, query: e.target.value })} />
          )}
          {draft.kind === "web_page" && (
            <textarea className={`${inputCls} h-16`} placeholder="https://… (one per line or comma-separated)" value={draft.urls ?? ""} onChange={e => setDraft({ ...draft, urls: e.target.value })} />
          )}
          {draft.kind === "db" && (
            <div className="grid grid-cols-2 gap-2">
              <input className={inputCls} placeholder="source label" value={draft.sourceLabel ?? ""} onChange={e => setDraft({ ...draft, sourceLabel: e.target.value })} />
              <input className={inputCls} placeholder="SELECT * FROM …" value={draft.query ?? ""} onChange={e => setDraft({ ...draft, query: e.target.value })} />
            </div>
          )}
          {draft.kind === "local_file" && (
            <input className={inputCls} placeholder="C:\\path\\to\\file.pdf" value={draft.path ?? ""} onChange={e => setDraft({ ...draft, path: e.target.value })} />
          )}
        </div>
        <button type="button" onClick={addSpec} className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-md bg-ink-800 border border-ink-700 text-cream-100 hover:border-violet-500/40">
          <Plus size={14} /> Add
        </button>
      </div>

      {specs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {specs.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-200">
              <Radar size={11} />
              {s.kind}: {(s.query ?? s.urls ?? s.path ?? s.sourceLabel ?? "").toString().slice(0, 32)}
              <button type="button" aria-label="Remove source" title="Remove source" onClick={() => setSpecs(prev => prev.filter((_, j) => j !== i))} className="hover:text-coral-300"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
        <input className={inputCls} placeholder="dataset name (for publish)" value={name} onChange={e => setName(e.target.value)} />
        <input className={inputCls} placeholder="sector (optional)" value={sector} onChange={e => setSector(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" onClick={doAcquire} disabled={busy !== null} className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-ink-800 border border-ink-700 text-cream-100 hover:border-violet-500/40 disabled:opacity-40">
            {busy === "acquire" ? <Loader2 className="animate-spin" size={14} /> : <Radar size={14} />} Acquire
          </button>
          <button type="button" onClick={doPublish} disabled={busy !== null} className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-40">
            {busy === "publish" ? <Loader2 className="animate-spin" size={14} /> : <PackageCheck size={14} />} Publish
          </button>
        </div>
      </div>

      {report && (
        <div className="mt-3 border-t border-ink-800 pt-3 space-y-1">
          {report.map((r, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-cream-200">{r.kind} · {r.source.slice(0, 40)}</span>
              {r.error ? <span className="text-coral-300">{r.error}</span> : <span className="text-leaf-300">{r.count} records</span>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PublishForm({ onPublished }: { onPublished: () => void }) {
  const [mode, setMode] = useState<"source" | "inline">("source");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [keyField, setKeyField] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim()) { showToast("Give the dataset a name", "error"); return; }
    setBusy(true);
    try {
      const body: any = { name: name.trim() };
      if (sector.trim()) body.sector = sector.trim();
      if (keyField.trim()) body.keyField = keyField.trim();
      if (mode === "source") {
        if (!sourceLabel.trim() || !query.trim()) { showToast("Source label and query are required", "error"); setBusy(false); return; }
        body.sourceLabel = sourceLabel.trim();
        body.query = query.trim();
      } else {
        let parsed: any;
        try { parsed = JSON.parse(records); } catch { showToast("Records must be valid JSON array", "error"); setBusy(false); return; }
        if (!Array.isArray(parsed)) { showToast("Records must be a JSON array", "error"); setBusy(false); return; }
        body.records = parsed;
      }
      const r = await api.publishDataset(body);
      showToast(`Published "${r.dataset.name}" — ${r.dataset.recordCount} golden records`, "success");
      setName(""); setSector(""); setKeyField(""); setSourceLabel(""); setQuery(""); setRecords("");
      onPublished();
    } catch (e: any) {
      showToast(e?.message ?? "Publish failed", "error");
    } finally { setBusy(false); }
  }

  const inputCls = "w-full bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500 text-cream-100 placeholder:text-cream-300/30";

  return (
    <Card title="Publish a dataset">
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] text-cream-300/60 mb-1 block">Name</label>
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Customer master" />
          </div>
          <div>
            <label className="text-[11px] text-cream-300/60 mb-1 block">Sector (optional)</label>
            <input className={inputCls} value={sector} onChange={e => setSector(e.target.value)} placeholder="fintech" />
          </div>
          <div>
            <label className="text-[11px] text-cream-300/60 mb-1 block">Merge key (optional)</label>
            <input className={inputCls} value={keyField} onChange={e => setKeyField(e.target.value)} placeholder="customer_id" />
          </div>
        </div>

        <div className="inline-flex rounded-md border border-ink-700 overflow-hidden text-xs">
          <button type="button" onClick={() => setMode("source")} className={`px-3 py-1.5 ${mode === "source" ? "bg-violet-500/20 text-violet-200" : "text-cream-300/60 hover:text-cream-100"}`}>From data source</button>
          <button type="button" onClick={() => setMode("inline")} className={`px-3 py-1.5 ${mode === "inline" ? "bg-violet-500/20 text-violet-200" : "text-cream-300/60 hover:text-cream-100"}`}>Inline JSON</button>
        </div>

        {mode === "source" ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-cream-300/60 mb-1 block">Source label</label>
              <input className={inputCls} value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} placeholder="prod-postgres" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] text-cream-300/60 mb-1 block">Read-only query</label>
              <input className={inputCls} value={query} onChange={e => setQuery(e.target.value)} placeholder="SELECT * FROM customers" />
            </div>
          </div>
        ) : (
          <div>
            <label className="text-[11px] text-cream-300/60 mb-1 block">Records (JSON array)</label>
            <textarea className={`${inputCls} font-mono h-28`} value={records} onChange={e => setRecords(e.target.value)} placeholder='[{"name":"Acme","value":120},{"name":"Beta","value":80}]' />
          </div>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={submit} disabled={busy} className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-40">
            {busy ? <Loader2 className="animate-spin" size={14} /> : <PackageCheck size={14} />}
            Run pipeline & publish
          </button>
        </div>
      </div>
    </Card>
  );
}

function DatasetCard({ d, onChange }: { d: Dataset; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const conf = Math.round(d.avgConfidence * 100);
  // Full class strings (not interpolated) so Tailwind's JIT actually emits them.
  const confBar = conf >= 80 ? "bg-leaf-500" : conf >= 60 ? "bg-flame-500" : "bg-coral-500";
  const confText = conf >= 80 ? "text-leaf-300" : conf >= 60 ? "text-flame-300" : "text-coral-300";

  async function del() {
    if (!confirm(`Delete dataset "${d.name}"? The manifest is removed; vault artifacts stay on disk.`)) return;
    try { await api.deleteDataset(d.id); showToast("Dataset removed", "success"); onChange(); }
    catch (e: any) { showToast(e?.message ?? "Delete failed", "error"); }
  }

  return (
    <Card hoverable>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-cream-50">{d.name}</h3>
            {d.sector && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ink-800 text-cream-300/70">{d.sector}</span>}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 inline-flex items-center gap-1"><Hash size={9} />{d.rootHash.slice(0, 10)}</span>
          </div>
          <div className="text-xs text-cream-300/60 mt-1">
            {d.recordCount} golden records · {d.rawCount} raw in · source <span className="font-mono text-cream-300/80">{d.source}</span>
            {d.reviewQueue > 0 && <span className="text-coral-300"> · {d.reviewQueue} flagged for review</span>}
          </div>
        </div>
        <button type="button" onClick={del} title="Remove dataset" className="text-cream-300/40 hover:text-coral-400 p-1 shrink-0"><Trash2 size={14} /></button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-ink-800 rounded-full overflow-hidden">
          <div className={`h-full ${confBar}`} style={{ width: `${conf}%` }} />
        </div>
        <span className={`text-[11px] ${confText} shrink-0`}>{conf}% avg confidence</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <a href={api.datasetOutputUrl(d.id, "csv")} download className="text-xs px-2.5 py-1 rounded-md bg-leaf-500/10 border border-leaf-500/30 text-leaf-300 hover:bg-leaf-500/20 inline-flex items-center gap-1.5"><FileSpreadsheet size={11} /> CSV</a>
        <a href={api.datasetOutputUrl(d.id, "jsonl")} download className="text-xs px-2.5 py-1 rounded-md bg-violet-500/10 border border-violet-500/30 text-violet-300 hover:bg-violet-500/20 inline-flex items-center gap-1.5"><Network size={11} /> Graph JSONL</a>
        <a href={api.datasetOutputUrl(d.id, "rag")} download className="text-xs px-2.5 py-1 rounded-md bg-flame-500/10 border border-flame-500/30 text-flame-300 hover:bg-flame-500/20 inline-flex items-center gap-1.5"><FileText size={11} /> RAG</a>
        <a href={api.datasetOutputUrl(d.id, "card")} download className="text-xs px-2.5 py-1 rounded-md bg-ink-800 border border-ink-700 text-cream-200 hover:bg-ink-700 inline-flex items-center gap-1.5"><Download size={11} /> Pack card</a>
        <button type="button" onClick={() => setOpen(o => !o)} className="text-xs px-2.5 py-1 rounded-md text-cream-300/60 hover:text-cream-100 inline-flex items-center gap-1">
          <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} /> stages
        </button>
      </div>

      {open && (
        <div className="mt-3 border-t border-ink-800 pt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-cream-300/50">
              <tr className="text-left"><th className="font-normal pb-1">Stage</th><th className="font-normal pb-1">In</th><th className="font-normal pb-1">Out</th><th className="font-normal pb-1">Note</th></tr>
            </thead>
            <tbody className="text-cream-200">
              {d.stages.map((s, i) => (
                <tr key={i} className="border-t border-ink-800/60">
                  <td className="py-1 pr-3 text-cream-100">{s.stage}</td>
                  <td className="py-1 pr-3 font-mono text-cream-300/70">{s.in}</td>
                  <td className="py-1 pr-3 font-mono text-cream-300/70">{s.out}</td>
                  <td className="py-1 text-cream-300/60">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[11px] text-cream-300/50">Fields: {d.fields.map(f => <span key={f} className="font-mono text-cream-300/70">{f} </span>)}</div>
        </div>
      )}
    </Card>
  );
}
