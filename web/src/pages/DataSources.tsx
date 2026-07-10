import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Database, Plus, Trash2, Upload, CheckCircle2, AlertTriangle, FileText, Folder, Play, ChevronDown, ChevronRight } from "lucide-react";
import { api, type DataSource, type DataSourceKind, type DepartmentDatum } from "../lib/api";
import { Card, Button, showToast } from "../components/Card";

// Company-data hub.
//   - Left card: registered DB connections. Add (engine + connection string),
//     test (SELECT 1), browse schema, delete. Source id is what agents pass
//     to the db.* primitives — surfaced inline so the operator can copy it
//     into a chat prompt ("query the production CRM, source_id=…").
//   - Right card: company-knowledge uploader. Files land in vault under
//     _company/ which is then searchable via vault.search — no extra wiring.
export function DataSources() {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [adding, setAdding] = useState(false);
  const [companyFiles, setCompanyFiles] = useState<{ name: string; path: string; type: "dir" | "file" }[]>([]);
  const [companyNote, setCompanyNote] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  async function refresh() {
    try { const r = await api.listDataSources(); setSources(r.sources); } catch {}
    try { const r = await api.listCompanyFiles(); setCompanyFiles(r.entries); setCompanyNote(r.note ?? null); } catch {}
  }
  useEffect(() => { void refresh(); }, []);

  async function test(id: string) {
    setTesting(id); setTestResult(null);
    try {
      const r = await api.testDataSource(id);
      setTestResult({ id, ok: r.ok, msg: r.ok ? `OK (${r.rowCount} row${r.rowCount === 1 ? "" : "s"})` : (r.error ?? "failed") });
    } catch (e: any) {
      setTestResult({ id, ok: false, msg: e?.message ?? String(e) });
    } finally { setTesting(null); }
  }
  async function remove(id: string) {
    if (!confirm("Remove this database connection? Agents using this source id will start to fail.")) return;
    try { await api.removeDataSource(id); refresh(); } catch (e: any) { alert(e?.message ?? String(e)); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-cream-50 flex items-center gap-3"><Database size={24} /> Company data</h1>
        <p className="text-sm text-cream-300/70 mt-1">
          Wire agents into a company database for live querying, or drop static knowledge into the vault. DB queries are read-only by default — agents use the <span className="font-mono">db.list_sources</span>, <span className="font-mono">db.schema</span>, and <span className="font-mono">db.query</span> primitives.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Database connections" action={
          <Button onClick={() => setAdding(a => !a)} variant="subtle"><Plus size={14} /> {adding ? "Cancel" : "Add"}</Button>
        }>
          {adding && <AddSourceForm onAdded={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}
          {sources.length === 0 && !adding && (
            <div className="text-sm text-cream-300/60 italic">
              No databases connected yet. Click <span className="font-mono">+ Add</span> to register a Postgres, MySQL, SQLite, SQL Server, or MongoDB database. Once added, agents can query it through the <span className="font-mono">db.*</span> primitives.
            </div>
          )}
          <div className="space-y-2">
            {sources.map(s => (
              <SourceRow
                key={s.id}
                source={s}
                onTest={() => test(s.id)}
                onRemove={() => remove(s.id)}
                testing={testing === s.id}
                testResult={testResult?.id === s.id ? testResult : null}
              />
            ))}
          </div>
        </Card>

        <Card
          title={`Company knowledge (_company/)${companyFiles.length ? ` — ${companyFiles.length}` : ""}`}
          action={
            <div className="flex items-center gap-2">
              <Link to="/knowledge/_company" className="text-[11px] text-violet-400 hover:text-violet-500">Browse in Knowledge →</Link>
              <CompanyUpload onUploaded={refresh} />
            </div>
          }
        >
          <p className="text-xs text-cream-300/70 mb-3">
            Drop any document (PDF, DOCX, XLSX, PPTX, TXT, MD). Files are extracted and indexed — agents will find them via <span className="font-mono">vault.search</span> alongside the rest of the knowledge base.
          </p>
          {companyFiles.length === 0 ? (
            <div className="text-sm text-cream-300/60 italic">
              {companyNote && companyNote.includes("unreachable")
                ? <>Vault is unreachable — fix that on the Knowledge page first.</>
                : <>Nothing in <span className="font-mono">_company/</span> yet. Upload a document to get started.</>}
            </div>
          ) : (
            <ul className="space-y-1 max-h-[420px] overflow-y-auto scrollbar-thin">
              {companyFiles.map(e => (
                <li key={e.path}>
                  <Link to={`/knowledge/${e.path}`} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-ink-800">
                    {e.type === "dir"
                      ? <Folder size={14} className="text-violet-400 shrink-0" />
                      : <FileText size={14} className="text-cream-300/60 shrink-0" />}
                    <span className={`font-mono truncate ${e.type === "dir" ? "text-violet-400" : "text-cream-200"}`}>{e.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <DepartmentDataCard />
    </div>
  );
}

function DepartmentDataCard() {
  const [data, setData] = useState<DepartmentDatum[]>([]);
  const [departments, setDepartments] = useState<{ department: string; count: number }[]>([]);
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try { const r = await api.listDepartmentData(); setData(r.data); setDepartments(r.departments); } catch {}
  }
  useEffect(() => { void refresh(); }, []);

  async function scanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { showToast("File too large (max 20 MB)", "error"); return; }
    setScanning(true);
    showToast(`Scanning ${file.name} for department data…`, "info", 2500);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
      const r = await api.importDepartmentData({ filename: file.name, contentBase64: btoa(binary), department: filter || undefined });
      refresh();
      showToast(`Added ${r.added.length} entr${r.added.length === 1 ? "y" : "ies"} from ${file.name}`, r.added.length ? "success" : "info", 4000);
    } catch (err: any) {
      showToast(`Scan failed: ${err?.message ?? String(err)}`, "error", 5000);
    } finally {
      setScanning(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this department data entry? Agents will no longer see it.")) return;
    try { await api.removeDepartmentDatum(id); refresh(); } catch (e: any) { alert(e?.message ?? String(e)); }
  }

  const shown = filter ? data.filter(d => d.department === filter) : data;

  return (
    <Card
      title={`Department data${data.length ? ` — ${data.length}` : ""}`}
      action={
        <div className="flex items-center gap-2">
          <input ref={scanRef} type="file" className="hidden" onChange={scanFile} aria-label="Upload a document to scan for department data" />
          <Button onClick={() => scanRef.current?.click()} disabled={scanning} variant="ghost"><Upload size={14} /> {scanning ? "Scanning…" : "Upload & scan"}</Button>
          <Button onClick={() => setAdding(a => !a)} variant="subtle"><Plus size={14} /> {adding ? "Cancel" : "Add"}</Button>
        </div>
      }
    >
      <p className="text-xs text-cream-300/70 mb-3">
        Curate facts, policies, assumptions, or numbers for a specific department — type them in, or
        <span className="text-cream-100"> Upload & scan</span> any document (PDF, DOCX, XLSX…) and the agent extracts the entries for you.
        Agents read these via the <span className="font-mono">company.department_data</span> primitive — so a persona working a Finance or HR task has its team's data on hand without you pasting it into every prompt.
        {filter && <span className="text-cream-300/50"> Scanned entries will be tagged <span className="text-leaf-300">{filter}</span> (the active filter).</span>}
      </p>

      {adding && <AddDepartmentDatum onAdded={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} suggestions={departments.map(d => d.department)} />}

      {departments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button type="button" onClick={() => setFilter("")} className={`text-[11px] px-2 py-0.5 rounded-full border ${filter === "" ? "bg-violet-500/15 text-violet-300 border-violet-500/30" : "border-ink-700 text-cream-300/70 hover:border-violet-500/40"}`}>All</button>
          {departments.map(d => (
            <button key={d.department} type="button" onClick={() => setFilter(d.department)} className={`text-[11px] px-2 py-0.5 rounded-full border ${filter === d.department ? "bg-violet-500/15 text-violet-300 border-violet-500/30" : "border-ink-700 text-cream-300/70 hover:border-violet-500/40"}`}>
              {d.department} <span className="opacity-60">{d.count}</span>
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 && !adding ? (
        <div className="text-sm text-cream-300/60 italic">No department data yet. Click <span className="font-mono">+ Add</span> to capture a team's key facts.</div>
      ) : (
        <div className="space-y-2">
          {shown.map(d => (
            <div key={d.id} className="border border-ink-800 rounded-lg p-3 bg-ink-950">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm text-cream-100 font-medium flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-leaf-500/15 text-leaf-300">{d.department}</span>
                    <span className="truncate">{d.title}</span>
                  </div>
                  <div className="text-[12px] text-cream-300/80 mt-1.5 whitespace-pre-wrap">{d.content}</div>
                </div>
                <button type="button" onClick={() => remove(d.id)} className="text-cream-300/50 hover:text-coral-400 shrink-0" aria-label="Remove"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AddDepartmentDatum({ onAdded, onCancel, suggestions }: { onAdded: () => void; onCancel: () => void; suggestions: string[] }) {
  const [department, setDepartment] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.addDepartmentDatum({ department: department.trim(), title: title.trim(), content: content.trim() });
      onAdded();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-2 mb-4 bg-ink-950 border border-ink-800 rounded-lg p-3">
      <div className="flex gap-2">
        <input
          value={department}
          onChange={e => setDepartment(e.target.value)}
          required
          list="dept-suggestions"
          placeholder="Department (e.g. Finance)"
          aria-label="Department"
          className="w-48 bg-ink-900 border border-ink-700 rounded px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-violet-500/40"
        />
        <datalist id="dept-suggestions">
          {suggestions.map(s => <option key={s} value={s} />)}
        </datalist>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          placeholder="Title (e.g. FY26 budget assumptions)"
          aria-label="Title"
          className="flex-1 bg-ink-900 border border-ink-700 rounded px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-violet-500/40"
        />
      </div>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        required
        rows={4}
        placeholder="The data itself — facts, figures, policies, territories, assumptions…"
        aria-label="Content"
        className="w-full bg-ink-900 border border-ink-700 rounded px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-violet-500/40 resize-y"
      />
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save entry"}</Button>
        <Button onClick={onCancel} variant="ghost">Cancel</Button>
        {err && <span className="text-[11px] text-coral-400">{err}</span>}
      </div>
    </form>
  );
}

function SourceRow({
  source: s,
  onTest, onRemove, testing, testResult,
}: {
  source: DataSource;
  onTest: () => void;
  onRemove: () => void;
  testing: boolean;
  testResult: { id: string; ok: boolean; msg: string } | null;
}) {
  const [showSchema, setShowSchema] = useState(false);
  const [schema, setSchema] = useState<{ tables: { name: string; columns: { name: string; type: string }[] }[] } | null>(null);
  const [schemaErr, setSchemaErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggleSchema() {
    const next = !showSchema;
    setShowSchema(next);
    if (next && !schema) {
      setLoading(true); setSchemaErr(null);
      try { setSchema(await api.describeDataSource(s.id)); }
      catch (e: any) { setSchemaErr(e?.message ?? String(e)); }
      finally { setLoading(false); }
    }
  }

  function copyId() {
    try {
      void navigator.clipboard.writeText(s.id);
      showToast(`Source id copied: ${s.label}`, "success", 1800);
    } catch { showToast("Copy failed — your browser blocked clipboard access", "error"); }
  }

  return (
    <div className="border border-ink-800 rounded-lg p-3 bg-ink-950">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-cream-100 font-medium flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-300 font-mono uppercase">{s.kind}</span>
            <span className="truncate">{s.label}</span>
            {s.department && <span className="px-1.5 py-0.5 rounded text-[10px] bg-leaf-500/15 text-leaf-300">{s.department}</span>}
            {s.readonly && <span className="text-[10px] text-cream-300/50 italic">read-only</span>}
          </div>
          <div className="text-[11px] text-cream-300/60 font-mono mt-1 break-all">{s.connection}</div>
          {s.notes && <div className="text-[11px] text-cream-300/70 mt-1">{s.notes}</div>}
          <button type="button" onClick={copyId} className="text-[10px] text-cream-300/40 mt-1 font-mono hover:text-violet-400" title="Click to copy">
            id: {s.id} ⧉
          </button>
        </div>
        <div className="shrink-0 flex gap-1">
          <Button onClick={onTest} disabled={testing} variant="ghost"><Play size={12} /> {testing ? "…" : "Test"}</Button>
          <Button onClick={toggleSchema} variant="ghost">{showSchema ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Schema</Button>
          <Button onClick={onRemove} variant="ghost"><Trash2 size={12} /></Button>
        </div>
      </div>

      {testResult && (
        <div className={`mt-2 text-[11px] ${testResult.ok ? "text-leaf-400" : "text-coral-400"}`}>
          {testResult.ok ? <CheckCircle2 size={11} className="inline mr-1" /> : <AlertTriangle size={11} className="inline mr-1" />}
          {testResult.msg}
        </div>
      )}

      {showSchema && (
        <div className="mt-3 pt-3 border-t border-ink-800 text-xs">
          {loading && <div className="text-cream-300/60">Loading schema…</div>}
          {schemaErr && <div className="text-coral-400">{schemaErr}</div>}
          {schema && schema.tables.length === 0 && <div className="text-cream-300/60 italic">No user tables found.</div>}
          {schema && schema.tables.length > 0 && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-thin">
              {schema.tables.map(t => (
                <div key={t.name}>
                  <div className="font-mono text-cream-100">{t.name}</div>
                  <div className="ml-3 text-[11px] text-cream-300/70 font-mono">
                    {t.columns.map(c => `${c.name}: ${c.type}`).join(", ") || "(no columns)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddSourceForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<DataSourceKind>("postgres");
  const [connection, setConnection] = useState("");
  const [notes, setNotes] = useState("");
  const [department, setDepartment] = useState("");
  const [readonly, setReadonly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const placeholders: Record<DataSourceKind, string> = {
    postgres: "postgres://user:password@host:5432/dbname",
    mysql: "mysql://user:password@host:3306/dbname",
    sqlite: "C:\\path\\to\\database.sqlite",
    mssql: "Server=host,1433;Database=db;User Id=user;Password=pass;Encrypt=true",
    mongodb: "mongodb+srv://user:password@cluster.mongodb.net/dbname",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.addDataSource({ label: label.trim(), kind, connection: connection.trim(), notes: notes.trim() || undefined, department: department.trim() || undefined, readonly });
      onAdded();
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-2 mb-4 bg-ink-950 border border-ink-800 rounded-lg p-3">
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        required
        placeholder="Label (e.g. Production CRM)"
        aria-label="Label"
        className="w-full bg-ink-900 border border-ink-700 rounded px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-violet-500/40"
      />
      <div className="flex gap-2">
        <select
          value={kind}
          onChange={e => setKind(e.target.value as any)}
          aria-label="Database engine"
          className="bg-ink-900 border border-ink-700 rounded px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-violet-500/40"
        >
          <option value="postgres">Postgres</option>
          <option value="mysql">MySQL / MariaDB</option>
          <option value="sqlite">SQLite</option>
          <option value="mssql">SQL Server</option>
          <option value="mongodb">MongoDB</option>
        </select>
        <input
          value={connection}
          onChange={e => setConnection(e.target.value)}
          required
          placeholder={placeholders[kind]}
          aria-label="Connection string"
          className="flex-1 bg-ink-900 border border-ink-700 rounded px-3 py-1.5 text-sm font-mono text-cream-100 focus:outline-none focus:border-violet-500/40"
        />
      </div>
      <input
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes for the agent (optional, e.g. 'use schema `crm` for sales data')"
        aria-label="Notes"
        className="w-full bg-ink-900 border border-ink-700 rounded px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-violet-500/40"
      />
      <input
        value={department}
        onChange={e => setDepartment(e.target.value)}
        placeholder="Department (optional, e.g. Finance, Sales, HR) — tags this connection to a team"
        aria-label="Department"
        className="w-full bg-ink-900 border border-ink-700 rounded px-3 py-1.5 text-sm text-cream-100 focus:outline-none focus:border-violet-500/40"
      />
      <label className="flex items-center gap-2 text-xs text-cream-300">
        <input type="checkbox" checked={readonly} onChange={e => setReadonly(e.target.checked)} />
        Read-only — block INSERT / UPDATE / DELETE / DDL (recommended)
      </label>
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save connection"}</Button>
        <Button onClick={onCancel} variant="ghost">Cancel</Button>
        {err && <span className="text-[11px] text-coral-400">{err}</span>}
      </div>
      {kind === "mongodb" && (
        <div className="text-[10px] text-cream-300/60 bg-ink-900 border border-ink-700/60 rounded px-2 py-1.5">
          MongoDB is queried with a JSON document, not SQL — agents pass e.g.{" "}
          <span className="font-mono">{`{"collection":"orders","filter":{"status":"open"},"limit":50}`}</span>. Only reads run.
        </div>
      )}
      <div className="text-[10px] text-cream-300/50">
        Driver packages (<span className="font-mono">pg</span>, <span className="font-mono">mysql2</span>, <span className="font-mono">better-sqlite3</span>, <span className="font-mono">mssql</span>, <span className="font-mono">mongodb</span>) install on first use — the server will tell you which <span className="font-mono">pnpm add</span> to run if one's missing.
      </div>
    </form>
  );
}

function CompanyUpload({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ status: "idle" | "uploading" | "saved" | "error"; filename?: string; error?: string; vaultPath?: string }>({ status: "idle" });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setState({ status: "error", filename: file.name, error: "File too large (max 20 MB)" });
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
      const r = await api.upload({
        filename: file.name,
        contentBase64: btoa(binary),
        target: "vault",
        mimeType: file.type || undefined,
        vaultFolder: "_company",
      });
      setState({ status: "saved", filename: file.name, vaultPath: r.vaultPath });
      onUploaded();
      setTimeout(() => setState(s => s.status === "saved" ? { status: "idle" } : s), 4000);
    } catch (err: any) {
      setState({ status: "error", filename: file.name, error: err?.message ?? String(err) });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={inputRef} type="file" className="hidden" onChange={handleFile} aria-label="Upload company knowledge" />
      <Button onClick={() => inputRef.current?.click()} disabled={state.status === "uploading"} variant="subtle">
        <Upload size={12} /> Upload
      </Button>
      {state.status === "uploading" && (
        <span className="text-[11px] text-violet-300">Uploading {state.filename}…</span>
      )}
      {state.status === "saved" && state.vaultPath && (
        <span className="text-[11px] text-leaf-400 inline-flex items-center gap-1">
          <CheckCircle2 size={11} /> {state.vaultPath}
        </span>
      )}
      {state.status === "error" && (
        <span className="text-[11px] text-coral-400 inline-flex items-center gap-1" title={state.error}>
          <AlertTriangle size={11} /> Failed
        </span>
      )}
    </div>
  );
}
