import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { Terminal as TerminalIcon, AlertTriangle, Trash2, CornerDownLeft, Loader2 } from "lucide-react";
import { api } from "../lib/api";

// UI terminal — a NON-interactive command runner. Each Enter sends one command
// to /api/terminal/exec, which spawns a fresh shell, runs it (chaining with
// && / ; / | is fine), and returns stdout+stderr+exit. `cd` persists because
// the server reads the shell's resulting cwd back. No PTY, so interactive
// programs (vim, top, prompts) won't work — by design, to fit the app's
// request/response architecture.

type Entry = {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  elapsedMs: number;
  error?: string;
};

export function Terminal() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [hint, setHint] = useState<string | undefined>();
  const [shell, setShell] = useState<string>("");
  const [cwd, setCwd] = useState<string>("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.terminalStatus()
      .then(s => { setEnabled(s.enabled); setHint(s.hint); setShell(s.shell); setCwd(s.cwd); })
      .catch(() => setEnabled(false));
  }, []);

  // Keep the scrollback pinned to the newest output.
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [entries, running]);

  async function run() {
    const command = input.trim();
    if (!command || running) return;
    if (command === "clear" || command === "cls") { setEntries([]); setInput(""); return; }
    setInput("");
    setHistory(h => [...h, command]);
    setHistIdx(null);
    setRunning(true);
    try {
      const r = await api.terminalExec(command, cwd || undefined);
      setCwd(r.cwd);
      setEntries(e => [...e, {
        command, cwd: cwd || r.cwd, stdout: r.stdout, stderr: r.stderr,
        exitCode: r.exitCode, timedOut: r.timedOut, elapsedMs: r.elapsedMs,
      }]);
    } catch (e: any) {
      setEntries(prev => [...prev, {
        command, cwd, stdout: "", stderr: "", exitCode: null, timedOut: false,
        elapsedMs: 0, error: e?.message ?? String(e),
      }]);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); void run(); return; }
    // Up/Down cycle command history.
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next); setInput(history[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === null) return;
      const next = histIdx + 1;
      if (next >= history.length) { setHistIdx(null); setInput(""); }
      else { setHistIdx(next); setInput(history[next]); }
    } else if (e.key === "l" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault(); setEntries([]);
    }
  }

  const prompt = (dir: string) => {
    // Show a compact prompt: last 2 path segments.
    const parts = dir.replace(/[\\/]+$/, "").split(/[\\/]/);
    const tail = parts.slice(-2).join("/");
    return tail || dir;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl text-cream-50 flex items-center gap-3"><TerminalIcon size={24} /> Terminal</h1>
        <p className="text-sm text-cream-300/70 mt-1">
          Run shell commands on the host{shell ? <> via <span className="font-mono">{shell}</span></> : null}. Each line runs in a fresh shell and <span className="font-mono">cd</span> persists.
          {shell === "powershell"
            ? <> Chain with <span className="font-mono">;</span> or <span className="font-mono">|</span> — Windows PowerShell 5.1 has no <span className="font-mono">&amp;&amp;</span>.</>
            : <> Chain with <span className="font-mono">&amp;&amp;</span> / <span className="font-mono">;</span> / <span className="font-mono">|</span>.</>}
          {" "}Non-interactive — no <span className="font-mono">vim</span>/<span className="font-mono">top</span>.
        </p>
      </div>

      {enabled === false && (
        <div className="flex items-start gap-3 rounded-lg border border-flame-500/30 bg-flame-500/10 px-4 py-3 text-sm text-flame-300">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-flame-200">Terminal is disabled</div>
            <div className="mt-0.5 text-flame-300/90">{hint ?? "set NEUROWORKS_TERMINAL=1 in clawbot/.env and restart the server to enable."}</div>
            <div className="mt-1 text-flame-300/70">It runs arbitrary commands on the host with the server's privileges — only enable on a machine you trust. The server listens on 127.0.0.1 only.</div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-ink-800 bg-ink-950/80 overflow-hidden shadow-inner">
        {/* title bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-ink-800 bg-ink-900/60">
          <div className="flex items-center gap-2 text-xs text-cream-300/60 font-mono">
            <span className="w-2.5 h-2.5 rounded-full bg-flame-500/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-leaf-500/60" />
            <span className="ml-2 truncate max-w-[40ch]" title={cwd}>{cwd || "—"}</span>
          </div>
          <button
            type="button"
            onClick={() => setEntries([])}
            className="flex items-center gap-1.5 text-xs text-cream-300/60 hover:text-cream-100 transition-colors"
            title="Clear scrollback (Ctrl+L)"
          >
            <Trash2 size={13} /> Clear
          </button>
        </div>

        {/* scrollback */}
        <div ref={scrollRef} className="h-[58vh] overflow-y-auto scrollbar-thin px-4 py-3 font-mono text-[13px] leading-relaxed">
          {entries.length === 0 && !running && (
            <div className="text-cream-300/40 select-none">
              {enabled === false
                ? "Enable the terminal to start running commands."
                : "Type a command below and press Enter. ↑/↓ for history, Ctrl+L to clear, 'clear' to reset."}
            </div>
          )}
          {entries.map((en, i) => (
            <div key={i} className="mb-2">
              <div className="flex items-baseline gap-2">
                <span className="text-violet-400 shrink-0">{prompt(en.cwd)} ❯</span>
                <span className="text-cream-100 break-all whitespace-pre-wrap">{en.command}</span>
              </div>
              {en.error && <div className="text-flame-400 whitespace-pre-wrap break-all">{en.error}</div>}
              {en.stdout && <div className="text-cream-200 whitespace-pre-wrap break-all">{en.stdout}</div>}
              {en.stderr && <div className="text-amber-300/90 whitespace-pre-wrap break-all">{en.stderr}</div>}
              {(en.exitCode !== null && en.exitCode !== 0) || en.timedOut ? (
                <div className="text-flame-400/80 text-[11px] mt-0.5">
                  {en.timedOut ? "timed out" : `exit ${en.exitCode}`} · {en.elapsedMs} ms
                </div>
              ) : (en.error ? null : (
                <div className="text-cream-300/40 text-[11px] mt-0.5">exit 0 · {en.elapsedMs} ms</div>
              ))}
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 text-cream-300/60">
              <Loader2 size={14} className="animate-spin" /> running…
            </div>
          )}
        </div>

        {/* prompt input */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-ink-800 bg-ink-900/40">
          <span className="font-mono text-[13px] text-violet-400 shrink-0">{prompt(cwd)} ❯</span>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={enabled === false || running}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={enabled === false ? "terminal disabled" : "command…"}
            className="flex-1 bg-transparent outline-none font-mono text-[13px] text-cream-100 placeholder:text-cream-300/30 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void run()}
            disabled={enabled === false || running || !input.trim()}
            className="flex items-center gap-1 text-xs text-cream-300/60 hover:text-cream-100 disabled:opacity-30 disabled:hover:text-cream-300/60 transition-colors"
            title="Run (Enter)"
          >
            <CornerDownLeft size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
