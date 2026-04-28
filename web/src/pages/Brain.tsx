import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { marked } from "marked";
import { api } from "../lib/api";
import { Card } from "../components/Card";

export function Brain() {
  const nav = useNavigate();
  const loc = useLocation();
  const subPath = loc.pathname.replace(/^\/brain\/?/, "");
  const [tree, setTree] = useState<any[]>([]);
  const [content, setContent] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setErr("");
    setContent(null);
    if (!subPath) {
      api.brainTree("").then(r => setTree(r.entries)).catch(e => setErr(e.message));
      return;
    }
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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Brain</h1>
        <div className="text-sm text-slate-400 mt-1 flex items-center gap-1 flex-wrap">
          <button onClick={() => nav("/brain")} className="hover:text-neuro-400">root</button>
          {segments.map((s, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-slate-600">/</span>
              <button onClick={() => nav("/brain/" + segments.slice(0, i + 1).join("/"))} className="hover:text-neuro-400">{s}</button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder="search vault…"
          className="flex-1 bg-ink-900 border border-ink-700 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-neuro-500"
        />
        <button onClick={doSearch} className="px-3 py-1.5 rounded-md bg-neuro-500 hover:bg-neuro-600 text-white text-sm">Search</button>
        {results && <button onClick={() => { setResults(null); setSearch(""); }} className="text-xs text-slate-400 hover:text-slate-200">clear</button>}
      </div>

      {err && <div className="text-red-400 text-sm">{err}</div>}

      {results !== null ? (
        <Card title={`${results.length} match${results.length === 1 ? "" : "es"}`}>
          {results.length === 0 && <div className="text-xs text-slate-500">No matches.</div>}
          <ul className="space-y-2">
            {results.map((r, i) => (
              <li key={i} className="text-sm">
                <button onClick={() => nav("/brain/" + r.path)} className="text-neuro-400 hover:text-neuro-500 font-mono text-xs">{r.path}:{r.line}</button>
                <div className="text-xs text-slate-400 mt-0.5">{r.preview}</div>
              </li>
            ))}
          </ul>
        </Card>
      ) : content !== null ? (
        <Card>
          <div className="prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }} />
        </Card>
      ) : (
        <Card title="Files">
          <ul>
            {tree.map(e => (
              <li key={e.path}>
                <button
                  onClick={() => nav("/brain/" + e.path)}
                  className="block w-full text-left px-2 py-1 rounded hover:bg-ink-800 text-sm font-mono"
                >
                  <span className="text-slate-500">{e.type === "dir" ? "📁" : "📄"}</span>{" "}
                  <span className={e.type === "dir" ? "text-neuro-400" : "text-slate-300"}>{e.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
