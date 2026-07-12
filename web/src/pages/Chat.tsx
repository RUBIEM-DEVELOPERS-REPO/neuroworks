import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { marked } from "marked";
import {
  Paperclip, X, Plus, Pause, RotateCcw, ArrowRight, AlertTriangle,
  CheckCircle2, FileText, Send, Mic, Square, Loader2, ListChecks,
} from "lucide-react";
import { api } from "../lib/api";
import { useAudioRecorder } from "../lib/useAudioRecorder";
import { BrandMark } from "../components/BrandMark";
import { ResultPanel } from "../components/ResultPanel";
import { Kbd, MetaKey } from "../components/Kbd";

type Clarification = {
  originalText: string;
  summary?: string;
  missing?: { name: string; label: string }[];
  templateId?: string;
  intent?: string;
  followUpKind?: string;
  ambiguityKind?: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  jobId?: string;
  templateId?: string;
  requiresApproval?: boolean;
  brainHits?: { path: string; line: number; preview: string }[];
  // Clawbot paused for missing context — the UI surfaces a "Continue this
  // task" button on the bubble, and clicking it pins a continuation chip
  // above the input so the user's next message gets stitched back to the
  // original task instead of starting a new one.
  needsContext?: boolean;
  clarification?: Clarification;
};

const STORAGE_KEY = "neuroworks.chat";
const SESSION_ID_KEY = "neuroworks.chat.sessionId";
// Recent sessions ring buffer — last 3 distinct sessions (excluding the
// current one when it's still active). Each entry carries the full message
// list so "resume" can swap them straight back into view without a server
// fetch. Capped at 3 to keep localStorage small.
const RECENT_SESSIONS_KEY = "neuroworks.chat.recent";
const RECENT_MAX = 3;

// Slash-commands — typing "/" in the composer opens this menu. Picking one
// fills the textarea with a natural-language prompt prefix that routes well
// through the existing chat pipeline (no special server parsing needed); the
// user then types the argument and sends. The media commands surface the
// MiniMax generative primitives the agent can now call.
type SlashCommand = { cmd: string; label: string; hint: string; prefix: string };
const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: "research", label: "Research", hint: "deep, multi-perspective, cited", prefix: "Research the following in depth — multiple perspectives, cite every claim with sources: " },
  { cmd: "summarize", label: "Summarize", hint: "tighten to the essentials", prefix: "Summarize the following clearly and concisely, keeping the key points: " },
  { cmd: "email", label: "Draft email", hint: "professional email draft", prefix: "Draft a professional email. " },
  { cmd: "plan", label: "Action plan", hint: "steps, owners, dates", prefix: "Turn this into a step-by-step action plan with owners and by-when dates: " },
  { cmd: "table", label: "Make a table", hint: "structured markdown table", prefix: "Present this as a clean, well-labelled markdown table: " },
  { cmd: "factcheck", label: "Fact-check", hint: "verify a claim", prefix: "Fact-check the following claim against reliable sources and give a verdict: " },
  { cmd: "translate", label: "Translate", hint: "to another language", prefix: "Translate the following (ask which language if unclear): " },
  { cmd: "code", label: "Write code", hint: "with a short explanation", prefix: "Write code for the following, with a short explanation: " },
  { cmd: "speak", label: "Speak (TTS)", hint: "MiniMax text-to-speech audio", prefix: "Use media.tts to generate spoken audio of the following text: " },
  { cmd: "video", label: "Make a video", hint: "MiniMax Hailuo clip", prefix: "Use media.video to generate a short video of: " },
  { cmd: "music", label: "Compose music", hint: "MiniMax music track", prefix: "Use media.music to compose a track: " },
];

type RecentSession = {
  id: string;
  title: string;
  savedAt: string;
  messages: Msg[];
};

