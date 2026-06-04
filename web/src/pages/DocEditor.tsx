import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { marked } from "marked";
import { FileText, Save, Sparkles, Eye, FileEdit, RotateCcw, Download, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { Card, Button, showToast } from "../components/Card";

// Markdown doc editor with an agent-assist side panel. The user can:
//   - Hand-edit the source in the textarea (split with a live preview).
//   - Ask the agent to make a targeted change ("tighten paragraph 3",
//     "add a TL;DR", "fix every misspelling of NeuroWorks").
// The agent is instructed to use `vault.edit` (string-replace) so the doc's
// structure (headings, lists, tables, frontmatter) is preserved — it changes
// only the spans the operator asked it to change.
//
// Saving writes through the same writeVaultFile + commit-queue clawbot uses
// for agent-side writes, so manual and agent edits share one audit trail.

export function DocEditor() {
  // useParams with splat — react-router v6 gives the rest in params["*"].
  const params = useParams();
  const path = (params["*"] ?? "").replace(/^[/\\]+/, "");
  const nav = useNavigate();
  const [original, setOriginal] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const reloadCountRef = useRef(0);

  useEffect(() => {
    if (!path) { setOriginal(""); setContent(""); return; }
    let alive = true;
    api.brainFile(path).then(r => {
      if (!alive) return;
      setOriginal(r.content);
      setContent(r.content);
      setLoadErr(null);
    }).catch(e => { if (alive) setLoadErr(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, [path, reloadCountRef.current]);

  // Recovery for the "sidecar is missing" case — call ensure-sidecar which
  // searches for a sibling .pdf/.docx/.xlsx and writes a markdown sidecar
  // from the extracted text. Then reload. This fixes the ENOENT a user hits
  // when they navigate to a .md path whose binary was uploaded in a prior
  // session that didn't auto-generate the sidecar.
  async function generateFromSource() {
    if (!path || recovering) return;
    setRecovering(true); setLoadErr(null);
    try {
      const s = await api.brainEnsureSidecar(path, true);
      // ensure-sidecar may navigate us to a slightly different path (the
      // canonical sidecar). Force a reload of the same path; if the sidecar
      // landed at a different path, navigate there.
      if (s.sidecarPath !== path) nav(`/edit/${s.sidecarPath}`);
      else reloadCountRef.current += 1;
    } catch (e: any) {
      setLoadErr(e?.message ?? String(e));
    } finally { setRecovering(false); }
  }

  const dirty = original !== null && content !== original;

  async function save() {
    if (!path || !dirty) return;
    setSaveState("saving"); setSaveErr(null);
    try {
      await api.brainSave(path, content);
      setOriginal(content);
      setSaveState("saved");
      showToast("Saved", "success");
      setTimeout(() => setSaveState(s => s === "saved" ? "idle" : s), 2000);
    } catch (e: any) {
      setSaveState("error");
      setSaveErr(e?.message ?? String(e));
      showToast(`Save failed: ${e?.message ?? "unknown"}`, "error", 4000);
    }
  }

  function revert() {
    if (original !== null) setContent(original);
  }

  // Trigger a download via a hidden form post (GET variants need .md path,
  // which we have). Using anchor-with-download lets the browser handle the
  // file naming and avoids fetch+blob memory copies for big PDFs.
  function downloadAs(format: "pdf" | "docx" | "md") {
    if (format === "md") {
      const url = `/api/exports/markdown`;
      const body = { markdown: content, filename: filenameOnly };
      postDownload(url, body);
    } else {
      const url = `/api/exports/${format}?path=${encodeURIComponent(path)}`;
      window.open(url, "_blank");
    }
  }

  // Hidden-form POST that triggers a download response.
  function postDownload(url: string, body: any) {
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => {
        const blob = await r.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = String(body.filename ?? "document");
        document.body.appendChild(a); a.click(); a.remove();
      }).catch(() => {});
  }

  const filenameOnly = useMemo(() => path.split("/").pop() ?? "document.md", [path]);
  const previewHtml = useMemo(() => marked.parse(content) as string, [content]);

  if (!path) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-3xl text-cream-50 flex items-center gap-3"><FileEdit size={24} /> Doc editor</h1>
        <Card><div className="text-sm text-cream-300">Open a file from the Knowledge browser, or paste a vault path:</div>
          <PickFile onPick={p => nav(`/edit/${p}`)} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-cream-50 flex items-center gap-2.5"><FileEdit size={22} /> {filenameOnly}</h1>
          <div className="text-[11px] text-cream-300/60 font-mono mt-0.5 break-all">{path}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button onClick={() => setShowPreview(p => !p)} variant="ghost"><Eye size={14} /> {showPreview ? "Hide preview" : "Show preview"}</Button>
          <DownloadMenu onSelect={downloadAs} />
          <Button onClick={revert} disabled={!dirty} variant="ghost"><RotateCcw size={14} /> Revert</Button>
          <Button onClick={save} disabled={!dirty || saveState === "saving"}><Save size={14} /> {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save"}</Button>
        </div>
      </div>

      {loadErr && (
        <div className="bg-coral-500/10 border border-coral-500/30 rounded-lg px-4 py-3">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-coral-300 font-medium">Load error</div>
              <div className="text-xs text-cream-300/70 mt-1 font-mono break-all">{loadErr}</div>
              {/^ENOENT/i.test(loadErr) && (
                <div className="text-[11px] text-cream-300/60 mt-2">
                  If a PDF / DOCX with the same name was uploaded, clicking <em>Generate from source</em> will extract the text into a markdown sidecar you can edit.
                </div>
              )}
            </div>
            {/^ENOENT/i.test(loadErr) && (
              <Button onClick={generateFromSource} disabled={recovering} variant="subtle">
                <Sparkles size={14} /> {recovering ? "Generating…" : "Generate from source"}
              </Button>
            )}
          </div>
        </div>
      )}
      {saveErr && <div className="text-coral-400 text-sm">Save error: {saveErr}</div>}

      <div className={`grid gap-4 ${showPreview ? "grid-cols-2" : "grid-cols-1"}`}>
        <Card title={`Source${dirty ? " · unsaved" : ""}`}>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            spellCheck={false}
            aria-label={`Edit ${filenameOnly}`}
            placeholder="Markdown source — edit, then Save."
            className="w-full min-h-[60vh] bg-ink-950 border border-ink-800 rounded p-3 text-[13px] font-mono text-cream-100 leading-relaxed resize-y focus:outline-none focus:border-violet-500/40"
          />
        </Card>
        {showPreview && (
          <Card title="Preview">
            <div className="prose-vault max-w-none" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </Card>
        )}
      </div>

      <AgentAssistPanel path={path} onAfterRun={() => { reloadCountRef.current += 1; api.brainFile(path).then(r => { setOriginal(r.content); setContent(r.content); }).catch(() => {}); }} />
    </div>
  );
}

function PickFile({ onPick }: { onPick: (path: string) => void }) {
  const [v, setV] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [upState, setUpState] = useState<{ status: "idle" | "uploading" | "saved" | "error"; filename?: string; error?: string }>({ status: "idle" });

  // PDF / DOCX uploads create an editable .md sidecar (same dir, same stem)
  // via importBinaryIntoVault — open the SIDECAR for editing, not the binary
  // itself. Markdown / text / json files have no sidecar; open them directly.
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setUpState({ status: "error", filename: file.name, error: "File too large (max 20 MB)" });
      return;
    }
    setUpState({ status: "uploading", filename: file.name });
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
        vaultFolder: "0-Inbox",
      });
      const vaultPath = r.vaultPath ?? "";
      const lower = file.name.toLowerCase();
      const textLike = /\.(md|markdown|txt|json)$/i.test(lower);
      let target = vaultPath;
      if (!textLike) {
        // Binary doc — importBinaryIntoVault only copies the file; it does
        // NOT generate the .md sidecar the editor needs. Call ensure-sidecar
        // explicitly so the editor opens onto a real, edit-ready document
        // instead of hitting ENOENT.
        const s = await api.brainEnsureSidecar(vaultPath);
        target = s.sidecarPath;
      }
      setUpState({ status: "saved", filename: file.name });
      onPick(target);
    } catch (err: any) {
      setUpState({ status: "error", filename: file.name, error: err?.message ?? String(err) });
    }
  }

  return (
    <div className="space-y-3 mt-3">
      <form onSubmit={e => { e.preventDefault(); if (v.trim()) onPick(v.trim()); }} className="flex items-center gap-2">
        <input value={v} onChange={e => setV(e.target.value)} placeholder="0-Inbox/example.md" className="flex-1 bg-ink-950 border border-ink-800 rounded px-3 py-1.5 text-sm font-mono text-cream-100 focus:outline-none focus:border-violet-500/40" />
        <Button type="submit"><FileText size={14} /> Open</Button>
      </form>
      <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-ink-800">
        <input ref={inputRef} type="file" className="hidden" onChange={handleFile} aria-label="Upload a document to edit" />
        <Button onClick={() => inputRef.current?.click()} disabled={upState.status === "uploading"} variant="subtle">
          <Upload size={14} /> {upState.status === "uploading" ? `Uploading ${upState.filename}…` : "Upload a document"}
        </Button>
        <span className="text-[11px] text-cream-300/50">
          Markdown / TXT open directly. PDF / DOCX / XLSX import to <span className="font-mono">0-Inbox/</span> with an editable <span className="font-mono">.md</span> sidecar.
        </span>
        {upState.status === "saved" && (
          <span className="text-[11px] text-leaf-400 inline-flex items-center gap-1">
            <CheckCircle2 size={11} /> opening…
          </span>
        )}
        {upState.status === "error" && (
          <span className="text-[11px] text-coral-400 inline-flex items-center gap-1" title={upState.error}>
            <AlertTriangle size={11} /> {upState.error}
          </span>
        )}
      </div>
    </div>
  );
}

