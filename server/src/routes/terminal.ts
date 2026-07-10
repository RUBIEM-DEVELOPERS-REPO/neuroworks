import { Router } from "express";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Terminal command runner. Powers the UI Terminal page. NON-interactive:
// each request runs one command (which may itself chain with && / ; / |) in a
// fresh shell, captures stdout+stderr+exit, and returns. `cd` persists because
// we read the shell's resulting working directory back via a marker line.
//
// SECURITY — this runs ARBITRARY shell commands in the host process with the
// server's privileges. It is GATED behind NEUROWORKS_TERMINAL=1 (off by default)
// and the server only listens on 127.0.0.1. Never expose this server to a
// network without removing this route. Same trust model as the code.exec
// primitive: treat the operator as the author.

export const terminalRouter = Router();

const ENABLED = () => process.env.NEUROWORKS_TERMINAL === "1";
const isWin = process.platform === "win32";
const CWD_MARK = "__NWCWD__:";
const EXIT_MARK = "__NWEXIT__:";
const MAX_STDOUT = 100_000;
const MAX_STDERR = 20_000;

// One shared working directory for the terminal "session". Starts at the
// clawbot repo root (process.cwd()) and moves as the user runs `cd`.
let sessionCwd = process.cwd();

function safeCwd(requested?: string): string {
  if (requested && typeof requested === "string") {
    try {
      const r = resolve(requested);
      if (existsSync(r) && statSync(r).isDirectory()) return r;
    } catch { /* fall through */ }
  }
  if (existsSync(sessionCwd)) return sessionCwd;
  sessionCwd = homedir();
  return sessionCwd;
}

terminalRouter.get("/status", (_req, res) => {
  res.json({
    enabled: ENABLED(),
    cwd: sessionCwd,
    shell: isWin ? "powershell" : "bash",
    platform: process.platform,
    hint: ENABLED() ? undefined : "set NEUROWORKS_TERMINAL=1 in clawbot/.env and restart to enable",
  });
});

terminalRouter.post("/exec", async (req, res) => {
  if (!ENABLED()) {
    return res.status(400).json({ error: "terminal disabled", hint: "set NEUROWORKS_TERMINAL=1 in clawbot/.env and restart to enable. It runs arbitrary shell commands on the host." });
  }
  const command = typeof req.body?.command === "string" ? req.body.command : "";
  if (!command.trim()) return res.status(400).json({ error: "command is required" });
  if (command.length > 20_000) return res.status(400).json({ error: "command too long (max 20000 chars)" });
  const timeoutMs = Math.min(300_000, Math.max(1_000, Number(req.body?.timeoutMs ?? 120_000)));
  const cwd = safeCwd(typeof req.body?.cwd === "string" ? req.body.cwd : undefined);

  // We feed the command to the shell over stdin (rather than as a -c argument)
  // so the user's own quoting is never mangled. Trailing marker lines print the
  // shell's final working directory (so `cd` persists) and a real exit code —
  // PowerShell otherwise leaves the process code at 0 even when a command fails,
  // so we compute it from $?/$LASTEXITCODE captured right after the command.
  const bin = isWin ? "powershell.exe" : "bash";
  const args = isWin ? ["-NoProfile", "-NonInteractive", "-Command", "-"] : ["-s"];
  // Windows preamble (runs BEFORE the user's command so $? still reflects the
  // command when we capture it):
  //   • $ProgressPreference=SilentlyContinue — stops cmdlets like
  //     Invoke-WebRequest / Copy-Item from spraying progress-bar control codes
  //     into the captured stream (a top cause of "garbled / hung" output).
  //   • UTF-8 output encoding — so native tools that emit UTF-8 (git, node,
  //     python) don't come back mojibake'd in the OEM codepage. Guarded because
  //     [Console]::OutputEncoding throws when there's no real console handle.
  const winPreamble =
    `$ProgressPreference='SilentlyContinue'\n` +
    `try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}\n` +
    `try { $OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}\n`;
  const script = isWin
    ? winPreamble +
      `${command}\n` +
      `$__ok=$?; $__le=$LASTEXITCODE\n` +
      `if ($__ok) { $__ec = 0 } elseif ($__le) { $__ec = $__le } else { $__ec = 1 }\n` +
      `Write-Output ("${CWD_MARK}" + (Get-Location).Path)\n` +
      `Write-Output ("${EXIT_MARK}" + $__ec)\n`
    : `${command}\n__ec=$?\n` +
      `printf '\\n${CWD_MARK}%s\\n' "$PWD"\n` +
      `printf '${EXIT_MARK}%s\\n' "$__ec"\n`;

  const t0 = Date.now();
  let proc;
  try {
    proc = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
  } catch (e: any) {
    return res.status(500).json({ error: `failed to start shell: ${e?.message ?? e}` });
  }

  let stdout = "";
  let stderr = "";
  let killedForTimeout = false;
  proc.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); if (stdout.length > MAX_STDOUT * 2) stdout = stdout.slice(0, MAX_STDOUT * 2); });
  proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); if (stderr.length > MAX_STDERR * 2) stderr = stderr.slice(0, MAX_STDERR * 2); });

  const timer = setTimeout(() => { killedForTimeout = true; try { proc.kill("SIGKILL"); } catch {} }, timeoutMs);

  proc.on("error", (e: any) => {
    clearTimeout(timer);
    if (!res.headersSent) res.status(500).json({ error: `shell error: ${e?.message ?? e}` });
  });

  proc.on("close", (code) => {
    clearTimeout(timer);
    // Pull the trailing marker lines out of stdout. They're appended last, so
    // slicing at the first marker removes both the cwd and exit lines from view.
    let newCwd = cwd;
    let markedExit: number | null = null;
    const cwdIdx = stdout.lastIndexOf(CWD_MARK);
    if (cwdIdx !== -1) {
      const tail = stdout.slice(cwdIdx);
      const cwdLine = tail.slice(CWD_MARK.length).split("\n", 1)[0].trim();
      if (cwdLine) newCwd = cwdLine;
      const exitIdx = tail.indexOf(EXIT_MARK);
      if (exitIdx !== -1) {
        const n = parseInt(tail.slice(exitIdx + EXIT_MARK.length).split("\n", 1)[0].trim(), 10);
        if (!Number.isNaN(n)) markedExit = n;
      }
      stdout = stdout.slice(0, cwdIdx).replace(/\n+$/, "");
    }
    if (existsSync(newCwd)) sessionCwd = newCwd;

    // Prefer the marker exit code (PowerShell's process code is unreliable).
    // If the markers never ran (e.g. a parse error aborted the script), fall
    // back to the process code, and treat "0 but wrote to stderr" as failure.
    let exitCode: number | null;
    if (killedForTimeout) exitCode = null;
    else if (markedExit !== null) exitCode = markedExit;
    else if (code && code !== 0) exitCode = code;
    else exitCode = stderr.trim() ? 1 : (code ?? 0);

    if (!res.headersSent) {
      res.json({
        ok: true,
        command,
        exitCode,
        timedOut: killedForTimeout,
        stdout: stdout.slice(0, MAX_STDOUT),
        stderr: stderr.slice(0, MAX_STDERR),
        cwd: sessionCwd,
        elapsedMs: Date.now() - t0,
      });
    }
  });

  proc.stdin.write(script);
  proc.stdin.end();
});
