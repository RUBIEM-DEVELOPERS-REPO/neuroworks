import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Contact, Bot, User as UserIcon, Mail, ArrowRight, Search, Upload } from "lucide-react";
import { api, type WorkforceDepartment } from "../lib/api";
import { Card, Button, showToast } from "../components/Card";

// Read a File into base64 in chunks (avoids call-stack blowups on big files).
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

// Workforce contact book.
//
// One directory of everyone in the org — the AI workforce (personas you can
// hire/dispatch) and the human team (the Users directory) — grouped by
// department so you can see who covers what at a glance.
export function Workforce() {
  const [departments, setDepartments] = useState<WorkforceDepartment[]>([]);
  const [counts, setCounts] = useState<{ agents: number; people: number; departments: number } | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function refresh() {
    api.getWorkforce()
      .then(r => { setDepartments(r.departments); setCounts(r.counts); })
      .catch(e => setErr(e?.message ?? String(e)));
  }
  useEffect(() => { refresh(); }, []);

  async function scanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { showToast("File too large (max 20 MB)", "error"); return; }
    setScanning(true);
    showToast(`Scanning ${file.name} for contacts…`, "info", 2500);
    try {
      const contentBase64 = await fileToBase64(file);
      const r = await api.importContacts({ filename: file.name, contentBase64 });
      refresh();
      const skips = r.skipped.length ? ` · ${r.skipped.length} skipped` : "";
      showToast(`Scanned ${r.scanned} contact${r.scanned === 1 ? "" : "s"} · added ${r.added.length}${skips}`, r.added.length ? "success" : "info", 4000);
    } catch (err: any) {
      showToast(`Scan failed: ${err?.message ?? String(err)}`, "error", 5000);
    } finally {
      setScanning(false);
    }
  }

  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? departments
        .map(d => ({
          ...d,
          agents: d.agents.filter(a => `${a.name} ${a.role} ${a.description}`.toLowerCase().includes(needle)),
          people: d.people.filter(p => `${p.name} ${p.role} ${p.title ?? ""} ${p.email}`.toLowerCase().includes(needle)),
        }))
        .filter(d => d.agents.length > 0 || d.people.length > 0 || d.department.toLowerCase().includes(needle))
    : departments;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-cream-50 flex items-center gap-3"><Contact size={24} /> Workforce contact book</h1>
          <p className="text-sm text-cream-300/70 mt-1">
            Everyone who works here — the AI workforce you can dispatch and the human team — organized by department.
            {counts && <span className="text-cream-300/50"> {counts.agents} agents · {counts.people} people · {counts.departments} departments.</span>}
          </p>
        </div>
        <div className="shrink-0">
          <input ref={fileRef} type="file" className="hidden" onChange={scanFile} aria-label="Upload a document to scan for contacts" />
          <Button onClick={() => fileRef.current?.click()} disabled={scanning} variant="subtle">
            <Upload size={14} /> {scanning ? "Scanning…" : "Upload & scan"}
          </Button>
        </div>
      </div>

      {err && <div className="bg-coral-500/10 border border-coral-500/30 text-coral-300 text-sm rounded-md px-3 py-2">{err}</div>}

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream-300/40" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name, role, title, or email…"
          aria-label="Search the workforce"
          className="w-full bg-ink-900 border border-ink-800 rounded-lg pl-9 pr-3 py-2 text-sm text-cream-100 focus:outline-none focus:border-violet-500/40"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-cream-300/60 italic">No matches.</div>
      ) : (
        filtered.map(dept => (
          <Card key={dept.department} title={`${dept.department} · ${dept.agents.length + dept.people.length}`}>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-2 flex items-center gap-1.5"><Bot size={12} /> AI workforce ({dept.agents.length})</div>
                {dept.agents.length === 0 ? (
                  <div className="text-xs text-cream-300/40 italic">No agents in this department.</div>
                ) : (
                  <ul className="space-y-2">
                    {dept.agents.map(a => (
                      <li key={a.id} className="border border-ink-800 rounded-lg p-2.5 bg-ink-950">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm text-cream-50 font-medium flex items-center gap-2">
                              <span className="truncate">{a.name}</span>
                              {a.builtin && <span className="text-[9px] uppercase tracking-wider text-cream-300/40">built-in</span>}
                            </div>
                            <div className="text-[11px] text-cream-300/60">{a.role}</div>
                          </div>
                          <Link to="/team" className="text-[11px] text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 shrink-0" title="Dispatch on the Team page">
                            Dispatch <ArrowRight size={11} />
                          </Link>
                        </div>
                        {a.description && <div className="text-[11px] text-cream-300/70 mt-1 line-clamp-2">{a.description}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-2 flex items-center gap-1.5"><UserIcon size={12} /> People ({dept.people.length})</div>
                {dept.people.length === 0 ? (
                  <div className="text-xs text-cream-300/40 italic">No people recorded in this department.</div>
                ) : (
                  <ul className="space-y-2">
                    {dept.people.map(p => (
                      <li key={p.email} className="border border-ink-800 rounded-lg p-2.5 bg-ink-950">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm text-cream-50 font-medium truncate">{p.name}</div>
                            <div className="text-[11px] text-cream-300/60">{p.title || p.role}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-ink-800 text-cream-300/70">{p.role}</span>
                            <button
                              type="button"
                              onClick={() => { void navigator.clipboard?.writeText(p.email); showToast(`Email copied: ${p.email}`, "success", 1600); }}
                              className="text-cream-300/50 hover:text-violet-400"
                              title={`Copy ${p.email}`}
                            >
                              <Mail size={13} />
                            </button>
                          </div>
                        </div>
                        <div className="text-[11px] text-cream-300/60 font-mono mt-1 truncate">{p.email}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
