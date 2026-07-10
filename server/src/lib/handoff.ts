// Agent hand-off relay — a SEQUENTIAL team workflow.
//
// Where /api/team fans an objective out to every member IN PARALLEL, a hand-off
// run passes ONE task DOWN A CHAIN: the first teammate does their slice, then
// hands the work + their report to the next teammate, and so on until someone
// marks it COMPLETE (or the chain is exhausted). Each agent sees the accumulated
// relay log, so later members build on earlier work instead of starting cold.
//
// Every step is recorded on a HandoffRun with timestamps, the agent's output,
// and the hand-off decision, so the Team page can render the relay as a live
// activity timeline ("Maya → handed to → Sam → handed to → Casey ✓ complete").
//
// The run executes inside a normal job (so it also shows in Activity / Reports),
// and the structured HandoffRun is persisted to .neuroworks/handoffs.json
// (recent runs only) so the timeline survives a poll/reload.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { getTeam, type PreorgTeam } from "./teams.js";
import { loadPersonas, personaSystemSuffix, type Persona } from "./personas.js";
import { planAndExecute } from "./agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = resolve(__dirname, "../../../.neuroworks");
const FILE = join(STATE_DIR, "handoffs.json");
const MAX_RUNS = 50;
// Cap the chain length so a relay can't ping-pong forever. Members can be
// revisited (a reviewer handing back for a fix) but only within this budget.
const MAX_STEPS_CEILING = 8;
// Hard ceiling per relay step. planAndExecute has no timeout of its own and can
// occasionally fall into a multi-minute re-plan; without this cap one runaway
// step would stall the whole relay. On timeout we mark the step failed and move
// to the next teammate.
const STEP_TIMEOUT_MS = Number(process.env.NEUROWORKS_HANDOFF_STEP_TIMEOUT_MS ?? "200000");

export type HandoffStepStatus = "pending" | "running" | "done" | "failed";
export type HandoffStep = {
  index: number;
  personaId: string;
  personaName: string;
  role: string;
  status: HandoffStepStatus;
  output: string;
  status_note: string;            // the agent's own "what I did / what's left" line
  handoffTo: string | null;       // role/name the agent handed to, or null/"COMPLETE"
  complete: boolean;              // agent declared the objective done
  jobId?: string;
  startedAt?: string;
  endedAt?: string;
  elapsedMs?: number;
};

export type HandoffRunStatus = "running" | "completed" | "exhausted" | "failed";
export type HandoffRun = {
  id: string;
  objective: string;
  teamId?: string;
  label: string;
  roster: { personaId: string; role: string; name: string }[];
  steps: HandoffStep[];
  status: HandoffRunStatus;
  finalReport: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
};

// ─── persistence (in-memory authoritative, mirrored to disk) ───
const runs = new Map<string, HandoffRun>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8"));
      if (Array.isArray(parsed)) {
        let recovered = false;
        for (const r of parsed as HandoffRun[]) {
          // Recover orphaned runs: anything persisted as "running" was being
          // driven by a process that's since exited (restart / crash). Nothing
          // is actually running now, so close it out rather than leaving the UI
          // spinning forever.
          if (r.status === "running") {
            r.status = "exhausted";
            for (const s of r.steps) if (s.status === "running") { s.status = "failed"; s.status_note = s.status_note || "interrupted by a server restart"; }
            const lastDone = [...r.steps].reverse().find(s => s.status === "done");
            r.finalReport = r.finalReport || lastDone?.output || "Relay was interrupted before completing.";
            recovered = true;
          }
          runs.set(r.id, r);
        }
        if (recovered) persist();
      }
    }
  } catch { /* start empty */ }
}

function persist(): void {
  try {
    if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
    const recent = [...runs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_RUNS);
    // Evict anything beyond the cap from the live map too, so it doesn't grow.
    if (recent.length < runs.size) {
      const keep = new Set(recent.map(r => r.id));
      for (const id of [...runs.keys()]) if (!keep.has(id)) runs.delete(id);
    }
    writeFileSync(FILE, JSON.stringify(recent, null, 2), "utf8");
  } catch { /* best-effort */ }
}

