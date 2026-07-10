import { useMemo, useState } from "react";
import {
  Clipboard, ClipboardCheck, ChevronDown, ChevronRight,
  Lightbulb, Cog, Sparkles, ShieldCheck, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { showToast } from "./Card";

// Trace view — replaces the raw log <pre> with three modes:
//   - phased  → 5 colored phase cards with step rows inside (default)
//   - narrate → plain-English sentence stream
//   - raw     → the original [ISO] log dump (always there as escape hatch)
// Each phase is detected from log-line patterns via a small state machine.
// Timestamps render as T+12.3s offsets from the job's startedAt.

const PHASE_DEFS = {
  planning: { label: "Planning", Icon: Lightbulb, color: "violet" },
  executing: { label: "Executing", Icon: Cog, color: "flame" },
  synthesizing: { label: "Synthesising", Icon: Sparkles, color: "violet" },
  reviewing: { label: "Reviewing", Icon: ShieldCheck, color: "coral" },
  delivered: { label: "Delivered", Icon: CheckCircle2, color: "leaf" },
} as const;
type PhaseKey = keyof typeof PHASE_DEFS;

type TraceLine = {
  rawTimestamp: string;
  offsetMs: number;          // ms from job start
  rawText: string;
  friendly: string;          // narration-mode rephrasing
  kind: "log" | "step" | "retry" | "wave" | "model";
  toolName?: string;         // when this line names a tool
};

type Phase = {
  key: PhaseKey;
  startOffsetMs: number;
  endOffsetMs: number;
  lines: TraceLine[];
};

const FRIENDLY_TOOL: Record<string, string> = {
  "email.send": "Sending email",
  "fs.find_in": "Searching your folders",
  "fs.read_external": "Reading the file",
  "fs.list_external": "Listing folder",
  "fs.import_to_vault": "Importing to vault",
  "vault.search": "Searching your vault",
  "vault.read": "Reading a vault note",
  "vault.write": "Saving to vault",
  "vault.scan_docs": "Scanning vault docs",
  "web.scrape": "Visiting the web page",
  "web.fetch": "Fetching from the web",
  "web.search": "Searching the web",
  "web.interact": "Driving a browser",
  "web.firecrawl": "Scraping with Firecrawl",
  "research.deep": "Deep research",
  "research.multiperspective": "Multi-angle research",
  "ollama.generate": "Drafting with AI",
  "quality.check": "Quality check",
  "security.scan": "Security scan",
  "peer.review": "Peer review",
  "peer.delegate": "Delegating to peer",
  "db.query": "Querying the database",
  "db.schema": "Reading database schema",
  "db.list_sources": "Listing data sources",
  "doc.ocr": "Running OCR",
  "github.read_repo": "Reading GitHub repo",
  "github.get_file": "Fetching from GitHub",
};

function friendlyTool(tool: string): string {
  return FRIENDLY_TOOL[tool] ?? tool;
}

function fmtOffset(ms: number): string {
  if (ms < 1000) return `T+0.0s`;
  const s = ms / 1000;
  if (s < 60) return `T+${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `T+${m}:${rem.toFixed(1).padStart(4, "0")}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${rem}s`;
}

// Phase detection — when we see X, transition forward (we never go back).
function classifyLine(rawText: string, currentPhase: PhaseKey): { phase: PhaseKey; kind: TraceLine["kind"]; toolName?: string } {
  const stepMatch = rawText.match(/Step\s+\d+\s+of\s+\d+:\s*([\w\-.]+)/i);
  const isReviewStep = /(?:Quality[-\s]?checking|Security[-\s]?scanning|Asking a peer)/i.test(rawText);
  const isSynthLine = /Thinking with .*tokens|Synth hiccup|Synthesis/i.test(rawText);
  const isQualityReview = /Reviewing the draft|quality and security/i.test(rawText);
  const isPlanLine = /Plan ready|Thinking about the best approach|Planning with|Handling this myself|Working as|Recognised the shape/i.test(rawText);
  const isRetry = /retry|hiccup|429|transient/i.test(rawText) && /retrying|will retry|attempt/i.test(rawText);
  const isWave = /(?:Wave \d+ finished|All sub-agents finished|Running \d+ sub-agents|Running with help from)/i.test(rawText);
  const isModel = /Thinking with .* tokens|routed to OpenRouter|profile "/i.test(rawText) && !isRetry;

  let phase: PhaseKey = currentPhase;
  if (isPlanLine && currentPhase === "planning") phase = "planning";
  else if (isQualityReview || isReviewStep) phase = "reviewing";
  else if (isSynthLine && currentPhase !== "reviewing") phase = "synthesizing";
  else if (stepMatch && !isReviewStep) {
    // first real Step jumps us to executing if we were still planning
    if (currentPhase === "planning") phase = "executing";
    else if (currentPhase === "executing" || currentPhase === "synthesizing") phase = currentPhase;
  }

  let kind: TraceLine["kind"] = "log";
  if (isRetry) kind = "retry";
  else if (stepMatch) kind = "step";
  else if (isWave) kind = "wave";
  else if (isModel) kind = "model";

  return { phase, kind, toolName: stepMatch?.[1] };
}

function rephraseLine(rawText: string, toolName?: string): string {
  // Convert technical log lines into friendly sentences for narration mode.
  if (toolName) {
    return `Started: ${friendlyTool(toolName)}`;
  }
  if (/Plan ready:\s*(\d+)\s+step/i.test(rawText)) {
    const n = rawText.match(/Plan ready:\s*(\d+)/i)?.[1];
    const summary = rawText.split("—").slice(1).join("—").trim().replace(/\.+$/, "");
    return `Picked a plan with ${n} step${n === "1" ? "" : "s"}${summary ? ` — ${summary}` : ""}.`;
  }
  if (/Thinking about the best approach/i.test(rawText)) return "Thinking about the best approach…";
  if (/Handling this myself/i.test(rawText)) return "Taking this on directly (no peer needed).";
  if (/Working as ([\w\s—-]+?)\./i.test(rawText)) {
    const persona = rawText.match(/Working as ([^.]+)\./i)?.[1] ?? "Neuro";
    return `Working as ${persona.replace(/—.*/, "").trim()}.`;
  }
  if (/Planning with ([\w/\-.:]+)/i.test(rawText)) {
    const model = rawText.match(/Planning with ([\w/\-.:]+)/i)?.[1];
    return `Planning with ${model}.`;
  }
  if (/Synth hiccup.*429.*retrying.*in ([\d.]+)s/i.test(rawText)) {
    const wait = rawText.match(/in ([\d.]+)s/i)?.[1];
    return `Hit a rate-limit while drafting — retrying in ${wait}s.`;
  }
  if (/Synth hiccup/i.test(rawText)) return "Transient draft error — retrying.";
  if (/Reviewing the draft/i.test(rawText)) return "Running quality and security checks on the draft.";
  if (/Wave (\d+) finished in ([\d.]+)s/i.test(rawText)) {
    const m = rawText.match(/Wave (\d+) finished in ([\d.]+)s/i)!;
    return `Wave ${m[1]} finished in ${m[2]}s.`;
  }
  if (/All sub-agents finished in ([\d.]+)s/i.test(rawText)) {
    const t = rawText.match(/([\d.]+)s/)?.[1];
    return `Sub-agents finished in ${t}s.`;
  }
  if (/Running (\d+) sub-agents in parallel/i.test(rawText)) {
    const n = rawText.match(/Running (\d+)/i)?.[1];
    return `Running ${n} sub-agents in parallel.`;
  }
  if (/Running with help from/i.test(rawText)) return "Bringing in a peer worker for parallel capacity.";
  if (/Thinking with ([\w/\-.:]+)\s*\(~?([\d ,]+)\s+tokens/i.test(rawText)) {
    const m = rawText.match(/Thinking with ([\w/\-.:]+)\s*\(~?([\d ,]+)\s+tokens/i)!;
    return `Drafting the answer with ${m[1]} (${m[2].replace(/ /g, "")} tokens of context).`;
  }
  // Step row inside a Wave (e.g. "Step 2 of 3: Quality-checking the draft")
  if (/Step \d+ of \d+:\s*(Quality[-\s]?checking|Security[-\s]?scanning|Asking a peer)/i.test(rawText)) {
    const m = rawText.match(/Step \d+ of \d+:\s*(.+)/i)?.[1];
    return `Started: ${m?.replace(/\s+the draft.*$/, "").replace(/\s+the note.*$/, "")}.`;
  }
  return rawText;
}

export function parseTrace(logLines: string[], jobStartedAt: string | undefined, jobStatus: string): { phases: Phase[]; startMs: number; endOffsetMs: number; raw: string } {
  const startMs = jobStartedAt ? new Date(jobStartedAt).getTime() : Date.now();
  const tsRe = /^\[(.+?Z)\]\s*(.*)$/;
  let currentPhase: PhaseKey = "planning";
  const lines: TraceLine[] = [];
  let lastOffset = 0;
  for (const raw of logLines) {
    const m = raw.match(tsRe);
    const ts = m?.[1] ?? "";
    const body = m?.[2] ?? raw;
    const at = ts ? new Date(ts).getTime() : startMs + lastOffset;
    const offsetMs = Math.max(0, at - startMs);
    lastOffset = offsetMs;
    const { phase, kind, toolName } = classifyLine(body, currentPhase);
    currentPhase = phase;
    lines.push({
      rawTimestamp: ts,
      offsetMs,
      rawText: body,
      friendly: rephraseLine(body, toolName),
      kind,
      toolName,
    });
  }
  // Build phases by grouping consecutive lines with the same phase.
  const order: PhaseKey[] = ["planning", "executing", "synthesizing", "reviewing", "delivered"];
  const buckets: Map<PhaseKey, TraceLine[]> = new Map();
  // Use the final phase the line ended up in — re-classify with the final state forward-only.
  let p: PhaseKey = "planning";
  for (const l of lines) {
    const { phase } = classifyLine(l.rawText, p);
    // monotonic — never go backward
    const fromIdx = order.indexOf(p);
    const toIdx = order.indexOf(phase);
    p = toIdx >= fromIdx ? phase : p;
    if (!buckets.has(p)) buckets.set(p, []);
    buckets.get(p)!.push(l);
  }
  // If the job is done, append a synthetic "delivered" phase marker.
  if (jobStatus === "succeeded" && !buckets.has("delivered")) {
    buckets.set("delivered", []);
  }
  const phases: Phase[] = [];
  for (const key of order) {
    const bucketLines = buckets.get(key);
    if (!bucketLines) continue;
    const startOffsetMs = bucketLines[0]?.offsetMs ?? lastOffset;
    const endOffsetMs = bucketLines[bucketLines.length - 1]?.offsetMs ?? startOffsetMs;
    phases.push({ key, startOffsetMs, endOffsetMs, lines: bucketLines });
  }
  return { phases, startMs, endOffsetMs: lastOffset, raw: logLines.join("\n") };
}

// ─── Components ────────────────────────────────────────────────────────

type ViewMode = "phased" | "narrate" | "raw";

export function TraceView({ job }: { job: any }) {
  const log: string[] = job.log ?? [];
  const trace = useMemo(() => parseTrace(log, job.startedAt, job.status), [log, job.startedAt, job.status]);
  const [mode, setMode] = useState<ViewMode>("phased");

  if (log.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <ViewTabs mode={mode} onChange={setMode} />
        <CopyTraceButton trace={trace} title={job.title} totalMs={trace.endOffsetMs} />
      </div>
      {mode === "phased" && <PhasedTrace trace={trace} jobStatus={job.status} />}
      {mode === "narrate" && <NarrationTrace trace={trace} />}
      {mode === "raw" && (
        <div className="bg-ink-950 border border-ink-800 rounded-md p-3 max-h-72 overflow-auto scrollbar-thin">
          <pre className="text-[11px] font-mono text-cream-200 whitespace-pre-wrap">{trace.raw}</pre>
        </div>
      )}
    </div>
  );
}

function ViewTabs({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const tabs: { id: ViewMode; label: string }[] = [
    { id: "phased", label: "Timeline" },
    { id: "narrate", label: "Narration" },
    { id: "raw", label: "Raw log" },
  ];
  return (
    <div className="inline-flex gap-1 p-0.5 bg-ink-950 border border-ink-800 rounded-md">
      {tabs.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`px-3 py-1 text-[11px] rounded transition-colors nw-press ${mode === t.id ? "bg-violet-500/20 text-violet-300 border border-violet-500/40" : "text-cream-300/70 hover:text-cream-100"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function PhasedTrace({ trace, jobStatus }: { trace: ReturnType<typeof parseTrace>; jobStatus: string }) {
  const running = jobStatus === "running" || jobStatus === "pending";
  const lastPhaseIdx = trace.phases.length - 1;
  return (
    <div className="space-y-2">
      {trace.phases.map((phase, i) => {
        const def = PHASE_DEFS[phase.key];
        const dur = Math.max(0, phase.endOffsetMs - phase.startOffsetMs);
        const isActive = running && i === lastPhaseIdx;
        return (
          <div
            key={phase.key}
            className={`bg-ink-950 border rounded-lg overflow-hidden nw-fade-up nw-delay-${Math.min(7, i + 1)} ${
              phase.key === "delivered" ? "border-leaf-500/40" :
              isActive ? "border-violet-500/40" : "border-ink-800"
            }`}
          >
            <PhaseHeader def={def} startOffsetMs={phase.startOffsetMs} durationMs={dur} active={isActive} lineCount={phase.lines.length} />
            {phase.lines.length > 0 && <PhaseBody lines={phase.lines} />}
          </div>
        );
      })}
    </div>
  );
}

function PhaseHeader({ def, startOffsetMs, durationMs, active, lineCount }: {
  def: typeof PHASE_DEFS[PhaseKey]; startOffsetMs: number; durationMs: number; active: boolean; lineCount: number;
}) {
  const { Icon, label, color } = def;
  const ringColor = color === "violet" ? "text-violet-400 bg-violet-500/15"
    : color === "flame" ? "text-flame-400 bg-flame-500/15"
    : color === "coral" ? "text-coral-400 bg-coral-500/15"
    : color === "leaf" ? "text-leaf-400 bg-leaf-500/15"
    : "text-cream-300 bg-ink-800";
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-ink-800/60">
      <span className={`inline-grid place-items-center w-7 h-7 rounded-full ${ringColor}`}>
        <Icon size={14} />
      </span>
      <span className="text-sm font-medium text-cream-100">{label}</span>
      {active && (
        <span className="nw-thinking-dots text-violet-400 ml-1"><span /><span /><span /></span>
      )}
      <span className="text-[10px] font-mono text-cream-300/40 ml-auto tabular-nums">
        {fmtOffset(startOffsetMs)} · {fmtDuration(durationMs)}{lineCount ? ` · ${lineCount}` : ""}
      </span>
    </div>
  );
}

function PhaseBody({ lines }: { lines: TraceLine[] }) {
  return (
    <div className="px-2 py-2 space-y-1">
      {lines.map((line, i) => <PhaseLine key={i} line={line} />)}
    </div>
  );
}

function PhaseLine({ line }: { line: TraceLine }) {
  const [expanded, setExpanded] = useState(false);
  const isStep = line.kind === "step";
  const isRetry = line.kind === "retry";
  const Indicator = isStep ? Cog : isRetry ? AlertTriangle : ChevronRight;
  const indicatorColor = isStep ? "text-flame-400" : isRetry ? "text-flame-300" : "text-cream-300/40";
  return (
    <div className="text-[12px]">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-2 px-2 py-1 rounded hover:bg-ink-900 text-left nw-press"
      >
        <span className="text-[10px] font-mono text-cream-300/50 tabular-nums shrink-0 mt-0.5 w-12">{fmtOffset(line.offsetMs)}</span>
        {expanded ? <ChevronDown size={11} className="text-cream-300/40 shrink-0 mt-1" /> : <Indicator size={11} className={`${indicatorColor} shrink-0 mt-1`} />}
        <span className="flex-1 min-w-0">
          <span className="text-cream-200">{line.friendly}</span>
        </span>
        {line.toolName && (
          <span className="text-[10px] font-mono text-cream-300/40 shrink-0 px-1.5 py-0.5 bg-ink-900 rounded">{line.toolName}</span>
        )}
      </button>
      {expanded && (
        <div className="pl-16 pr-2 py-1 text-[11px] font-mono text-cream-300/60 break-all bg-ink-900/50 rounded mt-0.5">
          {line.rawText}
        </div>
      )}
    </div>
  );
}

function NarrationTrace({ trace }: { trace: ReturnType<typeof parseTrace> }) {
  const lines: TraceLine[] = trace.phases.flatMap(p => p.lines);
  return (
    <div className="bg-ink-950 border border-ink-800 rounded-lg px-4 py-3 space-y-1.5">
      {lines.map((line, i) => (
        <div key={i} className={`flex items-start gap-3 text-[13px] nw-fade-up nw-delay-${Math.min(7, (i % 7) + 1)}`}>
          <span className="text-[10px] font-mono text-cream-300/40 tabular-nums shrink-0 mt-1 w-12">{fmtOffset(line.offsetMs)}</span>
          <span className={`flex-1 ${line.kind === "retry" ? "text-flame-300" : "text-cream-200"}`}>
            {line.kind === "step" && <Cog size={11} className="inline mr-1.5 text-flame-400/80 align-middle" />}
            {line.kind === "retry" && <AlertTriangle size={11} className="inline mr-1.5 text-flame-300 align-middle" />}
            {line.friendly}
          </span>
        </div>
      ))}
    </div>
  );
}

function CopyTraceButton({ trace, title, totalMs }: { trace: ReturnType<typeof parseTrace>; title?: string; totalMs: number }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    const md = renderTraceAsMarkdown(trace, title ?? "Task", totalMs);
    try {
      void navigator.clipboard.writeText(md);
      setCopied(true);
      showToast("Trace copied as markdown", "success", 1800);
      setTimeout(() => setCopied(false), 2000);
    } catch { showToast("Copy failed — clipboard blocked", "error"); }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border border-ink-700 text-cream-300/70 hover:text-cream-100 hover:border-violet-500/40 nw-press"
      title="Copy the trace as markdown"
    >
      {copied ? <ClipboardCheck size={11} /> : <Clipboard size={11} />}
      {copied ? "Copied" : "Copy trace"}
    </button>
  );
}

function renderTraceAsMarkdown(trace: ReturnType<typeof parseTrace>, title: string, totalMs: number): string {
  const out: string[] = [];
  out.push(`# Trace — ${title}`);
  out.push(`Total: ${fmtDuration(totalMs)}`);
  out.push("");
  for (const phase of trace.phases) {
    const def = PHASE_DEFS[phase.key];
    const dur = Math.max(0, phase.endOffsetMs - phase.startOffsetMs);
    out.push(`## ${def.label} — ${fmtOffset(phase.startOffsetMs)} (${fmtDuration(dur)})`);
    for (const line of phase.lines) {
      const prefix = line.kind === "step" ? "▶" : line.kind === "retry" ? "⚠" : "·";
      out.push(`- \`${fmtOffset(line.offsetMs)}\` ${prefix} ${line.friendly}`);
    }
    out.push("");
  }
  return out.join("\n");
}