function DownloadMenu({ onSelect }: { onSelect: (f: "pdf" | "docx" | "md") => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button onClick={() => setOpen(o => !o)} variant="ghost"><Download size={14} /> Download</Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-ink-900 border border-ink-700 rounded shadow-lg overflow-hidden z-20 min-w-[160px]">
          {[{ k: "pdf", l: "PDF (.pdf)" }, { k: "docx", l: "Word (.docx)" }, { k: "md", l: "Markdown (.md)" }].map(o => (
            <button
              key={o.k}
              type="button"
              onClick={() => { onSelect(o.k as any); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-xs text-cream-200 hover:bg-ink-800"
            >{o.l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentAssistPanel({ path, onAfterRun }: { path: string; onAfterRun: () => void }) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; jobId?: string; answer?: string; error?: string } | null>(null);

  async function ask() {
    if (!instruction.trim() || busy) return;
    setBusy(true); setLast(null);
    try {
      // System-style instruction: name the file, request structure-preserving
      // edits via `vault.edit`, do NOT rewrite the whole file. The planner
      // already prefers vault.edit over vault.write for edit-shaped tasks.
      const prompt = `Edit the vault file \`${path}\` per this instruction:\n\n${instruction.trim()}\n\nMake targeted, structure-preserving changes — use the vault.edit tool to replace only the spans you need to change. Preserve the document's existing headings, frontmatter, list shapes, table columns, and whitespace. Do NOT rewrite the whole file. Confirm what you changed in a short reply.`;
      const r = await api.chat([{ role: "user", content: prompt }]);
      setLast({ ok: true, jobId: r.jobId, answer: r.text });
      // Reload file content so the editor reflects any vault.edit changes.
      setTimeout(onAfterRun, 800);
    } catch (e: any) {
      setLast({ ok: false, error: e?.message ?? String(e) });
    } finally { setBusy(false); }
  }

  return (
    <Card title="Ask an agent to edit this doc">
      <p className="text-xs text-cream-300/70 mb-2">The agent will use <span className="font-mono">vault.edit</span> to make targeted string-replacement edits. Structure (headings, lists, tables, frontmatter) is preserved.</p>
      <div className="flex gap-2 items-start">
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          placeholder='e.g. "Tighten the TL;DR to one sentence" or "Add a Risks section after Decisions"'
          className="flex-1 min-h-[64px] bg-ink-950 border border-ink-800 rounded px-3 py-2 text-[13px] text-cream-100 focus:outline-none focus:border-violet-500/40 resize-y"
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); ask(); } }}
        />
        <Button onClick={ask} disabled={!instruction.trim() || busy}><Sparkles size={14} /> {busy ? "Asking…" : "Ask agent"}</Button>
      </div>
      {last && (
        <div className="mt-3 text-xs">
          {last.ok ? (
            <div className="bg-leaf-500/10 border border-leaf-500/30 rounded p-3 space-y-1">
              <div className="text-leaf-300 font-medium">Agent ran — file reloaded</div>
              {last.answer && <div className="text-cream-200 whitespace-pre-wrap">{last.answer.slice(0, 800)}</div>}
              {last.jobId && <Link to={`/results/${last.jobId}`} className="text-violet-400 hover:text-violet-500 inline-block">Open the full trace →</Link>}
            </div>
          ) : (
            <div className="bg-coral-500/10 border border-coral-500/30 rounded p-3 text-coral-300">{last.error}</div>
          )}
        </div>
      )}
    </Card>
  );
}
