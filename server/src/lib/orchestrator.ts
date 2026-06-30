import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { config } from "../config.js";

export type SubTask = {
  id: string;
  label: string;
  personaId?: string;
  personaName?: string;
  instructions: string;
  status: "pending" | "running" | "done" | "failed";
  output: string;
  jobId?: string;
  elapsedMs?: number;
  error?: string;
  startedAt?: string;
  endedAt?: string;
};

export type OrchestrationRunStatus = "planning" | "running" | "completed" | "failed";

export type OrchestrationRun = {
  id: string;
  label: string;
  objective: string;
  decomposition: string;
  subTasks: SubTask[];
  status: OrchestrationRunStatus;
  finalReport: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
  elapsedMs?: number;
};

const STATE_DIR = resolve(config.vaultPath, "_neuroworks");
const STATE_FILE = join(STATE_DIR, "orchestrations.json");
const MAX_RUNS = 50;

const runs = new Map<string, OrchestrationRun>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(STATE_FILE)) {
      const data = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      if (Array.isArray(data)) for (const r of data) runs.set(r.id, r);
    }
  } catch { /* corrupt state */ }
}

function persist(): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const all = [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_RUNS);
    writeFileSync(STATE_FILE, JSON.stringify(all, null, 2), "utf8");
  } catch { /* ignore */ }
}

function now(): string {
  return new Date().toISOString();
}