export function getHandoffRun(id: string): HandoffRun | undefined { load(); return runs.get(id); }
export function listHandoffRuns(): HandoffRun[] {
  load();
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── roster resolution ───
function resolvePersona(id: string): Persona | null {
  try { return loadPersonas().personas.find(p => p.id === id) ?? null; }
  catch { return null; }
}

export type RosterInput = { personaId: string; role?: string }[];

// Build the ordered roster either from a pre-org team or an explicit member
// list. Unknown persona ids are dropped (with their slot skipped).
function buildRoster(opts: { teamId?: string; members?: RosterInput }): HandoffRun["roster"] {
  let raw: RosterInput = [];
  if (opts.teamId) {
    const team: PreorgTeam | undefined = getTeam(opts.teamId);
    if (team) raw = team.members.map(m => ({ personaId: m.personaId, role: m.role }));
  } else if (Array.isArray(opts.members)) {
    raw = opts.members;
  }
  const roster: HandoffRun["roster"] = [];
  for (const m of raw) {
    const p = resolvePersona(m.personaId);
    if (!p) continue;
    roster.push({ personaId: p.id, role: m.role || p.role, name: p.name });
  }
  return roster;
}

// ─── the relay instruction appended to each agent's task ───
// Teaches the agent to (a) produce only its slice, (b) end with a parseable
// hand-off directive naming the next teammate or COMPLETE.
function relayInstruction(roster: HandoffRun["roster"], selfPersonaId: string): string {
  const teammates = roster
    .filter(r => r.personaId !== selfPersonaId)
    .map(r => `${r.name} (${r.role})`)
    .join(", ");
  return [
    "",
    "=== RELAY PROTOCOL (team hand-off) ===",
    "You are one link in a team relay working a single shared objective. Do ONLY your slice — the part that fits your role — building on the relay log above. Don't redo a teammate's finished work.",
    teammates ? `Teammates you can hand to: ${teammates}.` : "You are the last available teammate.",
    "When you finish your slice, end your reply with EXACTLY these two lines:",
    ">>> STATUS: <one sentence: what you completed and what still remains>",
    ">>> HANDOFF: <the role or name of the teammate who should take it next, OR the single word COMPLETE if the objective is fully done>",
    "Hand off only when another role is genuinely needed next. If your slice finishes the objective, write COMPLETE.",
  ].join("\n");
}

// Parse the trailing directives out of an agent's answer.
function parseDirectives(text: string): { status: string; handoff: string | null; complete: boolean } {
  const statusMatch = text.match(/>>>\s*STATUS:\s*(.+)/i);
  const handoffMatch = text.match(/>>>\s*HANDOFF:\s*(.+)/i);
  const status = statusMatch ? statusMatch[1].trim().split("\n")[0].slice(0, 300) : "";
  let handoffRaw = handoffMatch ? handoffMatch[1].trim().split("\n")[0].trim() : "";
  const complete = /\bcomplete\b/i.test(handoffRaw) || /^done$/i.test(handoffRaw);
  if (complete) handoffRaw = "";
  return { status, handoff: handoffRaw || null, complete };
}

// Match a hand-off target string to a roster member (by name or role, fuzzy).
function matchMember(roster: HandoffRun["roster"], target: string | null): HandoffRun["roster"][number] | null {
  if (!target) return null;
  const t = target.toLowerCase();
  return roster.find(r => t.includes(r.name.toLowerCase()) || r.name.toLowerCase().includes(t))
    ?? roster.find(r => t.includes(r.role.toLowerCase()) || r.role.toLowerCase().includes(t))
    ?? null;
}

// Strip the protocol directives from the stored output so the timeline shows
// clean prose (the parsed status/handoff are surfaced separately).
function cleanOutput(text: string): string {
  return text.replace(/>>>\s*(STATUS|HANDOFF):.*$/gim, "").trim();
}

export type HandoffStartOpts = {
  objective: string;
  teamId?: string;
  members?: RosterInput;
  label?: string;
  jobId?: string;
};

// Create + register a relay run synchronously (no agent work yet). Lets a route
// return the runId immediately, then drive execution in the background.
export function createHandoffRun(opts: HandoffStartOpts): HandoffRun {
  load();
  const now = () => new Date().toISOString();
  const run: HandoffRun = {
    id: randomUUID(),
    objective: String(opts.objective ?? "").trim(),
    teamId: opts.teamId,
    label: opts.label || (opts.teamId ? (getTeam(opts.teamId)?.name ?? "Team relay") : "Custom relay"),
    roster: buildRoster({ teamId: opts.teamId, members: opts.members }),
    steps: [],
    status: "running",
    finalReport: "",
    jobId: opts.jobId,
    createdAt: now(),
    updatedAt: now(),
  };
  runs.set(run.id, run);
  persist();
  return run;
}

// Convenience wrapper: create + execute in one call (used by tests/harness).
export async function runHandoff(opts: HandoffStartOpts & { push?: (msg: string) => void }): Promise<HandoffRun> {
  const run = createHandoffRun(opts);
  return executeHandoffRun(run, opts.push);
}

// Drive a previously-created run to completion. `push` is the job's logger so
// progress shows in Activity.
export async function executeHandoffRun(run: HandoffRun, push: (msg: string) => void = () => {}): Promise<HandoffRun> {
  load();
  const objective = run.objective;
  const roster = run.roster;
  const now = () => new Date().toISOString();

  if (!objective) { run.status = "failed"; run.finalReport = "No objective provided."; run.updatedAt = now(); persist(); return run; }
  if (roster.length === 0) { run.status = "failed"; run.finalReport = "No valid team members to relay between."; run.updatedAt = now(); persist(); return run; }

  // Single pass: each teammate contributes at most once. The agent's hand-off
  // directive only re-orders WHO goes next among teammates who haven't gone yet
  // — it can't send work back to someone who already contributed (that caused
  // ping-pong loops). So the chain is at most roster.length steps.
  const maxSteps = Math.min(roster.length, MAX_STEPS_CEILING);
  const relayLog: { name: string; role: string; output: string; status: string }[] = [];
  const visitCount = new Map<string, number>();

  let current: HandoffRun["roster"][number] | null = roster[0];
  let stepIndex = 0;

  while (current && stepIndex < maxSteps) {
    // Bind to a const so narrowing survives the awaits below (TS widens a
    // reassigned `let` back to nullable after any await).
    const active: HandoffRun["roster"][number] = current;
    const persona = resolvePersona(active.personaId);
    const step: HandoffStep = {
      index: stepIndex,
      personaId: active.personaId,
      personaName: active.name,
      role: active.role,
      status: "running",
      output: "",
      status_note: "",
      handoffTo: null,
      complete: false,
      startedAt: now(),
    };
    run.steps.push(step);
    run.updatedAt = now();
    persist();
    push(`Relay step ${stepIndex + 1}: ${active.name} (${active.role}) is working the objective…`);

    // Build the task: objective + the relay log so far + the protocol.
    const logBlock = relayLog.length === 0
      ? "(You are first — no prior work yet.)"
      : relayLog.map((e, i) =>
          `--- Relay entry ${i + 1}: ${e.name} (${e.role}) ---\n${e.output.slice(0, 2500)}\n[their status: ${e.status || "n/a"}]`,
        ).join("\n\n");
    const task = [
      `TEAM OBJECTIVE: ${objective}`,
      "",
      "RELAY LOG (what teammates have produced so far):",
      logBlock,
      relayInstruction(roster, active.personaId),
    ].join("\n");

    const t0 = Date.now();
    let answer = "";
    try {
      const exec = planAndExecute(task, (m) => push(`  · ${active.name}: ${m}`), undefined, {
        personaSystemSuffix: personaSystemSuffix(persona),
      });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`step timed out after ${Math.round(STEP_TIMEOUT_MS / 1000)}s`)), STEP_TIMEOUT_MS));
      const result = await Promise.race([exec, timeout]);
      answer = String(result?.answer ?? "").trim();
      step.status = "done";
    } catch (e: any) {
      answer = "";
      step.status = "failed";
      step.status_note = `error: ${String(e?.message ?? e).slice(0, 200)}`;
      push(`  · ${active.name} failed: ${step.status_note}`);
    }
    step.elapsedMs = Date.now() - t0;
    step.endedAt = now();

    const directives = parseDirectives(answer);
    step.output = cleanOutput(answer);
    if (directives.status) step.status_note = directives.status;
    step.handoffTo = directives.complete ? "COMPLETE" : directives.handoff;
    step.complete = directives.complete;
    run.updatedAt = now();
    persist();

    relayLog.push({ name: active.name, role: active.role, output: step.output, status: step.status_note });
    visitCount.set(active.personaId, (visitCount.get(active.personaId) ?? 0) + 1);

    if (directives.complete) {
      push(`${active.name} marked the objective COMPLETE after ${stepIndex + 1} step(s).`);
      break;
    }

    // Decide the next link among teammates who HAVEN'T contributed yet. Honor
    // the agent's named target if it points at an unvisited teammate; otherwise
    // fall through to the next unvisited member in roster order. When everyone
    // has contributed, the chain is done (single pass — no revisits).
    const unvisited = (r: HandoffRun["roster"][number]) => (visitCount.get(r.personaId) ?? 0) === 0;
    let next = matchMember(roster, directives.handoff);
    if (next && !unvisited(next)) next = null;
    if (!next) next = roster.find(unvisited) ?? null;
    if (next) push(`${active.name} → hands off to → ${next.name} (${next.role}).`);
    else push(`${active.name} is the last contributor — every teammate has worked the objective.`);
    current = next;
    stepIndex += 1;
  }

  // Finalize. "completed" when someone declared COMPLETE, or the chain made a
  // full single pass (every roster member contributed a done step). "exhausted"
  // only when the chain stopped early (e.g. a failure broke the relay). "failed"
  // when no step produced anything.
  const lastDone = [...run.steps].reverse().find(s => s.status === "done");
  const everyoneContributed = roster.every(r => run.steps.some(s => s.personaId === r.personaId && s.status === "done"));
  run.status = run.steps.every(s => s.status === "failed")
    ? "failed"
    : (run.steps.some(s => s.complete) || everyoneContributed)
      ? "completed"
      : "exhausted";
  run.finalReport = lastDone?.output || run.steps[run.steps.length - 1]?.output || "No output produced.";
  run.updatedAt = now();
  persist();
  push(`Relay ${run.status} after ${run.steps.length} step(s).`);
  return run;
}
