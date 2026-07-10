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
// Raised from 6000 so the injected SKILL PLAYBOOK (appended last, ~3000 chars)
// fits alongside the persona suffix + governance prefix instead of being
// truncated away. ~10k chars of preamble is still well within the CLI arg limit.
const MAX_PREAMBLE_CHARS = 10000;
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

// Always-on operating rules for Hermes runs — keeps the agent on the platform's
// sanctioned tool paths instead of shelling out to unconfigured external CLIs.
const OPERATING_RULES = [
  "=== OPERATING RULES (NeuroWorks) ===",
  "- To SEND EMAIL, use the `email.send` tool (the NeuroWorks email bridge — Mailjet/SMTP, already configured). Do NOT use Himalaya, `mail`, `sendmail`, `mutt`, or any external email CLI: they are NOT configured on this machine and will fail.",
  "- EMAIL RECIPIENTS: when the user names a recipient by NAME or ROLE (not a literal address), resolve their REAL address from the org directory first via `users.lookup` / `users.list`. NEVER invent or use placeholder/example addresses (name@example.com, '[project lead email]') — email.send rejects them. Only use a literal address when the user gave one.",
  "- To read company data / financials / connected systems, use the provided clawbot tools (connector.*, vault.*, users.*, integration.*) — not ad-hoc shell commands.",
  "- MEMORY: when the user asks what you REMEMBER / have on file about someone or something, call `memory.search` (or `memory.recall` for a known subject) — do NOT guess or say you have no memory. When the user tells you to REMEMBER a fact, call `memory.note` with {subject, fact} (add {date:\"YYYY-MM-DD\"} for a meeting/deadline so it lands on the calendar).",
  "- CALENDAR: for today's meetings use `calendar.read_today`; for a full day plan (meetings + scheduled tasks + dated memory commitments + carryover) use `calendar.plan_day`; for what the agents actually DID over a date range use `calendar.activity`. Do NOT ask the user for calendar access — these tools read the configured feed.",
  "- Prefer the provided tools over the shell whenever a tool exists for the job.",
].join("\n");

function buildPreamble(opts: { personaSuffix?: string; skillText?: string; governance?: string }): string {
  const parts: string[] = [OPERATING_RULES];
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
        // Hermes's CLI sometimes exits 0 but prints its OWN error as the "answer"
        // (e.g. "API call failed after 3 retries: HTTP 429: Provider returned
        // error" when the free model is rate-limited upstream). That string is
        // NOT a deliverable — if we returned it as ok:true it would leak straight
        // into the task result and skip the clawbot offload. Detect the CLI's
        // error shapes and treat them as a hard failure so chat.ts offloads to
        // clawbot (whose LLM path falls back to local on a transient 429).
        // Definitive CLI error markers — these never appear in a legit
        // deliverable, so match them ANYWHERE regardless of length.
        const hardErrMarker =
          /API call failed after \d+ retr/i.test(out) ||
          /\bHTTP\s+(?:429|5\d\d)\b[\s\S]{0,60}\b(?:provider returned error|rate.?limit|temporarily)\b/i.test(out) ||
          /\bfree-models-per-day\b/i.test(out);
        // Softer heuristics only when the whole output is short (an error, not a
        // long answer that happens to mention one of these words).
        const softErrMarker = out.length < 600 && (
          /^\s*(?:error|fatal|request failed|api error|exception)[:\s]/i.test(out) ||
          /^\s*\{?\s*"?error"?\s*[:=]/i.test(out) ||
          /\b(?:provider returned error|rate limit exceeded)\b/i.test(out)
        );
        const looksLikeCliError = hardErrMarker || softErrMarker;
        if (noFinal || (!out && err) || looksLikeCliError) {
          const reason = looksLikeCliError
            ? `Hermes's model call failed (${out.replace(/\s+/g, " ").slice(0, 140)}).`
            : noFinal
              ? `Hermes ran but produced no final response (its model "${model}" may be unavailable on the configured key).`
              : `Hermes failed: ${String(err?.message ?? "unknown error").slice(0, 160)}`;
          push(`Hermes returned no usable answer after ${(elapsedMs / 1000).toFixed(1)}s.`);
          return resolve({
            answer: reason, plan: { steps: [] }, runs: [], hermes: true, model, elapsedMs, ok: false,
            personaIdUsed: opts.personaId ?? null, error: looksLikeCliError ? "model call failed" : noFinal ? "no final response" : "execution error",
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