// LLM-based task decomposition. Takes a complex objective and splits it into
// parallel sub-tasks, each with persona mapping, instructions, and dependencies.
async function decomposeTask(objective: string): Promise<{ label: string; decomposition: string; subTasks: Omit<SubTask, "id" | "output" | "jobId" | "elapsedMs" | "error" | "startedAt" | "endedAt">[] }> {
  const { llmGenerate } = await import("./llm.js");
  const sys = `You are an orchestration planner. Break the user's objective into parallel sub-tasks that can be executed by different AI agents simultaneously.

Return ONLY valid JSON with this schema:
{
  "label": "short label for this orchestration run",
  "decomposition": "one-paragraph explanation of how you split the work",
  "subTasks": [
    {
      "label": "short task label",
      "personaName": "role name for the agent doing this (e.g. researcher, writer, analyst)",
      "personaId": "optional persona id if known",
      "instructions": "detailed instructions for what this sub-task should produce, including format and key points to cover"
    }
  ]
}

Rules:
- Each sub-task must be INDEPENDENT — no sub-task depends on another's output. The orchestrator runs them in parallel.
- 2-5 sub-tasks is ideal. More than 5 is too many.
- Each sub-task's instructions must be self-contained (the agent has NO context from other sub-tasks).
- Each sub-task should specify the output format the synthesizer needs.
- personaName should describe the role needed (e.g. "Market Researcher", "Technical Writer", "Data Analyst").`;

  const raw = await llmGenerate(objective, sys, { profile: "planning", complexity: "high", maxTokens: 1024 });
  try {
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?|```$/g, "").trim());
    return {
      label: String(parsed.label ?? objective.slice(0, 60)).trim(),
      decomposition: String(parsed.decomposition ?? "").trim(),
      subTasks: Array.isArray(parsed.subTasks) ? parsed.subTasks.map((st: any) => ({
        label: String(st.label ?? "Sub-task").trim().slice(0, 120),
        personaName: String(st.personaName ?? "Assistant").trim().slice(0, 60),
        personaId: st.personaId ? String(st.personaId).trim() : undefined,
        instructions: String(st.instructions ?? "").trim().slice(0, 2000),
        status: "pending" as const,
      })) : [],
    };
  } catch {
    // Fallback: treat the whole task as a single sub-task
    return {
      label: objective.slice(0, 60),
      decomposition: "Could not decompose — running as a single task.",
      subTasks: [{
        label: objective.slice(0, 120),
        personaName: "Assistant",
        instructions: objective.slice(0, 2000),
        status: "pending",
      }],
    };
  }
}

// Execute a single sub-task via planAndExecute
async function executeSubTask(subTask: SubTask, push: (msg: string) => void): Promise<SubTask> {
  const { planAndExecute } = await import("./agent.js");
  const startedAt = now();
  const t0 = Date.now();

  push(`[${subTask.label}] Starting…`);
  let result: any;
  try {
    const task = `You are a ${subTask.personaName ?? "AI assistant"} working on a sub-task of a larger orchestration.

YOUR SUB-TASK: ${subTask.instructions}

Produce your complete output below. Do NOT reference other sub-tasks or previous work — produce everything needed from scratch.`;
    const exec = planAndExecute(task, (m) => push(`  [${subTask.label}] ${m}`));
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`sub-task timed out after 5 minutes`)), 300_000));
    result = await Promise.race([exec, timeout]);
  } catch (e: any) {
    return {
      ...subTask,
      status: "failed",
      error: String(e?.message ?? e).slice(0, 300),
      startedAt,
      endedAt: now(),
      elapsedMs: Date.now() - t0,
    };
  }

  const answer = result?.answer ?? "";
  return {
    ...subTask,
    status: answer.trim() ? "done" : "failed",
    output: answer.trim(),
    jobId: result?.jobId,
    startedAt,
    endedAt: now(),
    elapsedMs: Date.now() - t0,
  };
}

// Synthesize sub-task outputs into a final report
async function synthesizeResults(objective: string, subTasks: SubTask[]): Promise<string> {
  const done = subTasks.filter(s => s.status === "done" && s.output.trim());
  if (done.length === 0) return "No sub-tasks produced output.";

  const { llmGenerate } = await import("./llm.js");
  const blocks = done.map((s, i) =>
    `=== Sub-task ${i + 1}: ${s.label} (${s.personaName ?? "Assistant"}) ===\n${s.output.slice(0, 3000)}`);
  const prompt = `Synthesize the following parallel sub-task outputs into a coherent final response for the original objective.

Original objective: ${objective}

Sub-task outputs:
${blocks.join("\n\n")}

Produce a well-structured final response that integrates all the information. Use headings where appropriate. Do NOT mention "sub-task" or the decomposition structure in the final output — present it as a unified answer.`;

  try {
    return await llmGenerate(prompt, "You are a synthesis specialist. Combine multiple research streams into a coherent, well-structured answer.", { profile: "synthesis", complexity: "high", maxTokens: 1536 });
  } catch {
    return done.map(s => s.output).filter(Boolean).join("\n\n---\n\n");
  }
}

export async function createOrchestration(objective: string, push: (msg: string) => void = () => {}): Promise<OrchestrationRun> {
  load();
  const t0 = Date.now();
  const id = randomUUID();

  // Phase 1: Decompose
  push("Orchestrator: Breaking down the objective into parallel sub-tasks…");
  const decomposed = await decomposeTask(objective);

  const run: OrchestrationRun = {
    id,
    label: decomposed.label,
    objective,
    decomposition: decomposed.decomposition,
    subTasks: decomposed.subTasks.map((st, i) => ({
      ...st,
      id: `${id}-${i}`,
      output: "",
      jobId: undefined,
      elapsedMs: undefined,
      error: undefined,
      startedAt: undefined,
      endedAt: undefined,
    })),
    status: "running",
    finalReport: "",
    createdAt: now(),
    updatedAt: now(),
  };
  runs.set(id, run);
  persist();
  push(`Orchestrator: Split into ${run.subTasks.length} parallel sub-tasks. ${run.decomposition}`);

  // Phase 2: Execute sub-tasks in parallel
  run.status = "running";
  run.updatedAt = now();
  persist();

  const results = await Promise.allSettled(
    run.subTasks.map(st => executeSubTask(st, push))
  );
  for (let i = 0; i < run.subTasks.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      run.subTasks[i] = r.value;
    } else {
      run.subTasks[i].status = "failed";
      run.subTasks[i].error = String(r.status === "rejected" ? r.reason : "unknown error").slice(0, 300);
    }
  }
  run.updatedAt = now();
  persist();

  push(`Orchestrator: ${run.subTasks.filter(s => s.status === "done").length}/${run.subTasks.length} sub-tasks completed. Synthesizing…`);

  // Phase 3: Synthesize
  const report = await synthesizeResults(objective, run.subTasks);
  run.finalReport = report;
  run.status = report.trim() ? "completed" : "failed";
  run.elapsedMs = Date.now() - t0;
  run.updatedAt = now();
  persist();
  push(`Orchestrator: ${run.status === "completed" ? "Done" : "Failed"} in ${((run.elapsedMs ?? 0) / 1000).toFixed(1)}s.`);

  return run;
}

export function listOrchestrations(): OrchestrationRun[] {
  load();
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOrchestration(id: string): OrchestrationRun | undefined {
  load();
  return runs.get(id);
}
