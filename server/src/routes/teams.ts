import { Router } from "express";
import { config } from "../config.js";
import {
  listTeams, getTeam, listTeamTemplates, getTeamTemplate,
  createTeamTemplate, deleteTeamTemplate, buildTasksForTeam, buildTasksForTemplate,
  type TeamTemplateTask,
} from "../lib/teams.js";

export const teamsRouter = Router();

const BASE = `http://127.0.0.1:${config.port}`;

// List pre-organized teams + team templates (built-in seeds + user-saved).
teamsRouter.get("/", (_req, res) => {
  res.json({ teams: listTeams(), templates: listTeamTemplates() });
});

// Create a user team template.
teamsRouter.post("/templates", (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    if (!name) return res.status(400).json({ error: "name required" });
    const clean: TeamTemplateTask[] = tasks
      .filter((t: any) => t && typeof t.persona === "string" && typeof t.content === "string" && t.content.trim())
      .map((t: any) => ({ persona: String(t.persona), content: String(t.content) }));
    if (clean.length === 0) return res.status(400).json({ error: "at least one task with persona + content required" });
    const tpl = createTeamTemplate({
      name,
      description: typeof req.body?.description === "string" ? req.body.description : undefined,
      teamId: typeof req.body?.teamId === "string" ? req.body.teamId : undefined,
      tasks: clean,
    });
    res.json(tpl);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

teamsRouter.delete("/templates/:id", (req, res) => {
  const ok = deleteTeamTemplate(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found (built-in templates can't be deleted)" });
  res.json({ ok: true });
});

// Dispatch a pre-org team (teamId + objective) or a team template (templateId
// [+ objective]) as a parallel multi-persona brief. Reuses /api/team so the
// jobs behave/appear exactly like a hand-built team dispatch.
teamsRouter.post("/dispatch", async (req, res) => {
  try {
    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId : undefined;
    const templateId = typeof req.body?.templateId === "string" ? req.body.templateId : undefined;
    const objective = typeof req.body?.objective === "string" ? req.body.objective : "";

    let tasks: TeamTemplateTask[] = [];
    let label = "";
    if (templateId) {
      const tpl = getTeamTemplate(templateId);
      if (!tpl) return res.status(404).json({ error: `template not found: ${templateId}` });
      tasks = buildTasksForTemplate(templateId, objective);
      label = tpl.name;
    } else if (teamId) {
      const team = getTeam(teamId);
      if (!team) return res.status(404).json({ error: `team not found: ${teamId}` });
      if (!objective.trim()) return res.status(400).json({ error: "objective required when dispatching a team" });
      tasks = buildTasksForTeam(teamId, objective);
      label = team.name;
    } else {
      return res.status(400).json({ error: "teamId or templateId required" });
    }
    if (tasks.length === 0) return res.status(400).json({ error: "no tasks to dispatch" });

    // Fan out through the existing team pipeline (loopback — origin guard
    // permits Host 127.0.0.1 with no Origin).
    const r = await fetch(`${BASE}/api/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks }),
    });
    const dispatch = await r.json().catch(() => ({}));
    res.json({ kind: "team-dispatch", label, ...dispatch });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});
