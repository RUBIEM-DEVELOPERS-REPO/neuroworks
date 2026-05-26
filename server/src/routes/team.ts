// Multi-persona team-task endpoint.
//
// POST /api/team
// Body: { tasks: [ { persona?: string, content: string, attachments?: [...] } ] }
//
// Each task in the array gets dispatched IN PARALLEL with its own
// persona (explicit, auto-routed, or active). Returns an array of
// { taskIndex, persona, jobId | inlineText, route } so the caller can
// poll each independently.
//
// Use cases:
//   • A weekly all-hands prep: Drew prepares pipeline summary, Maya
//     drafts launch update, Fiona prepares burn-rate slide — all at once.
//   • Customer escalation triage: Casey drafts the response, Sam scopes
//     the engineering work, Logan checks the contract — same incident,
//     three roles in parallel.
//
// Routing per-task uses the same chat pipeline (templates.run +
// generalTaskRunner), so the existing lane-gate, skill-picker,
// research-trigger, and synth fallbacks all apply. The only difference
// is we dispatch N tasks at once instead of serialising via active-
// persona mutation.
//
// Concurrency: dispatched via a serialise-activate + parallel-poll
// pattern (same as the chain harness) so each task lands on a worker
// with its correct persona context. Without serialisation the active
// persona races between dispatches.

import { Router } from "express";
import { templates } from "../lib/templates.js";
import { newJob, runJob } from "../lib/jobs.js";
import { getActivePersona, personaSystemSuffix, loadPersonas } from "../lib/personas.js";
import { autoRoutePersona } from "../lib/persona-router.js";
import { resolveContextAttachment } from "./uploads.js";
import { planAndExecute } from "../lib/agent.js";

export const teamRouter = Router();

type TeamTaskInput = {
  persona?: string;
  content: string;
  attachments?: { contextId?: string }[];
};

type TeamDispatch = {
  taskIndex: number;
  persona: { id: string; name: string; role: string } | null;
  personaAutoRouted: boolean;
  jobId: string;
  route: "primary" | "auto" | "explicit" | "active";
};

// Resolve a persona id (or null) to a Persona object.
function resolvePersona(id: string | undefined | null): ReturnType<typeof getActivePersona> | null {
  if (!id) return null;
  try {
    const store = loadPersonas();
    return store.personas.find(p => p.id === id) ?? null;
  } catch { return null; }
}

