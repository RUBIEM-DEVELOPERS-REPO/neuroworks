import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { marked } from "marked";
import { api } from "../lib/api";
import { Card } from "../components/Card";

export function Knowledge() {
  const nav = useNavigate();
  const loc = useLocation();
  const subPath = loc.pathname.replace(/^\/knowledge\/?/, "");
  const [tree, setTree] = useState<any[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [err, setErr] = useState("");

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

  const segments = subPath ? subPath.split("/") : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-cream-50">Knowledge</h1>
        <div className="text-sm text-cream-300/70 mt-1 flex items-center gap-1.5 flex-wrap">
          <button onClick={() => nav("/knowledge")} className="hover:text-violet-400">Vault root</button>
          {segments.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="text-cream-300/30">/</span>
              <button onClick={() => nav("/knowledge/" + segments.slice(0, i + 1).join("/"))} className="hover:text-violet-400">{s}</button>
            </span>
          ))}
        </div>
      </div>

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
        <Card>
          <PromoteBar path={subPath} />
          <div className="prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }} />
        </Card>
      ) : (
        <Card title="Files">
          <ul>
            {tree.map(e => (
              <li key={e.path}>
                <button onClick={() => nav("/knowledge/" + e.path)} className="block w-full text-left px-2 py-1.5 rounded hover:bg-ink-800 text-sm font-mono">
                  <span className="text-cream-300/40">{e.type === "dir" ? "📁" : "📄"}</span>{" "}
                  <span className={e.type === "dir" ? "text-violet-400" : "text-cream-200"}>{e.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
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
  if (!path.startsWith("0-Inbox/") || !path.endsWith(".md")) return null;
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
