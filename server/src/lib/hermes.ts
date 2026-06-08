// Hermes executor adapter — runs a task through the Hermes CLI agent and
// returns a result shaped like clawbot's plan/execute output (so the chat job,
// curation gate, and Reports all work unchanged).
//
// "Persona-shifter features": Hermes runs its OWN tool suite (it cannot use
// clawbot's vault/connector/primitive tools), but we inject the PROMPT-level
// features the persona-shifter carries — the active persona's lane + voice
// (personaSystemSuffix), the matched skill playbook, and the governance
// prefix — as a system preamble so Hermes adopts the hired employee's framing.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";

// Locate the Hermes binary installed by the Nous Research installer (same
// detection the external-agents route uses): %LOCALAPPDATA%/hermes/... on
// Windows, $HERMES_HOME, or ~/.hermes on Unix.
export function detectHermesBin(): string | null {
  const home = process.env.HERMES_HOME
    ?? (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "hermes") : null)
    ?? (process.env.HOME ? path.join(process.env.HOME, ".hermes") : null);
  if (!home) return null;
  for (const rel of ["hermes-agent/venv/Scripts/hermes.exe", "hermes-agent/venv/bin/hermes"]) {
    const p = path.join(home, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

export function hermesAvailable(): boolean {
  return detectHermesBin() !== null;
}

// Cap the injected preamble so the CLI arg stays well within OS limits and we
// don't pay for a giant prompt. Persona suffix + skill + a slice of governance.
const MAX_PREAMBLE_CHARS = 6000;
const DEFAULT_TIMEOUT_MS = 220_000;

export type HermesRunResult = {
  answer: string;
  plan: { steps: never[] };       // Hermes is single-shot from our side — no step plan to show
  runs: never[];
  hermes: true;
  model: string;
  elapsedMs: number;
  ok: boolean;
  personaIdUsed?: string | null;
  error?: string;
};

function buildPreamble(opts: { personaSuffix?: string; skillText?: string; governance?: string }): string {
  const parts: string[] = [];
  if (opts.governance && opts.governance.trim()) parts.push(opts.governance.trim());
  if (opts.personaSuffix && opts.personaSuffix.trim()) parts.push(opts.personaSuffix.trim());
  if (opts.skillText && opts.skillText.trim()) parts.push(`=== SKILL PLAYBOOK ===\n${opts.skillText.trim()}`);
  let preamble = parts.join("\n\n");
  if (preamble.length > MAX_PREAMBLE_CHARS) preamble = preamble.slice(0, MAX_PREAMBLE_CHARS) + "\n…(framing truncated)";
  return preamble;
}

export function runHermesAgent(
  task: string,
  opts: {
    personaSuffix?: string;
    skillText?: string;
    governance?: string;
    personaId?: string | null;
    push?: (line: string) => void;
    model?: string;
    timeoutMs?: number;
  } = {},
): Promise<HermesRunResult> {
  const bin = detectHermesBin();
  const model = opts.model ?? config.hermesModel;
  const push = opts.push ?? (() => {});
  const t0 = Date.now();

  if (!bin) {
    return Promise.resolve({
      answer: "The Hermes agent isn't installed on this machine, so I couldn't run this task through it. Install Hermes or switch the primary executor back to clawbot (Admin → Executor).",
      plan: { steps: [] }, runs: [], hermes: true, model, elapsedMs: 0, ok: false, error: "hermes binary not found",
    });
  }

  const preamble = buildPreamble(opts);
  const prompt = preamble ? `${preamble}\n\n=== TASK ===\n${task}` : task;
  push(`Dispatching to Hermes agent (model: ${model})…`);

  return new Promise<HermesRunResult>((resolve) => {
    const args = ["-z", prompt, "-m", model, "--provider", config.hermesProvider, "--yolo"];
    execFile(bin, args, { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: 12 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const elapsedMs = Date.now() - t0;
        const out = String(stdout ?? "").trim();
        const noFinal = /no final response was produced/i.test(out + String(stderr ?? ""));
        if (noFinal || (!out && err)) {
          const reason = noFinal
            ? `Hermes ran but produced no final response (its model "${model}" may be unavailable on the configured key).`
            : `Hermes failed: ${String(err?.message ?? "unknown error").slice(0, 160)}`;
          push(`Hermes returned no usable answer after ${(elapsedMs / 1000).toFixed(1)}s.`);
          return resolve({
            answer: reason, plan: { steps: [] }, runs: [], hermes: true, model, elapsedMs, ok: false,
            personaIdUsed: opts.personaId ?? null, error: noFinal ? "no final response" : "execution error",
          });
        }
        push(`Hermes responded in ${(elapsedMs / 1000).toFixed(1)}s (${out.length} chars).`);
        resolve({
          answer: out, plan: { steps: [] }, runs: [], hermes: true, model, elapsedMs, ok: true,
          personaIdUsed: opts.personaId ?? null,
        });
      });
  });
}