function loadRecentSessions(): RecentSession[] {
  try {
    const raw = localStorage.getItem(RECENT_SESSIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

function snapshotRecentSession(id: string, messages: Msg[]) {
  if (messages.length === 0) return;
  const first = messages.find(m => m.role === "user");
  const title = (first?.content ?? "Session").slice(0, 60).replace(/\s+/g, " ").trim() || "Session";
  const entry: RecentSession = { id, title, savedAt: new Date().toISOString(), messages: messages.slice(-50) };
  const prev = loadRecentSessions().filter(s => s.id !== id);
  const next = [entry, ...prev].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_SESSIONS_KEY, JSON.stringify(next)); } catch {}
}

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
  // Voice input — record a prompt with the mic, then transcribe server-side via
  // /api/stt (AssemblyAI). The transcript is appended to the draft so the user
  // can edit or send as normal. sttEnabled gates the button on the server key.
  const recorder = useAudioRecorder();
  const [sttEnabled, setSttEnabled] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  // Plan-first: draft a plan and route it to Approvals instead of running now.
  const [planFirst, setPlanFirst] = useState(false);
  useEffect(() => { api.sttStatus().then(s => setSttEnabled(s.enabled)).catch(() => setSttEnabled(false)); }, []);

  async function toggleMic() {
    if (transcribing) return;
    setSttError(null);
    if (recorder.recording) {
      const blob = await recorder.stop();
      if (!blob) return;
      setTranscribing(true);
      try {
        const dataUrl: string = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("could not read audio"));
          r.readAsDataURL(blob);
        });
        const { text } = await api.transcribe(dataUrl);
        if (text) setDraft(d => (d.trim() ? d.replace(/\s+$/, "") + " " : "") + text);
        else setSttError("No speech detected — try again.");
      } catch (e: any) {
        setSttError(e?.message ?? "Transcription failed");
      } finally {
        setTranscribing(false);
      }
    } else {
      await recorder.start();
    }
  }
  // When a customer clicks a starter template, we DON'T paste the full
  // template task into the input box — that exposes internal tool names and
  // makes the customer feel they have to edit a prompt. Instead we pin the
  // template as a chip above the input and keep the textarea clean for the
  // ONE thing they actually need to type (their topic / specifics).
  const [activeTemplate, setActiveTemplate] = useState<{ title: string; task: string; placeholder?: string } | null>(null);
  // Pending context-attachments — uploaded docs the next send will reference.
  // Each chip is removable; chips clear after a successful send.
  const [pendingAttachments, setPendingAttachments] = useState<{ contextId: string; filename: string; bytes: number; chars: number }[]>([]);
  // Pending continuation — when the user clicks "Continue this task" on a
  // bubble where clawbot paused for context, the original task text is pinned
  // here. The next send carries it as continuesTaskRef so the server stitches
  // it into the planner's task instead of treating the reply as a new ask.
  const [pendingContinuation, setPendingContinuation] = useState<{ originalText: string; summary?: string; originalJobId?: string } | null>(null);
  // Upload state separate from chat-busy: upload progress shouldn't block
  // the user from continuing to type their accompanying message.
  const [uploadState, setUploadState] = useState<{ status: "idle" | "uploading" | "error" | "saved"; filename?: string; error?: string; vaultPath?: string }>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<"context" | "vault">("context");
  // Context-target TTL — how long the upload stays available for chat
  // attachment before the gc unlinks it. Default 1h matches the legacy
  // global default; "1d" / "7d" are persisted as a per-upload .ttl sidecar
  // on the server (#6 from the gap-review batch).
  const [uploadTtl, setUploadTtl] = useState<"1h" | "1d" | "7d">("1h");
  // Vault-target folder. Free-text — server validates and falls back to
  // 0-Inbox if unsafe (system folders, traversal, absolute paths).
  const [uploadVaultFolder, setUploadVaultFolder] = useState<string>("0-Inbox");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
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
  // Recent sessions (last 3) for one-click resume. Updated after every save
  // and when New Session is clicked (we snapshot the just-ended session).
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>(() => loadRecentSessions());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50))); } catch {} }, [messages]);
  // Snapshot into the recent-sessions ring buffer whenever the message list
  // grows. Debounced via useEffect's natural batching — the effect runs once
  // per render of new `messages`, which is exactly once per turn.
  useEffect(() => {
    if (messages.length === 0) return;
    snapshotRecentSession(sessionId, messages);
    setRecentSessions(loadRecentSessions());
  }, [messages, sessionId]);
  // Auto-scroll to the newest message, but ONLY if the user was already near
  // the bottom before this update — otherwise a response arriving while
  // they've scrolled up to reread something yanks them back down mid-read,
  // which is exactly the "can't read the chat, it keeps auto-adjusting" bug.
  // wasNearBottomRef is updated by the onScroll handler on the message list
  // below and defaults to true so the initial mount still lands at the
  // bottom. Sending a message always scrolls (the user just acted, they
  // want to see it go out) — tracked via justSentRef.
  //
  // This is deliberately NOT keyed off `messages`/`busy` (that was the first
  // pass at this fix, and it wasn't enough): each assistant bubble with a
  // jobId mounts its own InlineJob, which fetches the job's report
  // ASYNCHRONOUSLY and can add a lot of height (trace steps, the full
  // ResultPanel) well after Chat's own state has already settled. A
  // messages-keyed effect fires once, before that content exists, and never
  // re-fires when it lands — verified live: loading a session with a
  // completed-job report card left scrollTop stuck at 0 for 8+ seconds while
  // the pane kept growing underneath it. A ResizeObserver on the message
  // list's content wrapper catches ANY height change regardless of source
  // (React state, async job data, images, fonts) and re-applies the same
  // "stick to bottom if I was there" rule.
  const wasNearBottomRef = useRef(true);
  const justSentRef = useRef(false);
  const NEAR_BOTTOM_PX = 120;
  const messageListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = scrollRef.current;
    const content = messageListRef.current;
    if (!container || !content) return;
    const ro = new ResizeObserver(() => {
      if (justSentRef.current || wasNearBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      justSentRef.current = false;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);
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
    // Snapshot the current session before nuking it so it remains resumable.
    if (messages.length > 0) snapshotRecentSession(sessionId, messages);
    const fresh = `session-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
    try { localStorage.setItem(SESSION_ID_KEY, fresh); } catch {}
    setSessionId(fresh);
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    setSaveState({ status: "idle" });
    setRecentSessions(loadRecentSessions());
  }

  function resumeSession(s: RecentSession) {
    if (s.id === sessionId && messages.length === s.messages.length) return;
    // Snapshot the CURRENT session before swapping so it stays in recents.
    if (messages.length > 0 && sessionId !== s.id) snapshotRecentSession(sessionId, messages);
    // Switching threads entirely — always land on the newest message of the
    // resumed session, not wherever the previous thread happened to scroll.
    justSentRef.current = true;
    setSessionId(s.id);
    try { localStorage.setItem(SESSION_ID_KEY, s.id); } catch {}
    setMessages(s.messages);
    setActiveTemplate(null);
    setPendingAttachments([]);
    setSaveState({ status: "idle" });
    setRecentSessions(loadRecentSessions());
  }

  async function send() {
    // Stop any in-progress recording so it doesn't dangle after send.
    if (recorder.recording) void recorder.stop();
    const topic = draft.trim();
    // Allow empty topic when attachments alone carry the intent — e.g.
    // "Summarize this for me" can be implied by just attaching a doc.
    if (busy) return;
    if (!topic && pendingAttachments.length === 0) return;
    // The user just acted — always scroll to show their message going out
    // and the response arriving, regardless of prior scroll position.
    justSentRef.current = true;
    // If a template is pinned, the customer's typed text is the TOPIC. We
    // splice it into the template prompt server-side so the planner sees
    // the full instruction ("research.multiperspective: <topic>") while the
    // customer only had to type their topic. The user-facing bubble shows
    // their topic alone — keeping the chat clean.
    const effectiveTopic = topic || `Read the attached document${pendingAttachments.length > 1 ? "s" : ""} and produce a concise summary highlighting the key facts, dates, owners, and risks.`;
    const displayText = topic || `[Attachments only] ${pendingAttachments.map(a => a.filename).join(", ")}`;
    const sendText = activeTemplate
      ? `${activeTemplate.task.trim()}\n\nTopic: ${effectiveTopic}`
      : effectiveTopic;

    // Plan-first mode: draft a plan and park it for approval instead of running.
    if (planFirst) {
      setMessages([...messages, { role: "user", content: displayText }]);
      setDraft(""); setActiveTemplate(null); setPendingAttachments([]); setPendingContinuation(null); setErr(""); setBusy(true);
      try {
        const { jobId } = await api.planTask(sendText);
        setMessages(prev => [...prev, { role: "assistant", content: "📋 Drafting a plan for this — review and approve the steps on the **Approvals** page. Once you approve, I'll run exactly that plan.", jobId }]);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally { setBusy(false); }
      return;
    }

    const next: Msg[] = [...messages, { role: "user", content: displayText }];
    const attachmentsToSend = pendingAttachments.map(a => ({ contextId: a.contextId }));
    const continuationToSend = pendingContinuation;
    setMessages(next); setDraft(""); setActiveTemplate(null); setPendingAttachments([]); setPendingContinuation(null); setErr(""); setBusy(true);
    try {
      const payload = next.map((m, idx) =>
        idx === next.length - 1 && m.role === "user"
          ? { role: m.role, content: sendText }
          : { role: m.role, content: m.content },
      );
      const opts: Parameters<typeof api.chat>[1] = {};
      if (attachmentsToSend.length > 0) opts.attachments = attachmentsToSend;
      if (continuationToSend) opts.continuesTaskRef = continuationToSend;
      const r = await api.chat(payload, Object.keys(opts).length > 0 ? opts : undefined);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: r.text,
        jobId: r.jobId,
        templateId: r.templateId,
        requiresApproval: r.requiresApproval,
        brainHits: r.brainHits,
        needsContext: r.needsContext,
        clarification: r.clarification,
      }]);
      // If the server is asking for context AGAIN (same task still missing
      // something), auto-pin the continuation chip so the user's next
      // message keeps stitching to the same original task. Prefer the
      // continuation we just sent (preserves the ORIGINAL task across
      // multiple clarification rounds) over the new clarification's
      // originalText (which would be the stitched form on round 2+).
      if (r.needsContext && r.clarification) {
        setPendingContinuation(continuationToSend ?? {
          originalText: r.clarification.originalText,
          summary: r.clarification.summary,
          originalJobId: r.jobId,
        });
      }
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // Start a continuation manually from a bubble's "Continue this task" button.
  // Pins the chip; the user's next typed message gets stitched server-side.
  function startContinuation(clarification: Clarification, originalJobId?: string) {
    setPendingContinuation({
      originalText: clarification.originalText,
      summary: clarification.summary,
      originalJobId,
    });
    // Drop the user straight into the input so they can type the missing piece.
    setTimeout(() => {
      try {
        const ta = document.querySelector<HTMLTextAreaElement>("textarea");
        ta?.focus();
      } catch { /* tolerate */ }
    }, 50);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-selected
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setUploadState({ status: "error", filename: file.name, error: "File too large (max 20 MB)" });
      return;
    }
    setUploadState({ status: "uploading", filename: file.name });
    try {
      const buf = await file.arrayBuffer();
      // Convert ArrayBuffer → base64 in chunks (avoids the 32k-arg call-stack
      // limit on String.fromCharCode for large files).
      const bytes = new Uint8Array(buf);
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
      }
      const contentBase64 = btoa(binary);
      const ttlSecondsMap = { "1h": 3600, "1d": 86400, "7d": 604800 };
      const r = await api.upload({
        filename: file.name,
        contentBase64,
        target: uploadTarget,
        mimeType: file.type || undefined,
        ...(uploadTarget === "vault" ? { vaultFolder: uploadVaultFolder.trim() || "0-Inbox" } : {}),
        ...(uploadTarget === "context" ? { ttlSeconds: ttlSecondsMap[uploadTtl] } : {}),
      });
      if (r.target === "vault") {
        setUploadState({ status: "saved", filename: file.name, vaultPath: r.vaultPath });
        setTimeout(() => setUploadState(s => s.status === "saved" ? { status: "idle" } : s), 4000);
      } else if (r.contextId) {
        setPendingAttachments(prev => [...prev, {
          contextId: r.contextId!,
          filename: r.filename ?? file.name,
          bytes: r.bytes ?? file.size,
          chars: r.extractedChars ?? 0,
        }]);
        setUploadState({ status: "idle" });
      }
    } catch (err: any) {
      setUploadState({ status: "error", filename: file.name, error: err?.message ?? String(err) });
    }
  }

  function removeAttachment(contextId: string) {
    setPendingAttachments(prev => prev.filter(a => a.contextId !== contextId));
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
          <h1 className="text-2xl font-semibold tracking-tight text-cream-50">Chat with Neuro</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <p className="text-xs text-cream-300/60">Type what you want done; I'll delegate and report back.</p>
            <span className="text-[10px] text-cream-300/40 font-mono">session {sessionId.slice(0, 18)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saveState.status === "saving" && <span className="text-[11px] text-violet-400">saving...</span>}
          {saveState.status === "saved" && saveState.path && (
            <Link to={`/knowledge/${saveState.path}`} className="inline-flex items-center gap-1 text-[11px] text-leaf-400 hover:text-leaf-500" title={saveState.path}>
              <CheckCircle2 size={11} /> saved to vault
            </Link>
          )}
          {saveState.status === "error" && (
            <span className="inline-flex items-center gap-1 text-[11px] text-coral-400" title={saveState.error}>
              <AlertTriangle size={11} /> save failed
            </span>
          )}
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

      {recentSessions.filter(s => s.id !== sessionId || messages.length === 0).length > 0 && (
        <div className="px-8 py-2 border-b border-ink-800 bg-ink-900/40">
          <div className="flex items-center gap-2 max-w-3xl mx-auto flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-cream-300/50 mr-1">Recent</span>
            {recentSessions.filter(s => s.id !== sessionId || messages.length === 0).slice(0, 3).map(s => {
              const when = (() => {
                const d = new Date(s.savedAt);
                const m = Math.round((Date.now() - d.getTime()) / 60000);
                if (m < 1) return "just now";
                if (m < 60) return `${m}m ago`;
                const h = Math.round(m / 60);
                if (h < 24) return `${h}h ago`;
                return d.toLocaleDateString();
              })();
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => resumeSession(s)}
                  className="group inline-flex items-center gap-2 px-3 py-1 bg-ink-900 hover:bg-ink-850 border border-ink-800 hover:border-violet-500/40 rounded-full text-[11px] transition-colors max-w-[260px]"
                  title={`${s.messages.length} message${s.messages.length === 1 ? "" : "s"} · saved ${when}`}
                >
                  <span className="text-cream-100 truncate group-hover:text-cream-50">{s.title}</span>
                  <span className="text-cream-300/40 group-hover:text-cream-300/60 text-[10px] flex-shrink-0">{s.messages.length}·{when}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={e => {
          const el = e.currentTarget;
          wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
        }}
        className="flex-1 overflow-auto scrollbar-thin px-8 py-6">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto text-center py-16">
            <div className="grid place-items-center mb-4"><BrandMark size={56} /></div>
            <h2 className="text-3xl font-semibold tracking-tight text-cream-50 mb-2">
              {activePersona ? `Hi, I'm ${activePersona.name}.` : "Hi, I'm Neuro."}
            </h2>
            <p className="text-sm text-cream-300/70 mb-2">
              {activePersona
                ? `Operating as ${activePersona.role}. Pick a starter or type your own. I'll route it through the right tools.`
                : "I can search your knowledge base, summarize projects, run digests, capture notes, and sync downloads. Try:"}
            </p>
            {activePersona && personaTemplates.length > 0 && (
              <p className="text-[11px] text-cream-300/40 mb-6">
                These are <Link to="/personas" className="text-violet-400 hover:text-violet-500">{activePersona.name}'s</Link> starter templates. <Link to="/templates" className="text-violet-400 hover:text-violet-500">See all</Link>
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 max-w-xl mx-auto text-left">
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

        <div ref={messageListRef} className="max-w-3xl mx-auto space-y-5">
          {messages.map((m, i) => (
            <Bubble
              key={i}
              m={m}
              onStartContinuation={startContinuation}
              continuationActive={!!pendingContinuation && pendingContinuation.originalText === m.clarification?.originalText}
            />
          ))}
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
                className="ml-auto text-cream-300/60 hover:text-cream-50"
                title="Clear template"
                aria-label="Clear template"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {pendingContinuation && (
            <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-flame-500/10 border border-flame-500/30 rounded-lg text-xs">
              <RotateCcw size={13} className="text-flame-300 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-flame-300 font-medium">Continuing task</div>
                <div className="text-cream-100 truncate" title={pendingContinuation.originalText}>
                  {pendingContinuation.summary ?? pendingContinuation.originalText.slice(0, 120)}
                </div>
                <div className="text-[10px] text-cream-300/60 mt-0.5">
                  Your next message will be stitched into the original task so the planner sees both halves.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingContinuation(null)}
                className="text-cream-300/60 hover:text-cream-50"
                title="Cancel continuation, treat next message as a new task"
                aria-label="Cancel continuation"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {pendingAttachments.length > 0 && (
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-cream-300/50">Attached for this send:</span>
              {pendingAttachments.map(a => (
                <span
                  key={a.contextId}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-leaf-500/10 border border-leaf-500/30 rounded-lg text-[11px]"
                  title={`${a.chars} chars extracted, ${(a.bytes / 1024).toFixed(1)} KB`}
                >
                  <Paperclip size={11} className="text-leaf-400" />
                  <span className="text-cream-100 max-w-[180px] truncate">{a.filename}</span>
                  <span className="text-cream-300/50 text-[10px]">{a.chars > 0 ? `${a.chars.toLocaleString()} chars` : "binary"}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.contextId)}
                    className="text-cream-300/60 hover:text-coral-400 ml-1"
                    aria-label={`Remove ${a.filename}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {uploadState.status === "uploading" && (
            <div className="text-[11px] text-violet-300 mb-2">Uploading {uploadState.filename}...</div>
          )}
          {uploadState.status === "error" && (
            <div className="text-[11px] text-coral-400 mb-2">Upload failed: {uploadState.error}</div>
          )}
          {uploadState.status === "saved" && uploadState.vaultPath && (
            <div className="inline-flex items-center gap-1 text-[11px] text-leaf-400 mb-2">
              <CheckCircle2 size={11} /> saved to vault at <Link to={`/knowledge/${uploadState.vaultPath}`} className="underline hover:text-leaf-300">{uploadState.vaultPath}</Link>
            </div>
          )}
          <div className="flex items-end gap-2 relative">
            {/* Slash-command menu — appears while typing the command word ("/re…"). */}
            {(() => {
              const m = /^\/(\w*)$/.exec(draft);
              if (!m) return null;
              const q = m[1].toLowerCase();
              const matches = SLASH_COMMANDS.filter(c => c.cmd.startsWith(q) || c.label.toLowerCase().includes(q));
              if (matches.length === 0) return null;
              return (
                <div className="absolute bottom-14 left-14 z-30 w-80 bg-ink-900 border border-ink-700 rounded-xl shadow-xl p-1.5 max-h-72 overflow-y-auto scrollbar-thin">
                  <div className="text-[10px] uppercase tracking-wider text-cream-300/50 px-2 py-1">Commands</div>
                  {matches.map(c => (
                    <button
                      key={c.cmd}
                      type="button"
                      onClick={() => { setDraft(c.prefix); document.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }}
                      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-ink-800 text-sm"
                    >
                      <span className="font-mono text-violet-300">/{c.cmd}</span>
                      <span className="text-cream-100">{c.label}</span>
                      <span className="text-cream-300/50 text-[11px] ml-auto truncate">{c.hint}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelected}
              aria-label="Attach a document"
            />
            <div className="relative">
              <button
                type="button"
                onClick={() => setAttachMenuOpen(o => !o)}
                disabled={uploadState.status === "uploading"}
                className="bg-ink-900 hover:bg-ink-850 border border-ink-800 hover:border-violet-500/40 disabled:opacity-40 text-cream-300 hover:text-cream-100 w-12 h-12 rounded-xl flex items-center justify-center"
                title="Attach a document"
                aria-label="Attach a document"
                aria-expanded={attachMenuOpen ? "true" : "false"}
              >
                <Plus size={18} className={`transition-transform ${attachMenuOpen ? "rotate-45" : ""}`} />
              </button>
              {attachMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAttachMenuOpen(false)} />
                  <div className="absolute bottom-14 left-0 z-20 w-72 bg-ink-900 border border-ink-700 rounded-xl shadow-xl p-3 space-y-3">
                    <div className="text-[10px] uppercase tracking-wider text-cream-300/50">Attach a document</div>

                    <fieldset className="space-y-1.5">
                      <legend className="text-[11px] text-cream-300/70 mb-1">Destination</legend>
                      <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-ink-800/60">
                        <input type="radio" name="upload-target" value="context" checked={uploadTarget === "context"} onChange={() => setUploadTarget("context")} className="mt-0.5 accent-violet-500" />
                        <div className="text-xs">
                          <div className="text-cream-100">This chat only</div>
                          <div className="text-cream-300/50 text-[10px]">Used as context, then expires</div>
                        </div>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-ink-800/60">
                        <input type="radio" name="upload-target" value="vault" checked={uploadTarget === "vault"} onChange={() => setUploadTarget("vault")} className="mt-0.5 accent-violet-500" />
                        <div className="text-xs">
                          <div className="text-cream-100">Knowledge vault</div>
                          <div className="text-cream-300/50 text-[10px]">Saved permanently to your second brain</div>
                        </div>
                      </label>
                    </fieldset>

                    {uploadTarget === "context" && (
                      <div>
                        <div className="text-[11px] text-cream-300/70 mb-1">Keep available for</div>
                        <div className="flex gap-1" role="radiogroup" aria-label="Context upload TTL">
                          {(["1h", "1d", "7d"] as const).map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setUploadTtl(t)}
                              className={`flex-1 text-xs py-1.5 rounded border ${uploadTtl === t ? "bg-violet-500/15 border-violet-500/40 text-violet-200" : "bg-ink-950 border-ink-800 text-cream-300 hover:border-ink-700"}`}
                            >
                              {t === "1h" ? "1 hour" : t === "1d" ? "1 day" : "7 days"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {uploadTarget === "vault" && (
                      <div>
                        <label htmlFor="vault-folder" className="block text-[11px] text-cream-300/70 mb-1">Save into folder</label>
                        <input
                          id="vault-folder"
                          type="text"
                          value={uploadVaultFolder}
                          onChange={e => setUploadVaultFolder(e.target.value)}
                          placeholder="0-Inbox"
                          className="w-full bg-ink-950 border border-ink-800 text-xs text-cream-100 rounded px-2 py-1.5 hover:border-violet-500/40 focus:outline-none focus:border-violet-500/60"
                        />
                        <div className="text-[10px] text-cream-300/40 mt-1">Auto-created. System folders and traversal are rejected.</div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click(); }}
                      className="w-full inline-flex items-center justify-center gap-1.5 bg-violet-500 hover:bg-violet-600 text-white text-sm px-3 py-2 rounded-md"
                    >
                      <FileText size={14} /> Choose file
                    </button>
                  </div>
                </>
              )}
            </div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              placeholder={
                activeTemplate?.placeholder
                ?? (pendingContinuation ? "Add the missing context, like the file path, the recipient, the topic..."
                : pendingAttachments.length > 0 ? "Add a note (optional). Press Send to ask about the attachment..."
                : "Message Neuro...")
              }
              className="flex-1 bg-ink-900 border border-ink-800 focus:border-violet-500/60 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-cream-300/40 max-h-52"
              aria-label="Message"
            />
            {recorder.supported && sttEnabled && (
              <button
                type="button"
                onClick={toggleMic}
                disabled={transcribing}
                className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-colors disabled:opacity-60 ${
                  recorder.recording
                    ? "bg-coral-500/20 border-coral-500/50 text-coral-300 animate-pulse"
                    : "bg-ink-900 hover:bg-ink-850 border-ink-800 hover:border-violet-500/40 text-cream-300 hover:text-cream-100"
                }`}
                title={recorder.recording ? "Stop & transcribe" : transcribing ? "Transcribing…" : "Record a prompt"}
                aria-label={recorder.recording ? "Stop and transcribe" : "Record a prompt"}
                aria-pressed={recorder.recording}
              >
                {transcribing ? <Loader2 size={16} className="animate-spin" /> : recorder.recording ? <Square size={16} /> : <Mic size={18} />}
              </button>
            )}
            <button type="submit" disabled={busy || (!draft.trim() && pendingAttachments.length === 0)} className="inline-flex items-center gap-1.5 bg-violet-500 hover:bg-violet-600 disabled:opacity-40 text-white px-5 py-3 rounded-xl text-sm font-medium">
              <Send size={14} /> Send
            </button>
          </div>
          {(recorder.recording || transcribing || sttError || recorder.error) && (
            <div className="max-w-3xl mx-auto mt-2 px-1 text-[11px]">
              {(sttError || recorder.error) ? (
                <span className="text-coral-400 inline-flex items-center gap-1"><AlertTriangle size={11} /> {sttError ?? recorder.error}</span>
              ) : transcribing ? (
                <span className="text-cream-300/60 inline-flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Transcribing…</span>
              ) : (
                <span className="text-cream-300/60 inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-coral-500 animate-pulse" /> Recording… tap the square to transcribe
                </span>
              )}
            </div>
          )}
        </form>
        <div className="max-w-3xl mx-auto text-[10px] text-cream-300/40 mt-2 px-1 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setPlanFirst(p => !p)}
            title="Draft a plan and approve the steps before Neuro runs them"
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full border transition-colors ${planFirst ? "bg-violet-500/15 border-violet-500/40 text-violet-300" : "border-ink-700 text-cream-300/50 hover:text-cream-200 hover:border-ink-600"}`}
          >
            <ListChecks size={11} /> Plan first{planFirst ? " · on" : ""}
          </button>
          <span className="text-cream-300/30">·</span>
          <span className="flex items-center gap-1"><Kbd>↵</Kbd> send</span>
          <span className="text-cream-300/30">·</span>
          <span className="flex items-center gap-1"><Kbd>/</Kbd> commands</span>
          <span className="text-cream-300/30">·</span>
          <span className="flex items-center gap-1"><Kbd>⇧</Kbd>+<Kbd>↵</Kbd> newline</span>
          <span className="text-cream-300/30">·</span>
          <span className="flex items-center gap-1"><MetaKey /><Kbd>K</Kbd> search</span>
          {model && <><span className="text-cream-300/30">·</span><span>Ollama local: {model}</span></>}
        </div>
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

function Bubble({ m, onStartContinuation, continuationActive }: { m: Msg; onStartContinuation?: (c: Clarification, jobId?: string) => void; continuationActive?: boolean }) {
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
        {m.needsContext && m.clarification && (
          <div className="flex items-center gap-2 px-3 py-2 bg-flame-500/10 border border-flame-500/30 rounded-lg text-xs">
            <Pause size={12} className="text-flame-300 shrink-0" />
            <span className="text-flame-300">Paused for missing context.</span>
            {continuationActive ? (
              <span className="text-cream-300/70 ml-1">Type the missing piece and send. I'll continue the task.</span>
            ) : (
              <button
                type="button"
                onClick={() => onStartContinuation?.(m.clarification!, m.jobId)}
                className="ml-auto inline-flex items-center gap-1 text-flame-400 hover:text-flame-300 font-medium"
              >
                Continue this task <ArrowRight size={11} />
              </button>
            )}
          </div>
        )}
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
  // Tracks "the server restarted while this job was running" so we can show
  // a friendlier message + a retry path instead of an infinite spinner.
  // The 404 hint (with serverBootAt) comes from /api/templates/jobs/:id when
  // the in-memory map has been wiped by tsx watch hot-reload.
  const [lostToRestart, setLostToRestart] = useState<{ hint: string; serverBootAt?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let pollTimer: any;
    let consecutive404s = 0;
    // Hybrid model: SSE streams "patch" / "done" / "log" events live, but
    // we still need ONE getJob call to load the initial state (status,
    // existing result, persona info) since the SSE endpoint replays log
    // lines but not the structured job object. We also fall back to
    // polling if SSE setup or connection fails — old browsers / proxies
    // sometimes block long-lived event-stream connections.
    let fellBackToPolling = false;

    async function loadInitial(): Promise<boolean> {
      try {
        const j = await api.getJob(jobId);
        if (!alive) return false;
        setJob(j);
        consecutive404s = 0;
        if (j.status === "succeeded" || j.status === "failed" || j.status === "rejected") return false;
        return true;
      } catch (e: any) {
        if (alive && e && typeof e === "object" && e.status === 404) {
          consecutive404s += 1;
          if (consecutive404s >= 2 && !lostToRestart) {
            setLostToRestart({
              hint: e.hint ?? "The server may have restarted while this task was running.",
              serverBootAt: e.serverBootAt,
            });
          }
        }
        return false;
      }
    }

    function startPolling() {
      fellBackToPolling = true;
      async function tick() {
        const stillRunning = await loadInitial();
        if (!alive || !stillRunning) return;
        pollTimer = setTimeout(tick, 2000);
      }
      tick();
    }

    function startSse(initialJob: any) {
      try {
        es = api.jobStream(jobId);
        es.addEventListener("patch", (ev: MessageEvent) => {
          try {
            const patch = JSON.parse(ev.data);
            setJob((prev: any) => prev ? { ...prev, result: { ...(prev.result ?? {}), ...patch } } : prev);
          } catch { /* tolerate */ }
        });
        es.addEventListener("log", (ev: MessageEvent) => {
          try {
            const { line } = JSON.parse(ev.data);
            setJob((prev: any) => prev ? { ...prev, log: [...(prev.log ?? []), line] } : prev);
          } catch { /* tolerate */ }
        });
        es.addEventListener("done", (ev: MessageEvent) => {
          try {
            const { status, error } = JSON.parse(ev.data);
            setJob((prev: any) => prev ? { ...prev, status, error } : prev);
          } catch { /* tolerate */ }
          es?.close();
          es = null;
        });
        es.onerror = () => {
          // Connection dropped before "done". Could be a server restart, a
          // proxy timeout, or a real failure. Close the SSE and fall back to
          // one poll — that'll give us a 404 (and trigger the restart UI) or
          // a refreshed status.
          es?.close();
          es = null;
          if (alive && !fellBackToPolling) startPolling();
        };
      } catch {
        if (alive) startPolling();
      }
      void initialJob;
    }

    (async () => {
      const stillRunning = await loadInitial();
      if (!alive) return;
      if (stillRunning) startSse(null);
    })();

    return () => {
      alive = false;
      if (pollTimer) clearTimeout(pollTimer);
      if (es) { try { es.close(); } catch { /* tolerate */ } es = null; }
    };
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

  if (lostToRestart) {
    return (
      <div className="text-xs bg-flame-500/10 border border-flame-500/30 rounded-lg px-3 py-2">
        <div className="flex items-center gap-1.5 text-flame-300 font-medium">
          <AlertTriangle size={12} /> Lost track of job <span className="font-mono">{jobId.slice(0, 8)}</span>
        </div>
        <div className="text-cream-300/70 mt-1">
          {lostToRestart.hint}
        </div>
        <div className="text-cream-300/50 mt-1">
          Resend the original task to retry. Your previous request wasn't kept on disk in time.
        </div>
      </div>
    );
  }
  if (!job) {
    return (
      <div className="text-xs text-cream-300/60 bg-ink-950 border border-ink-800 rounded-lg px-3 py-2">
        Connecting to job <span className="font-mono">{jobId.slice(0, 8)}</span>...
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

  // Categorise a failure into a one-line label that tells the user the
  // SHAPE of the problem, not the cryptic "Hit a snag". The full error
  // is still rendered below — this label sets the user's expectation
  // (transient → retry, permission → check config, unsupported → rephrase).
  function failureLabel(err: string | undefined, hasPartial: boolean): string {
    const e = (err ?? "").toLowerCase();
    if (hasPartial) return "Finished with partial results";
    if (!e) return "Couldn't complete this task";
    if (/vault.*unreach|vaultpath|mkdir.*enoent|d:\\\\main brain/.test(e)) return "Couldn't reach your vault";
    if (/\b(?:401|403|unauthori[sz]ed|forbidden|api key|missing.*token)\b/.test(e)) return "Authorisation problem, check your keys";
    if (/\b(?:econnreset|etimedout|enotfound|eai_again|fetch failed|socket hang up|timeout)\b/.test(e)) return "Network hiccup, usually clears on retry";
    if (/\b(?:429|rate.?limit|too many requests)\b/.test(e)) return "Rate-limited, wait a minute and retry";
    if (/refused to fetch|ssrf/.test(e)) return "Blocked target, public-internet only";
    if (/refused to read|sensitive file/.test(e)) return "Refused, path looks sensitive";
    if (/cannot read properties of undefined/.test(e)) return "Internal error, please retry";
    if (/no such tool|invalid tool|unknown tool/.test(e)) return "Couldn't route, try rephrasing";
    return "Couldn't complete this task";
  }

  const friendlyLabel = (() => {
    if (status === "succeeded") return r.savedTemplateId ? "Done · saved as a shortcut" : "Done";
    if (status === "failed") {
      const hasPartial = typeof r.answer === "string" && r.answer.trim().length > 0;
      return failureLabel(job.error, hasPartial);
    }
    if (status === "rejected") return "Rejected";
    if (status === "awaiting-approval") return "Waiting for your approval";
    if (phase === "planning") return "Working out a plan";
    if (phase === "executing") {
      if (inflightCount > 1) return `${inflightCount} sub-agents working together`;
      if (totalSteps > 0) return `Working on it, ${doneCount}/${totalSteps}`;
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
        {requiresApproval && status === "awaiting-approval" && (
          <Link to="/approvals" className="ml-1 inline-flex items-center gap-0.5 underline">approve <ArrowRight size={11} /></Link>
        )}
        {!isPending && status === "succeeded" && (
          <Link to={`/results/${jobId}`} className="ml-1 inline-flex items-center gap-0.5 underline opacity-90 hover:opacity-100">open report <ArrowRight size={11} /></Link>
        )}
        {!isPending && (
          <Link to={`/tasks?focus=${jobId}`} className="ml-1 underline opacity-50 hover:opacity-100 text-[10px]">details</Link>
        )}
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
            ? <div className="inline-flex items-center gap-1 text-[11px] text-leaf-400">
                Retry started. <Link to={`/tasks?focus=${retry.newJobId}`} className="underline inline-flex items-center gap-0.5">track new job <ArrowRight size={10} /></Link>
              </div>
            : <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={doRetry}
                  disabled={retry.state === "running"}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/40 text-violet-300 hover:bg-violet-500/25 disabled:opacity-40"
                >
                  <RotateCcw size={12} /> {retry.state === "running" ? "Retrying..." : "Retry this task"}
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