teamRouter.post("/", async (req, res) => {
  try {
    const rawTasks = req.body?.tasks;
    if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
      return res.status(400).json({ error: "tasks must be a non-empty array" });
    }
    if (rawTasks.length > 12) {
      // Cap to avoid pool meltdown. Twelve concurrent persona-flavored tasks
      // already exercises the worker scale-up path; more than that is a sign
      // the caller should batch instead.
      return res.status(400).json({ error: "max 12 tasks per team request" });
    }

    const tasks = rawTasks as TeamTaskInput[];
    const dispatched: TeamDispatch[] = [];

    // Preserve the caller's active persona — we mutate it during dispatch
    // (each task gets activated so chat-stack code that reads
    // getActivePersona picks up the right one), then restore at the end.
    const originalActive = getActivePersona();

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (!t?.content || String(t.content).trim().length === 0) {
        dispatched.push({ taskIndex: i, persona: null, personaAutoRouted: false, jobId: "", route: "primary" });
        continue;
      }
      const text = String(t.content).trim();
      let persona = resolvePersona(t.persona);
      let autoRouted = false;
      let route: TeamDispatch["route"] = "explicit";
      if (!persona) {
        // No explicit persona — try auto-route, fall back to original active
        const routed = autoRoutePersona(text);
        if (routed) { persona = routed.persona; autoRouted = true; route = "auto"; }
        else if (originalActive) { persona = originalActive; route = "active"; }
        else { route = "primary"; }
      }

      // We DON'T mutate the global active persona here — each team task
      // carries its persona via personaSystemSuffix into planAndExecute
      // directly, so the singleton doesn't need to flip per-task (which
      // would race against any concurrent /api/chat caller).

      // Resolve attachments and fold into the task text.
      let attachmentBlock = "";
      let attachmentMeta: { filename: string; chars: number }[] = [];
      if (Array.isArray(t.attachments) && t.attachments.length > 0) {
        const resolved = (await Promise.all(t.attachments.map(async (a) => {
          if (!a?.contextId) return null;
          const r = await resolveContextAttachment(String(a.contextId));
          if (!r) return null;
          return { filename: r.filename, text: r.text.slice(0, 8000) };
        }))).filter(Boolean) as { filename: string; text: string }[];
        if (resolved.length > 0) {
          attachmentBlock = "\n\nAttached documents (user uploaded as context for THIS task — read them carefully and use them as primary evidence):\n" +
            resolved.map((a, ix) => `[Attachment ${ix + 1}: ${a.filename}]\n${a.text}`).join("\n\n---\n\n");
          attachmentMeta = resolved.map(r => ({ filename: r.filename, chars: r.text.length }));
        }
      }

      // Alignment directive — same as buildEnrichedTask in routes/chat.ts.
      // Team tasks regularly carry per-role deliverable lists ("Your part:
      // produce A, B, C with X, Y, Z"); without this directive the synth
      // treats those as soft hints and drops items (q1 harness saw recruiter
      // skip "must-haves / nice-to-haves / 4-stage loop" entirely).
      const alignmentDirective = text.length >= 80
        ? `\n\n**Alignment check — required before responding.** The user's request names concrete elements (counts, people, dates, scale numbers, named sections, named steps, deliverable shape). The final answer MUST address each one. If N items are asked for, produce N. If A/B/C are named, reference A, B, AND C. Honor format directives exactly. Never silently drop or substitute — if you cannot address one, say so explicitly.`
        : "";
      const enrichedTask = (persona
        ? `(You are operating as ${persona.name}, the ${persona.role}. Bias tool choices, output shape, and depth toward this role's conventions.)\n\n${text}${alignmentDirective}`
        : `${text}${alignmentDirective}`) + attachmentBlock;

      const tpl = templates.find(x => x.id === "general-task")!;
      const job = newJob(`insights:general-task`);
      job.template = tpl.id;
      job.title = `Team task #${i + 1}: ${text.slice(0, 60)}`;
      job.inputs = {
        task: enrichedTask,
        userText: text,
        teamTask: { taskIndex: i, persona: persona?.id ?? null, route },
        ...(persona ? { personaId: persona.id } : {}),
        ...(attachmentMeta.length > 0 ? { attachments: attachmentMeta } : {}),
      };
      job.requiresApproval = false;
      if (persona) job.log.push(`[${new Date().toISOString()}] team-task #${i + 1} · persona=${persona.id} · route=${route}`);
      if (attachmentMeta.length > 0) job.log.push(`[${new Date().toISOString()}] folded ${attachmentMeta.length} attachment${attachmentMeta.length === 1 ? "" : "s"}: ${attachmentMeta.map(a => `${a.filename} (${a.chars} chars)`).join(", ")}`);

      dispatched.push({
        taskIndex: i,
        persona: persona ? { id: persona.id, name: persona.name, role: persona.role } : null,
        personaAutoRouted: autoRouted,
        jobId: job.id,
        route,
      });

      // Fire the job — runs through planAndExecute the same way chat does.
      // The PERSONA SUFFIX is captured at dispatch time so the worker uses
      // the right one even after the active-persona singleton moves on.
      const pinnedSuffix = personaSystemSuffix(persona);
      void runJob(job, async (push, progress) => {
        push(persona
          ? `**${persona.name}** (${persona.role}) is on this team-task.`
          : `Running team-task on primary (no persona).`);
        return planAndExecute(enrichedTask, push, (patch) => progress(patch as Record<string, unknown>), {
          personaSystemSuffix: pinnedSuffix,
        });
      });
    }

    // No global persona mutation to undo — each task carried its own
    // persona via personaSystemSuffix on planAndExecute.
    void originalActive;

    res.json({
      kind: "team-task",
      tasksDispatched: dispatched.length,
      tasks: dispatched,
    });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
