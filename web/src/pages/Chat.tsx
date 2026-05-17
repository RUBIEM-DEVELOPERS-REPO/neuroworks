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
const SESSION_ID_KEY = "neuroworks.chat.sessionId";

export function Chat() {
  const [messages, setMessages] = useState<Msg[]>(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch {}
    return [];
  });
  const [sessionId, setSessionId] = useState<string>(() => {
    try {
      const existing = localStorage.getItem(SESSION_ID_KEY);
      if (existing) return existing;
    } catch {}
    const fresh = `session-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
    try { localStorage.setItem(SESSION_ID_KEY, fresh); } catch {}
    return fresh;
  });
  const [draft, setDraft] = useState("");
  // When a customer clicks a starter template, we DON'T paste the full
  // template task into the input box — that exposes internal tool names and
  // makes the customer feel they have to edit a prompt. Instead we pin the
  // template as a chip above the input and keep the textarea clean for the
  // ONE thing they actually need to type (their topic / specifics).
  const [activeTemplate, setActiveTemplate] = useState<{ title: string; task: string; placeholder?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<{ status: "idle" | "saving" | "saved" | "error"; path?: string; error?: string }>({ status: "idle" });
  // Active persona + its starter templates — drives the empty-state
  // suggestions so each persona shows its OWN signature prompts instead of
  // a static list. When no persona is active, falls back to a sensible
  // generic set covering vault search, digests, and notes.
  const [activePersona, setActivePersona] = useState<{ id: string; name: string; role: string } | null>(null);
  const [personaTemplates, setPersonaTemplates] = useState<{ title: string; description?: string; origin?: { task?: string } }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50))); } catch {} }, [messages]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);
  useEffect(() => { api.health().then(h => setModel(h.model)).catch(() => {}); }, []);

  // Poll the active persona + its templates. Re-runs every 5s so swapping
  // persona on /personas reflects in the chat without needing a refresh.
  useEffect(() => {
    let alive = true;
    let lastPersonaId: string | null = null;
    async function tick() {
      try {
        const r = await api.listPersonas();
        if (!alive) return;
        setActivePersona(r.active);
        const id = r.active?.id ?? null;
        if (id !== lastPersonaId) {
          lastPersonaId = id;
          if (id) {
            try { const t = await api.listPersonaTemplates(id); if (alive) setPersonaTemplates(t.templates ?? []); }
            catch { if (alive) setPersonaTemplates([]); }
          } else {
            setPersonaTemplates([]);
          }
        }
      } catch { /* swallow */ }
    }
    tick();
    const i = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  // Auto-save policy:
  //   • After every exchange — once the assistant's response arrives the
  //     session file in the vault is rewritten with the full thread so far.
  //     A 3-second debounce coalesces rapid turn-taking.
  //   • On unmount — the user navigated away. Catches the most common
  //     "I closed the tab without saving" case.
  //   • On `visibilitychange` to hidden — covers tab-close / app-switch
  //     paths that don't fire React unmount cleanup synchronously.
  //   • Server-side, the commit queue debounces the actual git commit, so
  //     these frequent saves still collapse into a single commit.
  //
  // The 30s idle save survives as the slowest fallback, in case all three
  // above paths miss (e.g. browser crash mid-response).
  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => { void saveSession(true); }, 3_000);
    return () => clearTimeout(t);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unmount + visibility-change saves. Uses `keepalive: true` so the request
  // survives a page-close, and reads from a ref to avoid stale-closure bugs
  // (React cleanup captures the closure at mount time).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  useEffect(() => {
    function flush() {
      const msgs = messagesRef.current;
      if (msgs.length === 0) return;
      try {
        navigator.sendBeacon?.(
          "/api/chat/save-session",
          new Blob([JSON.stringify({ sessionId, messages: msgs.map(m => ({ role: m.role, content: m.content, jobId: m.jobId })) })], { type: "application/json" }),
        );
      } catch { /* tolerate — the next page load saves again */ }
    }
    function onHide() { if (document.visibilityState === "hidden") flush(); }
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [sessionId]);

  async function saveSession(silent = false) {
    if (messages.length === 0) return;
    if (!silent) setSaveState({ status: "saving" });
    try {
      const r = await api.saveSession(sessionId, messages.map(m => ({ role: m.role, content: m.content, jobId: m.jobId })));
      setSaveState({ status: "saved", path: r.path });
      if (!silent) setTimeout(() => setSaveState(s => s.status === "saved" ? { status: "idle" } : s), 3000);
    } catch (e: any) {
      setSaveState({ status: "error", error: e?.message ?? String(e) });
    }
  }

  function newSession() {
    const fresh = `session-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
    try { localStorage.setItem(SESSION_ID_KEY, fresh); } catch {}
    setSessionId(fresh);
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    setSaveState({ status: "idle" });
  }

  async function send() {
    const topic = draft.trim();
    if (!topic || busy) return;
    // If a template is pinned, the customer's typed text is the TOPIC. We
    // splice it into the template prompt server-side so the planner sees
    // the full instruction ("research.multiperspective: <topic>") while the
    // customer only had to type their topic. The user-facing bubble shows
    // their topic alone — keeping the chat clean.
    const displayText = topic;
    const sendText = activeTemplate
      ? `${activeTemplate.task.trim()}\n\nTopic: ${topic}`
      : topic;
    const next: Msg[] = [...messages, { role: "user", content: displayText }];
    setMessages(next); setDraft(""); setActiveTemplate(null); setErr(""); setBusy(true);
    try {
      const payload = next.map((m, idx) =>
        idx === next.length - 1 && m.role === "user"
          ? { role: m.role, content: sendText }
          : { role: m.role, content: m.content },
      );
      const r = await api.chat(payload);
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

  // Empty-state launchpad. Each suggestion pins itself as an activeTemplate
  // on click — the customer just types their topic, never the prompt.
  type Suggestion = { title: string; description?: string; task: string; placeholder: string };
  const genericSuggestions: Suggestion[] = [
    { title: "Search my notes", task: "search my notes for", placeholder: "What should I look for?" },
    { title: "Summarize a project", task: "summarize the", placeholder: "Which project?" },
    { title: "Run a digest", task: "run digest with", placeholder: "How many days back? e.g. 14 days" },
    { title: "Sync downloads to vault", task: "sync downloads to vault", placeholder: "Anything specific? (or leave blank)" },
    { title: "Capture a note", task: "add a note:", placeholder: "What should the note say?" },
  ];
  const suggestions: Suggestion[] = personaTemplates.length > 0
    ? personaTemplates.slice(0, 6).map(t => ({
        title: t.title,
        description: t.description,
        task: t.origin?.task ?? t.title,
        placeholder: t.description ? `Topic — e.g. ${shortHint(t.description)}` : "What topic?",
      }))
    : genericSuggestions;

  return (
    <div className="flex flex-col h-[calc(100vh-66px)] -my-7 -mx-8">
      <div className="flex items-center justify-between px-8 py-4 border-b border-ink-800 gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-cream-50">Chat with clawbot</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs text-cream-300/60">Type what you want done; I'll delegate and report back.</p>
            <span className="text-[10px] text-cream-300/40 font-mono">· session {sessionId.slice(0, 18)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveState.status === "saving" && <span className="text-[11px] text-violet-400">saving…</span>}
          {saveState.status === "saved" && saveState.path && (
            <Link to={`/knowledge/${saveState.path}`} className="text-[11px] text-leaf-400 hover:text-leaf-500" title={saveState.path}>✓ saved to vault</Link>
          )}
          {saveState.status === "error" && <span className="text-[11px] text-coral-400" title={saveState.error}>save failed</span>}
          <Link
            to="/knowledge/_neuroworks/sessions"
            className="text-xs text-cream-300 hover:text-cream-50 px-2 py-1 rounded border border-ink-700 hover:border-violet-500/40 transition-colors"
            title="Browse past chat sessions in your vault"
          >
            Past sessions
          </Link>
          <button
            type="button"
            onClick={() => void saveSession(false)}
            disabled={messages.length === 0 || saveState.status === "saving"}
            className="text-xs text-cream-300 hover:text-cream-50 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded border border-ink-700 hover:border-violet-500/40 transition-colors"
          >
            Save session
          </button>
          <button
            type="button"
            onClick={newSession}
            className="text-xs text-cream-300 hover:text-cream-50 px-2 py-1 rounded border border-ink-700 hover:border-violet-500/40 transition-colors"
            title="Start a fresh session id — the next save creates a new vault file"
          >
            New session
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto scrollbar-thin px-8 py-6">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto text-center py-16">
            <div className="grid place-items-center mb-4"><BrandMark size={56} /></div>
            <h2 className="font-display text-3xl text-cream-50 mb-2">
              {activePersona ? `Hi, I'm ${activePersona.name}.` : "Hi, I'm clawbot."}
            </h2>
            <p className="text-sm text-cream-300/70 mb-2">
              {activePersona
                ? `Operating as ${activePersona.role}. Pick a starter or type your own — I'll route it through the right tools.`
                : "I can search your knowledge base, summarize projects, run digests, capture notes, and sync downloads. Try:"}
            </p>
            {activePersona && personaTemplates.length > 0 && (
              <p className="text-[11px] text-cream-300/40 mb-6">
                These are <Link to="/personas" className="text-violet-400 hover:text-violet-500">{activePersona.name}'s</Link> starter templates · <Link to="/templates" className="text-violet-400 hover:text-violet-500">see all</Link>
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 max-w-xl mx-auto text-left">
              {suggestions.map(s => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => { setActiveTemplate({ title: s.title, task: s.task, placeholder: s.placeholder }); setDraft(""); }}
                  className="px-4 py-3 bg-ink-900 hover:bg-ink-850 border border-ink-800 hover:border-violet-500/40 rounded-lg transition-colors group"
                >
                  <div className="text-sm text-cream-100 group-hover:text-cream-50">{s.title}</div>
                  {s.description && (
                    <div className="text-[11px] text-cream-300/60 mt-0.5 line-clamp-2">{s.description}</div>
                  )}
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
        <form onSubmit={e => { e.preventDefault(); send(); }} className="max-w-3xl mx-auto">
          {activeTemplate && (
            <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-violet-500/10 border border-violet-500/30 rounded-lg text-xs">
              <span className="text-violet-300">Using:</span>
              <span className="text-cream-100 font-medium">{activeTemplate.title}</span>
              <button
                type="button"
                onClick={() => setActiveTemplate(null)}
                className="ml-auto text-cream-300/60 hover:text-cream-50 text-sm leading-none"
                title="Clear template"
                aria-label="Clear template"
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              placeholder={activeTemplate?.placeholder ?? "Message clawbot…"}
              className="flex-1 bg-ink-900 border border-ink-800 focus:border-violet-500/60 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-cream-300/40"
              style={{ maxHeight: 200 }}
            />
            <button type="submit" disabled={busy || !draft.trim()} className="bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white px-5 py-3 rounded-xl text-sm font-medium">
              Send
            </button>
          </div>
        </form>
        <div className="max-w-3xl mx-auto text-[10px] text-cream-300/40 mt-2 px-1">Enter to send · Shift+Enter for newline{model ? ` · Ollama local model: ${model}` : ""}</div>
      </div>
    </div>
  );
}

// Pull a short example fragment out of a template description for the
// placeholder hint — keeps the hint concrete without dragging full sentences
// into the input field. Falls back to the raw description trimmed at 40 chars.
function shortHint(desc: string): string {
  const m = desc.match(/e\.g\.?\s+([^.;]+)/i);
  if (m) return m[1].trim().replace(/[.,]$/, "").slice(0, 40);
  return desc.replace(/\.$/, "").slice(0, 40);
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
  const [retry, setRetry] = useState<{ state: "idle" | "running" | "started" | "error"; newJobId?: string; error?: string }>({ state: "idle" });
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
  async function doRetry() {
    setRetry({ state: "running" });
    try {
      const r = await api.retryJob(jobId);
      setRetry({ state: "started", newJobId: r.jobId });
    } catch (e: any) {
      setRetry({ state: "error", error: e?.message ?? String(e) });
    }
  }

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
        {!isPending && status === "succeeded" && <Link to={`/results/${jobId}`} className="ml-1 underline opacity-90 hover:opacity-100">open report →</Link>}
        {!isPending && <Link to={`/tasks?focus=${jobId}`} className="ml-1 underline opacity-60 hover:opacity-100">technical view</Link>}
      </div>
      {(job.template === "general-task" || (job.template ?? "").startsWith("custom-")) && job.result?.plan && (
        <ResultPanel job={job} />
      )}
      {!isPending && job.status === "succeeded" && job.template !== "general-task" && !(job.template ?? "").startsWith("custom-") && <ResultPanel job={job} />}
      {(job.status === "failed" || job.status === "rejected") && (
        <div className="space-y-2">
          {job.error && (
            <pre className="text-[11px] font-mono text-coral-400 whitespace-pre-wrap bg-ink-950 border border-coral-500/20 rounded-md p-3 overflow-auto scrollbar-thin max-h-40">{job.error}</pre>
          )}
          {/* Partial-results rescue: when a job failed but a partial answer
              survived (e.g. fallbackSynthesis kicked in), surface it so the
              customer isn't staring at a bare error. */}
          {typeof job.result?.answer === "string" && job.result.answer.trim().length > 0 && (
            <div className="bg-ink-950 border border-flame-500/30 rounded-md p-3 text-xs text-cream-100 prose-vault" dangerouslySetInnerHTML={{ __html: marked.parse(job.result.answer) as string }} />
          )}
          {/* Retry affordance — one click replays the same task. Most
              "Hit a snag" outcomes are transient (LLM hiccup, network blip)
              and clear on a fresh attempt. */}
          {retry.state === "started" && retry.newJobId
            ? <div className="text-[11px] text-leaf-400">Retry started — <Link to={`/tasks?focus=${retry.newJobId}`} className="underline">track new job →</Link></div>
            : <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={doRetry}
                  disabled={retry.state === "running"}
                  className="text-xs px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
                >
                  {retry.state === "running" ? "Retrying…" : "↻ Retry this task"}
                </button>
                {retry.state === "error" && <span className="text-[11px] text-coral-400">{retry.error}</span>}
              </div>
          }
        </div>
      )}
      {isPending && job.log?.length > 0 && !job.result?.plan && (
        <pre className="text-[10px] font-mono text-cream-300/70 whitespace-pre-wrap bg-ink-950 border border-ink-800 rounded-md p-2 max-h-32 overflow-auto scrollbar-thin">{job.log.slice(-6).join("\n")}</pre>
      )}
    </div>
  );
}
