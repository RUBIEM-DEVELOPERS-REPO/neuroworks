import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { marked } from "marked";
import { Folder, FileText, Upload, AlertTriangle, CheckCircle2, Download } from "lucide-react";
import { api } from "../lib/api";
import { Card } from "../components/Card";

// The vault path lives in the URL (e.g. /knowledge/NeuroWorks%20Data%20Migration.md)
// so spaces arrive percent-encoded. Decode ONCE here — otherwise api.brainFile()
// re-encodes it and the server tries to open a literal "%20" path → ENOENT.
function decodePath(p: string): string {
  try { return decodeURIComponent(p); } catch { return p; }
}

export function Knowledge() {
  const nav = useNavigate();
  const loc = useLocation();
  const subPath = decodePath(loc.pathname.replace(/^\/knowledge\/?/, ""));
  const [tree, setTree] = useState<any[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  // Vault-reachability probe — when the path on the server doesn't resolve
  // (drive unmounted, path renamed, env misconfigured) every brain endpoint
  // 503s. We probe once on mount and re-probe after each navigation so the
  // user sees the situation clearly instead of an empty tree.
  const [vaultHealth, setVaultHealth] = useState<{ ok: boolean; vaultPath: string; exists: boolean; gitRepo: boolean; reason?: string } | null>(null);

  useEffect(() => {
    api.brainHealth().then(setVaultHealth).catch(() => setVaultHealth(null));
  }, [subPath]);

  useEffect(() => {
    setErr(""); setContent(null);
    if (!subPath) { api.brainTree("").then(r => setTree(r.entries)).catch(e => setErr(e.message)); return; }
    if (subPath.endsWith(".md") || subPath.endsWith(".txt") || subPath.endsWith(".json")) {
      api.brainFile(subPath).then(r => setContent(r.content)).catch(e => setErr(e.message));
    } else {
      api.brainTree(subPath).then(r => setTree(r.entries)).catch(e => setErr(e.message));
    }
  }, [subPath]);

  async function doSearch() {
    if (!search.trim()) { setResults(null); return; }
    try { const r = await api.brainSearch(search.trim()); setResults(r.results); }
    catch (e: any) { setErr(e.message); }
  }
  async function retryVaultHealth() {
    try { const h = await api.brainHealth(); setVaultHealth(h); if (h.exists) { setErr(""); /* re-trigger the tree load */ if (!subPath) { const r = await api.brainTree(""); setTree(r.entries); } } }
    catch { /* tolerate */ }
  }

  const segments = subPath ? subPath.split("/") : [];
  // Hide the breadcrumb path while the vault is unreachable — none of the
  // segments resolve on disk, and rendering them as live links invites the
  // user to click into a 503-loop. We still show "Vault root" so the page
  // has an anchor, plus the unreachable banner explains why.
  const vaultUnreachable = vaultHealth ? !vaultHealth.exists : false;
  const showSegments = !vaultUnreachable;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-cream-50">Knowledge</h1>
        <div className="text-sm text-cream-300/70 mt-1 flex items-center gap-1.5 flex-wrap">
          <button onClick={() => nav("/knowledge")} className="hover:text-violet-400">Vault root</button>
          {showSegments && segments.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="text-cream-300/30">/</span>
              <button onClick={() => nav("/knowledge/" + segments.slice(0, i + 1).join("/"))} className="hover:text-violet-400">{s}</button>
            </span>
          ))}
          {!showSegments && segments.length > 0 && (
            <span className="text-[11px] text-cream-300/40 italic">
              (path hidden while vault is unreachable)
            </span>
          )}
        </div>
      </div>

      {vaultHealth && !vaultHealth.exists && (
        <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-4 py-3">
          <div className="flex items-start gap-3">
            <span aria-hidden className="text-coral-400 mt-0.5">⚠</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-coral-300 font-medium">Vault is not reachable.</div>
              <div className="text-xs text-cream-300/70 mt-1">
                Configured path: <span className="font-mono text-cream-100">{vaultHealth.vaultPath}</span>
              </div>
              <div className="text-xs text-cream-300/70 mt-1">
                {vaultHealth.reason ?? "The path does not resolve on this machine."}
              </div>
              <div className="text-[11px] text-cream-300/60 mt-2">
                Fix: mount the drive, restore the folder, or update <span className="font-mono">VAULT_PATH</span> in <span className="font-mono">.env</span> and restart the server. Until then, the knowledge tree, search, and capture endpoints will return 503.
              </div>
            </div>
            <button
              type="button"
              onClick={retryVaultHealth}
              className="text-xs px-3 py-1 rounded border border-coral-500/40 text-coral-200 hover:bg-coral-500/10"
            >
              Retry
            </button>
          </div>
        </div>
      )}
      {vaultHealth && vaultHealth.exists && !vaultHealth.gitRepo && (
        <div className="bg-flame-500/10 border border-flame-500/30 rounded-lg px-4 py-2">
          <div className="text-xs text-flame-300">
            Vault folder exists but has no <span className="font-mono">.git</span> — Obsidian sync over git won't work until you initialise the repo (run <span className="font-mono">git init</span> in <span className="font-mono">{vaultHealth.vaultPath}</span> and push to <span className="font-mono">origin</span>).
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder="search knowledge…"
          className="flex-1 bg-ink-900 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-violet-500"
        />
        <button onClick={doSearch} className="px-4 py-2 rounded-md bg-violet-500 hover:bg-violet-600 text-white text-sm">Search</button>
        {results && <button onClick={() => { setResults(null); setSearch(""); }} className="text-xs text-cream-300 hover:text-cream-100">clear</button>}
      </div>

      {err && <div className="text-coral-400 text-sm">{err}</div>}

      {results !== null ? (
        <Card title={`${results.length} match${results.length === 1 ? "" : "es"}`}>
          {results.length === 0 && <div className="text-xs text-cream-300/60">No matches.</div>}
          <ul className="space-y-2">
            {results.map((r, i) => (
              <li key={i} className="text-sm">
                <button onClick={() => nav("/knowledge/" + r.path)} className="text-violet-400 hover:text-violet-500 font-mono text-xs">{r.path}:{r.line}</button>
                <div className="text-xs text-cream-300/70 mt-0.5">{r.preview}</div>
              </li>
            ))}
          </ul>
        </Card>
      ) : content !== null ? (
        <Card
          title={subPath.split("/").pop()}
          action={
            <a href={api.brainDownloadUrl(subPath)} download className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25">
              <Download size={12} /> Download
            </a>
          }
        >
          <PromoteBar path={subPath} />
          <ImportsActions path={subPath} onChange={() => { /* navigate up after discard */ const up = subPath.split("/").slice(0, -1).join("/"); nav("/knowledge/" + up); }} />
          <div className="prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }} />
        </Card>
      ) : (
        <Card title="Files" action={<VaultUpload subPath={subPath} onUploaded={() => { api.brainTree(subPath).then(r => setTree(r.entries)).catch(() => {}); }} />}>
          <ul>
            {tree.map(e => {
              const Icon = e.type === "dir" ? Folder : FileText;
              return (
                <li key={e.path} className="flex items-center gap-1 group">
                  <button type="button" onClick={() => nav("/knowledge/" + e.path)} className="flex-1 flex items-center gap-2 text-left px-2 py-1.5 rounded hover:bg-ink-800 text-sm font-mono">
                    <Icon size={14} className={e.type === "dir" ? "text-violet-400 shrink-0" : "text-cream-300/60 shrink-0"} />
                    <span className={e.type === "dir" ? "text-violet-400" : "text-cream-200"}>{e.name}</span>
                  </button>
                  {e.type !== "dir" && (
                    <a href={api.brainDownloadUrl(e.path)} download title={`Download ${e.name}`} onClick={ev => ev.stopPropagation()} className="opacity-0 group-hover:opacity-100 text-cream-300/50 hover:text-violet-300 p-1.5 shrink-0">
                      <Download size={14} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

// Upload-into-current-folder control. Renders in the Card title bar so it's
// adjacent to the folder name. Folder is whatever subPath the user is
// browsing (root falls back to "0-Inbox" so the upload always lands in a
// known place rather than the vault root).
function VaultUpload({ subPath, onUploaded }: { subPath: string; onUploaded: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ status: "idle" | "uploading" | "saved" | "error"; filename?: string; vaultPath?: string; error?: string }>({ status: "idle" });
  const folder = subPath.trim() || "0-Inbox";

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
      const contentBase64 = btoa(binary);
      const r = await api.upload({
        filename: file.name,
        contentBase64,
        target: "vault",
        mimeType: file.type || undefined,
        vaultFolder: folder,
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
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFile} aria-label={`Upload a document to ${folder}`} />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={state.status === "uploading"}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
        title={`Upload a file into ${folder}`}
      >
        <Upload size={12} /> Upload to {folder.length > 20 ? folder.slice(0, 18) + "..." : folder}
      </button>
      {state.status === "uploading" && (
        <span className="text-[11px] text-violet-300">Uploading {state.filename}...</span>
      )}
      {state.status === "saved" && state.vaultPath && (
        <span className="inline-flex items-center gap-1 text-[11px] text-leaf-400">
          <CheckCircle2 size={11} /> Saved to {state.vaultPath}
        </span>
      )}
      {state.status === "error" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-coral-400" title={state.error}>
          <AlertTriangle size={11} /> Upload failed
        </span>
      )}
    </div>
  );
}

// Toolbar shown on a file open under _imports/. The bulk-import flow drops
// 880+ files in there with content-less sidecars; this lets the user act on
// each one without leaving the Knowledge browser:
//   - Process — kicks off the extractor job that fills sidecars with PDF/DOCX text
//   - Promote — re-uses the 2-Permanent flow (sidecar becomes a permanent note)
//   - Discard — deletes BOTH sidecar + binary (only legal under _imports/)
function ImportsActions({ path, onChange }: { path: string; onChange: () => void }) {
  const [busy, setBusy] = useState<"process" | "discard" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!path.startsWith("_imports/") || !path.endsWith(".md")) return null;

  async function discard() {
    if (!confirm("Delete this sidecar AND the original binary file? This can't be undone (unless you re-bulk-import).")) return;
    setBusy("discard"); setErr(null); setMsg(null);
    try {
      const r = await api.brainDiscard(path);
      setMsg(`Deleted ${r.count} file${r.count === 1 ? "" : "s"}.`);
      setTimeout(onChange, 800);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(null); }
  }
  async function process() {
    setBusy("process"); setErr(null); setMsg(null);
    try {
      const r = await api.brainProcessImports("_imports");
      setMsg(`Extractor job ${r.jobId.slice(0, 8)} started — refresh in a minute to see content.`);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(null); }
  }
  return (
    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-ink-800 flex-wrap">
      <div className="text-[10px] uppercase tracking-wider text-cream-300/50">Imported file</div>
      <button
        type="button"
        onClick={process}
        disabled={busy !== null}
        title="Extract text from every binary in _imports/ into its sidecar (runs once across the whole folder)"
        className="text-xs px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
      >
        {busy === "process" ? "Starting…" : "Process imports →"}
      </button>
      <button
        type="button"
        onClick={discard}
        disabled={busy !== null}
        title="Delete this sidecar AND its source binary"
        className="text-xs px-3 py-1.5 rounded-md bg-coral-500/15 border border-coral-500/40 text-coral-300 hover:bg-coral-500/25 disabled:opacity-40"
      >
        {busy === "discard" ? "Deleting…" : "Discard"}
      </button>
      {msg && <span className="text-[11px] text-leaf-400">{msg}</span>}
      {err && <span className="text-[11px] text-coral-400">{err}</span>}
      <span className="text-[11px] text-cream-300/40">Promote moves a content-bearing sidecar into 2-Permanent/.</span>
    </div>
  );
}

// Show "Promote to 2-Permanent" affordance ONLY for fleeting notes in
// 0-Inbox/ — that's the explicit Zettelkasten flow. For anything else we
// hide the button to avoid promoting random vault files by accident.
function PromoteBar({ path }: { path: string }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Promote is legal for fleeting captures (0-Inbox/) AND for imported sidecars
  // once they have content (_imports/ post-process). Other vault folders are
  // intentionally excluded — promoting them would create accidental duplicates.
  if (!path.endsWith(".md")) return null;
  if (!path.startsWith("0-Inbox/") && !path.startsWith("_imports/")) return null;
  async function promote() {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.brainPromote(path);
      setDone(r.to);
      setTimeout(() => nav("/knowledge/" + r.to), 1200);
    } catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-3 mb-4 pb-4 border-b border-ink-800 flex-wrap">
      <div className="text-[10px] uppercase tracking-wider text-cream-300/50">Fleeting note in 0-Inbox</div>
      {done ? (
        <span className="text-[11px] text-leaf-400">✓ promoted to <span className="font-mono">{done}</span></span>
      ) : err ? (
        <span className="text-[11px] text-coral-400">{err}</span>
      ) : (
        <button
          type="button"
          onClick={promote}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
        >
          {busy ? "Promoting…" : "Promote to 2-Permanent →"}
        </button>
      )}
      <span className="text-[11px] text-cream-300/40">Rewrites frontmatter with a Zettel id and archives the original.</span>
    </div>
  );
}
