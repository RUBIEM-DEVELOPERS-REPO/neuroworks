import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { marked } from "marked";
import { api } from "../lib/api";
import { BrandMark } from "../components/BrandMark";
import { ResultPanel } from "../components/ResultPanel";

type Msg = {
  role: "user" | "assistant";
  content: string;
  jobId?: string;
  templateId?: string;
  requiresApproval?: boolean;
  brainHits?: { path: string; line: number; preview: string }[];
};

const STORAGE_KEY = "neuroworks.chat";

export function Chat() {
  const [messages, setMessages] = useState<Msg[]>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch {}
    return [];
  });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50))); } catch {} }, [messages]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next); setDraft(""); setErr(""); setBusy(true);
    try {
      const r = await api.chat(next.map(m => ({ role: m.role, content: m.content })));
      setMessages(prev => [...prev, {
        role: "assistant",
        content: r.text,
        jobId: r.jobId,
        templateId: r.templateId,
        requiresApproval: r.requiresApproval,
        brainHits: r.brainHits,
      }]);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function clear() { setMessages([]); localStorage.removeItem(STORAGE_KEY); }

  const suggestions = [
    "search my notes for neuroworks",
    "summarize the clawbot project",
    "run digest with 14 day lookback",
    "sync downloads to vault",
    "add a note: idea for next sprint — wire publish-folder approvals to slack",
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-66px)] -my-7 -mx-8">
      <div className="flex items-center justify-between px-8 py-4 border-b border-ink-800">
        <div>
          <h1 className="font-display text-2xl text-cream-50">Chat with clawbot</h1>
          <p className="text-xs text-cream-300/60 mt-0.5">Type what you want done; if I can do it, I'll delegate to the right tool and report back.</p>
        </div>
        <button onClick={clear} className="text-xs text-cream-300/60 hover:text-cream-100">Clear conversation</button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto scrollbar-thin px-8 py-6">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto text-center py-16">
            <div className="grid place-items-center mb-4"><BrandMark size={56} /></div>
            <h2 className="font-display text-3xl text-cream-50 mb-2">Hi, I'm clawbot.</h2>
            <p className="text-sm text-cream-300/70 mb-8">I can search your knowledge base, summarize projects, run digests, capture notes, and sync downloads. Try:</p>
            <div className="grid grid-cols-1 gap-2 max-w-lg mx-auto">
              {suggestions.map(s => (
                <button key={s} onClick={() => setDraft(s)} className="text-left px-4 py-2.5 bg-ink-900 hover:bg-ink-850 border border-ink-800 hover:border-violet-500/40 rounded-lg text-sm text-cream-200 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto space-y-5">
          {messages.map((m, i) => <Bubble key={i} m={m} />)}
          {busy && (
            <div className="flex gap-3 items-start">
              <BrandMark size={28} />
              <div className="bg-ink-900 border border-ink-800 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-cream-300/70">
                <span className="inline-block w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse mr-1" />
                <span className="inline-block w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse mr-1" style={{ animationDelay: "0.1s" }} />
                <span className="inline-block w-1.5 h-1.5 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: "0.2s" }} />
              </div>
            </div>
          )}
          {err && <div className="text-coral-400 text-xs">{err}</div>}
        </div>
      </div>

      <div className="border-t border-ink-800 px-8 py-4 bg-ink-950">
        <form onSubmit={e => { e.preventDefault(); send(); }} className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="Message clawbot…"
            className="flex-1 bg-ink-900 border border-ink-800 focus:border-violet-500/60 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-cream-300/40"
            style={{ maxHeight: 200 }}
          />
          <button type="submit" disabled={busy || !draft.trim()} className="bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white px-5 py-3 rounded-xl text-sm font-medium">
            Send
          </button>
        </form>
        <div className="max-w-3xl mx-auto text-[10px] text-cream-300/40 mt-2 px-1">Enter to send · Shift+Enter for newline · Ollama local model: qwen3.5:0.8b</div>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-violet-500/15 border border-violet-500/30 rounded-2xl rounded-tr-sm px-4 py-3 text-sm text-cream-100 max-w-[75%]">
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3 items-start">
      <BrandMark size={28} />
      <div className="flex-1 max-w-[80%] space-y-2">
        <div className="bg-ink-900 border border-ink-800 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-cream-100 prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(m.content) as string }} />
        {m.jobId && <InlineJob jobId={m.jobId} requiresApproval={m.requiresApproval} templateId={m.templateId} />}
        {m.brainHits && m.brainHits.length > 0 && (
          <div className="bg-ink-950 border border-ink-800 rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-cream-300/50 mb-2">Possible brain matches</div>
            <ul className="space-y-1.5">
              {m.brainHits.map((h, i) => (
                <li key={i}>
                  <Link to={`/knowledge/${h.path}`} className="font-mono text-[11px] text-violet-400 hover:text-violet-500">{h.path}:{h.line}</Link>
                  <div className="text-[11px] text-cream-300/70">{h.preview}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function InlineJob({ jobId, requiresApproval, templateId }: { jobId: string; requiresApproval?: boolean; templateId?: string }) {
  const [job, setJob] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    let timer: any;
    async function tick() {
      try {
        const j = await api.getJob(jobId);
        if (!alive) return;
        setJob(j);
        if (j.status === "succeeded" || j.status === "failed" || j.status === "rejected") return;
      } catch {}
      timer = setTimeout(tick, 2000);
    }
    tick();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [jobId]);

  if (!job) {
    return (
      <div className="text-xs text-cream-300/60 bg-ink-950 border border-ink-800 rounded-lg px-3 py-2">
        Connecting to job <span className="font-mono">{jobId.slice(0, 8)}</span>…
      </div>
    );
  }

  const isPending = job.status === "running" || job.status === "pending";
  const status = isPending ? "running" : job.status;
  const r = job.result ?? {};
  const phase = r.phase as string | undefined;
  const runs = (r.runs ?? []) as any[];
  const totalSteps = r.plan?.steps?.length ?? 0;
  const doneCount = runs.filter(x => x?.ok === true).length;
  const inflightCount = runs.filter(x => x && x.startedAt && x.ok === false && !x.error).length;

  const friendlyLabel = (() => {
    if (status === "succeeded") return r.savedTemplateId ? "Done · saved as a shortcut" : "Done";
    if (status === "failed") return "Hit a snag";
    if (status === "rejected") return "Rejected";
    if (status === "awaiting-approval") return "Waiting for your approval";
    if (phase === "planning") return "Working out a plan";
    if (phase === "executing") {
      if (inflightCount > 1) return `${inflightCount} sub-agents working together`;
      if (totalSteps > 0) return `Working on it · ${doneCount}/${totalSteps}`;
      return "Working on it";
    }
    if (phase === "synthesizing") return "Writing your answer";
    if (phase === "answering") return "Answering directly";
    return "Working on it";
  })();

  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full inline-flex ${
        status === "succeeded" ? "bg-leaf-500/10 border border-leaf-500/30 text-leaf-400" :
        status === "failed" || status === "rejected" ? "bg-coral-500/10 border border-coral-500/30 text-coral-400" :
        status === "awaiting-approval" ? "bg-flame-500/10 border border-flame-500/30 text-flame-400" :
        "bg-violet-500/10 border border-violet-500/30 text-violet-400"
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full ${
          status === "succeeded" ? "bg-leaf-500" :
          status === "failed" || status === "rejected" ? "bg-coral-500" :
          status === "awaiting-approval" ? "bg-flame-500" :
          "bg-violet-500 animate-pulse"
        }`} />
        {friendlyLabel}
        {requiresApproval && status === "awaiting-approval" && <Link to="/approvals" className="ml-1 underline">approve →</Link>}
        {!isPending && <Link to={`/tasks?focus=${jobId}`} className="ml-1 underline opacity-70 hover:opacity-100">view full report</Link>}
      </div>
      {(job.template === "general-task" || (job.template ?? "").startsWith("custom-")) && job.result?.plan && (
        <ResultPanel job={job} />
      )}
      {!isPending && job.status === "succeeded" && job.template !== "general-task" && !(job.template ?? "").startsWith("custom-") && <ResultPanel job={job} />}
      {(job.status === "failed" || job.status === "rejected") && job.error && (
        <pre className="text-[11px] font-mono text-coral-400 whitespace-pre-wrap bg-ink-950 border border-coral-500/20 rounded-md p-3 overflow-auto scrollbar-thin max-h-40">{job.error}</pre>
      )}
      {isPending && job.log?.length > 0 && !job.result?.plan && (
        <pre className="text-[10px] font-mono text-cream-300/70 whitespace-pre-wrap bg-ink-950 border border-ink-800 rounded-md p-2 max-h-32 overflow-auto scrollbar-thin">{job.log.slice(-6).join("\n")}</pre>
      )}
    </div>
  );
}
